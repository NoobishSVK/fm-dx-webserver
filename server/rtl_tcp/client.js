"use strict";

const path = require('path');
const net = require('net');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { Worker } = require('worker_threads');

const RTL_TCP_HEADER_SIZE = 12;
const RTL_TCP_MAGIC = 'RTL0';
const MINIMUM_WFM_SAMPLE_RATE = 192000;
const OUTPUT_SAMPLE_RATE = 48000;
const DEFAULT_BANDWIDTH_HZ = 200000;
const DEFAULT_RTL_TCP_BLOCK_BYTES = 256 * 1024;
const DEFAULT_TUNE_GUARD_MS = 50;
const DEFAULT_WORKER_QUEUE_BYTES = 64 * 1024;
const AUDIO_STREAM_BUFFER_BYTES = 64 * 1024;

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

function defaultTuneSettleMs(sampleRate) {
  const blockDurationMs = DEFAULT_RTL_TCP_BLOCK_BYTES * 500 / sampleRate;
  return Math.ceil(blockDurationMs + DEFAULT_TUNE_GUARD_MS);
}

function rdsGroupToTunerRecord(group) {
  if (!group || !Array.isArray(group.blocks) || group.blocks.length !== 4) {
    return null;
  }

  let errorByte = 0;
  const blocks = group.blocks.map((block, index) => {
    const present = Number.isInteger(block) && block >= 0 && block <= 0xffff;
    const requestedError = Number(group.errors?.[index]);
    const error = present && Number.isFinite(requestedError)
      ? clamp(Math.round(requestedError), 0, 3)
      : (present ? 0 : 3);
    errorByte |= error << ((3 - index) * 2);
    return (present ? block : 0).toString(16).padStart(4, '0').toUpperCase();
  });

  return `R${blocks.join('')}${errorByte.toString(16).padStart(2, '0').toUpperCase()}\n`;
}

