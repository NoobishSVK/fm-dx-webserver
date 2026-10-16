"use strict";

const assert = require('node:assert/strict');
const test = require('node:test');
const { FmStereoDecoder } = require('../server/rtl_tcp/dsp/fm-stereo');

const SAMPLE_RATE = 240000;
const OUTPUT_RATE = 48000;
const DEVIATION_HZ = 75000;
const TWO_PI = 2 * Math.PI;

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function makeGeneratorState() {
  return {
    sampleIndex: 0,
    fmPhase: 0
  };
}

function generateFmIq(
  state,
  durationSeconds,
  {
    left = (time) => 0.3 * Math.sin(TWO_PI * 1000 * time),
    right = (time) => 0.3 * Math.sin(TWO_PI * 2000 * time),
    pilotAmplitude = 0.1,
    pilotFrequencyHz = 19000,
    pilotPhase = 0,
    extraMultiplex = () => 0
  } = {}
) {
  const sampleCount = Math.round(durationSeconds * SAMPLE_RATE);
  const iq = new Uint8Array(sampleCount * 2);
  const maximumPhase = TWO_PI * DEVIATION_HZ / SAMPLE_RATE;

  for (let localIndex = 0; localIndex < sampleCount; localIndex++) {
    const time = state.sampleIndex / SAMPLE_RATE;
    const leftSample = left(time);
    const rightSample = right(time);
    const pilot = typeof pilotAmplitude === 'function'
      ? pilotAmplitude(time)
      : pilotAmplitude;
    const currentPilotPhase =
      TWO_PI * pilotFrequencyHz * time + pilotPhase;
    const multiplex =
      0.5 * (leftSample + rightSample) +
      0.5 * (leftSample - rightSample) * Math.cos(2 * currentPilotPhase) +
      pilot * Math.cos(currentPilotPhase) +
      extraMultiplex(time);

    state.fmPhase += maximumPhase * multiplex;
    if (state.fmPhase > Math.PI) {
      state.fmPhase -= TWO_PI;
    } else if (state.fmPhase < -Math.PI) {
      state.fmPhase += TWO_PI;
    }

    iq[localIndex * 2] = clampByte(127.5 + 127 * Math.cos(state.fmPhase));
    iq[localIndex * 2 + 1] = clampByte(127.5 + 127 * Math.sin(state.fmPhase));
    state.sampleIndex++;
  }

  return iq;
}

function toneAmplitude(pcm, channel, frequencyHz, startSeconds = 0.35) {
  const startFrame = Math.floor(startSeconds * OUTPUT_RATE);
  const frameCount = pcm.length / 2 - startFrame;
  let sine = 0;
  let cosine = 0;

  for (let frame = startFrame; frame < pcm.length / 2; frame++) {
    const sample = pcm[frame * 2 + channel] / 32768;
    const phase = TWO_PI * frequencyHz * frame / OUTPUT_RATE;
    sine += sample * Math.sin(phase);
    cosine += sample * Math.cos(phase);
  }

  return 2 * Math.hypot(sine, cosine) / frameCount;
}

function stereoDifferenceRms(pcm, startSeconds = 0.15) {
  const startFrame = Math.floor(startSeconds * OUTPUT_RATE);
  const frameCount = pcm.length / 2 - startFrame;
  let sum = 0;

  for (let frame = startFrame; frame < pcm.length / 2; frame++) {
    const difference =
      (pcm[frame * 2] - pcm[frame * 2 + 1]) / 32768;
    sum += difference * difference;
  }

  return Math.sqrt(sum / frameCount);
}

