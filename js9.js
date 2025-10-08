// js6_mqtt_auth.js (Updated for custom server with authentication)

// This initial check for the Paho library remains the same.
console.log('js6.js: Top - typeof Paho:', typeof Paho);
if (typeof Paho !== 'undefined') {
    console.log('js6.js: Top - Paho object:', Paho);
    console.log('js6.js: Top - typeof Paho.Client:', typeof Paho.Client);
}
if (typeof Paho === 'undefined' || typeof Paho.Client === 'undefined') {
    console.error("FATAL: Paho MQTT Client not found. Ensure paho-mqtt.min.js is included BEFORE this script.");
} else {
    console.log("MQTT_Ctrl Pre-Check: Paho MQTT library (Paho.Client) appears to be loaded.");
}


const MQTT_Ctrl = (() => {
    // --- Configuration ---
    // ========================================================================
    // === 1. UPDATE THESE VALUES FOR YOUR SERVER =============================
    // ========================================================================
    const MQTT_BROKER_HOST = 'innovanext.ddns.net'; // <-- CHANGE THIS
    const MQTT_BROKER_PORT = 8884; // <-- CHANGE THIS (e.g., 8884 for secure, 1883 for insecure)
    const MQTT_USER = 'sankar_mqtt'; // <-- ADD YOUR USERNAME
    const MQTT_PASSWORD = 'sankar@2006'; // <-- ADD YOUR PASSWORD
    // ========================================================================

    const MQTT_CLIENT_ID_WEB_PREFIX = 'acWebClient_';
    let mqttClientID = `${MQTT_CLIENT_ID_WEB_PREFIX}${Math.random().toString(16).substr(2, 8)}`;

    const MQTT_BASE_TOPIC_PREFIX = `ac_remote/SANKAR_AC_BLE_MQTT`;
    const MQTT_COMMAND_TOPIC = `${MQTT_BASE_TOPIC_PREFIX}/command_to_esp32`;
    const MQTT_STATUS_TOPIC = `${MQTT_BASE_TOPIC_PREFIX}/status_from_esp32`;
    const MQTT_ESP32_READY_TOPIC = `${MQTT_BASE_TOPIC_PREFIX}/esp32_ready`;

    let client = null;
    let connectedToBroker = false;
    let esp32ConfirmedOnline = false;

    let onDataReceivedCallback = null;
    let onConnectionStatusChangeCallback = null;
    let deviceReadyTimeoutId = null;

    function _log(message) { console.log("MQTT_Ctrl:", message); }
    function _error(message, errObj) { console.error("MQTT_Ctrl ERROR:", message, errObj || ''); }

    function _updateAndNotifyStatus(isBrokerConnectedState, isDeviceOnlineState, statusMessage) {
        const oldBroker = connectedToBroker;
        const oldDevice = esp32ConfirmedOnline;

        connectedToBroker = isBrokerConnectedState;
        esp32ConfirmedOnline = isDeviceOnlineState;

        if (onConnectionStatusChangeCallback) {
            onConnectionStatusChangeCallback('mqtt', connectedToBroker, statusMessage);
        }
    }

    function isBrokerConnected() {
        return connectedToBroker && client && client.isConnected();
    }

    function isFullyConnected() {
        return isBrokerConnected() && esp32ConfirmedOnline;
    }

    function init(config) {
        _log("init() called.");
        if (typeof Paho === 'undefined' || typeof Paho.Client === 'undefined') {
            _error("init(): Paho.Client component is missing.");
            return false;
        }

        mqttClientID = MQTT_CLIENT_ID_WEB_PREFIX + Math.random().toString(16).substr(2, 8);
        if (config && config.onDataReceived) onDataReceivedCallback = config.onDataReceived;
        if (config && config.onConnectionStatusChange) onConnectionStatusChangeCallback = config.onConnectionStatusChange;

        try {
            _log(`Creating Paho.Client for ${MQTT_BROKER_HOST}:${MQTT_BROKER_PORT}, ID: ${mqttClientID}`);
            client = new Paho.Client(MQTT_BROKER_HOST, MQTT_BROKER_PORT, mqttClientID);
        } catch (e) {
            _error("Error creating Paho.Client instance:", e);
            return false;
        }

        client.onConnectionLost = (responseObject) => {
            clearTimeout(deviceReadyTimeoutId);
            if (responseObject.errorCode !== 0) {
                _error("Connection Lost -", responseObject.errorMessage);
                _updateAndNotifyStatus(false, false, "MQTT Connection Lost");
            } else {
                _log("Deliberately disconnected from MQTT broker.");
                _updateAndNotifyStatus(false, false, "MQTT Disconnected");
            }
        };

        client.onMessageArrived = (message) => {
            if (message.destinationName === MQTT_STATUS_TOPIC) {
                if (onDataReceivedCallback) onDataReceivedCallback(message.payloadString);
            } else if (message.destinationName === MQTT_ESP32_READY_TOPIC) {
                if (message.payloadString && message.payloadString.toLowerCase().includes("online")) {
                    _log("ESP32 reported 'online' via MQTT (esp32_ready topic).");
                    clearTimeout(deviceReadyTimeoutId);
                    if (connectedToBroker) {
                        _updateAndNotifyStatus(true, true, "MQTT Device Online");
                    } else {
                        _log("Received ESP32 ready, but broker connection state is false. This is unusual.");
                        if (client && client.isConnected()) {
                            _updateAndNotifyStatus(true, true, "MQTT Device Online");
                        }
                    }
                }
            }
        };
        _log("Initialized successfully. Client ID: " + mqttClientID);
        return true;
    }

    function connect() {
        if (!client) {
            _error("Connect called, but MQTT client not initialized.");
            _updateAndNotifyStatus(false, false, "MQTT System Error (Client not init)");
            return;
        }

        if (isFullyConnected()) {
            _log("Already fully connected (Broker + Device Confirmed Online).");
            _updateAndNotifyStatus(true, true, "MQTT Device Online");
            return;
        }
        if (client.isConnected() && !esp32ConfirmedOnline) {
            _log("Connected to broker, but ESP32 device not yet confirmed. Waiting for 'online' signal.");
            _updateAndNotifyStatus(true, false, "MQTT: Verifying Device...");
            _subscribeToTopicsAndRestartDeviceCheckTimer();
            return;
        }

        _log("Attempting to connect to MQTT broker...");
        esp32ConfirmedOnline = false;
        _updateAndNotifyStatus(false, false, "Connecting to MQTT Broker...");

        // ========================================================================
        // === 2. ADD USERNAME AND PASSWORD TO THE CONNECTION OPTIONS ===========
        // ========================================================================
        client.connect({
            timeout: 10,
            useSSL: (MQTT_BROKER_HOST.startsWith("wss://") || [443, 8081, 8883, 8884].includes(MQTT_BROKER_PORT)),
            
            // --- ADDED THESE LINES ---
            userName: MQTT_USER,
            password: MQTT_PASSWORD,
            // -------------------------

            onSuccess: () => {
                _log("Successfully connected to MQTT Broker!");
                _updateAndNotifyStatus(true, false, "MQTT: Verifying Device...");
                _subscribeToTopicsAndRestartDeviceCheckTimer();
            },
            onFailure: (responseObject) => {
                _error("Failed to connect to MQTT Broker:", responseObject.errorMessage);
                // Provide a more specific error for authentication failure
                if (responseObject.errorCode === 4 || responseObject.errorCode === 5) {
                    _updateAndNotifyStatus(false, false, "MQTT Auth Failed: Bad User/Pass");
                } else {
                    _updateAndNotifyStatus(false, false, "MQTT Broker Connection Failed");
                }
            },
            keepAliveInterval: 30,
            cleanSession: true
        });
        // ========================================================================
    }

    function _subscribeToTopicsAndRestartDeviceCheckTimer() {
        if (!client || !client.isConnected()) {
            _error("Cannot subscribe or start device check, not connected to broker.");
            return;
        }
        client.subscribe(MQTT_STATUS_TOPIC, {
            qos: 0,
            onSuccess: () => _log("Subscribed to Status Topic: " + MQTT_STATUS_TOPIC),
            onFailure: (e) => _error("Subscription failed for Status topic", e)
        });
        client.subscribe(MQTT_ESP32_READY_TOPIC, {
            qos: 0,
            onSuccess: () => _log("Subscribed to ESP32 Ready Topic: " + MQTT_ESP32_READY_TOPIC),
            onFailure: (e) => _error("Subscription failed for ESP32 Ready topic", e)
        });

        _startDeviceReadyCheckTimer();
    }

    function _startDeviceReadyCheckTimer() {
        clearTimeout(deviceReadyTimeoutId);
        _log("Starting timer for ESP32 'online' message (7 seconds).");
        deviceReadyTimeoutId = setTimeout(() => {
            if (connectedToBroker && !esp32ConfirmedOnline) {
                _log("Timeout: ESP32 did not send 'online' message via MQTT within 7s.");
                _updateAndNotifyStatus(true, false, "MQTT: Device Not Responding");
            }
        }, 7000);
    }

    function disconnect() {
        _log("disconnect() called by main application.");
        clearTimeout(deviceReadyTimeoutId);
        if (client && client.isConnected()) {
            _log("Actively disconnecting Paho client from MQTT broker.");
            try {
                if (client.isConnected()) client.unsubscribe(MQTT_STATUS_TOPIC);
                if (client.isConnected()) client.unsubscribe(MQTT_ESP32_READY_TOPIC);
                if (client.isConnected()) client.disconnect();
            } catch (e) {
                _error("Exception during Paho client.disconnect() sequence:", e);
                _updateAndNotifyStatus(false, false, "MQTT Disconnect Error");
            }
        } else {
            _log("disconnect() called but Paho client already disconnected or not initialized.");
            _updateAndNotifyStatus(false, false, "MQTT Disconnected");
        }
    }

    function publish(commandObject) {
        if (!isBrokerConnected()) {
            _error("Cannot publish: Not connected to MQTT broker.");
            return false;
        }
        if (!isFullyConnected()) {
            _log("Warning: Publishing command, but ESP32 device is not confirmed online. Message might be queued or lost.");
        }

        const jsonString = JSON.stringify(commandObject);
        const message = new Paho.Message(jsonString);
        message.destinationName = MQTT_COMMAND_TOPIC;

        try {
            client.send(message);
            return true;
        } catch (error) {
            _error("Publish error:", error);
            return false;
        }
    }

    function forceDeviceOnlineConfirmation() {
        if (isBrokerConnected() && !esp32ConfirmedOnline) {
            _log("Device online status externally confirmed (e.g., via BLE ack).");
            clearTimeout(deviceReadyTimeoutId);
            _updateAndNotifyStatus(true, true, "MQTT Device Online (Confirmed Alt)");
        } else if (!isBrokerConnected()) {
            _log("forceDeviceOnlineConfirmation called, but not even connected to broker.");
        }
    }

    function getStatus() {
        return {
            brokerConnected: connectedToBroker,
            deviceOnline: esp32ConfirmedOnline,
            fullyConnected: isFullyConnected()
        };
    }

    return {
        init,
        connect,
        disconnect,
        publish,
        isBrokerConnected,
        isFullyConnected,
        forceDeviceOnlineConfirmation,
        getStatus
    };
})();