class RtlTcpClient extends EventEmitter {
  constructor(options = {}) {
    super();

    const sampleRate = Number(options.sampleRate ?? 240000);
    const port = Number(options.port ?? 1234);
    const frequencyHz = Number(options.frequencyHz ?? 87500000);

    this.options = {
      host: options.host || '127.0.0.1',
      port,
      sampleRate,
      outputRate: OUTPUT_SAMPLE_RATE,
      frequencyHz,
      gain: options.gain ?? 'auto',
      ppm: Number(options.ppm ?? 0),
      biasTee: Boolean(options.biasTee),
      deemphasisUs: Number(options.deemphasisUs ?? 50),
      deviationHz: Number(options.deviationHz ?? 75000),
      bandwidthHz: Number(
        options.bandwidthHz ?? Math.min(DEFAULT_BANDWIDTH_HZ, sampleRate)
      ),
      signalSampleStride: Number(options.signalSampleStride ?? 64),
      stereoMinimumSnrDb: Number(options.stereoMinimumSnrDb ?? 3),
      rdsEnabled: options.rdsEnabled !== false,
      reconnectDelayMs: Number(options.reconnectDelayMs ?? 2000),
      dspRestartDelayMs: Number(options.dspRestartDelayMs ?? 500),
      tuneSettleMs: Number(
        options.tuneSettleMs ?? defaultTuneSettleMs(sampleRate)
      ),
      workerQueueBytes: Number(
        options.workerQueueBytes ?? DEFAULT_WORKER_QUEUE_BYTES
      ),
      reconnect: options.reconnect !== false,
      createConnection: options.createConnection || net.createConnection,
      createWorker: options.createWorker || ((workerData) => new Worker(
        path.join(__dirname, 'dsp-worker.js'),
        { workerData }
      ))
    };

    if (!Number.isFinite(this.options.sampleRate) ||
        this.options.sampleRate < MINIMUM_WFM_SAMPLE_RATE ||
        this.options.sampleRate % OUTPUT_SAMPLE_RATE !== 0) {
      throw new Error(
        `RTL-TCP sample rate must be a finite integer multiple of ${OUTPUT_SAMPLE_RATE} Hz and at least ${MINIMUM_WFM_SAMPLE_RATE} Hz`
      );
    }

    if (!Number.isInteger(this.options.port) ||
        this.options.port < 1 ||
        this.options.port > 65535) {
      throw new Error('RTL-TCP port must be an integer between 1 and 65535');
    }

    if (!Number.isInteger(this.options.frequencyHz) ||
        this.options.frequencyHz < 1000000 ||
        this.options.frequencyHz > 0xffffffff) {
      throw new Error('RTL-TCP frequency must be an integer between 1 MHz and 4294.967295 MHz');
    }

    if (!Number.isFinite(this.options.ppm)) {
      throw new Error('RTL-TCP PPM correction must be a finite number');
    }

    if (!Number.isFinite(this.options.deviationHz) ||
        this.options.deviationHz <= 0 ||
        this.options.deviationHz >= this.options.sampleRate / 2) {
      throw new Error('RTL-TCP FM deviation must be finite, positive, and below Nyquist');
    }

    if (!Number.isFinite(this.options.deemphasisUs) || this.options.deemphasisUs <= 0) {
      throw new Error('RTL-TCP de-emphasis must be a finite positive number');
    }

    if (!Number.isFinite(this.options.tuneSettleMs) || this.options.tuneSettleMs < 0) {
      throw new Error('RTL-TCP tune settle time must be a finite non-negative number');
    }

    if (!Number.isFinite(this.options.workerQueueBytes) ||
        this.options.workerQueueBytes < 1) {
      throw new Error('RTL-TCP worker queue size must be a finite positive number');
    }

    if (!Number.isFinite(this.options.bandwidthHz) ||
        this.options.bandwidthHz < 4000 ||
        this.options.bandwidthHz > this.options.sampleRate) {
      throw new Error(
        'RTL-TCP bandwidth must be between 4000 Hz and the sample rate'
      );
    }

    if (!Number.isFinite(this.options.stereoMinimumSnrDb) ||
        this.options.stereoMinimumSnrDb < 0 ||
        this.options.stereoMinimumSnrDb > 70) {
      throw new Error('RTL-TCP stereo SNR threshold must be between 0 and 70 dB');
    }

    if (!Number.isInteger(this.options.signalSampleStride) ||
        this.options.signalSampleStride < 1) {
      throw new Error('RTL-TCP signal sample stride must be a positive integer');
    }

    if (!Number.isFinite(this.options.reconnectDelayMs) ||
        this.options.reconnectDelayMs < 0 ||
        !Number.isFinite(this.options.dspRestartDelayMs) ||
        this.options.dspRestartDelayMs < 0) {
      throw new Error('RTL-TCP restart delays must be finite non-negative numbers');
    }

    this.audioStream = new PassThrough({
      readableHighWaterMark: AUDIO_STREAM_BUFFER_BYTES,
      writableHighWaterMark: AUDIO_STREAM_BUFFER_BYTES
    });
    this.socket = null;
    this.socketDataHandler = null;
    this.socketPaused = false;
    this.reconnectTimer = null;
    this.dspRestartTimer = null;
    this.commandBuffer = '';
    this.headerBuffer = Buffer.alloc(0);
    this.headerReceived = false;
    this.iqBytePhase = 0;
    this.iqDiscardBytes = 0;
    this.stopped = true;
    this.dspWorker = null;
    this.dspGeneration = 0;
    this.workerMessageId = 0;
    this.workerPendingBytes = 0;
    this.workerInputBackpressured = false;
    this.audioBackpressured = false;
    this.deferredIq = [];
    this.deferredIqBytes = 0;
    this.pendingPcm = [];
    this.pendingPcmBytes = 0;
    this.audioDiscontinuityInProgress = false;
    this.stereo = false;
    this.forceMono = options.forceMono === true || String(options.forceMono) === '1';
    this.unsupportedCommands = new Set();
    this.dspProcessingMs = 0;
    this.dspInputBytes = 0;

    this.audioStream.on('drain', () => {
      this.audioBackpressured = false;
      this._flushPendingPcm();
      if (!this.audioBackpressured) this._flushDeferredIq();
      this._resumeSocketIfPossible();
    });
  }

  get ready() {
    return this.headerReceived && !this.stopped;
  }