function toneResidualRms(pcm, channel, frequencyHz, startSeconds = 0.3) {
  const startFrame = Math.floor(startSeconds * OUTPUT_RATE);
  const frameCount = pcm.length / 2 - startFrame;
  let sine = 0;
  let cosine = 0;
  let power = 0;

  for (let frame = startFrame; frame < pcm.length / 2; frame++) {
    const sample = pcm[frame * 2 + channel] / 32768;
    const phase = TWO_PI * frequencyHz * frame / OUTPUT_RATE;
    sine += sample * Math.sin(phase);
    cosine += sample * Math.cos(phase);
    power += sample * sample;
  }

  const amplitude = 2 * Math.hypot(sine, cosine) / frameCount;
  return Math.sqrt(Math.max(0, power / frameCount - amplitude * amplitude / 2));
}

function generateAdjacentChannelIq(durationSeconds) {
  const sampleCount = Math.round(durationSeconds * SAMPLE_RATE);
  const iq = new Uint8Array(sampleCount * 2);
  const desiredScale = TWO_PI * 10000 / SAMPLE_RATE;
  const adjacentScale = TWO_PI * 90000 / SAMPLE_RATE;
  const byteScale = 110 / 1.35;
  let desiredPhase = 0;

  for (let sample = 0; sample < sampleCount; sample++) {
    const time = sample / SAMPLE_RATE;
    desiredPhase +=
      desiredScale * 0.5 * Math.sin(TWO_PI * 1000 * time);
    const adjacentPhase = adjacentScale * sample + 0.3;
    const i =
      0.45 * Math.cos(desiredPhase) +
      0.9 * Math.cos(adjacentPhase);
    const q =
      0.45 * Math.sin(desiredPhase) +
      0.9 * Math.sin(adjacentPhase);
    iq[sample * 2] = clampByte(127.5 + i * byteScale);
    iq[sample * 2 + 1] = clampByte(127.5 + q * byteScale);
  }

  return iq;
}

function concatTypedArrays(parts, Constructor) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const combined = new Constructor(totalLength);
  let offset = 0;

  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }

  return combined;
}

function referenceMpx(iq) {
  const maximumPhase = TWO_PI * DEVIATION_HZ / SAMPLE_RATE;
  const dcBlockPole = Math.exp(-TWO_PI * 5 / SAMPLE_RATE);
  const mpx = new Float64Array(iq.length / 2);
  let previousI = 0;
  let previousQ = 0;
  let previousDemodulated = 0;
  let previousDcOutput = 0;

  for (let sample = 0; sample < mpx.length; sample++) {
    const currentI = iq[sample * 2] - 127.5;
    const currentQ = iq[sample * 2 + 1] - 127.5;
    let demodulated = 0;

    if (sample > 0) {
      const cross = previousI * currentQ - previousQ * currentI;
      const dot = previousI * currentI + previousQ * currentQ;
      demodulated = Math.atan2(cross, dot) / maximumPhase;
    }

    const currentMpx =
      demodulated -
      previousDemodulated +
      dcBlockPole * previousDcOutput;
    mpx[sample] = currentMpx;
    previousI = currentI;
    previousQ = currentQ;
    previousDemodulated = demodulated;
    previousDcOutput = currentMpx;
  }

  return mpx;
}

test('IQ phase lookup matches the atan2 discriminator across wraps', () => {
  const edgeVectors = [
    0, 1,
    255, 254,
    0, 1,
    129, 129,
    127, 127,
    129, 129,
    255, 128,
    0, 127,
    0, 128,
    255, 127,
    255, 255,
    0, 0,
    255, 255,
    0, 255,
    255, 0,
    127, 127,
    127, 128,
    128, 128,
    128, 127
  ];
  const iq = new Uint8Array(
    edgeVectors.length + 256 * 256 * 2
  );
  iq.set(edgeVectors);
  let offset = edgeVectors.length;

  for (let byteI = 0; byteI < 256; byteI++) {
    for (let byteQ = 0; byteQ < 256; byteQ++) {
      iq[offset++] = byteI;
      iq[offset++] = byteQ;
    }
  }

  const expected = referenceMpx(iq);
  const actual = new FmStereoDecoder({
    bandwidthHz: SAMPLE_RATE
  }).process(iq).mpx;
  let maximumError = 0;

  for (let index = 0; index < actual.length; index++) {
    assert.ok(Number.isFinite(actual[index]), { index, value: actual[index] });
    maximumError = Math.max(
      maximumError,
      Math.abs(actual[index] - expected[index])
    );
  }

  assert.ok(maximumError < 2e-6, `maximumError=${maximumError}`);
});

