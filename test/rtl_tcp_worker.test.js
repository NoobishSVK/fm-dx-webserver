"use strict";

const assert = require('node:assert/strict');
const { once } = require('node:events');
const path = require('node:path');
const test = require('node:test');
const { Worker } = require('node:worker_threads');
const {
  OFFSET,
  encodeBlock,
  wordToBits
} = require('../server/rtl_tcp/dsp/rds');

const SAMPLE_RATE = 240000;
const OUTPUT_RATE = 48000;
const DEVIATION_HZ = 75000;
const TWO_PI = 2 * Math.PI;

function generateMonoFmIq(durationSeconds) {
  const sampleCount = Math.round(durationSeconds * SAMPLE_RATE);
  const iq = new Uint8Array(sampleCount * 2);
  const maximumPhase = TWO_PI * DEVIATION_HZ / SAMPLE_RATE;
  let fmPhase = 0;

  for (let index = 0; index < sampleCount; index++) {
    const time = index / SAMPLE_RATE;
    const multiplex =
      0.3 * Math.sin(TWO_PI * 1000 * time) +
      0.1 * Math.cos(TWO_PI * 19000 * time);
    fmPhase += maximumPhase * multiplex;
    if (fmPhase > Math.PI) fmPhase -= TWO_PI;
    if (fmPhase < -Math.PI) fmPhase += TWO_PI;
    iq[index * 2] = Math.round(127.5 + 127 * Math.cos(fmPhase));
    iq[index * 2 + 1] = Math.round(127.5 + 127 * Math.sin(fmPhase));
  }

  return iq;
}

function groupsToBits(groups) {
  const bits = [];
  for (const blocks of groups) {
    const thirdOffset = (blocks[1] & 0x0800) === 0 ? OFFSET.C : OFFSET.C_PRIME;
    const offsets = [OFFSET.A, OFFSET.B, thirdOffset, OFFSET.D];
    for (let index = 0; index < offsets.length; index++) {
      bits.push(...wordToBits(encodeBlock(blocks[index], offsets[index])));
    }
  }
  return bits;
}

function generateRdsFmIq(groups, carrierOffsetHz = 0) {
  const bits = groupsToBits(groups);
  const samplesPerBit = SAMPLE_RATE / 1187.5;
  const timingOffset = 137.375;
  const sampleCount = Math.ceil(
    timingOffset + (bits.length + 2) * samplesPerBit
  );
  const differentialStates = new Int8Array(bits.length);
  let differentialState = -1;
  for (let index = 0; index < bits.length; index++) {
    if (bits[index]) differentialState *= -1;
    differentialStates[index] = differentialState;
  }

  const iq = new Uint8Array(sampleCount * 2);
  const maximumPhase = TWO_PI * DEVIATION_HZ / SAMPLE_RATE;
  let fmPhase = 0;

  for (let sample = 0; sample < sampleCount; sample++) {
    const time = sample / SAMPLE_RATE;
    const left = 0.25 * Math.sin(TWO_PI * 1000 * time);
    const right = 0.25 * Math.sin(TWO_PI * 2000 * time);
    let multiplex =
      0.5 * (left + right) +
      0.5 * (left - right) * Math.cos(TWO_PI * 38000 * time) +
      0.1 * Math.cos(TWO_PI * 19000 * time);

    const bitPosition = (sample - timingOffset) / samplesPerBit;
    if (bitPosition >= 0 && bitPosition < bits.length) {
      const bitIndex = Math.floor(bitPosition);
      const biphase = bitPosition - bitIndex < 0.5 ? 1 : -1;
      multiplex +=
        0.08 *
        differentialStates[bitIndex] *
        biphase *
        Math.cos(TWO_PI * 57000 * time + 0.73);
    }

    fmPhase +=
      maximumPhase * multiplex +
      TWO_PI * carrierOffsetHz / SAMPLE_RATE;
    if (fmPhase > Math.PI) fmPhase -= TWO_PI;
    if (fmPhase < -Math.PI) fmPhase += TWO_PI;
    iq[sample * 2] = Math.round(127.5 + 127 * Math.cos(fmPhase));
    iq[sample * 2 + 1] = Math.round(127.5 + 127 * Math.sin(fmPhase));
  }

  return iq;
}

