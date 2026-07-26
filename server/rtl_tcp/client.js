"use strict";

const net = require('net');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { spawn } = require('child_process');

const RTL_TCP_HEADER_SIZE = 12;
const RTL_TCP_MAGIC = 'RTL0';
const RTL_TCP_COMMAND = Object.freeze({
  FREQUENCY: 0x01,
  SAMPLE_RATE: 0x02,
  GAIN_MODE: 0x03,
  GAIN: 0x04,
  PPM: 0x05,
  AGC_MODE: 0x08,
  BIAS_TEE: 0x0e
});

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function designLowPass(sampleRate, cutoffHz, length) {
  const taps = new Float64Array(length);
  const middle = (length - 1) / 2;
  const normalizedCutoff = cutoffHz / sampleRate;
  let sum = 0;

  for (let index = 0; index < length; index++) {
    const offset = index - middle;
    const sinc = offset === 0
      ? 2 * normalizedCutoff
      : Math.sin(2 * Math.PI * normalizedCutoff * offset) / (Math.PI * offset);
    const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * index) / (length - 1));
    taps[index] = sinc * window;
    sum += taps[index];
  }

  for (let index = 0; index < length; index++) {
    taps[index] /= sum;
  }

  return taps;
}

class RtlTcpClient extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      host: options.host || '127.0.0.1',
      port: Number(options.port) || 1234,
      sampleRate: Number(options.sampleRate) || 240000,
      frequencyHz: Number(options.frequencyHz) || 87500000,
      gain: options.gain ?? 'auto',
      ppm: Number(options.ppm) || 0,
      biasTee: Boolean(options.biasTee),
      deemphasisUs: Number(options.deemphasisUs) || 50,
      signalFloorDbfs: Number(options.signalFloorDbfs ?? -55),
      redseaPath: options.redseaPath || 'redsea',
      redseaEnabled: options.redseaEnabled !== false,
      reconnectDelayMs: Number(options.reconnectDelayMs ?? 2000),
      reconnect: options.reconnect !== false,
      audioChannels: Number(options.audioChannels) === 1 ? 1 : 2
    };

    if (this.options.sampleRate % 48000 !== 0) {
      throw new Error('RTL-TCP sample rate must be an integer multiple of 48000');
    }

    this.audioStream = new PassThrough({ highWaterMark: 1024 * 1024 });
    this.socket = null;
    this.reconnectTimer = null;
    this.commandBuffer = '';
    this.headerBuffer = Buffer.alloc(0);
    this.headerReceived = false;
    this.pendingIqByte = null;
    this.stopped = true;
    this.volume = 1;
    this.redsea = null;
    this.redseaBuffer = '';
    this.redseaBackpressured = false;
    this.decimation = this.options.sampleRate / 48000;
    this.audioTaps = designLowPass(this.options.sampleRate, 15000, 63);
    this.audioHistory = new Float64Array(this.audioTaps.length);
    this.audioHistoryIndex = 0;
    this.decimationCounter = 0;
    this.previousI = 0;
    this.previousQ = 0;
    this.hasPreviousIq = false;
    this.previousDemodInput = 0;
    this.previousDemodOutput = 0;
    this.deemphasisState = 0;
    this.powerSum = 0;
    this.powerSamples = 0;
    this.signalWindowSamples = Math.max(1, Math.round(this.options.sampleRate / 4));
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this._connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this._stopRedsea();
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
  }

  write(data) {
    this.commandBuffer += Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    const commands = this.commandBuffer.split(/\r?\n/);
    this.commandBuffer = commands.pop();

    for (const command of commands) {
      this._handleTunerCommand(command.trim());
    }
    return true;
  }

  tune(frequencyHz) {
    const parsedFrequency = Math.round(Number(frequencyHz));
    if (!Number.isFinite(parsedFrequency) || parsedFrequency < 1000000) return false;

    this.options.frequencyHz = parsedFrequency;
    this._sendCommand(RTL_TCP_COMMAND.FREQUENCY, parsedFrequency);
    this._resetDsp();
    this._restartRedsea();
    this.emit('frequency', parsedFrequency / 1000);
    return true;
  }

  _connect() {
    if (this.stopped) return;

    this.headerBuffer = Buffer.alloc(0);
    this.headerReceived = false;
    const socket = net.createConnection({
      host: this.options.host,
      port: this.options.port
    });
    this.socket = socket;
    socket.setNoDelay(true);

    socket.on('data', (data) => this._handleSocketData(data));
    socket.on('connect', () => {
      this.emit('status', `Connected to rtl_tcp at ${this.options.host}:${this.options.port}`);
    });
    socket.on('error', (error) => {
      this.emit('warning', `rtl_tcp connection error: ${error.message}`);
    });
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
      this.headerReceived = false;
      this._stopRedsea();
      this.emit('disconnected');
      this._scheduleReconnect();
    });
  }

  _scheduleReconnect() {
    if (this.stopped || !this.options.reconnect || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, this.options.reconnectDelayMs);
  }

  _handleSocketData(data) {
    let samples = data;

    if (!this.headerReceived) {
      this.headerBuffer = Buffer.concat([this.headerBuffer, data]);
      if (this.headerBuffer.length < RTL_TCP_HEADER_SIZE) return;

      const header = this.headerBuffer.subarray(0, RTL_TCP_HEADER_SIZE);
      if (header.subarray(0, 4).toString('ascii') !== RTL_TCP_MAGIC) {
        this.emit('warning', 'Invalid rtl_tcp header (expected RTL0)');
        this.socket?.destroy();
        return;
      }

      this.headerReceived = true;
      samples = this.headerBuffer.subarray(RTL_TCP_HEADER_SIZE);
      this.headerBuffer = Buffer.alloc(0);
      this._configureReceiver();
      this._startRedsea();
      this.emit('ready', {
        tunerType: header.readUInt32BE(4),
        gainCount: header.readUInt32BE(8)
      });
    }

    if (samples.length > 0) this._processIq(samples);
  }

  _configureReceiver() {
    this._sendCommand(RTL_TCP_COMMAND.SAMPLE_RATE, this.options.sampleRate);
    this._sendCommand(RTL_TCP_COMMAND.FREQUENCY, this.options.frequencyHz);
    this._sendCommand(RTL_TCP_COMMAND.PPM, this.options.ppm);

    const numericGain = Number(this.options.gain);
    if (String(this.options.gain).toLowerCase() === 'auto' || !Number.isFinite(numericGain)) {
      this._sendCommand(RTL_TCP_COMMAND.GAIN_MODE, 0);
      this._sendCommand(RTL_TCP_COMMAND.AGC_MODE, 1);
    } else {
      this._sendCommand(RTL_TCP_COMMAND.AGC_MODE, 0);
      this._sendCommand(RTL_TCP_COMMAND.GAIN_MODE, 1);
      this._sendCommand(RTL_TCP_COMMAND.GAIN, Math.round(numericGain * 10));
    }

    this._sendCommand(RTL_TCP_COMMAND.BIAS_TEE, this.options.biasTee ? 1 : 0);
  }

  _sendCommand(command, value) {
    if (!this.socket || this.socket.destroyed) return false;
    const message = Buffer.allocUnsafe(5);
    message.writeUInt8(command, 0);
    message.writeUInt32BE(Number(value) >>> 0, 1);
    this.socket.write(message);
    return true;
  }

  _handleTunerCommand(command) {
    if (!command) return;

    if (command.startsWith('T')) {
      const frequencyKhz = Number(command.slice(1).split(',')[0]);
      this.tune(frequencyKhz * 1000);
      return;
    }

    if (command.startsWith('Y')) {
      const requestedVolume = Number(command.slice(1));
      if (Number.isFinite(requestedVolume)) this.volume = clamp(requestedVolume / 100, 0, 2);
      return;
    }

    if (command.startsWith('W') || command.startsWith('F')) {
      this.emit('bandwidth', command.slice(1));
    }
  }

  _processIq(data) {
    let iq = data;
    if (this.pendingIqByte !== null) {
      iq = Buffer.concat([Buffer.from([this.pendingIqByte]), data]);
      this.pendingIqByte = null;
    }
    if (iq.length % 2 !== 0) {
      this.pendingIqByte = iq[iq.length - 1];
      iq = iq.subarray(0, iq.length - 1);
    }

    const sampleCount = iq.length / 2;
    const mpx = this.redsea && !this.redseaBackpressured
      ? Buffer.allocUnsafe(sampleCount * 2)
      : null;
    const estimatedAudioSamples = Math.ceil(sampleCount / this.decimation);
    const pcm = Buffer.allocUnsafe(
      estimatedAudioSamples * this.options.audioChannels * Int16Array.BYTES_PER_ELEMENT
    );
    let mpxOffset = 0;
    let pcmOffset = 0;

    for (let offset = 0; offset < iq.length; offset += 2) {
      const currentI = (iq[offset] - 127.5) / 127.5;
      const currentQ = (iq[offset + 1] - 127.5) / 127.5;
      const power = (currentI * currentI + currentQ * currentQ) / 2;
      this.powerSum += power;
      this.powerSamples++;

      let demodulated = 0;
      if (this.hasPreviousIq) {
        const cross = this.previousI * currentQ - this.previousQ * currentI;
        const dot = this.previousI * currentI + this.previousQ * currentQ;
        const phaseDifference = Math.atan2(cross, dot);
        const maximumPhase = (2 * Math.PI * 75000) / this.options.sampleRate;
        demodulated = clamp(phaseDifference / maximumPhase, -1.5, 1.5);
      } else {
        this.hasPreviousIq = true;
      }
      this.previousI = currentI;
      this.previousQ = currentQ;

      const dcBlocked = demodulated - this.previousDemodInput + 0.995 * this.previousDemodOutput;
      this.previousDemodInput = demodulated;
      this.previousDemodOutput = dcBlocked;

      if (mpx) {
        mpx.writeInt16LE(Math.round(clamp(dcBlocked, -1, 1) * 32767), mpxOffset);
        mpxOffset += 2;
      }

      this.audioHistory[this.audioHistoryIndex] = dcBlocked;
      this.audioHistoryIndex = (this.audioHistoryIndex + 1) % this.audioHistory.length;
      this.decimationCounter++;

      if (this.decimationCounter === this.decimation) {
        this.decimationCounter = 0;
        let filtered = 0;
        let historyIndex = this.audioHistoryIndex;
        for (let tapIndex = 0; tapIndex < this.audioTaps.length; tapIndex++) {
          historyIndex = (historyIndex - 1 + this.audioHistory.length) % this.audioHistory.length;
          filtered += this.audioHistory[historyIndex] * this.audioTaps[tapIndex];
        }

        const samplePeriod = 1 / 48000;
        const timeConstant = this.options.deemphasisUs / 1000000;
        const alpha = samplePeriod / (timeConstant + samplePeriod);
        this.deemphasisState += alpha * (filtered - this.deemphasisState);
        const audioSample = Math.round(clamp(this.deemphasisState * this.volume, -1, 1) * 32767);

        for (let channel = 0; channel < this.options.audioChannels; channel++) {
          pcm.writeInt16LE(audioSample, pcmOffset);
          pcmOffset += 2;
        }
      }

      if (this.powerSamples >= this.signalWindowSamples) this._emitSignalLevel();
    }

    if (mpx && mpxOffset > 0 && this.redsea?.stdin?.writable) {
      this.redseaBackpressured = !this.redsea.stdin.write(mpx.subarray(0, mpxOffset));
    }
    if (pcmOffset > 0) this.audioStream.write(pcm.subarray(0, pcmOffset));
  }

  _emitSignalLevel() {
    const meanPower = this.powerSum / Math.max(1, this.powerSamples);
    const dbfs = 10 * Math.log10(Math.max(meanPower, 1e-12));
    const snr = clamp(dbfs - this.options.signalFloorDbfs, 0, 70);
    this.emit('signal', {
      snr: Number(snr.toFixed(1)),
      dbfs: Number(dbfs.toFixed(1)),
      stereo: false
    });
    this.powerSum = 0;
    this.powerSamples = 0;
  }

  _startRedsea() {
    if (!this.options.redseaEnabled || this.redsea || this.stopped) return;

    const child = spawn(
      this.options.redseaPath,
      ['--input', 'mpx', '-r', String(this.options.sampleRate)],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    this.redsea = child;
    this.redseaBuffer = '';
    this.redseaBackpressured = false;

    child.stdin.on('drain', () => {
      if (this.redsea === child) this.redseaBackpressured = false;
    });
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') this.emit('warning', `redsea stdin error: ${error.message}`);
    });
    child.stdout.on('data', (data) => this._handleRedseaData(data));
    child.stderr.on('data', (data) => {
      const message = data.toString('utf8').trim();
      if (message) this.emit('warning', `redsea: ${message}`);
    });
    child.on('error', (error) => {
      this.emit('warning', `Unable to start redsea: ${error.message}`);
    });
    child.on('close', (code, signal) => {
      if (this.redsea !== child) return;
      this.redsea = null;
      this.redseaBackpressured = false;
      if (!this.stopped && code && signal !== 'SIGTERM') {
        this.emit('warning', `redsea exited with code ${code}`);
      }
    });
  }

  _stopRedsea() {
    const child = this.redsea;
    this.redsea = null;
    this.redseaBackpressured = false;
    this.redseaBuffer = '';
    if (!child) return;
    child.stdin?.end();
    child.kill('SIGTERM');
  }

  _restartRedsea() {
    this._stopRedsea();
    if (this.headerReceived) this._startRedsea();
  }

  _handleRedseaData(data) {
    this.redseaBuffer += data.toString('utf8');
    const lines = this.redseaBuffer.split(/\r?\n/);
    this.redseaBuffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        this.emit('rds', JSON.parse(line));
      } catch (error) {
        this.emit('warning', `Unable to parse redsea JSON: ${error.message}`);
      }
    }
  }

  _resetDsp() {
    this.pendingIqByte = null;
    this.audioHistory.fill(0);
    this.audioHistoryIndex = 0;
    this.decimationCounter = 0;
    this.previousI = 0;
    this.previousQ = 0;
    this.hasPreviousIq = false;
    this.previousDemodInput = 0;
    this.previousDemodOutput = 0;
    this.deemphasisState = 0;
    this.powerSum = 0;
    this.powerSamples = 0;
  }
}

module.exports = {
  RtlTcpClient,
  RTL_TCP_COMMAND,
  designLowPass
};