test('mono FM produces two matching channels while pilot lock remains visible', () => {
  const decoder = new FmStereoDecoder({ signalSampleStride: 64 });
  const state = makeGeneratorState();
  const mono = (time) => 0.3 * Math.sin(TWO_PI * 1000 * time);
  const result = decoder.process(generateFmIq(state, 1, {
    left: mono,
    right: mono
  }));

  assert.equal(result.mpx.length, SAMPLE_RATE);
  assert.equal(result.pcm.length, OUTPUT_RATE * 2);
  assert.ok(result.signals.length >= 3);
  assert.equal(result.signals.at(-1).stereo, true);
  assert.equal(result.signals.at(-1).forceMono, false);
  assert.ok(toneAmplitude(result.pcm, 0, 1000) > 0.2);
  assert.ok(stereoDifferenceRms(result.pcm, 0.35) < 0.003);
});

test('DC removal preserves broadcast audio bass', () => {
  const decoder = new FmStereoDecoder();
  const state = makeGeneratorState();
  const bass = (time) => 0.3 * Math.sin(TWO_PI * 50 * time);
  const result = decoder.process(generateFmIq(state, 1, {
    left: bass,
    right: bass,
    pilotAmplitude: 0
  }));

  assert.ok(toneAmplitude(result.pcm, 0, 50) > 0.25);
});

test('post-reconstruction DC removal preserves bass stereo separation', () => {
  for (const frequencyHz of [50, 100]) {
    const decoder = new FmStereoDecoder();
    const state = makeGeneratorState();
    const result = decoder.process(generateFmIq(state, 1, {
      left: (time) => 0.3 * Math.sin(TWO_PI * frequencyHz * time),
      right: () => 0
    }));
    const wanted = toneAmplitude(result.pcm, 0, frequencyHz);
    const leakage = toneAmplitude(result.pcm, 1, frequencyHz);
    const separationDb = 20 * Math.log10(wanted / Math.max(leakage, 1e-12));

    assert.ok(separationDb > 55, {
      frequencyHz,
      wanted,
      leakage,
      separationDb
    });
  }
});

test('audio response follows analog de-emphasis through 15 kHz', () => {
  function decodeMonoTone(frequencyHz) {
    const decoder = new FmStereoDecoder();
    const state = makeGeneratorState();
    const tone = (time) => 0.2 * Math.sin(TWO_PI * frequencyHz * time);
    const result = decoder.process(generateFmIq(state, 0.8, {
      left: tone,
      right: tone,
      pilotAmplitude: 0
    }));
    return toneAmplitude(result.pcm, 0, frequencyHz);
  }

  const referenceAmplitude = decodeMonoTone(1000);
  const highAmplitude = decodeMonoTone(15000);
  const measuredDb = 20 * Math.log10(highAmplitude / referenceAmplitude);
  const deemphasisTau = 50e-6;
  const expectedDb = 20 * Math.log10(
    Math.sqrt(
      (1 + Math.pow(TWO_PI * 1000 * deemphasisTau, 2)) /
      (1 + Math.pow(TWO_PI * 15000 * deemphasisTau, 2))
    )
  );

  assert.ok(Math.abs(measuredDb - expectedDb) < 1, {
    measuredDb,
    expectedDb
  });
});

test('audio filter keeps the 19 kHz stereo pilot out of PCM', () => {
  const decoder = new FmStereoDecoder();
  const state = makeGeneratorState();
  const result = decoder.process(generateFmIq(state, 1, {
    left: () => 0,
    right: () => 0
  }));

  assert.ok(toneAmplitude(result.pcm, 0, 19000) < 0.0003);
  assert.ok(toneAmplitude(result.pcm, 1, 19000) < 0.0003);
});

