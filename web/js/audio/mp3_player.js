/*
 * Parts of this file are derived from 3LAS (Low Latency Live Audio Streaming)
 * by JoJoBond — https://github.com/JoJoBond/3LAS
 * Licensed under GPL-2.0 (https://www.gnu.org/licenses/old-licenses/gpl-2.0.html)
 *
 */

'use strict';

class AudioWsMp3Player {
    constructor() {
        this._audioCtx = null;
        this._gainNode = null;
        this._ws = null;
        this._dataBuffer = new Uint8Array(0);
        this._frames = [];
        this._frameStartIdx = -1;
        this._frameEndIdx = -1;
        this._frameSamples = 0;
        this._frameSampleRate = 0;
        this._timeBudget = 0;
        this._nextPlayTime = 0;
        this._volume = 1.0;
        this._watchdogTimer = null;
        this._shouldReconnect = false;
        this._decoding = false;
        this._lastDecodeTime = 0;
    }

    get Volume() {
        return this._volume;
    }

    set Volume(value) {
        this._volume = Number(value);
        if (this._gainNode && this._audioCtx) {
            const clamped = Math.max(1e-20, Math.min(1.0, this._volume));
            this._gainNode.gain.cancelScheduledValues(this._audioCtx.currentTime);
            this._gainNode.gain.exponentialRampToValueAtTime(clamped, this._audioCtx.currentTime + 0.5);
        }
    }

    Start() {
        this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this._gainNode = this._audioCtx.createGain();
        this._gainNode.gain.value = Math.max(1e-20, Math.min(1.0, this._volume));
        this._gainNode.connect(this._audioCtx.destination);
        this._nextPlayTime = 0;
        this._dataBuffer = new Uint8Array(0);
        this._frames = [];
        this._frameStartIdx = -1;
        this._frameEndIdx = -1;
        this._timeBudget = 0;
        this._shouldReconnect = true;
        this._lastDecodeTime = performance.now();
        this._mobileUnmute();
        this._connect();
    }

    Reset() {
        this._shouldReconnect = false;
        this._stopWatchdog();
        if (this._ws) {
            const ws = this._ws;
            this._ws = null;
            ws.onopen = null;
            ws.onmessage = null;
            ws.onclose = null;
            ws.onerror = null;
            ws.close();
        }
        if (this._audioCtx) {
            this._audioCtx.close();
            this._audioCtx = null;
        }
        this._gainNode = null;
        this._dataBuffer = new Uint8Array(0);
        this._frames = [];
        this._nextPlayTime = 0;
        this._timeBudget = 0;
        this._decoding = false;
    }

    // Mobile workaround - play silent stereo buffer to unblock AudioContext.
    _mobileUnmute() {
        if (!this._audioCtx) return;
        const gain = this._audioCtx.createGain();
        gain.gain.value = 1.0;
        gain.connect(this._audioCtx.destination);
        const silentBuf = this._audioCtx.createBuffer(2, this._audioCtx.sampleRate, this._audioCtx.sampleRate);
        const src = this._audioCtx.createBufferSource();
        src.onended = () => { src.disconnect(); gain.disconnect(); };
        src.buffer = silentBuf;
        src.connect(gain);
        src.start();
    }

    // Open the websocket for audio and set up handlers.
    _connect() {
        if (!this._shouldReconnect) return;
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        this._ws = new WebSocket(`${protocol}//${location.host}${location.pathname}audio`);
        this._ws.binaryType = 'arraybuffer';

        this._ws.onopen = () => {
            this._lastDecodeTime = performance.now();
            this._startWatchdog();
            if (this._audioCtx && this._audioCtx.state === 'suspended') {
                this._audioCtx.resume();
            }
            this._mobileUnmute();
        };

        this._ws.onmessage = (event) => {
            const chunk = new Uint8Array(event.data);
            const merged = new Uint8Array(this._dataBuffer.length + chunk.length);
            merged.set(this._dataBuffer);
            merged.set(chunk, this._dataBuffer.length);
            this._dataBuffer = merged;
            this._extractAndSchedule();
        };

        this._ws.onclose = () => {
            this._stopWatchdog();
            this._ws = null;
            if (this._shouldReconnect) {
                this._dataBuffer = new Uint8Array(0);
                this._frames = [];
                this._frameStartIdx = -1;
                this._frameEndIdx = -1;
                this._nextPlayTime = 0;
                this._decoding = false;
                setTimeout(() => this._connect(), 1000);
            }
        };

        this._ws.onerror = () => {
            if (this._ws) this._ws.close();
        };
    }

    // Check every 3 seconds if the connection has died, and if so schedule a re-connect.
    _startWatchdog() {
        this._stopWatchdog();
        this._watchdogTimer = setInterval(() => {
            if (!this._shouldReconnect) { this._stopWatchdog(); return; }
            if (performance.now() - this._lastDecodeTime > 2000) {
                this._stopWatchdog();
                if (this._ws) {
                    const ws = this._ws;
                    this._ws = null;
                    ws.onopen = null;
                    ws.onmessage = null;
                    ws.onclose = null;
                    ws.onerror = null;
                    ws.close();
                }
                this._dataBuffer = new Uint8Array(0);
                this._frames = [];
                this._frameStartIdx = -1;
                this._frameEndIdx = -1;
                this._nextPlayTime = 0;
                this._decoding = false;
                setTimeout(() => this._connect(), 1000);
            }
        }, 3000);
    }

