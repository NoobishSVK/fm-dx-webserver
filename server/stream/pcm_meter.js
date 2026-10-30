'use strict';

// Measure the unmodified signed 16-bit ALSA samples, before encoder filters.
class PcmMeter {
    constructor(channels, sampleRate = 48000) {
        this.channels = channels;
        this.windowFrames = Math.round(sampleRate / 10);
        this.pending = Buffer.alloc(0);
        this.reset();
    }

    reset() {
        this.frames = 0;
        this.peaks = Array(this.channels).fill(0);
        this.squares = Array(this.channels).fill(0);
        this.fullScale = Array(this.channels).fill(false);
    }

    push(chunk) {
        const data = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
        const frameBytes = this.channels * 2;
        const end = data.length - data.length % frameBytes;
        const readings = [];
        for (let offset = 0; offset < end; offset += frameBytes) {
            for (let channel = 0; channel < this.channels; channel++) {
                const sample = data.readInt16LE(offset + channel * 2);
                this.peaks[channel] = Math.max(this.peaks[channel], Math.abs(sample));
                this.squares[channel] += sample * sample;
                this.fullScale[channel] ||= sample === -32768 || sample === 32767;
            }
            if (++this.frames === this.windowFrames) {
                const db = amplitude => amplitude > 0 ? 20 * Math.log10(amplitude / 32768) : null;
                readings.push({ type: 'levels', bits: 16, channels: this.peaks.map((peak, channel) => ({
                    peakDb: db(peak),
                    rmsDb: db(Math.sqrt(this.squares[channel] / this.frames)),
                    fullScale: this.fullScale[channel]
                })) });
                this.reset();
            }
        }
        this.pending = Buffer.from(data.subarray(end));
        return readings;
    }
}

module.exports = { PcmMeter };