test('channel bandwidth rejects a strong adjacent station', () => {
  const iq = generateAdjacentChannelIq(1);
  const unfiltered = new FmStereoDecoder({
    bandwidthHz: SAMPLE_RATE
  }).process(iq);
  const filtered = new FmStereoDecoder({
    bandwidthHz: 75000
  }).process(iq);
  const unfilteredTone = toneAmplitude(unfiltered.pcm, 0, 1000);
  const filteredTone = toneAmplitude(filtered.pcm, 0, 1000);
  const unfilteredResidual = toneResidualRms(unfiltered.pcm, 0, 1000);
  const filteredResidual = toneResidualRms(filtered.pcm, 0, 1000);

  assert.ok(filteredTone > unfilteredTone * 2, {
    filteredTone,
    unfilteredTone
  });
  assert.ok(filteredResidual < unfilteredResidual / 20, {
    filteredResidual,
    unfilteredResidual
  });
  assert.equal(
    new FmStereoDecoder({ bandwidthHz: 200000 }).channelFilterEnabled,
    false
  );
  assert.equal(
    new FmStereoDecoder({ bandwidthHz: 75000 }).channelFilterEnabled,
    true
  );
});

test('uncorrelated IQ noise cannot report stereo lock', () => {
  const iq = new Uint8Array(SAMPLE_RATE * 2);
  let state = 0x12345678;
  for (let index = 0; index < iq.length; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    iq[index] = state >>> 24;
  }

  const decoder = new FmStereoDecoder({ signalSampleStride: 64 });
  const result = decoder.process(iq);

  assert.equal(decoder.stereo, false);
  assert.ok(result.signals.length > 0);
  assert.ok(result.signals.every(({ snr, stereo }) => snr < 3 && !stereo));
});

test('pilot-locked multiplex separates left and right program audio', () => {
  const decoder = new FmStereoDecoder({ signalSampleStride: 64 });
  const state = makeGeneratorState();
  const result = decoder.process(generateFmIq(state, 1));

  const leftWanted = toneAmplitude(result.pcm, 0, 1000);
  const leftLeak = toneAmplitude(result.pcm, 0, 2000);
  const rightWanted = toneAmplitude(result.pcm, 1, 2000);
  const rightLeak = toneAmplitude(result.pcm, 1, 1000);

  assert.equal(decoder.stereo, true);
  assert.ok(leftWanted > leftLeak * 15, { leftWanted, leftLeak });
  assert.ok(rightWanted > rightLeak * 7, { rightWanted, rightLeak });
});

test('clean program pitch cannot incorrectly force the stereo gate to mono', () => {
  for (const frequencyHz of [3000, 3500, 10500, 11000]) {
    const decoder = new FmStereoDecoder({ signalSampleStride: 64 });
    const state = makeGeneratorState();
    decoder.process(generateFmIq(state, 0.7, {
      left: (time) => 0.3 * Math.sin(TWO_PI * frequencyHz * time),
      right: () => 0
    }));

    assert.equal(decoder.stereo, true, {
      frequencyHz,
      snr: decoder.signalSnr
    });
  }
});

test('out-of-band discriminator noise prevents false stereo lock', () => {
  const decoder = new FmStereoDecoder({ signalSampleStride: 64 });
  const state = makeGeneratorState();
  decoder.process(generateFmIq(state, 0.7, {
    extraMultiplex: (time) =>
      0.25 * Math.sin(TWO_PI * 80000 * time)
  }));

  assert.equal(decoder.stereo, false);
  assert.ok(decoder.signalSnr < decoder.stereoMinimumSnrDb, {
    snr: decoder.signalSnr
  });
});

