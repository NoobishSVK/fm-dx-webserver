"use strict";
/*
    Stdin streamer is part of 3LAS (Low Latency Live Audio Streaming)
    https://github.com/JoJoBond/3LAS
*/
var fs = require('fs');
const path = require('path');
const checkFFmpeg = require('./checkFFmpeg');
const { spawn } = require('child_process');
const { logDebug, logError, logInfo, logWarn, logFfmpeg } = require('../console');
const { serverConfig } = require('../server_config');
const { isRtlTcpBackend } = require('../backend-config');
const { getMp3FfmpegArguments } = require('./ffmpeg-arguments');
const MAX_SOCKET_BUFFER_BYTES = 1024 * 1024;
const AUDIO_DISCONTINUITY_MESSAGE = JSON.stringify({ type: "discontinuity" });
const RESET_KILL_DELAY_MS = 250;

let ffmpegStaticPath = 'ffmpeg'; // fallback value

let ServerInstance;
let handleAudioUpgradeFn;
const clientCountListeners = new Set();

function notifyClientCount(count) {
  for (const listener of clientCountListeners) {
    try {
      listener(count);
    } catch (error) {
      logWarn(`[Stream] Audio client-count listener failed: ${error.message}`);
    }
  }
}

function onClientCountChange(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('Audio client-count listener must be a function.');
  }
  clientCountListeners.add(listener);
  return () => clientCountListeners.delete(listener);
}

let readyResolve;
const waitUntilReady = new Promise((resolve) => {
  readyResolve = resolve;
});

