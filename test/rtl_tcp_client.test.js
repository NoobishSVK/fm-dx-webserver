"use strict";

const assert = require('node:assert/strict');
const net = require('node:net');
const test = require('node:test');
const { once } = require('node:events');
const {
  RtlTcpClient,
  RTL_TCP_COMMAND,
  designLowPass
} = require('../server/rtl_tcp/client');

function makeRtlHeader(tunerType = 5, gainCount = 29) {
  const header = Buffer.alloc(12);
  header.write('RTL0', 0, 'ascii');
  header.writeUInt32BE(tunerType, 4);
  header.writeUInt32BE(gainCount, 8);
  return header;
}

function makeFmIq(sampleRate, sampleCount) {
  const iq = Buffer.alloc(sampleCount * 2);
  let phase = 0;

  for (let sample = 0; sample < sampleCount; sample++) {
    const modulation = Math.sin((2 * Math.PI * 1000 * sample) / sampleRate);
    phase += (2 * Math.PI * 10000 * modulation) / sampleRate;
    iq[sample * 2] = Math.round(127.5 + 100 * Math.cos(phase));
    iq[sample * 2 + 1] = Math.round(127.5 + 100 * Math.sin(phase));
  }

  return iq;
}

function parseCommands(buffer) {
  const commands = [];
  for (let offset = 0; offset + 5 <= buffer.length; offset += 5) {
    commands.push({
      command: buffer.readUInt8(offset),
      value: buffer.readUInt32BE(offset + 1)
    });
  }
  return commands;
}

test('designLowPass returns normalized symmetric FIR taps', () => {
  const taps = designLowPass(240000, 15000, 63);
  const sum = [...taps].reduce((total, tap) => total + tap, 0);
  assert.equal(taps.length, 63);
  assert.ok(Math.abs(sum - 1) < 1e-10);
  assert.ok(Math.abs(taps[0] - taps[taps.length - 1]) < 1e-12);
});

test('rtl_tcp backend configures, tunes, and produces 48 kHz PCM', async (t) => {
  const received = [];
  const sampleRate = 240000;
  const iq = makeFmIq(sampleRate, sampleRate / 4);

  const mockServer = net.createServer((socket) => {
    socket.on('data', (data) => received.push(data));
    const header = makeRtlHeader();
    socket.write(header.subarray(0, 5));
    setImmediate(() => socket.write(Buffer.concat([header.subarray(5), iq])));
  });
  mockServer.listen(0, '127.0.0.1');
  await once(mockServer, 'listening');

  const backend = new RtlTcpClient({
    host: '127.0.0.1',
    port: mockServer.address().port,
    sampleRate,
    frequencyHz: 101100000,
    gain: 28,
    ppm: -2,
    biasTee: true,
    redseaEnabled: false,
    reconnect: false,
    audioChannels: 2
  });

  t.after(async () => {
    backend.stop();
    await new Promise((resolve) => mockServer.close(resolve));
  });

  const readyPromise = once(backend, 'ready');
  const signalPromise = once(backend, 'signal');
  const audioChunks = [];
  backend.audioStream.on('data', (data) => audioChunks.push(data));
  backend.start();

  const [ready] = await readyPromise;
  const [signal] = await signalPromise;
  await new Promise((resolve) => setTimeout(resolve, 20));
  const audio = Buffer.concat(audioChunks);

  assert.deepEqual(ready, { tunerType: 5, gainCount: 29 });
  assert.ok(audio.length >= 48000, 'expected at least 0.25 seconds of stereo PCM');
  assert.equal(audio.length % 4, 0, 'stereo S16LE frames must be complete');
  assert.ok(audio.some((byte) => byte !== 0), 'demodulated audio must not be silent');
  assert.ok(signal.snr >= 0 && signal.snr <= 70);

  const configuredCommands = parseCommands(Buffer.concat(received));
  assert.ok(configuredCommands.some(({ command, value }) =>
    command === RTL_TCP_COMMAND.SAMPLE_RATE && value === sampleRate));
  assert.ok(configuredCommands.some(({ command, value }) =>
    command === RTL_TCP_COMMAND.FREQUENCY && value === 101100000));
  assert.ok(configuredCommands.some(({ command, value }) =>
    command === RTL_TCP_COMMAND.GAIN && value === 280));
  assert.ok(configuredCommands.some(({ command, value }) =>
    command === RTL_TCP_COMMAND.PPM && value === (-2 >>> 0)));
  assert.ok(configuredCommands.some(({ command, value }) =>
    command === RTL_TCP_COMMAND.BIAS_TEE && value === 1));

  const frequencyPromise = once(backend, 'frequency');
  backend.write('T102500\n');
  const [frequencyKhz] = await frequencyPromise;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(frequencyKhz, 102500);

  const commandsAfterTune = parseCommands(Buffer.concat(received));
  assert.ok(commandsAfterTune.some(({ command, value }) =>
    command === RTL_TCP_COMMAND.FREQUENCY && value === 102500000));
});

test('rtl_tcp backend rejects sample rates that cannot produce exact 48 kHz audio', () => {
  assert.throws(
    () => new RtlTcpClient({ sampleRate: 250000 }),
    /integer multiple of 48000/
  );
});