test('pilot loss clears stereo lock and smoothly returns automatic mode to mono', () => {
  const decoder = new FmStereoDecoder({ signalSampleStride: 64 });
  const state = makeGeneratorState();

  decoder.process(generateFmIq(state, 0.6));
  assert.equal(decoder.stereo, true);

  const withoutPilot = decoder.process(generateFmIq(state, 0.5, {
    pilotAmplitude: 0
  }));

  assert.equal(decoder.stereo, false);
  assert.ok(withoutPilot.signals.some(({ stereo }) => stereo === false));
  assert.ok(stereoDifferenceRms(withoutPilot.pcm, 0.3) < 0.003);
});

test('forced mono preserves pilot status and B0 restores stereo without a reset', () => {
  const decoder = new FmStereoDecoder({ signalSampleStride: 64 });
  const state = makeGeneratorState();

  decoder.process(generateFmIq(state, 0.6));
  assert.equal(decoder.stereo, true);

  decoder.setForceMono(true);
  const forced = decoder.process(generateFmIq(state, 0.4));
  assert.equal(decoder.stereo, true);
  assert.ok(
    forced.signals.some(
      ({ stereo, forceMono }) => stereo === true && forceMono === true
    )
  );
  assert.ok(stereoDifferenceRms(forced.pcm, 0.15) < 0.003);
  assert.equal(decoder.diffFilterActive, false);

  decoder.setForceMono(false);
  const automatic = decoder.process(generateFmIq(state, 0.4));
  assert.equal(decoder.stereo, true);
  assert.equal(decoder.diffFilterActive, true);
  assert.ok(stereoDifferenceRms(automatic.pcm, 0.15) > 0.15);
});

// Halve the carrier and add Gaussian IQ noise (deterministic) for a CNR of
// 10 * log10(63.5^2 / (2 * sigma^2)) dB.
function weakenIq(iq, sigma) {
  let seed = 0x2468ace1;
  const uniform = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed + 0.5) / 4294967296;
  };
  const weak = new Uint8Array(iq.length);
  for (let index = 0; index < iq.length; index++) {
    const noise =
      Math.sqrt(-2 * Math.log(uniform())) * Math.cos(TWO_PI * uniform());
    weak[index] = clampByte(127.5 + (iq[index] - 127.5) * 0.5 + sigma * noise);
  }
  return weak;
}

test('weak stereo narrows separation to limit noise; strong stereo stays full', () => {
  const state = makeGeneratorState();
  // Left-only program: the right channel carries only crosstalk and noise.
  const clean = generateFmIq(state, 1.2, { right: () => 0 });
  const weak = weakenIq(clean, 8.5);

  const strong = new FmStereoDecoder();
  strong.process(clean);
  assert.equal(strong.stereo, true);
  assert.ok(strong.stereoBlend > 0.99, `stereoBlend=${strong.stereoBlend}`);

  const blended = new FmStereoDecoder();
  const blendedResult = blended.process(weak);
  const unblended = new FmStereoDecoder({ stereoBlendSnrDb: 0 });
  const unblendedResult = unblended.process(weak);

  // The pilot is still detected, so the stereo indicator stays lit.
  assert.equal(blended.stereo, true);
  assert.equal(unblended.stereo, true);
  assert.ok(unblended.stereoBlend > 0.99, `stereoBlend=${unblended.stereoBlend}`);
  assert.ok(
    blended.stereoBlend > 0.2 && blended.stereoBlend < 0.8,
    `stereoBlend=${blended.stereoBlend}`
  );

  // Blending trades separation (more 1 kHz crosstalk into the right
  // channel) for noise (less of everything else).
  const blendedNoise = toneResidualRms(blendedResult.pcm, 1, 1000, 0.6);
  const unblendedNoise = toneResidualRms(unblendedResult.pcm, 1, 1000, 0.6);
  assert.ok(
    unblendedNoise > blendedNoise * 1.5,
    `blendedNoise=${blendedNoise} unblendedNoise=${unblendedNoise}`
  );
  assert.ok(
    toneAmplitude(blendedResult.pcm, 1, 1000, 0.6) >
      toneAmplitude(unblendedResult.pcm, 1, 1000, 0.6) * 2
  );
});

