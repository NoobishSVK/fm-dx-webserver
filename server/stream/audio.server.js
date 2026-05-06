"use strict";
/*
    SSE audio codec streamer (replaces 3LAS server module)
*/
const { spawn } = require('child_process');
const checkFFmpeg = require('./checkFFmpeg');
const { logError, logInfo, logWarn } = require('../console');
const { serverConfig } = require('../server_config');

let ffmpegPath = 'ffmpeg';
let ServerInstance;

let readyResolve;
const waitUntilReady = new Promise((resolve) => {
  readyResolve = resolve;
});

class StreamClient {
  constructor(server) {
    this.Server = server;
  }
  Destroy() {
  }
}

class StreamServer {
  constructor(channels, sampleRate) {
    this.Channels = channels;
    this.SampleRate = sampleRate;
    this.Clients = new Set();
    this.AudioCodecClients = {
      mp3: new Set(),
      opus: new Set()
    };
    this.AudioCodecProvider = {};
    if (serverConfig.audio.mp3Enabled) {
      this.AudioCodecProvider.mp3 = AudioCodecProviderBase.Create(this, "mp3");
    }
    if (serverConfig.audio.opusEnabled) {
      this.AudioCodecProvider.opus = AudioCodecProviderBase.Create(this, "opus");
    }
    if (Object.keys(this.AudioCodecProvider).length === 0) {
      logWarn('[Audio] No codecs enabled — audio streaming disabled. Enable MP3 or Opus in admin setup and restart.');
    }
    this.StdIn = process.stdin;
  }
  Run() {
    if (!this.StdIn) {
      logError('[Stream] No audio input stream defined (this.StdIn is null)');
      return;
    }
    this.StdIn.on('data', this.OnStdInData.bind(this));
    this.StdIn.resume();
  }
  OnStdInData(buffer) {
    for (let codec in this.AudioCodecProvider) {
      this.AudioCodecProvider[codec].InsertData(buffer);
    }
  }
  BroadcastBinary(codec, buffer) {
    const clients = this.AudioCodecClients[codec];
    if (!clients) return;
    clients.forEach((client) => {
      client.SendBinary(buffer);
    });
  }
  SetAudioCodec(client, codec) {
    if (!this.AudioCodecProvider[codec]) {
      this.DestroyClient(client);
      return;
    }
    this.AudioCodecClients[codec].add(client);
    this.AudioCodecProvider[codec].PrimeClient(client);
    logInfo(`[Audio] Listener connected: codec=${codec} bitrate=${this.AudioCodecProvider[codec].Bitrate} | active: ${this.FormatActiveCounts()}`);
  }
  DestroyClient(client) {
    let removedFrom = null;
    Object.keys(this.AudioCodecClients).forEach((key) => {
      if (this.AudioCodecClients[key].delete(client)) {
        removedFrom = key;
      }
    });
    this.Clients.delete(client);
    if (typeof client.Destroy === 'function') {
      client.Destroy();
    }
    if (removedFrom) {
      logInfo(`[Audio] Listener disconnected: codec=${removedFrom} | active: ${this.FormatActiveCounts()}`);
    }
  }
  FormatActiveCounts() {
    return Object.keys(this.AudioCodecClients)
      .map((c) => `${c}=${this.AudioCodecClients[c].size}`)
      .join(' ');
  }
}

class AudioCodecProviderBase {
  constructor(server, codec) {
    this.Server = server;
    this.Codec = codec;
    this.Bitrate = serverConfig.audio[`${codec}Bitrate`];
    this.Process = spawn(ffmpegPath, this.GetFFmpegArguments(), {
      shell: false,
      detached: false,
      stdio: ['pipe', 'pipe', 'ignore']
    });
    this.Process.stdout.addListener('data', this.OnData.bind(this));
    this.Process.on('error', (err) => {
      logWarn(`[Stream] FFmpeg spawn failed: ${err.message}`);
    });
    logInfo(`[Audio] FFmpeg encoder started: codec=${codec} bitrate=${this.Bitrate}`);
  }
  InsertData(buffer) {
    this.Process.stdin.write(buffer);
  }
  static Create(server, format) {
    if (format === "mp3") {
      return new AudioCodecProviderMp3(server);
    }
    if (format === "opus") {
      return new AudioCodecProviderOpus(server);
    }
    return null;
  }
}

