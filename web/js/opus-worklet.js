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
        this.port.onmessage = event => {
            const data = event.data;
            if (data.type === 'reset') {
                this.chunks = []; this.frames = 0; this.offset = 0; this.started = false;
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
        if (!this.started && this.frames >= this.target) this.started = true;
        if (!this.started) return true;
        let written = 0;
        while (written < output[0].length && this.chunks.length) {
            const chunk = this.chunks[0];
            const n = Math.min(output[0].length - written, chunk[0].length - this.offset);
            for (let channel = 0; channel < output.length; channel++) {
                output[channel].set(chunk[Math.min(channel, chunk.length - 1)].subarray(this.offset, this.offset + n), written);
            }
            written += n; this.offset += n; this.frames -= n;
            if (this.offset === chunk[0].length) { this.chunks.shift(); this.offset = 0; }
        }
        if (written < output[0].length) {
            this.started = false;
            this.target = Math.min(Math.round(sampleRate * 0.5), this.target + Math.round(sampleRate * 0.05));
            this.port.postMessage({ type: 'underrun', targetMs: this.target * 1000 / sampleRate });
        }
        return true;
    }
}
registerProcessor('opus-playback', OpusPlayback);
