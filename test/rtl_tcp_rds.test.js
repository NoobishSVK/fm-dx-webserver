"use strict";

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BLOCK_BITS,
  OFFSET,
  OFFSET_SYNDROMES,
  PARITY_CHECK_MATRIX,
  calculateSyndrome,
  offsetForBlock,
  encodeBlock,
  decodeBlock,
  wordToBits,
  RdsBlockSynchronizer,
  RdsDecoder
} = require('../server/rtl_tcp/dsp/rds');

const BLOCK_MASK = 0x03ffffff;

function calculateSyndromeReference(inputVector) {
  const word = Number(inputVector) & BLOCK_MASK;
  let result = 0;

  for (let bit = 0; bit < BLOCK_BITS; bit++) {
    if ((word >>> bit) & 1) {
      result ^= PARITY_CHECK_MATRIX[BLOCK_BITS - 1 - bit];
    }
  }

  return result;
}

function makeGroups(count) {
  return Array.from({ length: count }, (_, index) => {
    const versionB = index % 3 === 1;
    return [
      (0x1200 + index) & 0xffff,
      ((index & 0x0f) << 12) | (versionB ? 0x0800 : 0) | (0x40 + index),
      (0xa500 ^ (index * 0x123)) & 0xffff,
      (0x4141 + index * 0x101) & 0xffff
    ];
  });
}

function groupsToBits(groups) {
  const result = [];
  for (const blocks of groups) {
    const thirdOffset = (blocks[1] & 0x0800) === 0 ? OFFSET.C : OFFSET.C_PRIME;
    const offsets = [OFFSET.A, OFFSET.B, thirdOffset, OFFSET.D];
    for (let index = 0; index < 4; index++) {
      result.push(...wordToBits(encodeBlock(blocks[index], offsets[index])));
    }
  }
  return result;
}

function makeMpxFixture(groups, options = {}) {
  const sampleRate = options.sampleRate || 240000;
  const bitRate = options.bitRate || 1187.5;
  const samplesPerBit = sampleRate / bitRate;
  const timingOffset = options.timingOffset ?? 137.375;
  const carrierPhase = options.carrierPhase ?? 0.731;
  const inversion = options.inversion ? -1 : 1;
  const rdsAmplitude = options.rdsAmplitude ?? 0.12;
  const bits = groupsToBits(groups);
  const states = new Int8Array(bits.length);
  let differentialState = options.initialDifferentialState ? 1 : -1;

  for (let index = 0; index < bits.length; index++) {
    if (bits[index]) differentialState *= -1;
    states[index] = differentialState;
  }

  const sampleCount = Math.ceil(timingOffset + (bits.length + 2) * samplesPerBit);
  const mpx = new Float64Array(sampleCount);
  let noiseState = 0x51f15e5d;

  for (let sample = 0; sample < sampleCount; sample++) {
    const time = sample / sampleRate;
    let value =
      0.08 * Math.sin(2 * Math.PI * 1000 * time) +
      0.07 * Math.cos(2 * Math.PI * 19000 * time + 0.2) +
      0.035 * Math.sin(2 * Math.PI * 38000 * time + 0.4);
    const bitPosition = (sample - timingOffset) / samplesPerBit;

    if (bitPosition >= 0 && bitPosition < bits.length) {
      const bitIndex = Math.floor(bitPosition);
      const biphase = bitPosition - bitIndex < 0.5 ? 1 : -1;
      value += inversion * rdsAmplitude * states[bitIndex] * biphase *
        Math.cos(2 * Math.PI * 57000 * time + carrierPhase);
    }

    noiseState = (Math.imul(noiseState, 1664525) + 1013904223) >>> 0;
    value += (((noiseState >>> 8) / 0x01000000) * 2 - 1) * 0.004;
    mpx[sample] = value;
  }
  return mpx;
}

function processInChunks(decoder, samples, chunkPattern) {
  const groups = [];
  let offset = 0;
  let chunkIndex = 0;

  while (offset < samples.length) {
    const length = Math.min(chunkPattern[chunkIndex % chunkPattern.length], samples.length - offset);
    groups.push(...decoder.process(samples.subarray(offset, offset + length)));
    offset += length;
    chunkIndex++;
  }
  return groups;
}

function findContiguousExpectedRun(decoded, expected, minimumLength) {
  for (let decodedStart = 0; decodedStart < decoded.length; decodedStart++) {
    for (let expectedStart = 0; expectedStart < expected.length; expectedStart++) {
      let length = 0;
      while (decodedStart + length < decoded.length &&
             expectedStart + length < expected.length &&
             decoded[decodedStart + length].blocks.every(
               (block, index) => block === expected[expectedStart + length][index]
             )) {
        length++;
      }
      if (length >= minimumLength) return true;
    }
  }
  return false;
}