function createDspWorker(rdsEnabled) {
  return new Worker(
    path.join(__dirname, '../server/rtl_tcp/dsp-worker.js'),
    {
      workerData: {
        sampleRate: SAMPLE_RATE,
        outputRate: OUTPUT_RATE,
        deviationHz: DEVIATION_HZ,
        deemphasisUs: 50,
        bandwidthHz: 200000,
        signalSampleStride: 64,
        stereoMinimumSnrDb: 3,
        forceMono: false,
        rdsEnabled
      }
    }
  );
}

function containsGroupRun(decoded, expected, minimumLength) {
  for (let decodedStart = 0; decodedStart < decoded.length; decodedStart++) {
    for (let expectedStart = 0; expectedStart < expected.length; expectedStart++) {
      let length = 0;
      while (
        decodedStart + length < decoded.length &&
        expectedStart + length < expected.length &&
        decoded[decodedStart + length].blocks.every(
          (block, index) => block === expected[expectedStart + length][index]
        )
      ) {
        length++;
      }
      if (length >= minimumLength) return true;
    }
  }
  return false;
}

test('real Worker runs the JavaScript DSP and transfers stereo PCM', async (t) => {
  const worker = createDspWorker(false);
  t.after(() => worker.terminate());

  const [ready] = await once(worker, 'message');
  assert.deepEqual(ready, { type: 'ready' });

  const iq = generateMonoFmIq(0.35);
  const inputBytes = iq.byteLength;
  worker.postMessage(
    { type: 'iq', id: 1, buffer: iq.buffer },
    [iq.buffer]
  );

  const [result] = await once(worker, 'message');
  assert.equal(result.type, 'result');
  assert.equal(result.id, 1);
  assert.equal(result.inputBytes, inputBytes);
  assert.ok(result.pcm instanceof ArrayBuffer);
  assert.equal(
    result.pcm.byteLength,
    Math.round(0.35 * OUTPUT_RATE) * 2 * Int16Array.BYTES_PER_ELEMENT
  );
  assert.ok(result.signals.length >= 1);
  assert.equal(result.stereo, true);
  assert.deepEqual(result.groups, []);
  assert.ok(result.processingMs > 0);
});

test('IQ through the real Worker produces stereo PCM and canonical-ready RDS groups', async (t) => {
  const expected = Array.from({ length: 12 }, (_, index) => [
    0x2200 + index,
    ((index & 0x0f) << 12) | 0x0040,
    (0xa500 ^ (index * 0x123)) & 0xffff,
    (0x4141 + index * 0x101) & 0xffff
  ]);
  const worker = createDspWorker(true);
  t.after(() => worker.terminate());

  await once(worker, 'message');
  // A realistic tuner/carrier offset ensures the RDS-only MPX DC blocker
  // remains independent from the phase-matched stereo audio path.
  const iq = generateRdsFmIq(expected, 8000);
  const decoded = [];
  let result;
  let offset = 0;
  let messageId = 2;
  while (offset < iq.length) {
    const chunk = iq.slice(offset, Math.min(offset + 32768, iq.length));
    worker.postMessage(
      { type: 'iq', id: messageId, buffer: chunk.buffer },
      [chunk.buffer]
    );
    [result] = await once(worker, 'message');
    assert.equal(result.type, 'result');
    assert.equal(result.id, messageId);
    decoded.push(...result.groups);
    offset += 32768;
    messageId++;
  }

  assert.equal(result.stereo, true);
  assert.ok(result.pcm.byteLength > 0);
  assert.ok(
    containsGroupRun(decoded, expected, 5),
    `decoded ${decoded.length} groups without a valid contiguous run`
  );
  assert.ok(
    decoded.every((group) => group.errors.every((error) => error === 0)),
    'clean end-to-end IQ must not require RDS error correction'
  );
});