test('loud L-R treble on a strong station is not mistaken for noise', () => {
  // L-R at 15 kHz puts sidebands at 23 and 53 kHz, near the 80 kHz noise
  // detector; it must not narrow the stereo blend of a clean signal.
  for (const frequencyHz of [12000, 15000]) {
    const decoder = new FmStereoDecoder();
    const state = makeGeneratorState();
    const treble = (time) => 0.45 * Math.sin(TWO_PI * frequencyHz * time);
    decoder.process(generateFmIq(state, 1, {
      left: treble,
      right: (time) => -treble(time)
    }));

    assert.equal(decoder.stereo, true);
    assert.ok(
      decoder.stereoBlend > 0.99,
      `frequencyHz=${frequencyHz} stereoBlend=${decoder.stereoBlend} snr=${decoder.signalSnr}`
    );
  }
});

test('recursive pilot oscillator remains normalized and follows carrier error', () => {
  const decoder = new FmStereoDecoder({ signalSampleStride: 64 });
  const state = makeGeneratorState();
  const result = decoder.process(generateFmIq(state, 1.2, {
    pilotFrequencyHz: 19080,
    pilotPhase: 0.73
  }));
  const oscillatorMagnitude = Math.hypot(decoder.pilotCos, decoder.pilotSin);
  const correctionHz =
    decoder.pilotFrequencyCorrection * SAMPLE_RATE / TWO_PI;

  assert.equal(decoder.stereo, true);
  assert.ok(Math.abs(oscillatorMagnitude - 1) < 1e-9, oscillatorMagnitude);
  assert.ok(Math.abs(correctionHz - 80) < 0.5, correctionHz);
  assert.ok(toneAmplitude(result.pcm, 0, 1000, 0.5) > 0.2);
  assert.ok(
    toneAmplitude(result.pcm, 0, 1000, 0.5) >
      toneAmplitude(result.pcm, 0, 2000, 0.5) * 15
  );
});

test('MPX allocation can be disabled without changing PCM or signal results', () => {
  const state = makeGeneratorState();
  const iq = generateFmIq(state, 0.4);
  const withMpx = new FmStereoDecoder({ signalSampleStride: 64 }).process(iq);
  const withoutMpx = new FmStereoDecoder({
    signalSampleStride: 64,
    includeMpx: false
  }).process(iq);

  assert.ok(withMpx.mpx instanceof Float32Array);
  assert.equal(Object.hasOwn(withoutMpx, 'mpx'), false);
  assert.deepEqual(withoutMpx.signals, withMpx.signals);
  assert.ok(
    Buffer.from(withoutMpx.pcm.buffer).equals(Buffer.from(withMpx.pcm.buffer))
  );
});

test('odd-byte and arbitrary chunk boundaries are sample-exact', () => {
  const state = makeGeneratorState();
  const iq = generateFmIq(state, 0.45);
  const wholeDecoder = new FmStereoDecoder({ signalSampleStride: 64 });
  const chunkedDecoder = new FmStereoDecoder({ signalSampleStride: 64 });
  const whole = wholeDecoder.process(iq);
  const pcmParts = [];
  const mpxParts = [];
  const chunkedSignals = [];
  const chunkSizes = [1, 0, 3, 7, 64, 255, 1024, 8191, 32769];
  let offset = 0;
  let sizeIndex = 0;

  while (offset < iq.length) {
    const requestedSize = chunkSizes[sizeIndex++ % chunkSizes.length];
    if (requestedSize === 0) {
      const empty = chunkedDecoder.process(new Uint8Array(0));
      pcmParts.push(empty.pcm);
      mpxParts.push(empty.mpx);
      chunkedSignals.push(...empty.signals);
      continue;
    }

    const end = Math.min(iq.length, offset + requestedSize);
    const result = chunkedDecoder.process(iq.subarray(offset, end));
    pcmParts.push(result.pcm);
    mpxParts.push(result.mpx);
    chunkedSignals.push(...result.signals);
    offset = end;
  }

  const chunkedPcm = concatTypedArrays(pcmParts, Int16Array);
  const chunkedMpx = concatTypedArrays(mpxParts, Float32Array);

  assert.equal(chunkedDecoder.pendingIqByte, -1);
  assert.equal(chunkedPcm.length, whole.pcm.length);
  assert.equal(chunkedMpx.length, whole.mpx.length);
  assert.deepEqual(chunkedSignals, whole.signals);
  assert.ok(
    Buffer.from(chunkedPcm.buffer).equals(Buffer.from(whole.pcm.buffer)),
    'PCM differs when IQ arrives on odd byte boundaries'
  );
  assert.ok(
    Buffer.from(chunkedMpx.buffer).equals(Buffer.from(whole.mpx.buffer)),
    'MPX differs when IQ arrives on odd byte boundaries'
  );
  assert.deepEqual(
    chunkedDecoder,
    wholeDecoder,
    'decoder state differs after arbitrary chunk boundaries'
  );
});