test('RDS syndrome and offset helpers encode clean blocks and correct short bursts', () => {
  for (const offset of Object.values(OFFSET)) {
    const raw = encodeBlock(0xa55a, offset);
    assert.equal(calculateSyndrome(raw), OFFSET_SYNDROMES[offset]);
    assert.equal(offsetForBlock(raw), offset);
    assert.deepEqual(decodeBlock(raw, offset), {
      data: 0xa55a,
      offset,
      errors: 0,
      raw
    });

    const oneBit = decodeBlock(raw ^ (1 << 17), offset);
    assert.equal(oneBit.data, 0xa55a);
    assert.equal(oneBit.errors, 1);

    const twoBitBurst = decodeBlock(raw ^ (0b11 << 7), offset);
    assert.equal(twoBitBurst.data, 0xa55a);
    assert.equal(twoBitBurst.errors, 2);
  }

  assert.throws(() => encodeBlock(-1, OFFSET.A), /unsigned 16-bit/);
  assert.throws(() => encodeBlock(0, 'unknown'), /Unknown RDS offset/);
});

test('RDS syndrome lookup is exact against the bitwise reference', () => {
  const edgeWords = [
    0,
    1,
    BLOCK_MASK,
    1 << 12,
    1 << 13,
    1 << 25,
    0x01555555,
    0x02aaaaaa
  ];

  for (const word of edgeWords) {
    assert.equal(calculateSyndrome(word), calculateSyndromeReference(word));
  }

  let state = 0x5eeda11;
  for (let index = 0; index < 10000; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const word = state & BLOCK_MASK;
    assert.equal(calculateSyndrome(word), calculateSyndromeReference(word));
  }
});

test('block synchronizer acquires only a cyclic offset sequence across arbitrary bit boundaries', () => {
  const expected = makeGroups(7);
  const bits = [
    1, 0, 1, 1, 0, 0, 1,
    ...groupsToBits(expected)
  ];
  const synchronizer = new RdsBlockSynchronizer({ lockBlocks: 4 });
  const decoded = [];

  for (const bit of bits) decoded.push(...synchronizer.pushBit(bit));

  assert.equal(synchronizer.synced, true);
  assert.ok(findContiguousExpectedRun(decoded, expected, 4));

  const noiseSynchronizer = new RdsBlockSynchronizer({ lockBlocks: 4 });
  let state = 0x12345678;
  const falseGroups = [];
  for (let index = 0; index < BLOCK_BITS * 400; index++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    falseGroups.push(...noiseSynchronizer.pushBit(state >>> 31));
  }
  assert.deepEqual(falseGroups, []);
  assert.equal(noiseSynchronizer.synced, false);
});

test('pure-JS RDS decoder survives carrier inversion, fractional timing, and chunk boundaries', () => {
  const expected = makeGroups(12);
  const scenarios = [
    {
      timingOffset: 137.375,
      carrierPhase: 0.731,
      inversion: false,
      chunks: [1, 73, 4093, 8191, 257]
    },
    {
      timingOffset: 23.625,
      carrierPhase: 2.17,
      inversion: true,
      initialDifferentialState: true,
      chunks: [16001, 3, 997, 32768, 5]
    },
    {
      timingOffset: 71.125,
      carrierPhase: -1.31,
      inversion: false,
      chunks: [Number.MAX_SAFE_INTEGER]
    }
  ];

  for (const scenario of scenarios) {
    const decoder = new RdsDecoder({ sampleRate: 240000 });
    const fixture = makeMpxFixture(expected, scenario);
    const decoded = processInChunks(decoder, fixture, scenario.chunks);
    assert.equal(decoder.synced, true);
    assert.ok(
      findContiguousExpectedRun(decoded, expected, 6),
      `expected a run of decoded groups for ${JSON.stringify(scenario)}`
    );
    assert.ok(decoded.every((group) => group.errors.every((error) => error === 0)));
  }
});

test('RDS sample positions are rebased before leaving the int32 range', () => {
  const expected = makeGroups(12);
  const fixture = makeMpxFixture(expected, { timingOffset: 61.5, carrierPhase: 1.1 });
  const chunks = [4093, 16384, 777];

  const fresh = new RdsDecoder({ sampleRate: 240000 });
  const freshGroups = processInChunks(fresh, fixture, chunks);

  // State equivalent to a stream that has been running for about 2.5 hours:
  // whole ring lengths keep every sample in the same storage slot.
  const aged = new RdsDecoder({ sampleRate: 240000 });
  const shift =
    Math.ceil((2 ** 31 - 1000) / aged.storageCapacity) * aged.storageCapacity;
  aged.totalSamples += shift;
  aged.bufferStart += shift;
  const agedGroups = processInChunks(aged, fixture, chunks);

  assert.deepEqual(agedGroups, freshGroups);
  assert.equal(aged.synced, true);
  assert.ok(aged.totalSamples < 2 ** 31);
  assert.ok(aged.bufferStart >= 0 && aged.bufferStart <= aged.totalSamples);
  assert.equal(
    aged.totalSamples % aged.storageCapacity,
    fresh.totalSamples % fresh.storageCapacity
  );
});