    // Clear any pre-existing re-connect check
    _stopWatchdog() {
        if (this._watchdogTimer !== null) {
            clearInterval(this._watchdogTimer);
            this._watchdogTimer = null;
        }
    }

    // Find an MP3 frame start and its length in the data buffer, by searching byte-by-byte for the MPEG sync word if the start byte is not known.
    _findFrame() {
        if (this._frameStartIdx < 0) {
            for (let i = 0; i + 1 < this._dataBuffer.length; i++) {
                if (this._dataBuffer[i] === 0xFF && (this._dataBuffer[i + 1] & 0xE0) === 0xE0) {
                    this._frameStartIdx = i;
                    break;
                }
            }
        }
        if (this._frameStartIdx >= 0 && this._frameEndIdx < 0) {
            if (this._frameStartIdx + 3 < this._dataBuffer.length) {
                const b1 = this._dataBuffer[this._frameStartIdx + 1];
                const b2 = this._dataBuffer[this._frameStartIdx + 2];
                const ver = (b1 & 0x18) >>> 3;
                const lyr = (b1 & 0x06) >>> 1;
                const pad = (b2 & 0x02) >>> 1;
                const brx = (b2 & 0xF0) >>> 4;
                const srx = (b2 & 0x0C) >>> 2;
                const bitrate = AudioWsMp3Player.MPEG_bitrates[ver][lyr][brx] * 1000;
                const samprate = AudioWsMp3Player.MPEG_srates[ver][srx];
                const samples = AudioWsMp3Player.MPEG_frame_samples[ver][lyr];
                const slotSize = AudioWsMp3Player.MPEG_slot_size[lyr];
                if (bitrate > 0 && samprate > 0) {
                    this._frameSamples = samples;
                    this._frameSampleRate = samprate;
                    this._frameEndIdx = this._frameStartIdx + Math.floor((samples / 8.0 * bitrate) / samprate + (pad ? slotSize : 0));
                } else {
                    this._frameStartIdx = -1;
                }
            }
        }
    }

    // Check if a complete frame boundary has been found and enough bytes have arrived in the buffer to extract.
    _canExtractFrame() {
        return this._frameStartIdx >= 0 && this._frameEndIdx >= 0 && this._frameEndIdx <= this._dataBuffer.length;
    }

    // Extract the MPEG audio frame from the buffer, and reset the data buffer indexes ready for the next frame.
    _extractFrame() {
        const frameData = new Uint8Array(this._dataBuffer.buffer.slice(this._frameStartIdx, this._frameEndIdx));
        this._dataBuffer = this._frameEndIdx + 1 < this._dataBuffer.length
            ? new Uint8Array(this._dataBuffer.buffer.slice(this._frameEndIdx))
            : new Uint8Array(0);
        this._frameStartIdx = 0;
        this._frameEndIdx = -1;
        return { data: frameData, sampleCount: this._frameSamples, sampleRate: this._frameSampleRate };
    }

    // Central processing loop to find all frames within the incoming buffer data each time a websocket message is received.
    _extractAndSchedule() {
        if (!this._audioCtx) return;
        this._findFrame();
        while (this._canExtractFrame()) {
            this._frames.push(this._extractFrame());
            this._findFrame();
        }
        if (this._decoding || this._frames.length < 3) return;

        const first = this._frames[0];
        const last = this._frames[this._frames.length - 1];
        const firstGranule = first.sampleCount / first.sampleRate / 2.0;
        const lastGranule = last.sampleCount / last.sampleRate / 2.0;
        let expectedTime = firstGranule + lastGranule;
        let bufLen = first.data.length + last.data.length;
        for (let i = 1; i < this._frames.length - 1; i++) {
            expectedTime += this._frames[i].sampleCount / this._frames[i].sampleRate;
            bufLen += this._frames[i].data.length;
        }
        if (this._nextPlayTime !== 0 && this._nextPlayTime + expectedTime <= this._audioCtx.currentTime) return;

        const decodeBuffer = new Uint8Array(bufLen);
        let offset = 0;
        for (const frame of this._frames) {
            decodeBuffer.set(frame.data, offset);
            offset += frame.data.length;
        }

        this._frames.splice(0, this._frames.length - 1);

        this._decoding = true;
        this._audioCtx.decodeAudioData(
            decodeBuffer.buffer,
            (decoded) => {
                this._decoding = false;
                this._onDecoded(decoded, expectedTime, firstGranule, lastGranule);
                this._extractAndSchedule();
            },
            () => {
                this._decoding = false;
                this._extractAndSchedule();
            }
        );
    }

