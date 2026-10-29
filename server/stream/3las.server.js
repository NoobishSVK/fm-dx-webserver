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
const { getAudioFilterArguments } = require('./audio_encoder');
const { getMaxClientBufferBytes, hasExceededClientBuffer } = require('./live_stream_buffer');
const { Mp3Packetizer } = require('./mp3_packetizer');

let ffmpegStaticPath = 'ffmpeg'; // fallback value

let ServerInstance;
let handleAudioUpgradeFn;

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
        this.Destroyed = false;
        this.Socket.on('error', this.OnError.bind(this));
        this.Socket.on('message', this.OnMessage.bind(this));
        this.Socket.once('close', () => this.Server.RemoveClient(this));
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
    Destroy(force = false) {
        if (this.Destroyed) return;
        this.Destroyed = true;
        try {
            if (force) {
                this.Socket.terminate();
            } else {
                this.Socket.close();
            }
        }
        catch (ex) {
        }
    }
    SendBinary(buffer) {
        if (this.Socket.readyState != ws.OPEN) {
            this.OnError(null);
            return;
        }
        if (hasExceededClientBuffer(this.Socket.bufferedAmount, this.Server.MaxClientBufferBytes)) {
            logWarn(`[Stream] Disconnecting an audio client with more than ${this.Server.MaxClientBufferBytes} queued bytes.`);
            this.Server.DestroyClient(this, true);
            return;
        }
        try {
            this.Socket.send(buffer, this.BinaryOptions, (error) => {
                if (error) this.OnError(error);
            });
        } catch (error) {
            this.OnError(error);
        }
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
        } catch (error) {
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
        this.MaxClientBufferBytes = getMaxClientBufferBytes(serverConfig.audio.audioBitrate);
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
        this.StdIn = process.stdin;
        this.StdInDataHandler = this.OnStdInData.bind(this);
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
        const input = this.StdIn;
        this.StdIn = null;
        if (!this.SetInput(input)) {
          logError('[Stream] No audio input stream defined (this.StdIn is null)');
        }
    }
    SetInput(stream) {
        if (this.StdIn) {
            this.StdIn.removeListener('data', this.StdInDataHandler);
        }
        this.StdIn = stream;
        if (!this.StdIn) return false;
        this.StdIn.on('data', this.StdInDataHandler);
        this.StdIn.resume();
        return true;
    }
    BroadcastBinary(format, buffer) {
        this.FallbackClients[format].forEach((function each(client) {
            client.SendBinary(buffer);
        }).bind(this));
    }
    OnStdInData(buffer) {
        for (let format in this.FallbackProvider) {
            this.FallbackProvider[format].InsertData(buffer);
        }
    }
    OnServerConnection(socket, _request) {
        this.Clients.add(new StreamClient(this, socket));
    }
    SetFallback(client, format) {
        if (format != "mp3" && format != "wav") {
            this.DestroyClient(client);
            return;
        }
        this.FallbackClients[format].add(client);
        this.FallbackProvider[format].PrimeClient(client);
    }
    RemoveClient(client) {
        this.FallbackClients["mp3"].delete(client);
        this.FallbackClients["wav"].delete(client);
        this.Clients.delete(client);
    }
    DestroyClient(client, force = false) {
        this.RemoveClient(client);
        client.Destroy(force);
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
        this.InputBackpressured = false;
        this.DroppedInputChunks = 0;
        this.DroppedInputBytes = 0;
        this.Process = null;
        this.RestartTimer = null;
        this.BackpressureTimer = null;
        this.StartProcess();
    }
    StartProcess() {
        this.InputBackpressured = false;
        const encoder = (0, child_process_1.spawn)(FFmpeg_command, this.GetFFmpegArguments(), {
            shell: false,
            detached: false,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        this.Process = encoder;
        let lastOutputAt = 0;
        let lastGapWarningAt = 0;
        encoder.stdout.addListener('data', (data) => {
            if (encoder === this.Process) {
                const now = Date.now();
                const gap = now - lastOutputAt;
                if (lastOutputAt && gap >= 500 && now - lastGapWarningAt >= 10000) {
                    logWarn(`[Stream] Encoder output gap: ${gap} ms (includes capture and event-loop delay).`);
                    lastGapWarningAt = now;
                }
                lastOutputAt = now;
                this.OnData(data);
            }
        });
        encoder.stderr.on('data', (data) => {
            logFfmpeg(`[Stream encoder stderr]: ${data.toString()}`);
        });
        encoder.stdin.on('drain', () => this.OnInputDrain(encoder));
        encoder.stdin.on('error', (error) => {
            logError(`[Stream] FFmpeg input error: ${error.message}`);
            this.ScheduleRestart(encoder, 'input failure');
        });
        encoder.on('error', (error) => {
            logError(`[Stream] FFmpeg encoder failed to start: ${error.message}`);
            this.ScheduleRestart(encoder, 'process failure');
        });
        encoder.on('exit', (code, signal) => {
            const reason = signal ? `signal ${signal}` : `code ${code}`;
            this.ScheduleRestart(encoder, reason);
        });
        if (this.DroppedInputChunks > 0) {
            logWarn(`[Stream] Encoder restarted after dropping ${this.DroppedInputChunks} PCM chunks (${this.DroppedInputBytes} bytes).`);
            this.DroppedInputChunks = 0;
            this.DroppedInputBytes = 0;
        }
    }
    ScheduleRestart(encoder, reason) {
        if (encoder !== this.Process) return;

        this.Process = null;
        this.InputBackpressured = true;
        this.ClearBackpressureTimer();
        this.ResetOutputState();
        if (encoder.exitCode === null && encoder.signalCode === null) {
            try {
                encoder.kill('SIGKILL');
            } catch (_error) {
            }
        }
        if (this.RestartTimer) return;

        logWarn(`[Stream] FFmpeg encoder stopped (${reason}). Restarting in 2 seconds.`);
        this.RestartTimer = setTimeout(() => {
            this.RestartTimer = null;
            this.StartProcess();
        }, 2000);
    }
    ResetOutputState() {
    }
    StartBackpressureTimer(encoder) {
        if (this.BackpressureTimer) return;
        this.BackpressureTimer = setTimeout(() => {
            this.BackpressureTimer = null;
            if (encoder === this.Process && this.InputBackpressured) {
                this.ScheduleRestart(encoder, 'input backpressure timeout');
            }
        }, 5000);
    }
    ClearBackpressureTimer() {
        if (!this.BackpressureTimer) return;
        clearTimeout(this.BackpressureTimer);
        this.BackpressureTimer = null;
    }
    InsertData(buffer) {
        const encoder = this.Process;
        if (this.InputBackpressured || !encoder || !encoder.stdin.writable) {
            this.DroppedInputChunks++;
            this.DroppedInputBytes += buffer.length;
            return false;
        }

        try {
            if (!encoder.stdin.write(buffer)) {
                this.InputBackpressured = true;
                this.StartBackpressureTimer(encoder);
            }
            return true;
        } catch (error) {
            this.InputBackpressured = true;
            this.DroppedInputChunks++;
            this.DroppedInputBytes += buffer.length;
            logError(`[Stream] FFmpeg input write failed: ${error.message}`);
            this.ScheduleRestart(encoder, 'input write failure');
            return false;
        }
    }
    OnInputDrain(encoder) {
        if (encoder !== this.Process) return;
        this.ClearBackpressureTimer();
        this.InputBackpressured = false;
        if (this.DroppedInputChunks > 0) {
            logWarn(`[Stream] Encoder recovered from backpressure; dropped ${this.DroppedInputChunks} stale PCM chunks (${this.DroppedInputBytes} bytes).`);
            this.DroppedInputChunks = 0;
            this.DroppedInputBytes = 0;
        }
    }
    static Create(server, format) {
        if (format == "mp3") {
            return new FallbackProviderMp3(server);
        }
        else if (format == "wav") {
            return new FallbackProviderWav(server, 384);
        }
    }
}
class FallbackProviderMp3 extends AFallbackProvider {
    constructor(server) {
        super(server);
        this.Packetizer = new Mp3Packetizer(2);
    }
    GetFFmpegArguments() {
        return [
            "-fflags", "+nobuffer+flush_packets", "-flags", "low_delay", "-rtbufsize", "32", "-probesize", "32",
            "-f", "s16le",
            "-ar", Number(this.Server.SampleRate.toString()) + Number(serverConfig.audio.samplerateOffset),
            "-ac", this.Server.Channels.toString(),
            "-i", "pipe:0",
            ...getAudioFilterArguments(serverConfig.audio.audioBoost),
            "-c:a", "libmp3lame",
            "-b:a", serverConfig.audio.audioBitrate,
            "-ac", this.Server.Channels.toString(),
            "-reservoir", "0",
            "-f", "mp3", "-write_xing", "0", "-id3v2_version", "0",
            "-fflags", "+nobuffer", "-flush_packets", "1",
            "pipe:1"
        ];
    }
    OnData(chunk) {
        for (const packet of this.Packetizer.Push(chunk)) {
            this.Server.BroadcastBinary("mp3", packet);
        }
    }
    ResetOutputState() {
        this.Packetizer = new Mp3Packetizer(2);
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
            ...getAudioFilterArguments(serverConfig.audio.audioBoost),
            "-c:a", "pcm_s16le",
            "-ar", Settings.FallbackWavSampleRate.toString(),
            "-ac", "1",
            "-f", "wav",
            "-flush_packets", "1", "-fflags", "+nobuffer", "-chunk_size", "384", "-packetsize", "384",
            "pipe:1"
        ];
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
    ResetOutputState() {
        this.ChunkBuffer = Buffer.alloc(0);
        this.HeaderBuffer = new Array();
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
  const audioChannels = serverConfig.audio.audioChannels || 2;
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
  waitUntilReady
};
//# sourceMappingURL=3las.server.js.map