test('pure-JS RDS timing loop follows a small sample-clock mismatch', () => {
  const expected = makeGroups(24);
  const transmitterBitRate = 1187.5 * (1 + 45e-6);
  const fixture = makeMpxFixture(expected, {
    bitRate: transmitterBitRate,
    timingOffset: 91.25,
    carrierPhase: -0.41
  });
  const decoder = new RdsDecoder({ sampleRate: 240000 });
  const decoded = processInChunks(decoder, fixture, [7777, 31, 16384, 2049]);

  assert.equal(decoder.synced, true);
  assert.ok(findContiguousExpectedRun(decoded, expected, 12));
});

test('pure-JS RDS decoder has bounded storage and does not false-lock in a long noise soak', () => {
  const sampleRate = 240000;
  const durationSeconds = 8;
  const samples = new Float64Array(sampleRate * durationSeconds);
  let state = 0xdecafbad;

  for (let index = 0; index < samples.length; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const noise = ((state >>> 8) / 0x01000000) * 2 - 1;
    const time = index / sampleRate;
    samples[index] =
      0.3 * noise +
      0.1 * Math.sin(2 * Math.PI * 1000 * time) +
      0.1 * Math.sin(2 * Math.PI * 19000 * time) +
      0.08 * Math.sin(2 * Math.PI * 38000 * time);
  }

  const decoder = new RdsDecoder({ sampleRate });
  const prefixI = decoder.prefixI;
  const prefixQ = decoder.prefixQ;
  const prefixPower = decoder.prefixPower;
  const decoded = processInChunks(decoder, samples, [8192, 511, 16381]);
  assert.deepEqual(decoded, []);
  assert.equal(decoder.synced, false);
  assert.strictEqual(decoder.prefixI, prefixI);
  assert.strictEqual(decoder.prefixQ, prefixQ);
  assert.strictEqual(decoder.prefixPower, prefixPower);
  assert.equal(decoder.prefixI.length, decoder.storageCapacity);
  assert.equal(decoder.prefixQ.length, decoder.storageCapacity);
  assert.equal(decoder.prefixPower.length, decoder.storageCapacity);
  assert.ok(
    decoder.totalSamples - decoder.bufferStart <= decoder.maximumBufferedSamples
  );
  assert.ok(
    decoder.acquisitionAttempts <=
      Math.ceil(durationSeconds * 1000 / decoder.acquisitionIntervalMs) + 1
  );
  assert.doesNotThrow(() => decoder.process(new Float32Array(4)));
  assert.throws(() => decoder.process(new Uint8Array(4)), /Float32Array/);
  assert.throws(() => new RdsDecoder({ sampleRate: 120000 }), /at least 128000/);
});

test('RDS acquisition attempts are throttled by newly received samples', () => {
  const decoder = new RdsDecoder({
    sampleRate: 240000,
    minimumCoherentRatio: 1
  });

  decoder.process(new Float64Array(decoder.requiredAcquisitionSamples));
  assert.equal(decoder.acquisitionAttempts, 1);

  decoder.process(new Float64Array(decoder.acquisitionIntervalSamples - 1));
  assert.equal(decoder.acquisitionAttempts, 1);

  decoder.process(new Float64Array(1));
  assert.equal(decoder.acquisitionAttempts, 2);
});

test('failed RDS acquisition backs off and reset restores its base cadence', () => {
  const decoder = new RdsDecoder({
    sampleRate: 240000,
    acquisitionIntervalMs: 50,
    maximumAcquisitionIntervalMs: 400,
    minimumCoherentRatio: 1
  });

  decoder.process(new Float32Array(decoder.requiredAcquisitionSamples));
  decoder.process(new Float32Array(decoder.acquisitionIntervalSamples));
  assert.equal(decoder.acquisitionAttempts, 2);
  assert.equal(
    decoder.currentAcquisitionIntervalSamples,
    decoder.acquisitionIntervalSamples * 2
  );

  decoder.process(new Float32Array(decoder.currentAcquisitionIntervalSamples - 1));
  assert.equal(decoder.acquisitionAttempts, 2);
  decoder.process(new Float32Array(1));
  assert.equal(decoder.acquisitionAttempts, 3);
  assert.equal(
    decoder.currentAcquisitionIntervalSamples,
    decoder.acquisitionIntervalSamples * 4
  );

  decoder.reset();
  assert.equal(decoder.acquisitionFailures, 0);
  assert.equal(
    decoder.currentAcquisitionIntervalSamples,
    decoder.acquisitionIntervalSamples
  );
});

