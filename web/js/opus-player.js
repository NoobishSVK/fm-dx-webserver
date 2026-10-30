(function () {
    'use strict';
    let context, worklet, gain, decoder, socket, retryTimer;
    let active = false, generation = 0, timestamp = 0, retry = 250;
    let underruns = 0, drops = 0, bytes = 0, bytesAt = 0;
    function display(id, value) { const node = document.getElementById(id); if (node) node.textContent = value; }
    const buttons = () => document.querySelectorAll('.playbutton');
    function state(playing) {
        buttons().forEach(button => {
            button.setAttribute('aria-label', playing ? 'Stop audio' : 'Play audio');
            const icon = button.querySelector('i');
            if (icon) { icon.classList.toggle('fa-play', !playing); icon.classList.toggle('fa-stop', playing); }
        });
    }
    async function stop() {
        active = false; generation++; clearTimeout(retryTimer);
        if (socket) { socket.onclose = null; socket.close(); socket = null; }
        if (decoder && decoder.state !== 'closed') decoder.close();
        decoder = null;
        if (context) { const old = context; context = null; await old.close(); }
        state(false);
        display('opus-state', 'Stopped');
        const panel = document.getElementById('audio-stream-stats');
        if (panel) panel.hidden = true;
    }
    function connect(id) {
        if (!active || id !== generation) return;
        timestamp = 0;
        display('opus-state', 'Connecting');
        worklet.port.postMessage({ type: 'reset' });
        const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/audio');
        socket = ws; ws.binaryType = 'arraybuffer';
        ws.onmessage = async event => {
            if (!active || id !== generation || socket !== ws) return;
            if (typeof event.data === 'string') {
                let format;
                try { format = JSON.parse(event.data); } catch (_) { ws.close(); return; }
                if (format.type !== 'format' || format.codec !== 'opus' || ![1, 2].includes(format.channels)) { ws.close(); return; }
                const config = { codec: 'opus', sampleRate: 48000, numberOfChannels: format.channels };
                try {
                    const support = await AudioDecoder.isConfigSupported(config);
                    if (!active || id !== generation || socket !== ws || ws.readyState !== WebSocket.OPEN) return;
                    if (!support.supported) throw new Error('Opus decoding is not supported by this browser');
                    if (decoder && decoder.state !== 'closed') decoder.close();
                    decoder = new AudioDecoder({
                        output(data) {
                            if (!active || id !== generation || socket !== ws) { data.close(); return; }
                            const channels = [];
                            for (let i = 0; i < data.numberOfChannels; i++) {
                                const samples = new Float32Array(data.numberOfFrames);
                                data.copyTo(samples, { planeIndex: i, format: 'f32-planar' });
                                channels.push(samples);
                            }
                            data.close();
                            worklet.port.postMessage({ type: 'audio', channels }, channels.map(channel => channel.buffer));
                        },
                        error(error) { console.error('[Opus] Decoder error:', error); ws.close(); }
                    });
                    decoder.configure(config);
                } catch (error) { console.error('[Opus]', error); alert(error.message); stop(); }
                return;
            }
            if (!decoder || decoder.state !== 'configured') return;
            bytes += event.data.byteLength;
            const now = performance.now();
            if (now - bytesAt >= 1000) {
                display('opus-rate', Math.round(bytes * 8 / (now - bytesAt)) + ' kbit/s');
                bytes = 0; bytesAt = now;
            }
            if (decoder.decodeQueueSize > 50) { console.warn('[Opus] Decoder behind; reconnecting.'); ws.close(); return; }
            try {
                decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp, duration: 20000, data: event.data }));
                display('opus-state', 'Receiving');
                timestamp += 20000; retry = 250;
            } catch (error) { console.error('[Opus] Decode failed:', error); ws.close(); }
        };
        ws.onerror = () => console.warn('[Opus] Audio connection error.');
        ws.onclose = event => {
            if (!active || id !== generation || socket !== ws) return;
            console.warn('[Opus] Audio connection closed:', event.code);
            display('opus-state', 'Reconnecting');
            if (decoder && decoder.state !== 'closed') decoder.close();
            decoder = null;
            worklet.port.postMessage({ type: 'reset' });
            retryTimer = setTimeout(() => connect(id), retry);
            retry = Math.min(5000, retry * 2);
        };
    }
    async function start() {
        const id = ++generation; active = true; state(true);
        underruns = drops = bytes = 0; bytesAt = performance.now();
        const panel = document.getElementById('audio-stream-stats');
        if (panel) panel.hidden = false;
        display('opus-state', 'Starting');
        display('opus-buffer', 'Waiting…');
        display('opus-target', 'Waiting…');
        display('opus-rate', 'Waiting…');
        display('opus-events', '0 underruns · 0 drops');
        try {
            if (!window.AudioDecoder || !window.EncodedAudioChunk) throw new Error('This browser does not support Opus WebCodecs playback.');
            context = new AudioContext({ sampleRate: 48000 });
            if (context.sampleRate !== 48000) throw new Error('This audio device does not support 48 kHz playback.');
            const resume = context.resume();
            await Promise.all([context.audioWorklet.addModule('js/opus-worklet.js'), resume]);
            if (!active || id !== generation) return;
            worklet = new AudioWorkletNode(context, 'opus-playback', { outputChannelCount: [2] });
            worklet.port.onmessage = event => {
                if (event.data.type === 'stats') {
                    display('opus-buffer', Math.round(event.data.bufferedMs) + ' ms');
                    display('opus-target', Math.round(event.data.targetMs) + ' ms');
                } else if (event.data.type === 'underrun' || event.data.type === 'drop') {
                    if (event.data.type === 'underrun') underruns++; else drops++;
                    display('opus-events', underruns + ' underruns · ' + drops + ' drops');
                    console.warn('[Opus]', event.data.type, event.data.targetMs || '');
                }
            };
            gain = context.createGain();
            gain.gain.value = Number(document.getElementById('volumeSlider').value);
            worklet.connect(gain).connect(context.destination);
            if (active && id === generation) connect(id);
        } catch (error) { if (id !== generation) return; console.error('[Opus]', error); alert(error.message); await stop(); }
    }
    document.addEventListener('DOMContentLoaded', () => {
        buttons().forEach(button => { button.disabled = false; button.addEventListener('click', () => active ? stop() : start()); });
        const slider = document.getElementById('volumeSlider');
        slider.addEventListener('input', () => { if (gain && context) gain.gain.setTargetAtTime(Number(slider.value), context.currentTime, 0.02); });
    });
}());