    // Each time we call to decode, trim artefacts created by decoder cold start to stop audio glitches.
    _onDecoded(decoded, expectedTime, firstGranule, lastGranule) {
        if (!this._audioCtx || !this._gainNode) return;
        this._lastDecodeTime = performance.now();

        // WebKit-based Apple platforms (iOS, iPadOS, macOS Safari) need the middle section.
        // Other macOS browsers (Firefox, Chrome) behave like non-Apple platforms.
        const ua = navigator.userAgent.toLowerCase();
        const isIOS = /iphone|ipod/.test(ua);
        const isIPadOS = /ipad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const isMacOSX = !isIOS && !isIPadOS && /mac os x/.test(ua);
        const isSafari = !/chromium|chrome|crios/.test(ua) && /safari/.test(ua);
        const isApple = isIOS || isIPadOS || (isMacOSX && isSafari);

        const delta = 0.001;
        let sampleCount, sampleOffset = 0;

        if (expectedTime > decoded.duration) {
            sampleCount = decoded.length;
            sampleOffset = 0;
            this._timeBudget += expectedTime - decoded.duration;
        } else if (expectedTime < decoded.duration) {
            sampleCount = Math.ceil(expectedTime * decoded.sampleRate);
            const budgetSamples = this._timeBudget * decoded.sampleRate;
            if (budgetSamples > 1.0) {
                const extra = Math.min(budgetSamples, decoded.length - sampleCount);
                sampleCount += extra;
                this._timeBudget -= extra / decoded.sampleRate;
            }
            const diff = decoded.duration - expectedTime;
            if ((diff - firstGranule - lastGranule) >= -delta) {
                sampleOffset = Math.floor((decoded.length - sampleCount) / 2);
            }
            if (Math.abs(firstGranule - lastGranule) <= delta) {
                sampleOffset = isApple
                    ? Math.floor((decoded.length - sampleCount) / 2)
                    : decoded.length - sampleCount;
            } else if (Math.abs(diff - firstGranule) <= delta) {
                sampleOffset = decoded.length - sampleCount;
            } else if (Math.abs(diff - lastGranule) <= delta) {
                sampleOffset = 0;
            } else {
                sampleOffset = Math.floor((decoded.length - sampleCount) / 2);
            }
        } else {
            sampleCount = decoded.length;
            sampleOffset = 0;
        }

        const buf = this._audioCtx.createBuffer(decoded.numberOfChannels, sampleCount, decoded.sampleRate);
        for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
            buf.getChannelData(ch).set(decoded.getChannelData(ch).subarray(sampleOffset, sampleOffset + sampleCount));
        }
        this._scheduleBuffer(buf);
    }

    // Schedule a decoded buffer for playback at the correct AudioContext time. Reset if it's falled behind (on reconnect etc.).
    _scheduleBuffer(buffer) {
        if (!this._audioCtx || !this._gainNode) return;
        if (this._audioCtx.state === 'suspended') {
            this._audioCtx.resume();
        }
        const INITIAL_OFFSET = 0.33;

        if (this._nextPlayTime === 0) {
            this._nextPlayTime = this._audioCtx.currentTime + INITIAL_OFFSET;
        }

        const duration = buffer.duration;
        if (this._nextPlayTime + duration <= this._audioCtx.currentTime) {
            this._nextPlayTime = this._audioCtx.currentTime + INITIAL_OFFSET;
        }

        let skipDuration = 0;
        if (this._audioCtx.currentTime >= this._nextPlayTime) {
            skipDuration = this._audioCtx.currentTime - this._nextPlayTime + 0.05;
        }

        if (skipDuration < duration) {
            const src = this._audioCtx.createBufferSource();
            src.loop = false;
            src.buffer = buffer;
            src.onended = () => src.disconnect();
            src.connect(this._gainNode);
            src.start(this._nextPlayTime + skipDuration, skipDuration);
        }
        this._nextPlayTime += duration;
    }
}

// MPEG bitrate table [version][layer][index] in kbps
AudioWsMp3Player.MPEG_bitrates = [
    [ // MPEG 2.5
        [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0],
        [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0],
        [0,32,48,56,64,80,96,112,128,144,160,176,192,224,256,0]
    ],
    [ // Reserved
        [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
    ],
    [ // MPEG 2
        [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0],
        [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0],
        [0,32,48,56,64,80,96,112,128,144,160,176,192,224,256,0]
    ],
    [ // MPEG 1
        [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0],
        [0,32,48,56,64,80,96,112,128,160,192,224,256,320,384,0],
        [0,32,64,96,128,160,192,224,256,288,320,352,384,416,448,0]
    ]
];

// Sample rates [version][index] in Hz
AudioWsMp3Player.MPEG_srates = [
    [11025,12000,8000,0],
    [0,0,0,0],
    [22050,24000,16000,0],
    [44100,48000,32000,0]
];

// Samples per frame [version][layer]
AudioWsMp3Player.MPEG_frame_samples = [
    [0,576,1152,384],
    [0,0,0,0],
    [0,576,1152,384],
    [0,1152,1152,384]
];

// Slot size [layer]: Reserved, Layer3, Layer2, Layer1
AudioWsMp3Player.MPEG_slot_size = [0,1,1,4];