test('coherent-energy gate rejects a valid but deliberately sub-threshold waveform', () => {
  const expected = makeGroups(12);
  const fixture = makeMpxFixture(expected);
  const decoder = new RdsDecoder({
    sampleRate: 240000,
    minimumCoherentRatio: 0.9
  });
  const decoded = processInChunks(decoder, fixture, [4096, 7777, 31]);

  assert.deepEqual(decoded, []);
  assert.equal(decoder.synced, false);
});

test('default coherent-energy gate accepts a weak valid RDS waveform', () => {
  const expected = makeGroups(12);
  const fixture = makeMpxFixture(expected, { rdsAmplitude: 0.012 });
  const decoder = new RdsDecoder({ sampleRate: 240000 });
  const decoded = processInChunks(decoder, fixture, [4096, 7777, 31]);

  assert.equal(decoder.minimumCoherentRatio, 0.002);
  assert.equal(decoder.synced, true);
  assert.ok(findContiguousExpectedRun(decoded, expected, 6));

  const oldGateDecoder = new RdsDecoder({
    sampleRate: 240000,
    minimumCoherentRatio: 0.008
  });
  const oldGateDecoded = processInChunks(
    oldGateDecoder,
    fixture,
    [4096, 7777, 31]
  );
  assert.deepEqual(oldGateDecoded, []);
  assert.equal(oldGateDecoder.synced, false);
});

test('advanced RDS numeric options reject non-finite and unsafe values', () => {
  for (const bitRate of [0, 99, 30001, Infinity, Number.NaN]) {
    assert.throws(
      () => new RdsDecoder({ bitRate }),
      /bit ?rate/i
    );
  }
  for (const subcarrierHz of [0, 117001, Infinity, Number.NaN]) {
    assert.throws(
      () => new RdsDecoder({ sampleRate: 240000, subcarrierHz }),
      /subcarrier/
    );
  }
  for (const lockBlocks of [2, 3.5, 33, Infinity, Number.NaN]) {
    assert.throws(
      () => new RdsDecoder({ lockBlocks }),
      /lockBlocks/
    );
    assert.throws(
      () => new RdsBlockSynchronizer({ lockBlocks }),
      /lockBlocks/
    );
  }

  for (const acquisitionBits of [1, 105, 4097, Infinity, Number.NaN]) {
    assert.throws(
      () => new RdsDecoder({ acquisitionBits }),
      /acquisitionBits/
    );
  }
  for (const acquisitionIntervalMs of [0, 49, 5001, Infinity, Number.NaN]) {
    assert.throws(
      () => new RdsDecoder({ acquisitionIntervalMs }),
      /acquisitionIntervalMs/
    );
  }
  for (const maximumAcquisitionIntervalMs of [49, 10001, Infinity, Number.NaN]) {
    assert.throws(
      () => new RdsDecoder({
        acquisitionIntervalMs: 50,
        maximumAcquisitionIntervalMs
      }),
      /maximumAcquisitionIntervalMs/
    );
  }
  assert.throws(
    () => new RdsDecoder({
      acquisitionIntervalMs: 500,
      maximumAcquisitionIntervalMs: 499
    }),
    /maximumAcquisitionIntervalMs/
  );
  for (const coarsePhaseStep of [0, 1.5, 33, Infinity, Number.NaN]) {
    assert.throws(
      () => new RdsDecoder({ coarsePhaseStep }),
      /coarsePhaseStep/
    );
  }
  for (const minimumCoherentRatio of [-0.1, 1.1, Infinity, Number.NaN]) {
    assert.throws(
      () => new RdsDecoder({ minimumCoherentRatio }),
      /minimumCoherentRatio/
    );
  }
  for (const timingGain of [-1, 11, Infinity, Number.NaN]) {
    assert.throws(
      () => new RdsDecoder({ timingGain }),
      /timingGain/
    );
  }
  for (const timingProbeFraction of [0, 0.2, Infinity, Number.NaN]) {
    assert.throws(
      () => new RdsDecoder({ timingProbeFraction }),
      /timing ?probe ?fraction/i
    );
  }
  for (const maximumTimingCorrection of [-1, 30, Infinity, Number.NaN]) {
    assert.throws(
      () => new RdsDecoder({ maximumTimingCorrection }),
      /maximumTimingCorrection/
    );
  }
  for (const maxConsecutiveBadBlocks of [1, 101, Infinity, Number.NaN]) {
    assert.throws(
      () => new RdsBlockSynchronizer({ maxConsecutiveBadBlocks }),
      /maxConsecutiveBadBlocks/
    );
  }

  assert.throws(
    () => new RdsDecoder({
      sampleRate: 4000000,
      bitRate: 100,
      acquisitionBits: 4096
    }),
    /buffered samples/
  );
});