test('constructor rejects unsupported rates and process validates input', () => {
  assert.throws(
    () => new FmStereoDecoder({ sampleRate: 191999 }),
    /integer multiple|too low/
  );
  assert.throws(
    () => new FmStereoDecoder({ deviationHz: 120000 }),
    /below Nyquist/
  );

  const decoder = new FmStereoDecoder();
  assert.throws(() => decoder.process([1, 2]), /Uint8Array/);
});

test('WebAssembly SIMD audio filter is bit-identical to the JavaScript filter', (t) => {
  const modulePath = require.resolve('../server/rtl_tcp/dsp/fm-stereo');
  const wasmModule = require(modulePath);
  if (wasmModule.FIR_BACKEND !== 'wasm-simd') {
    t.skip('WebAssembly SIMD is not available in this runtime');
    return;
  }

  // Load a second copy of the decoder with the JavaScript filter forced.
  const previousSetting = process.env.FMDX_DSP_WASM;
  const cachedModule = require.cache[modulePath];
  process.env.FMDX_DSP_WASM = '0';
  delete require.cache[modulePath];
  let jsModule;
  try {
    jsModule = require(modulePath);
  } finally {
    if (previousSetting === undefined) {
      delete process.env.FMDX_DSP_WASM;
    } else {
      process.env.FMDX_DSP_WASM = previousSetting;
    }
    require.cache[modulePath] = cachedModule;
  }
  assert.equal(jsModule.FIR_BACKEND, 'js');

  // The pilot drops out and returns, so both the stereo and the silent-L-R
  // (sum-only) filter paths run, across odd and uneven chunk boundaries.
  const iq = generateFmIq(makeGeneratorState(), 1.2, {
    pilotAmplitude: (time) => (time > 0.4 && time < 0.8 ? 0 : 0.1)
  });
  const chunks = [1, 4097, 65536, 333, 12000, 77777];

  function decode(Decoder) {
    const decoder = new Decoder({ includeMpx: false });
    const pcm = [];
    const signals = [];
    for (let offset = 0, index = 0; offset < iq.length; index++) {
      const length = chunks[index % chunks.length];
      const result = decoder.process(iq.subarray(offset, offset + length));
      pcm.push(Buffer.from(result.pcm.buffer));
      signals.push(...result.signals);
      offset += length;
    }
    return { pcm: Buffer.concat(pcm), signals };
  }

  const fromWasm = decode(wasmModule.FmStereoDecoder);
  const fromJs = decode(jsModule.FmStereoDecoder);
  assert.ok(fromWasm.signals.some((signal) => signal.stereo));
  assert.ok(fromWasm.signals.some((signal) => !signal.stereo));
  assert.deepEqual(fromWasm.signals, fromJs.signals);
  assert.ok(fromWasm.pcm.equals(fromJs.pcm), 'PCM differs between filter backends');
});
