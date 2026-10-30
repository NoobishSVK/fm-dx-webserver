class OpusPlayback extends AudioWorkletProcessor {
    constructor() {
        super();
        this.chunks = [];
        this.frames = 0;
        this.offset = 0;
        this.started = false;
        this.target = Math.round(sampleRate * 0.18);
        this.maximum = Math.round(sampleRate * 0.6);
        this.reportFrames = 0;
        this.phase = 0;
        this.level = this.target;
        this.port.onmessage = event => {
            const data = event.data;
            if (data.type === 'reset') {
                this.chunks = []; this.frames = 0; this.offset = 0; this.started = false;
                this.phase = 0; this.level = this.target;
            } else if (data.type === 'audio') {
                this.chunks.push(data.channels);
                this.frames += data.channels[0].length;
                if (this.frames > this.maximum) {
                    // Drop oldest whole audio blocks to bound live latency.
                    while (this.chunks.length > 1 && this.frames > this.target) {
                        const old = this.chunks.shift();
                        this.frames -= old[0].length - this.offset;
                        this.offset = 0;
                    }
                    this.port.postMessage({ type: 'drop' });
                    this.phase = 0; this.level = this.target;
                }
            }
        };
    }
    process(_inputs, outputs) {
        const output = outputs[0];
        if (!output || !output.length) return true;
        this.reportFrames += output[0].length;
        if (this.reportFrames >= sampleRate) {
            this.reportFrames = 0;
            this.port.postMessage({ type: 'stats', bufferedMs: this.frames * 1000 / sampleRate, targetMs: this.target * 1000 / sampleRate });
        }
        if (!this.started && this.frames >= this.target) {
            this.started = true;
            this.level = this.target;
        }
        if (!this.started) return true;
        // Smooth packet-sized changes over two seconds. Adjust consumption by at
        // most 0.2% to track independent capture/playback clocks without jumps.
        const smoothing = 1 - Math.exp(-output[0].length / (sampleRate * 2));
        // Center the level between arrivals of the server's 20 ms packets.
        this.level += smoothing * (this.frames - sampleRate * 0.01 - this.level);
        const rate = 1 + Math.max(-0.002, Math.min(0.002, (this.level - this.target) / (sampleRate * 20)));
        let written = 0;
        while (written < output[0].length && this.frames >= 2) {
            const chunk = this.chunks[0];
            const atEnd = this.offset + 1 === chunk[0].length;
            const next = atEnd ? this.chunks[1] : chunk;
            const nextOffset = atEnd ? 0 : this.offset + 1;
            for (let channel = 0; channel < output.length; channel++) {
                const a = chunk[Math.min(channel, chunk.length - 1)][this.offset];
                const b = next[Math.min(channel, next.length - 1)][nextOffset];
                output[channel][written] = a + (b - a) * this.phase;
            }
            written++;
            this.phase += rate;
            const consumed = Math.floor(this.phase);
            this.phase -= consumed;
            this.offset += consumed; this.frames -= consumed;
            if (this.offset >= chunk[0].length) { this.chunks.shift(); this.offset -= chunk[0].length; }
        }
        if (written < output[0].length) {
            this.started = false;
            this.phase = 0;
            this.target = Math.min(Math.round(sampleRate * 0.5), this.target + Math.round(sampleRate * 0.05));
            this.port.postMessage({ type: 'underrun', targetMs: this.target * 1000 / sampleRate });
        }
        return true;
    }
}
registerProcessor('opus-playback', OpusPlayback);
