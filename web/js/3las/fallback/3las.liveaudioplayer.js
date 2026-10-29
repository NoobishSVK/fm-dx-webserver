/*
    Live audio player is part of 3LAS (Low Latency Live Audio Streaming)
    https://github.com/JoJoBond/3LAS
*/
var LiveAudioPlayer = /** @class */ (function () {
    function LiveAudioPlayer(audio, logger, maxVolume, startOffset, variableSpeed) {
        if (maxVolume === void 0) { maxVolume = 1.0; }
        if (startOffset === void 0) { startOffset = 0.2; }
        if (variableSpeed === void 0) { variableSpeed = false; }
        this.Audio = audio;
        this.Logger = logger;
        this.MaxVolume = maxVolume;
        this.StartOffset = startOffset;
        this.VariableSpeed = variableSpeed;
        this.OffsetMin = this.StartOffset - LiveAudioPlayer.OffsetVariance;
        this.OffsetMax = this.StartOffset + LiveAudioPlayer.OffsetVariance;
        this.TargetBufferLength = Math.min(LiveAudioPlayer.MaxBufferLength, Math.max(LiveAudioPlayer.MinBufferLength, startOffset));
        this.LastUnderrunTime = Date.now();
        this.LastBufferAdjustmentTime = this.LastUnderrunTime;
        // Set speed to default
        this.PlaybackSpeed = 1.0;
        // Reset variable for scheduling times
        this.NextScheduleTime = 0.0;
        this.UnderrunCount = 0;
        this.SkippedBufferCount = 0;
        this.WasUnderrunning = false;
        this.BufferPlayedCallback = null;
        // Create gain node for volume control
        this.Amplification = this.Audio.createGain();
        // Set volume to max
        this.Amplification.gain.value = 1.0;
        // Connect gain node to context
        this.Amplification.connect(this.Audio.destination);
    }
    Object.defineProperty(LiveAudioPlayer.prototype, "Volume", {
        get: function () {
            // Get volume from gain node
            return this.Amplification.gain.value;
        },
        set: function (value) {
            // Clamp value to [1e-20 ; MaxVolume]
            if (value > 1.0)
                value = this.MaxVolume;
            else if (value <= 0.0)
                value = 1e-20;
            // Cancel any scheduled ramps
            this.Amplification.gain.cancelScheduledValues(this.Audio.currentTime);
            // Change volume following a ramp (more userfriendly)
            this.Amplification.gain.exponentialRampToValueAtTime(value, this.Audio.currentTime + 0.5);
        },
        enumerable: false,
        configurable: true
    });
    LiveAudioPlayer.prototype.UpdateAdaptiveBufferTarget = function () {
        var now = Date.now();
        if (this.TargetBufferLength <= LiveAudioPlayer.MinBufferLength)
            return;
        if (now - this.LastUnderrunTime < LiveAudioPlayer.StablePeriodMs)
            return;
        if (now - this.LastBufferAdjustmentTime < LiveAudioPlayer.StablePeriodMs)
            return;

        this.TargetBufferLength = Math.max(LiveAudioPlayer.MinBufferLength, this.TargetBufferLength - LiveAudioPlayer.BufferStep);
        this.LastBufferAdjustmentTime = now;
        this.Logger.Log("Audio stable; reducing target buffer to " + Math.round(this.TargetBufferLength * 1000) + " ms.");
    };
    LiveAudioPlayer.prototype.RegisterUnderrun = function () {
        var now = Date.now();
        this.UnderrunCount++;
        console.warn("[Audio] Playback underrun at " + new Date().toISOString() + "; target " + Math.round(this.TargetBufferLength * 1000) + " ms");
        this.LastUnderrunTime = now;
        this.LastBufferAdjustmentTime = now;
        this.TargetBufferLength = Math.min(LiveAudioPlayer.MaxBufferLength, this.TargetBufferLength + LiveAudioPlayer.BufferStep);
        this.Logger.Log("Audio underrun; increasing target buffer to " + Math.round(this.TargetBufferLength * 1000) + " ms.");
    };
    LiveAudioPlayer.prototype.ObservePacketGap = function (gapSeconds) {
        if (!Number.isFinite(gapSeconds) || gapSeconds < 0.25) return;
        var target = Math.min(LiveAudioPlayer.MaxBufferLength, gapSeconds + 0.1);
        if (target > this.TargetBufferLength) {
            this.TargetBufferLength = target;
            this.LastBufferAdjustmentTime = Date.now();
            this.Logger.Log("Audio packet gap; increasing target buffer to " + Math.round(target * 1000) + " ms.");
        }
    };
    // Recieves an audiobuffer and schedules it for seamless playback
    LiveAudioPlayer.prototype.GetScheduledBufferLength = function () {
        return Math.max(0, this.NextScheduleTime - this.Audio.currentTime);
    };
    LiveAudioPlayer.prototype.CanScheduleBuffer = function () {
        return this.NextScheduleTime === 0
            || this.GetScheduledBufferLength() <= this.TargetBufferLength + LiveAudioPlayer.BufferTolerance;
    };
    LiveAudioPlayer.prototype.GetCatchUpSpeed = function (totalBufferedLength) {
        var excess = totalBufferedLength - this.TargetBufferLength;
        if (excess <= LiveAudioPlayer.BufferTolerance)
            return 1.0;
        return 1.0 + Math.min(
            LiveAudioPlayer.MaxCatchUpRate,
            Math.max(LiveAudioPlayer.MinCatchUpRate, excess * LiveAudioPlayer.CatchUpGain)
        );
    };
    LiveAudioPlayer.prototype.PushBuffer = function (buffer, pendingDecodedLength) {
        if (pendingDecodedLength === void 0) { pendingDecodedLength = 0; }
        this.UpdateAdaptiveBufferTarget();
        // Check if this is the first buffer we received
        if (this.NextScheduleTime == 0.0) {
            this.NextScheduleTime = this.Audio.currentTime + this.TargetBufferLength;
        }
        else if (this.Audio.currentTime >= this.NextScheduleTime) {
            if (!this.WasUnderrunning)
                this.RegisterUnderrun();
            this.WasUnderrunning = true;
            this.NextScheduleTime = this.Audio.currentTime + this.TargetBufferLength;
        }
        else {
            this.WasUnderrunning = false;
        }

        var scheduledBuffer = this.GetScheduledBufferLength();
        if (this.VariableSpeed) {
            this.PlaybackSpeed = 1.0;
        }
        else {
            this.PlaybackSpeed = this.GetCatchUpSpeed(scheduledBuffer + pendingDecodedLength + buffer.duration);
        }
        var duration = buffer.duration / this.PlaybackSpeed;

        var sourceNode_1 = this.Audio.createBufferSource();
        var _this = this;
        sourceNode_1.onended = function (_ev) {
            sourceNode_1.disconnect();
            if (_this.BufferPlayedCallback)
                _this.BufferPlayedCallback();
        };
        sourceNode_1.loop = false;
        sourceNode_1.buffer = buffer;
        sourceNode_1.connect(this.Amplification);
        sourceNode_1.playbackRate.value = this.PlaybackSpeed;
        sourceNode_1.start(this.NextScheduleTime);
        // Move time forward
        this.NextScheduleTime += duration;
    };
    LiveAudioPlayer.prototype.Reset = function () {
        this.NextScheduleTime = 0.0;
        this.UnderrunCount = 0;
        this.SkippedBufferCount = 0;
        this.WasUnderrunning = false;
        this.LastUnderrunTime = Date.now();
        this.LastBufferAdjustmentTime = this.LastUnderrunTime;
        this.PlaybackSpeed = 1.0;
    };
    LiveAudioPlayer.prototype.GetStats = function () {
        return {
            ScheduledBufferMs: this.GetScheduledBufferLength() * 1000,
            TargetBufferMs: this.TargetBufferLength * 1000,
            Underruns: this.UnderrunCount,
            SkippedBuffers: this.SkippedBufferCount,
            PlaybackSpeed: this.PlaybackSpeed
        };
    };
    LiveAudioPlayer.prototype.CheckBeforeDecode = function (playbackLength) {
        if (this.NextScheduleTime == 0)
            return true;
        return this.NextScheduleTime + playbackLength > this.Audio.currentTime;
    };
    // Crystal oscillator have a variance of about +/- 20ppm
    // So worst case would be a difference of 40ppm between two oscillators.
    LiveAudioPlayer.SpeedCorrectionFactor = 40 / 1.0e6;
    // Hystersis value for speed up/down trigger
    LiveAudioPlayer.OffsetVariance = 0.2;
    LiveAudioPlayer.MinBufferLength = 0.2;
    LiveAudioPlayer.MaxBufferLength = 0.6;
    LiveAudioPlayer.BufferStep = 0.05;
    LiveAudioPlayer.BufferTolerance = 0.015;
    LiveAudioPlayer.MinCatchUpRate = 0.003;
    LiveAudioPlayer.MaxCatchUpRate = 0.01;
    LiveAudioPlayer.CatchUpGain = 0.05;
    LiveAudioPlayer.StablePeriodMs = 300000;
    return LiveAudioPlayer;
}());

if (typeof module !== "undefined" && module.exports) {
    module.exports = LiveAudioPlayer;
}
