/*
    Socket fallback is part of 3LAS (Low Latency Live Audio Streaming)
    https://github.com/JoJoBond/3LAS
*/
var Fallback_Settings = /** @class */ (function () {
    function Fallback_Settings() {
        this.Formats = [
            { "Mime": "audio/mpeg", "Name": "mp3" },
            { "Mime": "audio/wave", "Name": "wav" }
        ];
        this.MaxVolume = 1.0;
        this.AutoCorrectSpeed = false;
        this.InitialBufferLength = 0.2;
    }
    return Fallback_Settings;
}());
var Fallback = /** @class */ (function () {
    function Fallback(logger, settings) {
        this.Logger = logger;
        if (!this.Logger) {
            this.Logger = new Logging(null, null);
        }
        // Create audio context
        if (typeof AudioContext !== "undefined")
            this.Audio = new AudioContext();
        else if (typeof webkitAudioContext !== "undefined")
            this.Audio = new webkitAudioContext();
        else if (typeof mozAudioContext !== "undefined")
            this.Audio = new mozAudioContext();
        else {
            this.Logger.Log('3LAS: Browser does not support "AudioContext".');
            throw new Error();
        }
        this.Settings = settings;
        this.Logger.Log("Detected: " +
            (OSName == "MacOSX" ? "Mac OSX" : (OSName == "Unknown" ? "Unknown OS" : OSName)) + ", " +
            (BrowserName == "IE" ? "Internet Explorer" : (BrowserName == "NativeChrome" ? "Chrome legacy" : (BrowserName == "Unknown" ? "Unknown Browser" : BrowserName))));
        this.SelectedFormatMime = "";
        this.SelectedFormatName = "";
        for (var i = 0; i < this.Settings.Formats.length; i++) {
            if (!AudioFormatReader.CanDecodeTypes([this.Settings.Formats[i].Mime]))
                continue;
            this.SelectedFormatMime = this.Settings.Formats[i].Mime;
            this.SelectedFormatName = this.Settings.Formats[i].Name;
            break;
        }
        if (this.SelectedFormatMime == "" || this.SelectedFormatName == "") {
            this.Logger.Log("None of the available MIME types are supported.");
            throw new Error();
        }
        this.Logger.Log("Using websocket fallback with MIME: " + this.SelectedFormatMime);
        try {
            this.Player = new LiveAudioPlayer(this.Audio, this.Logger, this.Settings.MaxVolume, this.Settings.InitialBufferLength, this.Settings.AutoCorrectSpeed);
            this.Player.BufferPlayedCallback = this.PumpDecodedAudio.bind(this);
            this.Logger.Log("Init of LiveAudioPlayer succeeded");
        }
        catch (e) {
            this.Logger.Log("Init of LiveAudioPlayer failed: " + e);
            throw new Error();
        }
        try {
            this.FormatReader = AudioFormatReader.Create(this.SelectedFormatMime, this.Audio, this.Logger, this.OnReaderError.bind(this), this.Player.CheckBeforeDecode, this.OnReaderDataReady.bind(this), AudioFormatReader.DefaultSettings());
            this.Logger.Log("Init of AudioFormatReader succeeded");
        }
        catch (e) {
            this.Logger.Log("Init of AudioFormatReader failed: " + e);
            throw new Error();
        }
        this.PacketModCounter = 0;
        this.LastCheckTime = 0;
        this.FocusChecker = 0;
        this.PendingSamples = [];
        this.PendingSamplesDuration = 0;
        this.SamplePumpTimer = 0;
        this.ResetNetworkStats();
    }
    Fallback.prototype.Init = function (webSocket) {
        this.MobileUnmute();
        this.WebSocket = webSocket;
        this.WebSocket?.Send(JSON.stringify({
            "type": "fallback",
            "data": this.SelectedFormatName
        }));
        this.StartFocusChecker();
    };
    Fallback.prototype.MobileUnmute = function () {
        var amplification = this.Audio.createGain();
        // Set volume to max
        amplification.gain.value = 1.0;
        // Connect gain node to context
        amplification.connect(this.Audio.destination);
        // Create one second buffer with silence		
        var audioBuffer = this.Audio.createBuffer(2, this.Audio.sampleRate, this.Audio.sampleRate);
        // Create new audio source for the buffer
        var sourceNode = this.Audio.createBufferSource();
        // Make sure the node deletes itself after playback
        sourceNode.onended = function (_ev) {
            sourceNode.disconnect();
            amplification.disconnect();
        };
        // Pass audio data to source
        sourceNode.buffer = audioBuffer;
        // Connect the source to the gain node
        sourceNode.connect(amplification);
        // Play source		
        sourceNode.start();
    };
    Object.defineProperty(Fallback.prototype, "Volume", {
        get: function () {
            return this.Player.Volume / this.Settings.MaxVolume;
        },
        set: function (value) {
            this.Player.Volume = value * this.Settings.MaxVolume;
        },
        enumerable: false,
        configurable: true
    });
    // Callback functions from format reader
    Fallback.prototype.OnReaderError = function () {
        this.Logger.Log("Reader error: Decoding failed.");
    };
    Fallback.prototype.OnReaderDataReady = function () {
        while (this.FormatReader.SamplesAvailable()) {
            var samples = this.FormatReader.PopSamples();
            this.PendingSamples.push(samples);
            this.PendingSamplesDuration += samples.duration;
        }
        this.PumpDecodedAudio();
    };
    Fallback.prototype.PumpDecodedAudio = function () {
        if (this.SamplePumpTimer) {
            window.clearTimeout(this.SamplePumpTimer);
            this.SamplePumpTimer = 0;
        }

        while (this.PendingSamples.length > 0 && this.Player.CanScheduleBuffer()) {
            var samples = this.PendingSamples.shift();
            this.PendingSamplesDuration = Math.max(0, this.PendingSamplesDuration - samples.duration);
            this.Player.PushBuffer(samples, this.PendingSamplesDuration);
        }

        if (this.PendingSamples.length > 0) {
            this.SamplePumpTimer = window.setTimeout(this.PumpDecodedAudio.bind(this), 25);
        }
    };
    Fallback.prototype.ResetAudioQueue = function () {
        if (this.SamplePumpTimer) {
            window.clearTimeout(this.SamplePumpTimer);
            this.SamplePumpTimer = 0;
        }
        this.PendingSamples = [];
        this.PendingSamplesDuration = 0;
    };
    // Callback function from socket connection
    Fallback.prototype.OnSocketError = function (message) {
    };
    Fallback.prototype.OnSocketConnect = function () {
    };
    Fallback.prototype.OnSocketDisconnect = function () {
    };
    Fallback.prototype.OnSocketDataReady = function (data) {
        var now = performance.now();
        var byteLength = data.byteLength || data.length || 0;
        if (this.LastPacketTime > 0) {
            var interval = now - this.LastPacketTime;
            if (interval <= 1000) {
                this.PacketIntervals.push(interval);
                if (this.PacketIntervals.length > 120)
                    this.PacketIntervals.shift();
            }
        }
        this.LastPacketTime = now;
        this.StatsWindowBytes += byteLength;
        this.UpdateReceiveRate(now);
        this.PacketModCounter++;
        if (this.PacketModCounter > 100) {
            if (this.ActivityCallback)
                this.ActivityCallback();
            this.PacketModCounter = 0;
        }
        this.FormatReader.PushData(new Uint8Array(data));
    };
    Fallback.prototype.UpdateReceiveRate = function (now) {
        var elapsed = now - this.StatsWindowStart;
        if (elapsed < 1000)
            return;
        this.ReceiveRateKbps = this.StatsWindowBytes * 8 / elapsed;
        this.StatsWindowBytes = 0;
        this.StatsWindowStart = now;
    };
    Fallback.prototype.ResetNetworkStats = function () {
        this.StatsWindowBytes = 0;
        this.StatsWindowStart = performance.now();
        this.ReceiveRateKbps = 0;
        this.LastPacketTime = 0;
        this.PacketIntervals = [];
    };
    Fallback.prototype.GetPercentile = function (values, percentile) {
        if (values.length === 0)
            return 0;
        var sorted = values.slice().sort(function (a, b) { return a - b; });
        var position = (sorted.length - 1) * percentile;
        var lower = Math.floor(position);
        var upper = Math.ceil(position);
        if (lower === upper)
            return sorted[lower];
        return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
    };
    Fallback.prototype.GetPacketTiming = function () {
        var median = this.GetPercentile(this.PacketIntervals, 0.5);
        var deviations = this.PacketIntervals.map(function (interval) {
            return Math.abs(interval - median);
        });
        return {
            IntervalMs: median,
            JitterMs: this.GetPercentile(deviations, 0.95)
        };
    };
    Fallback.prototype.GetStats = function () {
        var now = performance.now();
        this.UpdateReceiveRate(now);
        var playerStats = this.Player.GetStats();
        var packetTiming = this.GetPacketTiming();
        var baseLatencyMs = Number.isFinite(this.Audio.baseLatency) ? this.Audio.baseLatency * 1000 : null;
        var outputLatencyMs = Number.isFinite(this.Audio.outputLatency) ? this.Audio.outputLatency * 1000 : null;
        var browserOutputMs = (baseLatencyMs || 0) + (outputLatencyMs || 0);
        return {
            Format: this.SelectedFormatName.toUpperCase(),
            ReceiveRateKbps: this.ReceiveRateKbps,
            PacketIntervalMs: packetTiming.IntervalMs,
            PacketJitterMs: packetTiming.JitterMs,
            LastPacketAgeMs: this.LastPacketTime > 0 ? now - this.LastPacketTime : null,
            ScheduledBufferMs: playerStats.ScheduledBufferMs,
            PendingDecodedMs: this.PendingSamplesDuration * 1000,
            TargetBufferMs: playerStats.TargetBufferMs,
            BrowserOutputMs: baseLatencyMs === null && outputLatencyMs === null ? null : browserOutputMs,
            LocalPlaybackLatencyMs: playerStats.ScheduledBufferMs + (this.PendingSamplesDuration * 1000) + browserOutputMs,
            Underruns: playerStats.Underruns,
            SkippedBuffers: playerStats.SkippedBuffers,
            PlaybackSpeed: playerStats.PlaybackSpeed,
            SampleRate: this.Audio.sampleRate,
            AudioState: this.Audio.state
        };
    };
    Fallback.prototype.StartFocusChecker = function () {
        if (!this.FocusChecker) {
            this.LastCheckTime = Date.now();
            this.FocusChecker = window.setInterval(this.CheckFocus.bind(this), 2000);
        }
    };
    Fallback.prototype.StopFocusChecker = function () {
        if (this.FocusChecker) {
            window.clearInterval(this.FocusChecker);
            this.FocusChecker = 0;
        }
    };
    Fallback.prototype.CheckFocus = function () {
        var checkTime = Date.now();
        // Check if focus was lost
        if (checkTime - this.LastCheckTime > 10000) {
            // If so, drop all samples in the buffer
            this.Logger.Log("Focus lost, purging format reader.");
            this.FormatReader.PurgeData();
        }
        this.LastCheckTime = checkTime;
    };
    Fallback.prototype.Reset = function () {
        this.StopFocusChecker();
        this.FormatReader.Reset();
        this.ResetAudioQueue();
        this.Player.Reset();
        this.ResetNetworkStats();
        this.WebSocket = null;
    };
    return Fallback;
}());

if (typeof module !== "undefined" && module.exports) {
    module.exports = { Fallback: Fallback, Fallback_Settings: Fallback_Settings };
}
