var elapsedTimeConnectionWatchdog;
var _3LAS_Settings = /** @class */ (function () {
    function _3LAS_Settings() {
        this.SocketHost = document.location.hostname ? document.location.hostname : "127.0.0.1";
        this.SocketPath = "/";
        this.Fallback = new Fallback_Settings();
    }
    return _3LAS_Settings;
}());
var _3LAS = /** @class */ (function () {
    function _3LAS(logger, settings) {
        this.Logger = logger;
        if (!this.Logger) {
            this.Logger = new Logging(null, null);
        }
        this.Settings = settings;

        try {
            this.Fallback = new Fallback(this.Logger, this.Settings.Fallback);
            this.Fallback.ActivityCallback = this.OnActivity.bind(this);
        }
        catch (_b) {
            this.Fallback = null;
        }

        if (this.Fallback == null) {
            this.Logger.Log('3LAS: Browser does not support either media handling methods.');
            throw new Error();
        }
        if (isAndroid) {
            this.WakeLock = new WakeLock(this.Logger);
        }
    }
    Object.defineProperty(_3LAS.prototype, "Volume", {
        get: function () {
                return this.Fallback.Volume;
        },
        set: function (value) {
                this.Fallback.Volume = value;
        },
        enumerable: false,
        configurable: true
    });
    _3LAS.prototype.CanChangeVolume = function () {
            return true;
    };
    _3LAS.prototype.Start = function () {
        this.ConnectivityFlag = false;
        this.Stop(); // Attempt to mitigate the 0.5x speed/multiple stream bug

        // Stream connection watchdog monitors mp3 frames
        console.log("Stream connection watchdog active.");
        let intervalReconnectWatchdog = setInterval(() => {
            if (Stream) {
                var endTimeConnectionWatchdog = performance.now();
                elapsedTimeConnectionWatchdog = endTimeConnectionWatchdog - window.startTimeConnectionWatchdog;
                //console.log(`Stream frame elapsed time: ${elapsedTimeConnectionWatchdog} ms`);
                if (elapsedTimeConnectionWatchdog > 2000 && shouldReconnect) {
                    clearInterval(intervalReconnectWatchdog);
                    setTimeout(() => {
                        clearInterval(intervalReconnectWatchdog);
                        console.log("Unstable internet connection detected, reconnecting (" + elapsedTimeConnectionWatchdog + " ms)...");
                        this.Stop();
                        this.Start();
                    }, 2000);
                }
            } else {
                clearInterval(intervalReconnectWatchdog);
                this.Stop();
                console.log("Stream connection watchdog inactive.");
            }
        }, 3000);

        // This is stupid, but required for Android.... thanks Google :(
        if (this.WakeLock)
            this.WakeLock.Begin();
        try {
            if (window.location.protocol === 'https:') { 
                this.WebSocket = new WebSocketClient(this.Logger, 'wss://' + this.Settings.SocketHost + ':' + location.port.toString() + window.location.pathname + 'audio' , this.OnSocketError.bind(this), this.OnSocketConnect.bind(this), this.OnSocketDataReady.bind(this), this.OnSocketDisconnect.bind(this));
            }
            else {
                this.WebSocket = new WebSocketClient(this.Logger, 'ws://' + this.Settings.SocketHost + ':' + location.port.toString() + window.location.pathname + 'audio' , this.OnSocketError.bind(this), this.OnSocketConnect.bind(this), this.OnSocketDataReady.bind(this), this.OnSocketDisconnect.bind(this));
            }
            this.Logger.Log("Init of WebSocketClient succeeded");
            this.Logger.Log("Trying to connect to server.");
        }
        catch (e) {
            this.Logger.Log("Init of WebSocketClient failed: " + e);
            throw new Error();
        }
    };
    _3LAS.prototype.Stop = function () {
        try {
            // Close WebSocket connection
            if (this.WebSocket) {
                this.WebSocket.Close();
                this.WebSocket.OnClose();
                this.WebSocket = null;
                this.Logger.Log("WebSocket connection closed.");
            }

            // Stop WakeLock if it exists and is an Android device
            if (isAndroid && this.WakeLock) {
                this.WakeLock.End();
                this.Logger.Log("WakeLock stopped.");
            }

            // Reset Fallback if it exists
            if (this.Fallback) {
                this.Fallback.OnSocketDisconnect();
                this.Fallback.Stop();
                this.Fallback.Reset();
                this.Logger.Log("Fallback reset.");
            }

            // Reset connectivity flag
            if (this.ConnectivityFlag) {
                this.ConnectivityFlag = null;
                if (this.ConnectivityCallback) {
                    this.ConnectivityCallback(null);
                }
            }

            this.Logger.Log("3LAS stopped successfully.");
        } catch (e) {
            this.Logger.Log("Error while stopping 3LAS: " + e);
        }
    };
    _3LAS.prototype.OnActivity = function () {
        if (this.ActivityCallback)
            this.ActivityCallback();
        if (!this.ConnectivityFlag) {
            this.ConnectivityFlag = true;
            if (this.ConnectivityCallback)
                this.ConnectivityCallback(true);
        }
    };
    // Callback function from socket connection
    _3LAS.prototype.OnSocketError = function (message) {
        this.Logger.Log("Network error: " + message);
        this.Fallback.OnSocketError(message);
    };
    _3LAS.prototype.OnSocketConnect = function () {
        this.Logger.Log("Established connection with server.");
            this.Fallback.OnSocketConnect();
            this.Fallback.Init(this.WebSocket);
    };
    _3LAS.prototype.OnSocketDisconnect = function () {
        this.Logger.Log("Lost connection to server.");
            this.Fallback.OnSocketDisconnect();
            this.Fallback.Reset();
        if (this.ConnectivityFlag) {
            this.ConnectivityFlag = false;
            if (this.ConnectivityCallback)
                this.ConnectivityCallback(false);
    }
};

    _3LAS.prototype.OnSocketDataReady = function (data) {
        this.Fallback.OnSocketDataReady(data);
    };
    return _3LAS;
}());