class AudioCodecProviderMp3 extends AudioCodecProviderBase {
  constructor(server) {
    super(server, 'mp3');
  }
  GetFFmpegArguments() {
    return [
      "-fflags", "+nobuffer+flush_packets", "-flags", "low_delay", "-rtbufsize", "32", "-probesize", "32",
      "-f", "s16le",
      "-ar", Number(this.Server.SampleRate.toString()) + Number(serverConfig.audio.samplerateOffset),
      "-ac", this.Server.Channels.toString(),
      "-i", "pipe:0",
      "-c:a", "libmp3lame",
      "-b:a", this.Bitrate,
      "-ac", this.Server.Channels.toString(),
      "-reservoir", "0",
      "-f", "mp3", "-write_xing", "0", "-id3v2_version", "0",
      "-fflags", "+nobuffer", "-flush_packets", "1",
      "pipe:1"
    ];
  }
  OnData(chunk) {
    this.Server.BroadcastBinary("mp3", chunk);
  }
  PrimeClient(_) {
  }
}


class AudioCodecProviderOpus extends AudioCodecProviderBase {
  constructor(server) {
    super(server, 'opus');
    this.HeaderBuffer = Buffer.alloc(0);
    this.HeaderBytes = null;
    this.HeaderComplete = false;
  }
  GetFFmpegArguments() {
    return [
      "-fflags", "+nobuffer+flush_packets", "-flags", "low_delay", "-rtbufsize", "32", "-probesize", "32",
      "-f", "s16le",
      "-ar", Number(this.Server.SampleRate.toString()) + Number(serverConfig.audio.samplerateOffset),
      "-ac", this.Server.Channels.toString(),
      "-i", "pipe:0",
      "-c:a", "libopus",
      "-b:a", this.Bitrate,
      "-application", "audio",
      "-f", "webm",
      "-cluster_time_limit", "100",
      "-cluster_size_limit", "200000",
      "-fflags", "+nobuffer", "-flush_packets", "1",
      "pipe:1"
    ];
  }
  FindClusterOffset(buffer) {
    for (let i = 0; i + 3 < buffer.length; i++) {
      if (buffer[i] === 0x1f && buffer[i + 1] === 0x43 && buffer[i + 2] === 0xb6 && buffer[i + 3] === 0x75) {
        return i;
      }
    }
    return -1;
  }
  OnData(chunk) {
    if (!this.HeaderComplete) {
      this.HeaderBuffer = Buffer.concat([this.HeaderBuffer, chunk], this.HeaderBuffer.length + chunk.length);
      const clusterOffset = this.FindClusterOffset(this.HeaderBuffer);
      if (clusterOffset === -1) {
        return;
      }
      this.HeaderBytes = this.HeaderBuffer.slice(0, clusterOffset);
      this.HeaderComplete = true;
      this.Server.BroadcastBinary("opus", this.HeaderBytes);
      const remaining = this.HeaderBuffer.slice(clusterOffset);
      if (remaining.length) {
        this.Server.BroadcastBinary("opus", remaining);
      }
      this.HeaderBuffer = Buffer.alloc(0);
      return;
    }
    this.Server.BroadcastBinary("opus", chunk);
  }
  PrimeClient(client) {
    if (this.HeaderComplete && this.HeaderBytes) {
      client.SendBinary(this.HeaderBytes);
    }
  }
}

checkFFmpeg().then((resolvedPath) => {
  ffmpegPath = resolvedPath;
  const audioChannels = serverConfig.audio.audioChannels || 2;
  const Server = new StreamServer(audioChannels, 48000);
  ServerInstance = Server;
  readyResolve();
}).catch((err) => {
  logError('[Stream] Error:', err);
  readyResolve();
});

module.exports = {
  get Server() {
    return ServerInstance;
  },
  waitUntilReady
};
