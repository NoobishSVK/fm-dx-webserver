'use strict';

const { spawn } = require('child_process');
const { logError, logWarn } = require('../console');
const { serverConfig } = require('../server_config');
const checkFFmpeg = require('./checkFFmpeg');

let ffmpegStaticPath = 'ffmpeg';
let ServerInstance;
let readyResolve;

const waitUntilReady = new Promise((resolve) => {
    readyResolve = resolve;
});

checkFFmpeg().then((resolvedPath) => {
    ffmpegStaticPath = resolvedPath;
    const audioChannels = serverConfig.audio.audioChannels || 2;
    ServerInstance = new StreamServer(audioChannels, 48000);
    readyResolve();
}).catch((err) => {
    logError('[Audio Stream] FFmpeg check failed:', err);
});

class StreamServer {
    constructor(channels, sampleRate) {
        this.Channels = channels;
        this.SampleRate = sampleRate;
        this.StdIn = null;
        this.Clients = new Set();
        this.Mp3Process = null;
    }

    Run() {
        const sampleRate = Number(this.SampleRate) + Number(serverConfig.audio.samplerateOffset || 0);
        const mp3Args = [
            '-fflags', '+nobuffer+flush_packets', '-flags', 'low_delay', '-rtbufsize', '32', '-probesize', '32',
            '-f', 's16le',
            '-ar', String(sampleRate),
            '-ac', String(this.Channels),
            '-i', 'pipe:0',
            '-c:a', 'libmp3lame',
            '-b:a', serverConfig.audio.audioBitrate || '192k',
            '-ac', String(this.Channels),
            '-reservoir', '0',
            '-f', 'mp3', '-write_xing', '0', '-id3v2_version', '0',
            '-fflags', '+nobuffer', '-flush_packets', '1',
            'pipe:1'
        ];

        this.Mp3Process = spawn(ffmpegStaticPath, mp3Args, {
            shell: false,
            detached: false,
            stdio: ['pipe', 'pipe', 'ignore']
        });

        this.Mp3Process.stdout.on('data', (chunk) => {
            this.Clients.forEach((client) => client.SendBinary(chunk));
        });

        this.Mp3Process.on('exit', (code, signal) => {
            logWarn(`[Audio Stream] MP3 encoder exited (code=${code}, signal=${signal})`);
        });

        if (this.StdIn) {
            this.StdIn.on('data', (buffer) => {
                if (this.Mp3Process && this.Mp3Process.stdin.writable) {
                    this.Mp3Process.stdin.write(buffer);
                }
            });
            this.StdIn.resume();
        } else {
            logError('[Audio Stream] StdIn not set when Run() was called');
        }
    }

    AddClient(client) {
        this.Clients.add(client);
    }

    DestroyClient(client) {
        if (this.Clients.delete(client)) {
            client.Destroy();
        }
    }
}

module.exports = {
    get Server() { return ServerInstance; },
    waitUntilReady
};
