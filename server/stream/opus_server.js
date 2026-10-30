'use strict';

const { spawn } = require('child_process');
const WebSocket = require('ws');
const checkFFmpeg = require('./checkFFmpeg');
const { buildLinuxOpusPipeline } = require('./opus_pipeline');
const { OggOpusPackets } = require('./ogg_opus_packets');
const { AlsaStderrParser, containsAlsaSetupError, containsAlsaXrun, getAlsaFallbackProfile } = require('./linux_capture');

class OpusServer {
    constructor(audio, logger = console, spawnProcess = spawn, resolveFFmpeg = checkFFmpeg) {
        this.audio = { ...audio };
        this.log = logger;
        this.spawnProcess = spawnProcess;
        this.resolveFFmpeg = resolveFFmpeg;
        this.clients = new Set();
        this.stopped = true;
        this.generation = 0;
        this.retryMs = 1000;
        this.xruns = [];
        this.wss = new WebSocket.Server({ noServer: true, perMessageDeflate: false });
        this.wss.on('connection', socket => {
            this.clients.add(socket);
            socket.on('error', () => {});
            socket.on('close', () => this.clients.delete(socket));
            try { socket.send(JSON.stringify({ type: 'format', codec: 'opus', sampleRate: 48000, channels: Number(this.audio.audioChannels), frameMs: 20 })); }
            catch (_) { socket.terminate(); }
        });
    }

    upgrade(req, socket, head) {
        this.wss.handleUpgrade(req, socket, head, ws => this.wss.emit('connection', ws, req));
    }

    async start() {
        if (!this.stopped) return;
        this.stopped = false;
        const generation = ++this.generation;
        try {
            const executable = await this.resolveFFmpeg();
            if (this.stopped || generation !== this.generation) return;
            if (!executable) throw new Error('No FFmpeg executable available');
            this.ffmpeg = executable;
        } catch (error) {
            if (this.stopped || generation !== this.generation) return;
            this.stopped = true;
            this.log.error('[Opus] Cannot locate FFmpeg:', error.message);
            return;
        }
        this.launch();
    }

    launch() {
        if (this.stopped) return;
        let pipeline;
        try { pipeline = buildLinuxOpusPipeline(this.audio); }
        catch (error) { this.log.error('[Opus] Invalid audio configuration:', error.message); return; }
        const generation = ++this.generation;
        const capture = this.spawnProcess('arecord', pipeline.captureArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        const encoder = this.spawnProcess(this.ffmpeg, pipeline.encoderArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
        this.capture = capture;
        this.encoder = encoder;
        const parser = new OggOpusPackets();
        const stderr = new AlsaStderrParser();
        let lastOutput = Date.now();
        let lastCapture = Date.now();
        let healthySince = 0;
        let failed = false;
        const fail = reason => {
            if (failed || this.stopped || generation !== this.generation) return;
            failed = true;
            this.log.warn('[Opus] ' + reason + '; restarting capture and encoder.');
            clearInterval(this.watchdog);
            capture.kill('SIGKILL');
            encoder.kill('SIGKILL');
            for (const client of this.clients) client.terminate();
            this.restartTimer = setTimeout(() => this.launch(), this.retryMs);
            this.retryMs = Math.min(30000, this.retryMs * 2);
        };
        capture.stdout.on('data', () => { lastCapture = Date.now(); });
        capture.stdout.pipe(encoder.stdin);
        encoder.stdin.on('error', error => fail('encoder input: ' + error.message));
        capture.on('error', error => fail('capture: ' + error.message));
        encoder.on('error', error => fail('encoder: ' + error.message));
        capture.on('exit', (code, signal) => fail('capture exited: ' + (signal || code)));
        encoder.on('exit', (code, signal) => fail('encoder exited: ' + (signal || code)));
        const captureMessage = line => {
            if (failed || this.stopped || generation !== this.generation) return;
            if (containsAlsaXrun(line)) {
                const now = Date.now();
                this.xruns = this.xruns.filter(time => now - time < 30000);
                this.xruns.push(now);
            }
            if (containsAlsaSetupError(line) || this.xruns.length >= 3) {
                const next = getAlsaFallbackProfile(pipeline.profile.name);
                if (next) {
                    this.log.warn('[Opus] ALSA timing failed; switching to ' + next + '.');
                    this.audio.alsaLatencyProfile = next;
                    this.xruns = [];
                    fail('ALSA timing or repeated overruns');
                }
            } else if (containsAlsaXrun(line)) this.log.warn('[Opus] ALSA overrun: ' + line);
            else if (/error|cannot|failed|no such|device or resource busy/i.test(line)) this.log.warn('[Opus] Capture: ' + line);
        };
        capture.stderr.on('data', data => { for (const line of stderr.Push(data)) captureMessage(line); });
        capture.stderr.on('end', () => { for (const line of stderr.Flush()) captureMessage(line); });
        encoder.stderr.on('data', data => this.log.warn('[Opus] FFmpeg: ' + data.toString().trim()));
        encoder.stdout.on('data', data => {
            if (failed || generation !== this.generation) return;
            try {
                for (const packet of parser.push(data)) {
                    lastOutput = Date.now();
                    if (!healthySince) healthySince = lastOutput;
                    if (lastOutput - healthySince >= 30000) this.retryMs = 1000;
                    for (const client of this.clients) {
                        if (client.readyState !== WebSocket.OPEN) continue;
                        const bitrate = parseInt(this.audio.audioBitrate || '128k', 10) * 1000;
                        if (client.bufferedAmount > Math.max(8192, bitrate / 16)) { client.terminate(); continue; }
                        try { client.send(packet, { binary: true }, error => { if (error) client.terminate(); }); }
                        catch (_) { client.terminate(); }
                    }
                }
            } catch (error) { fail('invalid encoder output: ' + error.message); }
        });
        this.watchdog = setInterval(() => {
            const now = Date.now();
            if (now - lastCapture > 5000) fail('capture stalled');
            else if (now - lastOutput > 5000) fail('encoder output stalled');
        }, 1000);
        this.log.info('[Opus] Started capture and encoder; ALSA profile ' + pipeline.profile.name + '.');
    }

    stop() {
        this.stopped = true;
        this.generation++;
        clearInterval(this.watchdog);
        clearTimeout(this.restartTimer);
        if (this.capture) this.capture.kill('SIGKILL');
        if (this.encoder) this.encoder.kill('SIGKILL');
        for (const client of this.clients) client.terminate();
    }
}

module.exports = { OpusServer };
