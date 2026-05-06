/*
    SSE + MSE audio player for low-latency streaming
*/
var AudioSsePlayer = /** @class */ (function () {
    function AudioSsePlayer(codec, mimeType, logger) {
        this.Codec = codec;
        this.MimeType = mimeType;
        this.Logger = logger || console;
        this.Queue = [];
        this.SourceBuffer = null;
        this.EventSource = null;
        this.MediaSource = new MediaSource();
        this.AudioElement = new Audio();
        this.AudioElement.autoplay = true;
        this.AudioElement.playsInline = true;
        this.ObjectUrl = URL.createObjectURL(this.MediaSource);
        this.AudioElement.src = this.ObjectUrl;
        this.MediaSource.addEventListener('sourceopen', this.OnSourceOpen.bind(this));
    }
    AudioSsePlayer.prototype.OnSourceOpen = function () {
        if (this.SourceBuffer)
            return;
        try {
            this.SourceBuffer = this.MediaSource.addSourceBuffer(this.MimeType);
            this.SourceBuffer.mode = 'sequence';
            this.SourceBuffer.addEventListener('updateend', this.ProcessQueue.bind(this));
            this.ProcessQueue();
        }
        catch (err) {
            this.Logger.error("MSE source open failed:", err);
        }
    };
    AudioSsePlayer.prototype.Start = function () {
        var _this = this;
        if (this.EventSource)
            return;
        this.EventSource = new EventSource("/audio/stream?codec=" + encodeURIComponent(this.Codec));
        this.EventSource.onmessage = function (event) {
            if (!event.data)
                return;
            var chunk = AudioSsePlayer.DecodeBase64(event.data);
            if (!chunk)
                return;
            _this.Queue.push(chunk);
            _this.ProcessQueue();
        };
        this.EventSource.onerror = function (err) {
            _this.Logger.warn("SSE error:", err);
        };
        this.AudioElement.play().catch(function (err) {
            _this.Logger.warn("Audio play failed:", err);
        });
    };
    AudioSsePlayer.prototype.ProcessQueue = function () {
        if (!this.SourceBuffer || this.SourceBuffer.updating)
            return;
        if (this.Queue.length === 0)
            return;
        var chunk = this.Queue.shift();
        if (!chunk)
            return;
        try {
            this.SourceBuffer.appendBuffer(chunk);
        }
        catch (err) {
            this.Logger.warn("MSE append failed:", err);
        }
    };
    Object.defineProperty(AudioSsePlayer.prototype, "Volume", {
        get: function () {
            return this.AudioElement ? this.AudioElement.volume : 1.0;
        },
        set: function (value) {
            if (this.AudioElement) {
                this.AudioElement.volume = value;
            }
        },
        enumerable: false,
        configurable: true
    });
    AudioSsePlayer.prototype.Reset = function () {
        if (this.EventSource) {
            this.EventSource.close();
            this.EventSource = null;
        }
        this.Queue = [];
        if (this.SourceBuffer && this.MediaSource.readyState === 'open') {
            try {
                this.MediaSource.endOfStream();
            }
            catch (_a) {
            }
        }
        if (this.AudioElement) {
            this.AudioElement.pause();
        }
        if (this.ObjectUrl) {
            URL.revokeObjectURL(this.ObjectUrl);
        }
        this.SourceBuffer = null;
        this.MediaSource = null;
        this.AudioElement = null;
    };
    AudioSsePlayer.DecodeBase64 = function (payload) {
        try {
            var binary = atob(payload);
            var len = binary.length;
            var bytes = new Uint8Array(len);
            for (var i = 0; i < len; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return bytes;
        }
        catch (_a) {
            return null;
        }
    };
    return AudioSsePlayer;
}());