checkFFmpeg().then((resolvedPath) => {
  ffmpegStaticPath = resolvedPath;
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const child_process_1 = require("child_process");
const ws = __importStar(require("ws"));
const Settings = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'settings.json'), 'utf-8'));
const FFmpeg_command = ffmpegStaticPath;
class StreamClient {
    constructor(server, socket) {
        this.Server = server;
        this.Socket = socket;
        this.BinaryOptions = {
            compress: false,
            binary: true
        };
        this.Format = null;
        this.Socket.on('error', this.OnError.bind(this));
        this.Socket.on('close', this.OnError.bind(this));
        this.Socket.on('message', this.OnMessage.bind(this));
    }
    OnMessage(message, isBinary) {
        try {
            let request = JSON.parse(message.toString());
            if (request.type == "answer") {
                
            }
            else if (request.type == "fallback") {
                this.Server.SetFallback(this, request.data);
            }
            else if (request.type == "stats") {
                if (Settings.AdminKey && request.data == Settings.AdminKey) {
                    this.SendText(JSON.stringify({
                        "type": "stats",
                        "data": this.Server.GetStats(),
                    }));
                }
            }
            else {
                this.OnError(null);
                return;
            }
        }
        catch (_a) {
            this.OnError(null);
            return;
        }
    }
    OnError(_err) {
        this.Server.DestroyClient(this);
    }
    Destroy() {
        try {
            this.Socket.close();
        }
        catch (ex) {
        }
    }
    SendBinary(buffer) {
        if (this.Socket.readyState != ws.OPEN) {
            this.OnError(null);
            return;
        }
        if (this.Socket.bufferedAmount > MAX_SOCKET_BUFFER_BYTES) {
            logWarn('[Stream] Disconnecting a slow audio client to keep buffering bounded.');
            this.OnError(null);
            return;
        }
        this.Socket.send(buffer, this.BinaryOptions, (error) => {
            if (error) this.OnError(error);
        });
    }
    SendText(text) {
        if (this.Socket.readyState != ws.OPEN) {
            this.OnError(null);
            return;
        }
        try {
            this.Socket.send(text, (error) => {
                if (error) this.OnError(error);
            });
        }
        catch (error) {
            this.OnError(error);
        }
    }
    OnIceCandidate(e) {
        if (e.candidate) {
            this.SendText(JSON.stringify({
                "type": "candidate",
                "data": e.candidate
            }));
        }
    }
}
class StreamServer {
    constructor(port, channels, sampleRate) {
        this.Port = port || null;
        this.Channels = channels;
        this.SampleRate = sampleRate;
        this.Clients = new Set();
        this.FallbackClients = {
            "wav": new Set(),
            "mp3": new Set()
        };
        this.FallbackProvider = {};
        if (Settings.FallbackUseMp3) {
            this.FallbackProvider["mp3"] = AFallbackProvider.Create(this, "mp3");
        }
        if (Settings.FallbackUseWav) {
            this.FallbackProvider["wav"] = AFallbackProvider.Create(this, "wav");
        }
        this.StdIn = null;
        this.DroppingInput = false;
    }
    Run() {
        this.Server = new ws.Server({
            noServer: true,
            clientTracking: true,
            perMessageDeflate: false,
        });
        // Allow manual upgrade handling from index.js
        this.handleUpgrade = (req, socket, head) => {
            this.Server.handleUpgrade(req, socket, head, (ws) => {
                this.Server.emit('connection', ws, req);
            });
        };
        this.Server.on('connection', this.OnServerConnection.bind(this));
        if (!this.StdIn) {
          logError('[Stream] No audio input stream defined (this.StdIn is null)');
          return;
        }
        this.StdIn.on('data', this.OnStdInData.bind(this));
        this.StdIn.resume();
    }
    BroadcastBinary(format, buffer) {
        this.FallbackClients[format].forEach((function each(client) {
            client.SendBinary(buffer);
        }).bind(this));
    }
    OnStdInData(buffer) {
        if (this.DroppingInput) return;
        let accepted = true;
        for (let format in this.FallbackProvider) {
            if (!this.FallbackProvider[format].InsertData(buffer)) accepted = false;
        }
        if (!accepted) this.StdIn.pause();
    }
    Discontinuity() {
        this.StdIn?.pause?.();
        this.DroppingInput = true;
        try {
            if (typeof this.StdIn?.read === "function") {
                while (this.StdIn.read() !== null) {
                    // Drop PCM queued before the discontinuity.
                }
            }
            this.Clients.forEach((client) => {
                if (!client.Format) return;
                try {
                    client.SendText(AUDIO_DISCONTINUITY_MESSAGE);
                }
                catch (error) {
                    logWarn(`[Stream] Unable to notify an audio client about a discontinuity: ${error.message}`);
                }
            });
            for (const provider of Object.values(this.FallbackProvider)) {
                try {
                    provider.Reset();
                }
                catch (error) {
                    logWarn(`[Stream] Unable to reset the ${provider.Format || "audio"} encoder: ${error.message}`);
                }
            }
        } finally {
            this.DroppingInput = false;
            this.ResumeInputWhenReady();
        }
    }
    ResumeInputWhenReady() {
        if (this.DroppingInput) return;
        const providers = Object.values(this.FallbackProvider);
        if (providers.every((provider) => !provider.Backpressured && !provider.Resetting)) {
            this.StdIn?.resume?.();
        }
    }
    OnServerConnection(socket, _request) {
        this.Clients.add(new StreamClient(this, socket));
    }
    // Clients that requested an audio format, i.e. are actually listening.
    ListenerCount() {
        return this.FallbackClients["mp3"].size + this.FallbackClients["wav"].size;
    }
    SetFallback(client, format) {
        // ws still delivers messages while a destroyed socket is closing; a
        // late request must not re-register the client or start an encoder.
        if (!this.Clients.has(client)) return;
        const provider = this.FallbackProvider[format];
        if ((format != "mp3" && format != "wav") || !provider) {
            this.DestroyClient(client);
            return;
        }

        if (client.Format === format) return;

        const previousFormat = client.Format;
        if (previousFormat) {
            this.FallbackClients[previousFormat].delete(client);
            if (this.FallbackClients[previousFormat].size === 0) {
                this.FallbackProvider[previousFormat]?.Stop();
            }
        }

        client.Format = format;
        this.FallbackClients[format].add(client);
        provider.Start();
        provider.PrimeClient(client);
        if (!previousFormat) notifyClientCount(this.ListenerCount());
    }
    DestroyClient(client) {
        if (!this.Clients.delete(client)) return;
        const wasListening = Boolean(client.Format);
        this.FallbackClients["mp3"].delete(client);
        this.FallbackClients["wav"].delete(client);
        client.Format = null;
        for (const format of ["mp3", "wav"]) {
            if (this.FallbackClients[format].size === 0) {
                this.FallbackProvider[format]?.Stop();
            }
        }
        client.Destroy();
        if (wasListening) notifyClientCount(this.ListenerCount());
    }
    GetStats() {
        let fallback = {
            "wav": (this.FallbackClients["wav"] ? this.FallbackClients["wav"].size : 0),
            "mp3": (this.FallbackClients["mp3"] ? this.FallbackClients["mp3"].size : 0),
        };
        let total = 0;
        for (let format in fallback) {
            total += fallback[format];
        }
        return {
            "Total": total,
            "Fallback": fallback,
        };
    }
    static Create(options) {
        // Allow Port to be omitted
        const port = options["-port"] || null;
        if (!options["-channels"])
            throw new Error("Channels undefined. Please use -channels to define the number of channels.");
        if (typeof options["-channels"] !== "number" || options["-channels"] !== Math.floor(options["-channels"]) ||
            !(options["-channels"] == 1 || options["-channels"] == 2))
            throw new Error("Invalid channels. Must be either 1 or 2.");
        if (!options["-samplerate"])
            throw new Error("Sample rate undefined. Please use -samplerate to define the sample rate.");
        if (typeof options["-samplerate"] !== "number" || options["-samplerate"] !== Math.floor(options["-samplerate"]) || options["-samplerate"] < 1)
            throw new Error("Invalid sample rate. Must be natural number greater than 0.");
        return new StreamServer(port, options["-channels"], options["-samplerate"]);
    }
}
class AFallbackProvider {
    constructor(server) {
        this.Server = server;
        this.Process = null;
        this.Backpressured = false;
        this.RestartTimer = null;
        this.Stopping = false;
        this.Resetting = false;
        this.ResetKillTimer = null;
    }
    Start() {
        if (this.Process || this.RestartTimer) return;
        this.Stopping = false;
        this.OnStart();
        const child = (0, child_process_1.spawn)(
            FFmpeg_command,
            this.GetFFmpegArguments(),
            { shell: false, detached: false, stdio: ['pipe', 'pipe', 'ignore'] }
        );
        this.Process = child;
        child.stdout.addListener('data', (data) => {
            this.OnProcessData(child, data);
        });
        child.stdin.on('error', (error) => {
            if (error.code !== 'EPIPE') {
                logWarn(`[Stream] FFmpeg input error: ${error.message}`);
            }
        });
        child.on('error', (error) => {
            if (this.Process === child) {
                logWarn(`[Stream] Unable to start FFmpeg: ${error.message}`);
            }
        });
        child.on('close', () => this.OnProcessClose(child));
    }
    Stop() {
        this.Stopping = true;
        clearTimeout(this.RestartTimer);
        clearTimeout(this.ResetKillTimer);
        this.RestartTimer = null;
        this.ResetKillTimer = null;
        this.Backpressured = false;
        this.Resetting = false;
        const child = this.Process;
        this.Process = null;
        if (child) {
            child.stdin.end();
            child.kill('SIGTERM');
        }
        this.Server.ResumeInputWhenReady();
    }
    Reset() {
        this.Stopping = false;
        clearTimeout(this.RestartTimer);
        this.RestartTimer = null;

        const child = this.Process;
        if (!child) {
            this.Resetting = false;
            this.Backpressured = false;
            if (this.Server.FallbackClients[this.Format]?.size > 0) this.Start();
            this.Server.ResumeInputWhenReady();
            return;
        }
        if (this.Resetting) return;

        this.Resetting = true;
        this.Backpressured = true;
        child.stdin.end();
        child.kill('SIGTERM');
        this.ResetKillTimer = setTimeout(() => {
            this.ResetKillTimer = null;
            if (this.Process === child && this.Resetting) {
                child.kill('SIGKILL');
            }
        }, RESET_KILL_DELAY_MS);
        this.ResetKillTimer.unref?.();
    }
    OnStart() {
    }
    OnProcessData(child, data) {
        if (this.Process === child && !this.Resetting) this.OnData(data);
    }
    OnProcessClose(child) {
        if (this.Process !== child) return;
        clearTimeout(this.ResetKillTimer);
        this.ResetKillTimer = null;
        this.Process = null;
        const restartImmediately = this.Resetting;
        this.Resetting = false;
        this.Backpressured = false;
        if (restartImmediately &&
            !this.Stopping &&
            this.Server.FallbackClients[this.Format]?.size > 0) {
            this.Start();
            this.Server.ResumeInputWhenReady();
            return;
        }
        this.Server.ResumeInputWhenReady();
        if (!this.Stopping && this.Server.FallbackClients[this.Format]?.size > 0) {
            this.RestartTimer = setTimeout(() => {
                this.RestartTimer = null;
                this.Start();
            }, 500);
        }
    }
    InsertData(buffer) {
        if (this.Resetting) return false;
        const child = this.Process;
        if (!child?.stdin?.writable) return true;
        const accepted = child.stdin.write(buffer);
        if (!accepted && !this.Backpressured) {
            this.Backpressured = true;
            child.stdin.once('drain', () => {
                if (this.Process !== child || this.Resetting) return;
                this.Backpressured = false;
                this.Server.ResumeInputWhenReady();
            });
        }
        return accepted;
    }
    static Create(server, format) {
        let provider;
        if (format == "mp3") {
            provider = new FallbackProviderMp3(server);
        }
        else if (format == "wav") {
            provider = new FallbackProviderWav(server, 384);
        }
        if (provider) provider.Format = format;
        return provider;
    }
}
class FallbackProviderMp3 extends AFallbackProvider {
    constructor(server) {
        super(server);
    }
    GetFFmpegArguments() {
        return getMp3FfmpegArguments({
            sampleRate: this.Server.SampleRate,
            sampleRateOffset: serverConfig.audio.samplerateOffset,
            channels: this.Server.Channels,
            audioBitrate: serverConfig.audio.audioBitrate
        });
    }
    OnData(chunk) {
        this.Server.BroadcastBinary("mp3", chunk);
    }
    PrimeClient(_) {
    }
}
class FallbackProviderWav extends AFallbackProvider {
    constructor(server, chunkSize) {
        super(server);
        if (typeof chunkSize !== "number" || chunkSize !== Math.floor(chunkSize) || chunkSize < 1)
            throw new Error("Invalid ChunkSize. Must be natural number greater than or equal to 1.");
        this.ChunkSize = chunkSize;
        this.ChunkBuffer = Buffer.alloc(0);
        this.HeaderBuffer = new Array();
    }
    GetFFmpegArguments() {
        return [
            "-fflags", "+nobuffer+flush_packets", "-flags", "low_delay", "-rtbufsize", "32", "-probesize", "32",
            "-f", "s16le",
            "-ar", Number(this.Server.SampleRate.toString()) + Number(serverConfig.audio.samplerateOffset),
            "-ac", this.Server.Channels.toString(),
            "-i", "pipe:0",
            "-c:a", "pcm_s16le",
            "-ar", Settings.FallbackWavSampleRate.toString(),
            "-ac", "1",
            "-f", "wav",
            "-flush_packets", "1", "-fflags", "+nobuffer", "-chunk_size", "384", "-packetsize", "384",
            "pipe:1"
        ];
    }
    OnStart() {
        this.ChunkBuffer = Buffer.alloc(0);
        this.HeaderBuffer = new Array();
    }
    OnData(chunk) {
        // Check if riff for wav
        if (this.HeaderBuffer.length == 0) {
            // Check if chunk is a header page
            let isHeader = (chunk[0] == 0x52 && chunk[1] == 0x49 && chunk[2] == 0x46 && chunk[3] == 0x46);
            if (isHeader) {
                this.HeaderBuffer.push(chunk);
                this.Server.BroadcastBinary("wav", chunk);
            }
        }
        else {
            this.ChunkBuffer = Buffer.concat(new Array(this.ChunkBuffer, chunk), this.ChunkBuffer.length + chunk.length);
            if (this.ChunkBuffer.length >= this.ChunkSize) {
                let chunkBuffer = this.ChunkBuffer;
                this.ChunkBuffer = Buffer.alloc(0);
                this.Server.BroadcastBinary("wav", chunkBuffer);
            }
        }
    }
    PrimeClient(client) {
        let headerBuffer = this.HeaderBuffer;
        for (let i = 0; i < headerBuffer.length; i++) {
            client.SendBinary(headerBuffer[i]);
        }
    }
}
/* Parsing parameters no longer required for Server variable but we'll keep the old code here as a reference
const OptionParser = {
    "-port": function (txt) { return parseInt(txt, 10); },
    "-channels": function (txt) { return parseInt(txt, 10); },
    "-samplerate": function (txt) { return parseInt(txt, 10); }
};
const Options = {};
// Parse parameters
for (let i = 2; i < (process.argv.length - 1); i += 2) {
    if (!OptionParser[process.argv[i]])
        throw new Error("Invalid argument: '" + process.argv[i] + "'.");
    if (Options[process.argv[i]])
        throw new Error("Redefined argument: '" + process.argv[i] + "'. Please use '" + process.argv[i] + "' only ONCE");
    Options[process.argv[i]] = OptionParser[process.argv[i]](process.argv[i + 1]);
}
*/
  const useRtlTcp = isRtlTcpBackend(serverConfig);
  const audioChannels = useRtlTcp ? 2 : (serverConfig.audio.audioChannels || 2);
  const Server = new StreamServer(null, audioChannels, 48000);

  ServerInstance = Server;

  handleAudioUpgradeFn = function (request, socket, head, cb) {
    if (Server.Server && Server.Server.handleUpgrade) {
      Server.Server.handleUpgrade(request, socket, head, cb);
    } else {
      socket.destroy();
    }
  };

  readyResolve();

}).catch((err) => {
  logError('[Stream] Error:', err);
});

module.exports = {
  get Server() {
    return ServerInstance;
  },
  get handleAudioUpgrade() {
    return handleAudioUpgradeFn;
  },
  onClientCountChange,
  waitUntilReady
};
//# sourceMappingURL=3las.server.js.map
