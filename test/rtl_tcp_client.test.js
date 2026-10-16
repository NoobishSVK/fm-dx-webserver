"use strict";

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  RtlTcpClient,
  RTL_TCP_COMMAND,
  rdsGroupToTunerRecord
} = require('../server/rtl_tcp/client');

function makeRtlHeader(tunerType = 5, gainCount = 29) {
  const header = Buffer.alloc(12);
  header.write('RTL0', 0, 'ascii');
  header.writeUInt32BE(tunerType, 4);
  header.writeUInt32BE(gainCount, 8);
  return header;
}

function parseCommands(writes) {
  const buffer = Buffer.concat(writes);
  const commands = [];

  for (let offset = 0; offset + 5 <= buffer.length; offset += 5) {
    commands.push({
      command: buffer.readUInt8(offset),
      value: buffer.readUInt32BE(offset + 1)
    });
  }

  return commands;
}

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.writes = [];
    this.pauseCalls = 0;
    this.resumeCalls = 0;
    this.paused = false;
    this.noDelay = null;
    this.readQueue = [];
  }

  setNoDelay(enabled) {
    this.noDelay = enabled;
  }

  write(data) {
    this.writes.push(Buffer.from(data));
    return true;
  }

  pause() {
    this.pauseCalls++;
    this.paused = true;
    return this;
  }

  resume() {
    this.resumeCalls++;
    this.paused = false;
    return this;
  }

  read() {
    return this.readQueue.shift() ?? null;
  }

  destroy() {
    this.destroyed = true;
  }
}

class FakeWorker extends EventEmitter {
  constructor(workerData) {
    super();
    this.workerData = workerData;
    this.messages = [];
    this.terminated = false;
  }

  postMessage(message) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
    return Promise.resolve(0);
  }
}

function makeHarness(options = {}) {
  const socket = new FakeSocket();
  const workers = [];
  let connectionOptions;

  const client = new RtlTcpClient({
    host: 'rtl-host',
    port: 4321,
    sampleRate: 240000,
    frequencyHz: 101100000,
    reconnect: false,
    tuneSettleMs: 0,
    createConnection: (requestedOptions) => {
      connectionOptions = requestedOptions;
      return socket;
    },
    createWorker: (workerData) => {
      const worker = new FakeWorker(workerData);
      workers.push(worker);
      return worker;
    },
    ...options
  });

  return {
    client,
    socket,
    workers,
    get connectionOptions() {
      return connectionOptions;
    }
  };
}