  getDspStats() {
    const radioMs = this.dspInputBytes * 500 / this.options.sampleRate;
    return {
      inputBytes: this.dspInputBytes,
      processingMs: this.dspProcessingMs,
      realtimeRatio: this.dspProcessingMs > 0
        ? radioMs / this.dspProcessingMs
        : 0
    };
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this._connect();
  }

  stop() {
    const wasReady = this.headerReceived;
    this.stopped = true;
    this.headerReceived = false;
    this.iqBytePhase = 0;
    this.iqDiscardBytes = 0;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.dspRestartTimer);
    this.reconnectTimer = null;
    this.dspRestartTimer = null;
    this._stopDspWorker({ resumeSocket: false });

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.socketDataHandler = null;
    this.socketPaused = false;

    if (wasReady) this.emit('unready');
  }

  /**
   * Match the writable receiver contract used by SerialPort and the XDR socket.
   */
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
    if (!Number.isFinite(parsedFrequency) ||
        parsedFrequency < 1000000 ||
        parsedFrequency > 0xffffffff) return false;

    const resetActiveAudio = this.headerReceived && !this.stopped;
    if (resetActiveAudio) {
      this._pauseSocket();
      this._drainSocketInput();
    }
    this.options.frequencyHz = parsedFrequency;
    this._sendCommand(RTL_TCP_COMMAND.FREQUENCY, parsedFrequency);
    this.stereo = false;

    if (resetActiveAudio) {
      clearTimeout(this.dspRestartTimer);
      this.dspRestartTimer = null;
      this._stopDspWorker({ resumeSocket: false });
    }

    if (resetActiveAudio) {
      this.audioDiscontinuityInProgress = true;
      try {
        this.emit('audio-discontinuity', {
          reason: 'tune',
          frequencyHz: parsedFrequency
        });
      } catch (error) {
        try {
          this.emit(
            'warning',
            `Unable to reset the audio stream during tuning: ${error.message}`
          );
        } catch (_) {
        }
      } finally {
        this.audioDiscontinuityInProgress = false;
        this._beginTuneSettling();
      }
    }
    this._emitTunerRecord(`T${Math.round(parsedFrequency / 1000)}\n`);
    return true;
  }

  _connect() {
    if (this.stopped) return;

    this.headerBuffer = Buffer.alloc(0);
    this.headerReceived = false;
    this.iqBytePhase = 0;
    this.iqDiscardBytes = 0;
    let socket;
    try {
      socket = this.options.createConnection({
        host: this.options.host,
        port: this.options.port
      });
    } catch (error) {
      this.emit('warning', `Unable to open rtl_tcp connection: ${error.message}`);
      this._scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.socketPaused = false;
    socket.setNoDelay?.(true);

    const socketDataHandler = (data) => this._handleSocketData(data);
    this.socketDataHandler = socketDataHandler;
    socket.on('data', socketDataHandler);
    socket.on('connect', () => {
      this.emit('status', `Connected to rtl_tcp at ${this.options.host}:${this.options.port}`);
    });
    socket.on('error', (error) => {
      this.emit('warning', `rtl_tcp connection error: ${error.message}`);
    });
    socket.on('close', () => {
      if (this.socket === socket) {
        this.socket = null;
        this.socketDataHandler = null;
      }
      const wasReady = this.headerReceived;
      this.headerReceived = false;
      this.iqBytePhase = 0;
      this.iqDiscardBytes = 0;
      this.socketPaused = false;
      this.stereo = false;
      clearTimeout(this.dspRestartTimer);
      this.dspRestartTimer = null;
      this._stopDspWorker({ resumeSocket: false });
      if (wasReady) this.emit('unready');
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
      this.iqDiscardBytes = 0;
      const preConfigurationIq = this.headerBuffer.subarray(RTL_TCP_HEADER_SIZE);
      this.iqBytePhase = preConfigurationIq.length & 1;
      samples = Buffer.alloc(0);
      this.headerBuffer = Buffer.alloc(0);
      this._configureReceiver();
      this._beginTuneSettling();
      this._emitTunerRecord(`T${Math.round(this.options.frequencyHz / 1000)}\n`);
      this._emitTunerRecord(`W${this.options.bandwidthHz}\n`);
      this.emit('ready', {
        tunerType: header.readUInt32BE(4),
        gainCount: header.readUInt32BE(8)
      });
    }

    if (samples.length > 0) this._processIq(samples);
  }

  _beginTuneSettling() {
    this.stereo = false;
    const settleSamples = Math.round(
      this.options.sampleRate * this.options.tuneSettleMs / 1000
    );
    this.iqDiscardBytes = settleSamples * 2 + this.iqBytePhase;
    if (this.iqDiscardBytes === 0) {
      this._startDspWorker();
    } else {
      this._resumeSocketIfPossible();
    }
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

    if (command.startsWith('W')) {
      const requestedBandwidth = Math.round(
        Number(command.slice(1).split(',')[0])
      );
      const bandwidthHz = requestedBandwidth === 0
        ? DEFAULT_BANDWIDTH_HZ
        : requestedBandwidth;
      if (!this._setBandwidthHz(bandwidthHz)) return;
      this._emitTunerRecord(`W${this.options.bandwidthHz}\n`);
      return;
    }

    const monoCommand = /^B([01])$/.exec(command);
    if (monoCommand) {
      this._setForceMono(monoCommand[1] === '1');
      return;
    }

    // F is the legacy XDR bandwidth command. The UI also sends W, which is the
    // canonical command and the one acknowledged above.
    if (command.startsWith('F')) return;

    this._warnUnsupported(command);
  }

  _warnUnsupported(command) {
    const commandType = command[0];
    if (!commandType || this.unsupportedCommands.has(commandType)) return;
    this.unsupportedCommands.add(commandType);
    this.emit('warning', `Command ${commandType} is not supported by the JavaScript rtl_tcp receiver`);
  }

  _setForceMono(forceMono) {
    if (this.forceMono === forceMono) return;

    this.forceMono = forceMono;
    const worker = this.dspWorker;
    if (worker) {
      try {
        worker.postMessage({ type: 'mono', forceMono });
      } catch (error) {
        this.emit('warning', `Unable to switch stereo mode: ${error.message}`);
        this._scheduleDspRestart();
        return;
      }
    }

    this.emit('status', `Audio mode switched to ${forceMono ? 'forced mono' : 'automatic stereo'}`);
  }

  _setBandwidthHz(bandwidthHz) {
    if (!Number.isInteger(bandwidthHz) ||
        bandwidthHz < 4000 ||
        bandwidthHz > this.options.sampleRate) {
      this.emit(
        'warning',
        `Bandwidth must be between 4000 and ${this.options.sampleRate} Hz`
      );
      return false;
    }

    this.options.bandwidthHz = bandwidthHz;
    const worker = this.dspWorker;
    if (worker) {
      try {
        worker.postMessage({ type: 'bandwidth', bandwidthHz });
      } catch (error) {
        this.emit('warning', `Unable to switch bandwidth: ${error.message}`);
        this._scheduleDspRestart();
        return false;
      }
    }
    return true;
  }

  _processIq(data) {
    let iq = data;
    this.iqBytePhase = (this.iqBytePhase + data.length) & 1;

    if (this.iqDiscardBytes > 0) {
      const discardBytes = Math.min(this.iqDiscardBytes, iq.length);
      this.iqDiscardBytes -= discardBytes;
      iq = iq.subarray(discardBytes);

      if (this.iqDiscardBytes > 0) return;
      this._startDspWorker();
    }

    if (iq.length === 0) return;
    if (this.audioBackpressured) {
      const deferred = Buffer.from(iq);
      this.deferredIq.push(deferred);
      this.deferredIqBytes += deferred.length;
      this._pauseSocket();
      return;
    }
    this._postIq(iq);
  }

  _postIq(iq) {
    const worker = this.dspWorker;
    if (!worker) return;

    const transferredIq = new Uint8Array(iq.length);
    transferredIq.set(iq);
    const messageId = ++this.workerMessageId;
    this.workerPendingBytes += transferredIq.byteLength;

    try {
      worker.postMessage(
        {
          type: 'iq',
          id: messageId,
          buffer: transferredIq.buffer
        },
        [transferredIq.buffer]
      );
    } catch (error) {
      this.workerPendingBytes -= iq.length;
      this.emit('warning', `Unable to send IQ to JavaScript DSP: ${error.message}`);
      this._scheduleDspRestart();
      return;
    }

    if (this.workerPendingBytes >= this.options.workerQueueBytes) {
      this.workerInputBackpressured = true;
      this._pauseSocket();
    }
  }

  _startDspWorker() {
    if (this.stopped || !this.headerReceived || this.dspWorker) return;

    const generation = ++this.dspGeneration;
    let worker;
    try {
      worker = this.options.createWorker({
        sampleRate: this.options.sampleRate,
        outputRate: this.options.outputRate,
        deviationHz: this.options.deviationHz,
        deemphasisUs: this.options.deemphasisUs,
        bandwidthHz: this.options.bandwidthHz,
        signalSampleStride: this.options.signalSampleStride,
        stereoMinimumSnrDb: this.options.stereoMinimumSnrDb,
        forceMono: this.forceMono,
        rdsEnabled: this.options.rdsEnabled
      });
    } catch (error) {
      this.emit('warning', `Unable to start JavaScript DSP: ${error.message}`);
      this._scheduleDspRestart();
      return;
    }

    this.dspWorker = worker;
    this.workerPendingBytes = 0;
    this.workerInputBackpressured = false;

    worker.on('message', (message) => {
      if (worker !== this.dspWorker || generation !== this.dspGeneration) return;
      this._handleWorkerMessage(message);
    });
    worker.on('messageerror', (error) => {
      if (worker !== this.dspWorker || generation !== this.dspGeneration) return;
      this.emit('warning', `JavaScript DSP message error: ${error.message}`);
      this._scheduleDspRestart();
    });
    worker.on('error', (error) => {
      if (worker !== this.dspWorker || generation !== this.dspGeneration) return;
      this.emit('warning', `JavaScript DSP worker error: ${error.message}`);
      this._scheduleDspRestart();
    });
    worker.on('exit', (code) => {
      if (worker !== this.dspWorker ||
          generation !== this.dspGeneration ||
          this.stopped ||
          !this.headerReceived) return;
      this.emit('warning', `JavaScript DSP worker exited with code ${code}`);
      this._scheduleDspRestart();
    });

    this._resumeSocketIfPossible();
  }

  _handleWorkerMessage(message) {
    if (message.type === 'ready') {
      this.emit(
        'status',
        `JavaScript DSP ready (${this.options.sampleRate} Hz IQ → ${this.options.outputRate} Hz stereo${this.options.rdsEnabled ? ' + RDS' : ''})`
      );
      return;
    }

    if (message.type !== 'result') return;

    const acknowledgedBytes = Math.max(0, Number(message.inputBytes) || 0);
    this.workerPendingBytes = Math.max(
      0,
      this.workerPendingBytes - acknowledgedBytes
    );
    this.dspInputBytes += acknowledgedBytes;
    this.dspProcessingMs += Math.max(0, Number(message.processingMs) || 0);
    this.stereo = Boolean(message.stereo);

    if (message.pcm instanceof ArrayBuffer && message.pcm.byteLength > 0) {
      this._writeOrQueuePcm(Buffer.from(message.pcm));
    }

    for (const signal of message.signals || []) {
      this._emitSignalLevel(signal.snr, signal.stereo);
    }

    for (const group of message.groups || []) {
      const record = rdsGroupToTunerRecord(group);
      if (record) this._emitTunerRecord(record);
    }

    if (this.workerInputBackpressured &&
        this.workerPendingBytes < this.options.workerQueueBytes / 2) {
      this.workerInputBackpressured = false;
    }
    if (!this.audioBackpressured) this._flushDeferredIq();
    this._resumeSocketIfPossible();
  }

  _writeOrQueuePcm(pcm) {
    if (this.audioBackpressured) {
      this.pendingPcm.push(pcm);
      this.pendingPcmBytes += pcm.length;
      return;
    }

    if (!this.audioStream.write(pcm)) {
      this.audioBackpressured = true;
      this._pauseSocket();
    }
  }

  _flushPendingPcm() {
    while (!this.audioBackpressured && this.pendingPcm.length > 0) {
      const pcm = this.pendingPcm.shift();
      this.pendingPcmBytes -= pcm.length;
      if (!this.audioStream.write(pcm)) {
        this.audioBackpressured = true;
        this._pauseSocket();
      }
    }
  }

  _flushDeferredIq() {
    while (!this.audioBackpressured &&
           !this.workerInputBackpressured &&
           this.dspWorker &&
           this.deferredIq.length > 0) {
      const iq = this.deferredIq.shift();
      this.deferredIqBytes -= iq.length;
      this._postIq(iq);
    }
  }

  _emitSignalLevel(signal, stereo) {
    this.stereo = Boolean(stereo);
    const prefix = this.forceMono
      ? (this.stereo ? 'SS' : 'SM')
      : (this.stereo ? 'Ss' : 'Sm');
    this._emitTunerRecord(`${prefix}${clamp(Number(signal) || 0, 0, 70).toFixed(1)}\n`);
  }

  _emitTunerRecord(record) {
    this.emit('data', Buffer.from(record, 'utf8'));
  }

  _scheduleDspRestart() {
    if (this.stopped || !this.headerReceived || this.dspRestartTimer) return;
    this._pauseSocket();
    this._drainSocketInput();
    this._stopDspWorker({ resumeSocket: false });
    this.audioDiscontinuityInProgress = true;
    try {
      this.emit('audio-discontinuity', {
        reason: 'dsp-restart',
        frequencyHz: this.options.frequencyHz
      });
    } catch (error) {
      this.emit(
        'warning',
        `Unable to reset audio after a DSP failure: ${error.message}`
      );
    } finally {
      this.audioDiscontinuityInProgress = false;
    }
    this.dspRestartTimer = setTimeout(() => {
      this.dspRestartTimer = null;
      this._drainSocketInput();
      this.iqDiscardBytes = this.iqBytePhase;
      if (this.iqDiscardBytes > 0) {
        this._resumeSocketIfPossible();
      } else {
        this._startDspWorker();
      }
    }, this.options.dspRestartDelayMs);
  }

  _stopDspWorker({ resumeSocket = true } = {}) {
    this.dspGeneration++;
    this.workerPendingBytes = 0;
    this.workerInputBackpressured = false;
    this.deferredIq = [];
    this.deferredIqBytes = 0;
    this.pendingPcm = [];
    this.pendingPcmBytes = 0;

    const worker = this.dspWorker;
    this.dspWorker = null;
    if (worker) {
      worker.removeAllListeners?.();
      const termination = worker.terminate?.();
      termination?.catch?.(() => {});
    }

    if (resumeSocket) this._resumeSocketIfPossible();
  }

  _pauseSocket() {
    if (!this.socket || this.socketPaused) return;
    this.socket.pause?.();
    this.socketPaused = true;
  }

  _drainSocketInput() {
    const socket = this.socket;
    if (!socket || typeof socket.read !== 'function') return 0;

    const dataHandler = this.socketDataHandler;
    if (dataHandler) socket.removeListener?.('data', dataHandler);

    let discardedBytes = 0;
    try {
      let chunk;
      while ((chunk = socket.read()) !== null) {
        discardedBytes += chunk.length;
      }
    } finally {
      if (dataHandler && this.socket === socket && !socket.destroyed) {
        socket.on?.('data', dataHandler);
      }
    }

    this.iqBytePhase = (this.iqBytePhase + discardedBytes) & 1;
    return discardedBytes;
  }

  _resumeSocketIfPossible() {
    if (!this.socket ||
        !this.socketPaused ||
        this.stopped ||
        this.audioDiscontinuityInProgress ||
        this.dspRestartTimer ||
        this.workerInputBackpressured ||
        this.deferredIq.length > 0 ||
        (this.audioBackpressured && this.iqDiscardBytes === 0)) return;
    this.socket.resume?.();
    this.socketPaused = false;
  }
}

module.exports = {
  RtlTcpClient,
  RTL_TCP_COMMAND,
  rdsGroupToTunerRecord
};
