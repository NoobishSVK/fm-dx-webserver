// Recording adapter for the shared audio API. No socket or decoder of its own.
(() => {
    'use strict';
    class SharedAudioRecording {
        constructor(api, Recorder, onComplete, onError) {
            this.api = api;
            this.Recorder = Recorder;
            this.onComplete = onComplete;
            this.onError = onError;
        }
        async start() {
            if (this.recorder || this.starting) throw new Error('Recording already started');
            const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']
                .find(type => this.Recorder?.isTypeSupported(type));
            if (!mimeType) throw new Error('This browser does not support audio recording');
            this.starting = true;
            try {
                this.tap = await this.api.createStream();
                const recorder = this.recorder = new this.Recorder(this.tap.stream, { mimeType, audioBitsPerSecond: 256000 });
                const chunks = [];
                recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
                recorder.onerror = event => this.onError(event.error || new Error('Recording failed'));
                recorder.onstop = () => {
                    const type = recorder.mimeType || mimeType;
                    this.cleanup();
                    const extension = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
                    this.onComplete(new Blob(chunks, { type }), extension);
                };
                recorder.start(1000);
                this.unsubscribe = this.api.subscribe(event => {
                    if (event.type === 'state' && event.state === 'stopped') this.stop();
                });
            } catch (error) {
                this.cleanup();
                throw error;
            } finally { this.starting = false; }
        }
        stop() {
            if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
        }
        cleanup() {
            this.unsubscribe?.();
            this.unsubscribe = null;
            this.tap?.release();
            this.tap = null;
            this.recorder = null;
        }
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { SharedAudioRecording };
        return;
    }
    function init(attempt = 0) {
        if (document.getElementById('audio-record-button')) return;
        if (typeof addIconToPluginPanel !== 'function' || !window.fmdxAudio) {
            if (attempt < 100) setTimeout(() => init(attempt + 1), 100);
            return;
        }
        addIconToPluginPanel('audio-record-button', 'Record', 'solid', 'circle', 'Record audio (independent of playback volume)');
        const button = document.getElementById('audio-record-button');
        const label = button.querySelector('span');
        let recording = null, timer, limit, began, filename;
        const error = problem => sendToast('error', 'Audio recording', problem.message);
        function reset() {
            clearInterval(timer); clearTimeout(limit);
            recording = null;
            button.disabled = false;
            button.classList.remove('rec-active');
            button.setAttribute('aria-label', 'Start audio recording');
            label.textContent = 'Record';
        }
        const style = document.createElement('style');
        style.textContent = '#audio-record-button.rec-active i {color:#ef5555}';
        document.head.appendChild(style);
        button.addEventListener('click', async () => {
            button.disabled = true;
            if (recording) { recording.stop(); return; }
            const date = new Date().toISOString().slice(0, 19).replaceAll(':', '').replace('T', '_');
            const frequency = (document.getElementById('data-frequency')?.textContent || '').replace(/[^0-9.]/g, '');
            filename = `Audio_${date}Z_${frequency || 'unknown'}MHz`;
            recording = new SharedAudioRecording(window.fmdxAudio, window.MediaRecorder, (blob, extension) => {
                reset();
                if (!blob.size) { error(new Error('No audio was recorded')); return; }
                const link = document.createElement('a');
                const url = URL.createObjectURL(blob);
                link.href = url;
                link.download = `${filename}.${extension}`;
                document.body.appendChild(link);
                link.click(); link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 60000);
                sendToast('success', 'Audio recording saved', `${filename}.${extension}`);
            }, error);
            try {
                await recording.start();
                began = performance.now();
                button.disabled = false;
                button.classList.add('rec-active');
                button.setAttribute('aria-label', 'Stop audio recording');
                label.textContent = '00:00';
                timer = setInterval(() => {
                    const seconds = Math.floor((performance.now() - began) / 1000);
                    label.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
                }, 1000);
                limit = setTimeout(() => recording?.stop(), 600000);
            } catch (problem) { reset(); error(problem); }
        });
        reset();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init(), { once: true });
    else init();
})();