function startWithHeader(harness, header = makeRtlHeader()) {
  harness.client.start();
  harness.socket.emit('connect');
  harness.socket.emit('data', header);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test('RDS groups convert to the receiver protocol with per-block errors', () => {
  assert.equal(
    rdsGroupToTunerRecord({
      blocks: [0x1234, 0xabcd, 0x00f0, 0xdead],
      errors: [0, 0, 0, 0]
    }),
    'R1234ABCD00F0DEAD00\n'
  );
  assert.equal(
    rdsGroupToTunerRecord({
      blocks: [0x1234, null, 0xabcd, null],
      errors: [1, 3, 2, 3]
    }),
    'R12340000ABCD00007B\n'
  );
  assert.equal(rdsGroupToTunerRecord(null), null);
  assert.equal(rdsGroupToTunerRecord({ blocks: [1, 2, 3] }), null);
});

test('rtl_tcp header is buffered and receiver configuration commands are exact', (t) => {
  const harness = makeHarness({
    gain: 28,
    ppm: -2,
    biasTee: true,
    rdsEnabled: false
  });
  const readyEvents = [];
  harness.client.on('ready', (details) => readyEvents.push(details));
  t.after(() => harness.client.stop());

  harness.client.start();
  assert.deepEqual(harness.connectionOptions, { host: 'rtl-host', port: 4321 });
  assert.equal(harness.socket.noDelay, true);

  const header = makeRtlHeader(5, 29);
  harness.socket.emit('data', header.subarray(0, 7));
  assert.equal(harness.socket.writes.length, 0);
  assert.equal(harness.workers.length, 0);
  assert.equal(harness.client.ready, false);

  harness.socket.emit('data', header.subarray(7));

  assert.equal(harness.client.ready, true);
  assert.equal(harness.workers.length, 1);
  assert.equal(harness.workers[0].workerData.rdsEnabled, false);
  assert.deepEqual(readyEvents, [{ tunerType: 5, gainCount: 29 }]);
  assert.deepEqual(parseCommands(harness.socket.writes), [
    { command: RTL_TCP_COMMAND.SAMPLE_RATE, value: 240000 },
    { command: RTL_TCP_COMMAND.FREQUENCY, value: 101100000 },
    { command: RTL_TCP_COMMAND.PPM, value: -2 >>> 0 },
    { command: RTL_TCP_COMMAND.AGC_MODE, value: 0 },
    { command: RTL_TCP_COMMAND.GAIN_MODE, value: 1 },
    { command: RTL_TCP_COMMAND.GAIN, value: 280 },
    { command: RTL_TCP_COMMAND.BIAS_TEE, value: 1 }
  ]);
});

test('startup drops pre-configuration IQ and waits for the complete settle window', (t) => {
  const harness = makeHarness({ tuneSettleMs: 1 });
  t.after(() => harness.client.stop());

  harness.client.start();
  harness.socket.emit(
    'data',
    Buffer.concat([makeRtlHeader(), Buffer.alloc(701, 255)])
  );

  assert.equal(harness.workers.length, 0);
  assert.equal(
    harness.client.iqDiscardBytes,
    481,
    'pre-configuration IQ must not count toward settling, and odd IQ must realign'
  );

  harness.socket.emit('data', Buffer.alloc(480, 255));
  assert.equal(harness.workers.length, 0);
  assert.equal(harness.client.iqDiscardBytes, 1);

  harness.socket.emit('data', Buffer.alloc(1, 255));
  assert.equal(harness.client.iqDiscardBytes, 0);
  assert.equal(harness.workers.length, 1);
});

test('backend emits only canonical T, W, S, and R records through data', (t) => {
  const harness = makeHarness();
  const records = [];
  harness.client.on('data', (record) => {
    assert.ok(Buffer.isBuffer(record));
    records.push(record.toString('utf8'));
  });
  t.after(() => harness.client.stop());

  startWithHeader(harness);
  harness.workers[0].emit('message', {
    type: 'result',
    inputBytes: 2,
    pcm: new ArrayBuffer(0),
    signals: [{ snr: 55, stereo: true }],
    groups: [{
      blocks: [0x1234, 0xabcd, 0x00f0, 0xdead],
      errors: [0, 0, 0, 0]
    }],
    stereo: true,
    processingMs: 1
  });
  harness.client.write('T102500\nW0\n');

  assert.deepEqual(records, [
    'T101100\n',
    'W200000\n',
    'Ss55.0\n',
    'R1234ABCD00F0DEAD00\n',
    'T102500\n',
    'W200000\n'
  ]);
  assert.deepEqual(parseCommands(harness.socket.writes).at(-1), {
    command: RTL_TCP_COMMAND.FREQUENCY,
    value: 102500000
  });
});

test('W changes the active channel filter without restarting DSP', (t) => {
  const harness = makeHarness();
  const records = [];
  harness.client.on('data', (record) => records.push(record.toString('utf8')));
  t.after(() => harness.client.stop());

  startWithHeader(harness);
  const worker = harness.workers[0];

  harness.client.write('W75000\n');

  assert.equal(harness.client.options.bandwidthHz, 75000);
  assert.equal(harness.workers.length, 1);
  assert.deepEqual(worker.messages.at(-1), {
    type: 'bandwidth',
    bandwidthHz: 75000
  });
  assert.equal(records.at(-1), 'W75000\n');

  harness.client.write('W3999\n');
  assert.equal(harness.client.options.bandwidthHz, 75000);
  assert.equal(worker.messages.length, 1);
  assert.equal(records.at(-1), 'W75000\n');
});

test('existing B0/B1 control changes JavaScript audio mode without restarting DSP', (t) => {
  const harness = makeHarness();
  const records = [];
  harness.client.on('data', (record) => records.push(record.toString('utf8')));
  t.after(() => harness.client.stop());

  startWithHeader(harness);
  const worker = harness.workers[0];

  harness.client.write('B1\n');
  assert.equal(harness.workers.length, 1);
  assert.equal(harness.client.forceMono, true);
  assert.deepEqual(worker.messages.at(-1), {
    type: 'mono',
    forceMono: true
  });

  worker.emit('message', {
    type: 'result',
    inputBytes: 0,
    pcm: new ArrayBuffer(0),
    signals: [{ snr: 42, stereo: true }],
    groups: [],
    stereo: true,
    processingMs: 0
  });
  assert.equal(records.at(-1), 'SS42.0\n');

  harness.client.write('B0\n');
  assert.equal(harness.workers.length, 1);
  assert.equal(harness.client.forceMono, false);
  assert.deepEqual(worker.messages.at(-1), {
    type: 'mono',
    forceMono: false
  });
});

test('tuning replaces DSP after settling and ignores stale worker output', (t) => {
  const harness = makeHarness({ tuneSettleMs: 1 });
  const records = [];
  harness.client.on('data', (record) => records.push(record.toString('utf8')));
  t.after(() => harness.client.stop());

  startWithHeader(harness);
  harness.socket.emit('data', Buffer.alloc(480));
  const oldWorker = harness.workers[0];
  records.length = 0;

  harness.client.write('T102500\n');

  assert.equal(oldWorker.terminated, true);
  assert.equal(harness.workers.length, 1);
  assert.equal(records.at(-1), 'T102500\n');

  oldWorker.emit('message', {
    type: 'result',
    inputBytes: 0,
    pcm: new ArrayBuffer(0),
    signals: [],
    groups: [{ blocks: [1, 2, 3, 4], errors: [0, 0, 0, 0] }],
    stereo: false,
    processingMs: 0
  });
  assert.deepEqual(records, ['T102500\n']);

  harness.socket.emit('data', Buffer.alloc(479));
  assert.equal(harness.workers.length, 1);
  harness.socket.emit('data', Buffer.alloc(1));
  assert.equal(harness.workers.length, 2);
});

test('tuning announces an audio discontinuity after the old DSP is stopped', (t) => {
  const harness = makeHarness({ tuneSettleMs: 1 });
  t.after(() => harness.client.stop());

  startWithHeader(harness);
  harness.socket.emit('data', Buffer.alloc(480));
  const oldWorker = harness.workers[0];
  const events = [];
  harness.client.on('audio-discontinuity', (event) => {
    events.push(event);
    assert.equal(oldWorker.terminated, true);
    assert.equal(harness.client.dspWorker, null);
    assert.equal(harness.client.pendingPcmBytes, 0);
    assert.equal(harness.client.deferredIqBytes, 0);
    assert.equal(harness.socket.paused, true);
  });

  harness.client.write('T102500\n');

  assert.deepEqual(events, [{
    reason: 'tune',
    frequencyHz: 102500000
  }]);
});

test('tuning drains locally queued rtl_tcp IQ before the post-tune settle window', (t) => {
  const harness = makeHarness({ tuneSettleMs: 1 });
  t.after(() => harness.client.stop());

  startWithHeader(harness);
  harness.socket.emit('data', Buffer.alloc(480));
  const oldWorker = harness.workers[0];
  harness.socket.readQueue.push(
    Buffer.alloc(262144),
    Buffer.alloc(262145)
  );

  harness.client.write('T102500\n');

  assert.equal(oldWorker.terminated, true);
  assert.equal(harness.socket.readQueue.length, 0);
  assert.equal(harness.client.iqDiscardBytes, 481);
  assert.equal(harness.workers.length, 1);

  harness.socket.emit('data', Buffer.alloc(480));
  assert.equal(harness.workers.length, 1);
  harness.socket.emit('data', Buffer.alloc(1));
  assert.equal(harness.workers.length, 2);
});

test('tuning before rtl_tcp is ready does not reset an inactive audio stream', (t) => {
  const harness = makeHarness();
  const events = [];
  harness.client.on('audio-discontinuity', (event) => events.push(event));
  t.after(() => harness.client.stop());

  harness.client.start();
  harness.client.write('T102500\n');

  assert.deepEqual(events, []);
  assert.deepEqual(parseCommands(harness.socket.writes), [{
    command: RTL_TCP_COMMAND.FREQUENCY,
    value: 102500000
  }]);
});

test('B1 received during tune settling initializes the next worker in mono', (t) => {
  const harness = makeHarness({ tuneSettleMs: 1 });
  t.after(() => harness.client.stop());

  startWithHeader(harness);
  harness.client.write('B1\n');
  assert.equal(harness.workers.length, 0);

  harness.socket.emit('data', Buffer.alloc(480));

  assert.equal(harness.workers.length, 1);
  assert.equal(harness.workers[0].workerData.forceMono, true);
});

test('worker input credit pauses rtl_tcp and acknowledgement resumes it', (t) => {
  const harness = makeHarness({ workerQueueBytes: 4 });
  t.after(() => harness.client.stop());
  startWithHeader(harness);

  const worker = harness.workers[0];
  harness.socket.emit('data', Buffer.from([128, 128, 129, 129]));

  assert.equal(harness.client.workerPendingBytes, 4);
  assert.equal(harness.socket.paused, true);
  assert.equal(worker.messages.at(-1).type, 'iq');

  worker.emit('message', {
    type: 'result',
    inputBytes: 4,
    pcm: new ArrayBuffer(0),
    signals: [],
    groups: [],
    stereo: false,
    processingMs: 2
  });

  assert.equal(harness.client.workerPendingBytes, 0);
  assert.equal(harness.socket.paused, false);
  assert.equal(harness.client.getDspStats().inputBytes, 4);
});

test('audio backpressure pauses IQ until the shared stream drains', (t) => {
  const harness = makeHarness();
  t.after(() => harness.client.stop());
  startWithHeader(harness);

  let shouldBackpressure = true;
  let writeCalls = 0;
  harness.client.audioStream.write = () => {
    writeCalls++;
    return !shouldBackpressure;
  };
  harness.workers[0].emit('message', {
    type: 'result',
    inputBytes: 0,
    pcm: new Int16Array([1, 1]).buffer,
    signals: [],
    groups: [],
    stereo: false,
    processingMs: 0
  });

  assert.equal(harness.client.audioBackpressured, true);
  assert.equal(harness.socket.paused, true);
  assert.equal(writeCalls, 1);

  harness.workers[0].emit('message', {
    type: 'result',
    inputBytes: 0,
    pcm: new Int16Array([2, 2]).buffer,
    signals: [],
    groups: [],
    stereo: false,
    processingMs: 0
  });
  assert.equal(writeCalls, 1, 'later PCM must wait instead of growing the stream');
  assert.equal(harness.client.pendingPcm.length, 1);

  shouldBackpressure = false;
  harness.client.audioStream.emit('drain');
  assert.equal(harness.client.audioBackpressured, false);
  assert.equal(harness.client.pendingPcm.length, 0);
  assert.equal(writeCalls, 2);
  assert.equal(harness.socket.paused, false);
});

test('IQ delivered while audio is blocked is retained across tune settling', (t) => {
  const harness = makeHarness({ tuneSettleMs: 1 });
  t.after(() => harness.client.stop());
  startWithHeader(harness);
  harness.socket.emit('data', Buffer.alloc(480));

  harness.client.audioBackpressured = true;
  harness.client._pauseSocket();
  harness.client.write('T102500\n');
  assert.equal(harness.socket.paused, false, 'settling must continue while audio is blocked');

  harness.socket.emit('data', Buffer.alloc(481));
  const worker = harness.workers.at(-1);
  assert.equal(harness.workers.length, 2);
  assert.equal(harness.client.deferredIqBytes, 1);
  assert.equal(harness.socket.paused, true);
  assert.equal(worker.messages.length, 0);

  harness.client.audioStream.emit('drain');
  assert.equal(harness.client.deferredIqBytes, 0);
  assert.equal(worker.messages.length, 1);
  assert.equal(worker.messages[0].buffer.byteLength, 1);

  harness.socket.emit('data', Buffer.alloc(1));
  assert.equal(harness.client.iqBytePhase, 0);
  assert.equal(worker.messages.length, 2);
  assert.equal(worker.messages[1].buffer.byteLength, 1);
});

test('one worker failure schedules exactly one restart', async (t) => {
  const harness = makeHarness({ dspRestartDelayMs: 0 });
  t.after(() => harness.client.stop());
  startWithHeader(harness);

  const firstWorker = harness.workers[0];
  firstWorker.emit('error', new Error('DSP failed'));
  firstWorker.emit('exit', 1);

  await delay(10);
  assert.equal(harness.workers.length, 2);
  await delay(10);
  assert.equal(harness.workers.length, 2);
});

test('socket close cancels a stale DSP restart before a quick reconnect', async (t) => {
  const firstSocket = new FakeSocket();
  const secondSocket = new FakeSocket();
  const sockets = [firstSocket, secondSocket];
  const harness = makeHarness({
    reconnect: true,
    reconnectDelayMs: 0,
    dspRestartDelayMs: 30,
    createConnection: () => sockets.shift()
  });
  t.after(() => harness.client.stop());

  harness.client.start();
  firstSocket.emit('data', makeRtlHeader());
  assert.equal(harness.workers.length, 1);

  harness.workers[0].emit('error', new Error('first generation failed'));
  assert.notEqual(harness.client.dspRestartTimer, null);

  firstSocket.emit('close');
  assert.equal(harness.client.dspRestartTimer, null);

  await delay(5);
  secondSocket.emit('data', makeRtlHeader());
  assert.equal(harness.workers.length, 2);

  harness.workers[1].emit('error', new Error('second generation failed'));
  await delay(40);

  assert.equal(
    harness.workers.length,
    3,
    'the new generation must schedule its own restart'
  );
});

test('failure after an odd IQ byte realigns before the next worker starts', async (t) => {
  const harness = makeHarness({ dspRestartDelayMs: 0 });
  t.after(() => harness.client.stop());
  startWithHeader(harness);

  harness.socket.emit('data', Buffer.alloc(1));
  assert.equal(harness.client.iqBytePhase, 1);

  harness.workers[0].emit('error', new Error('DSP failed'));
  await delay(10);

  assert.equal(harness.workers.length, 1);
  assert.equal(harness.client.iqDiscardBytes, 1);
  assert.equal(harness.socket.paused, false);

  harness.socket.emit('data', Buffer.alloc(1));

  assert.equal(harness.client.iqBytePhase, 0);
  assert.equal(harness.client.iqDiscardBytes, 0);
  assert.equal(harness.workers.length, 2);
});

test('synchronous connection failures are reported without escaping start()', () => {
  const client = new RtlTcpClient({
    reconnect: false,
    createConnection: () => {
      throw new Error('invalid address');
    }
  });
  const warnings = [];
  client.on('warning', (warning) => warnings.push(warning));

  assert.doesNotThrow(() => client.start());
  assert.deepEqual(warnings, [
    'Unable to open rtl_tcp connection: invalid address'
  ]);
  client.stop();
});

test('invalid DSP rate, deviation, timing, and queue options fail early', () => {
  // 192 kHz and 336 kHz are 48 kHz multiples the RTL2832U cannot produce.
  for (const sampleRate of [0, 191999, 192000, 200000, 336000, 3216000, Infinity, Number.NaN]) {
    assert.throws(
      () => new RtlTcpClient({ sampleRate }),
      /integer multiple of 48000 Hz/
    );
  }
  for (const sampleRate of [240000, 288000, 960000, 2400000]) {
    assert.doesNotThrow(() => new RtlTcpClient({ sampleRate }));
  }

  for (const deviationHz of [-1, 0, 120000, Infinity, Number.NaN]) {
    assert.throws(
      () => new RtlTcpClient({ sampleRate: 240000, deviationHz }),
      /FM deviation/
    );
  }
  for (const tuneSettleMs of [-1, Infinity, Number.NaN]) {
    assert.throws(
      () => new RtlTcpClient({ tuneSettleMs }),
      /tune settle time/
    );
  }
  for (const workerQueueBytes of [0, -1, Infinity, Number.NaN]) {
    assert.throws(
      () => new RtlTcpClient({ workerQueueBytes }),
      /worker queue size/
    );
  }
  for (const signalSampleStride of [0, 1.5, Infinity, Number.NaN]) {
    assert.throws(
      () => new RtlTcpClient({ signalSampleStride }),
      /signal sample stride/
    );
  }
  for (const bandwidthHz of [0, 3999, 240001, Infinity, Number.NaN]) {
    assert.throws(
      () => new RtlTcpClient({ bandwidthHz }),
      /bandwidth/
    );
  }
  for (const stereoMinimumSnrDb of [-1, 71, Infinity, Number.NaN]) {
    assert.throws(
      () => new RtlTcpClient({ stereoMinimumSnrDb }),
      /stereo SNR/
    );
  }
  for (const stereoBlendSnrDb of [-1, 91, Infinity, Number.NaN]) {
    assert.throws(
      () => new RtlTcpClient({ stereoBlendSnrDb }),
      /stereo blend/
    );
  }
  for (const port of [-1, 0, 65536, 1.5, Infinity, Number.NaN]) {
    assert.throws(() => new RtlTcpClient({ port }), /port/);
  }
  for (const frequencyHz of [-1, 999999, 0x100000000, Infinity, Number.NaN]) {
    assert.throws(() => new RtlTcpClient({ frequencyHz }), /frequency/);
  }
  for (const delayOption of ['reconnectDelayMs', 'dspRestartDelayMs']) {
    for (const value of [-1, Infinity, Number.NaN]) {
      assert.throws(
        () => new RtlTcpClient({ [delayOption]: value }),
        /restart delays/
      );
    }
  }
});
