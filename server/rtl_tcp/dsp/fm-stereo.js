"use strict";

const {
  clamp,
  fastAtan2,
  designLowPass,
  designBiquadLowPass,
  designBiquadBandPass
} = require('./filters');

const TWO_PI = 2 * Math.PI;
const PILOT_HZ = 19000;
const DEFAULT_SAMPLE_RATE = 240000;
const DEFAULT_OUTPUT_RATE = 48000;
const DEFAULT_DEVIATION_HZ = 75000;
const DEFAULT_DEEMPHASIS_US = 50;
const DEFAULT_SIGNAL_SAMPLE_STRIDE = 64;
const DEFAULT_BANDWIDTH_HZ = 200000;
const DEFAULT_STEREO_MINIMUM_SNR_DB = 3;
const DEFAULT_STEREO_BLEND_SNR_DB = 40;
const AUDIO_FILTER_LENGTH = 159;
const AUDIO_CUTOFF_HZ = 16500;
const AUDIO_PASSBAND_HZ = 15000;
const DC_BLOCK_CUTOFF_HZ = 5;
const NOISE_BAND_CENTER_HZ = 80000;
const NOISE_BAND_Q = 8;
// The SNR scale (and stereoMinimumSnrDb) was calibrated with one Q = 4
// section; the sharper detector is normalised to read the same noise power.
const REFERENCE_NOISE_BAND_Q = 4;
const OSCILLATOR_NORMALIZE_INTERVAL = 4096;
const STEREO_BLEND_SILENCE = 1e-5;
const IQ_BYTE_VALUES = 256;
const PHASE_TURNS = 0x100000000;
const RADIANS_TO_PHASE_TURNS = PHASE_TURNS / TWO_PI;

// Stereo blend calibration, measured on white IQ noise with 50 us
// de-emphasis and a 9 % pilot: mono program SNR (re. 100 % modulation) is this
// much above the pilot-to-80 kHz-noise ratio the decoder already tracks, and
// the L-R channel carries 20 dB more noise than L+R. Other de-emphasis time
// constants are corrected analytically in the constructor (75 us checked to
// within 0.2 dB of measurement).
const MONO_SNR_ABOVE_PILOT_SNR_DB = 46.3;
const BLEND_REFERENCE_DEEMPHASIS_US = 50;
const REFERENCE_STEREO_NOISE_PENALTY = 100;
const BLEND_UPDATE_INTERVAL = 16;
const BLEND_WARMUP_SECONDS = 0.1;
const BLEND_RISE_SECONDS = 0.06;
const BLEND_FALL_SECONDS = 0.03;

function createIqPhaseLookup() {
  const phases = new Int32Array(IQ_BYTE_VALUES * IQ_BYTE_VALUES);

  for (let byteI = 0; byteI < IQ_BYTE_VALUES; byteI++) {
    const centeredI = byteI - 127.5;
    const rowOffset = byteI << 8;

    for (let byteQ = 0; byteQ < IQ_BYTE_VALUES; byteQ++) {
      phases[rowOffset | byteQ] = Math.round(
        Math.atan2(byteQ - 127.5, centeredI) * RADIANS_TO_PHASE_TURNS
      ) | 0;
    }
  }

  return phases;
}

// rtl_tcp samples are unsigned 8-bit I/Q, so all possible vector phases fit
// in one shared table. 32-bit turns make wrap-around exact, including
// anti-parallel vectors, without evaluating atan2 for all 240k samples/s.
// Signed entries keep the discriminator in V8's int32 fast path.
const IQ_PHASE_LOOKUP = createIqPhaseLookup();

// Per-call work buffers are shared by all decoders. process() is synchronous,
// so the buffers never hold state between calls; keeping them off the
// instance means decoder state does not depend on how IQ was chunked.
let scratchIq = new Uint8Array(0);
let scratchSum = new Float64Array(0);
let scratchDiff = new Float64Array(0);

function scratchIqBuffer(length) {
  if (scratchIq.length < length) scratchIq = new Uint8Array(length * 2);
  return scratchIq;
}

function ensureWorkBuffers(length) {
  if (scratchSum.length < length) {
    scratchSum = new Float64Array(length * 2);
    scratchDiff = new Float64Array(length * 2);
  }
}

// Integral of f^2 / (1 + (2 pi f tau)^2) from 0 to bandHz: the FM
// discriminator's parabolic noise after first-order de-emphasis.
function deemphasizedNoisePower(tau, bandHz) {
  const a = TWO_PI * tau;
  return bandHz / (a * a) - Math.atan(a * bandHz) / (a * a * a);
}

// The same for the L-R channel, whose noise comes from 38 kHz +/- f:
// integral of (38k^2 + f^2) / (1 + (2 pi f tau)^2).
function deemphasizedDifferenceNoisePower(tau, bandHz) {
  const a = TWO_PI * tau;
  const subcarrierHz = 2 * PILOT_HZ;
  return subcarrierHz * subcarrierHz * Math.atan(a * bandHz) / a +
    deemphasizedNoisePower(tau, bandHz);
}

// Discriminator noise (PSD rising with f^2) passed by `stages` cascaded
// copies of a biquad, integrated numerically up to Nyquist.
function parabolicNoiseGain(filter, sampleRate, stages) {
  const steps = 4096;
  let total = 0;
  for (let step = 0; step < steps; step++) {
    const omega = Math.PI * (step + 0.5) / steps;
    const cos1 = Math.cos(omega);
    const sin1 = Math.sin(omega);
    const cos2 = Math.cos(2 * omega);
    const sin2 = Math.sin(2 * omega);
    const numeratorRe = filter.b0 + filter.b1 * cos1 + filter.b2 * cos2;
    const numeratorIm = -filter.b1 * sin1 - filter.b2 * sin2;
    const denominatorRe = 1 + filter.a1 * cos1 + filter.a2 * cos2;
    const denominatorIm = -filter.a1 * sin1 - filter.a2 * sin2;
    const powerGain =
      (numeratorRe * numeratorRe + numeratorIm * numeratorIm) /
      (denominatorRe * denominatorRe + denominatorIm * denominatorIm);
    total += omega * omega * Math.pow(powerGain, stages);
  }
  return total;
}

function finiteNumber(value, fallback, label) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return parsed;
}

class FmStereoDecoder {
  constructor(options = {}) {
    const sampleRate = finiteNumber(options.sampleRate, DEFAULT_SAMPLE_RATE, 'sampleRate');
    const outputRate = finiteNumber(options.outputRate, DEFAULT_OUTPUT_RATE, 'outputRate');
    const deviationHz = finiteNumber(
      options.deviationHz,
      DEFAULT_DEVIATION_HZ,
      'deviationHz'
    );
    const deemphasisUs = finiteNumber(
      options.deemphasisUs,
      DEFAULT_DEEMPHASIS_US,
      'deemphasisUs'
    );
    const signalSampleStride = finiteNumber(
      options.signalSampleStride,
      DEFAULT_SIGNAL_SAMPLE_STRIDE,
      'signalSampleStride'
    );
    const bandwidthHz = finiteNumber(
      options.bandwidthHz,
      Math.min(DEFAULT_BANDWIDTH_HZ, sampleRate),
      'bandwidthHz'
    );
    const stereoMinimumSnrDb = finiteNumber(
      options.stereoMinimumSnrDb,
      DEFAULT_STEREO_MINIMUM_SNR_DB,
      'stereoMinimumSnrDb'
    );
    const stereoBlendSnrDb = finiteNumber(
      options.stereoBlendSnrDb,
      DEFAULT_STEREO_BLEND_SNR_DB,
      'stereoBlendSnrDb'
    );

    if (sampleRate < 2 * (PILOT_HZ * 2 + AUDIO_CUTOFF_HZ)) {
      throw new RangeError('sampleRate is too low for broadcast FM stereo');
    }
    if (outputRate <= 0 || outputRate > sampleRate || sampleRate % outputRate !== 0) {
      throw new RangeError('sampleRate must be an integer multiple of outputRate');
    }
    if (deviationHz <= 0 || deviationHz >= sampleRate / 2) {
      throw new RangeError('deviationHz must be positive and below Nyquist');
    }
    if (deemphasisUs <= 0) {
      throw new RangeError('deemphasisUs must be positive');
    }
    if (!Number.isInteger(signalSampleStride) || signalSampleStride < 1) {
      throw new RangeError('signalSampleStride must be a positive integer');
    }
    if (bandwidthHz < 4000 || bandwidthHz > sampleRate) {
      throw new RangeError('bandwidthHz must be between 4000 Hz and the sample rate');
    }
    if (stereoMinimumSnrDb < 0 || stereoMinimumSnrDb > 70) {
      throw new RangeError('stereoMinimumSnrDb must be between 0 and 70 dB');
    }
    if (stereoBlendSnrDb < 0 || stereoBlendSnrDb > 90) {
      throw new RangeError('stereoBlendSnrDb must be between 0 and 90 dB');
    }

    this.sampleRate = sampleRate;
    this.outputRate = outputRate;
    this.deviationHz = deviationHz;
    this.deemphasisUs = deemphasisUs;
    this.signalSampleStride = signalSampleStride;
    this.stereoMinimumSnrDb = stereoMinimumSnrDb;
    this.stereoMinimumSnrPowerRatio =
      Math.pow(10, stereoMinimumSnrDb / 10);
    this.forceMono = options.forceMono === true || String(options.forceMono) === '1';
    this.includeMpx = options.includeMpx !== false;

    this.decimation = sampleRate / outputRate;
    this.maximumPhase = TWO_PI * deviationHz / sampleRate;
    this.phaseTurnsToDemodulated =
      (TWO_PI / PHASE_TURNS) / this.maximumPhase;
    this.audioTaps = designLowPass(
      sampleRate,
      Math.min(AUDIO_CUTOFF_HZ, outputRate * 0.42),
      AUDIO_FILTER_LENGTH
    );

    // A matched analog pole keeps the low and middle audio band accurate. A
    // small delayed feed-forward term corrects the otherwise increasing error
    // near 15 kHz while preserving exact unity gain at DC.
    const deemphasisTau = deemphasisUs * 1e-6;
    this.deemphasisPole = Math.exp(-1 / (outputRate * deemphasisTau));
    const deemphasisTargetHz = Math.min(
      AUDIO_PASSBAND_HZ,
      outputRate * 0.45
    );
    const targetOmega = TWO_PI * deemphasisTargetHz / outputRate;
    const targetAnalogMagnitudeSquared =
      1 / (1 + Math.pow(TWO_PI * deemphasisTargetHz * deemphasisTau, 2));
    const targetDenominatorMagnitudeSquared =
      1 +
      this.deemphasisPole * this.deemphasisPole -
      2 * this.deemphasisPole * Math.cos(targetOmega);
    const deemphasisNumeratorSum = 1 - this.deemphasisPole;
    const targetNormalizedNumeratorMagnitudeSquared =
      targetAnalogMagnitudeSquared *
      targetDenominatorMagnitudeSquared /
      (deemphasisNumeratorSum * deemphasisNumeratorSum);
    const delayedProduct = clamp(
      (1 - targetNormalizedNumeratorMagnitudeSquared) /
        (2 * (1 - Math.cos(targetOmega))),
      0,
      0.25
    );
    const delayedFraction =
      (1 - Math.sqrt(1 - 4 * delayedProduct)) / 2;
    this.deemphasisB0 =
      deemphasisNumeratorSum * (1 - delayedFraction);
    this.deemphasisB1 =
      deemphasisNumeratorSum * delayedFraction;

    this.dcBlockPole = Math.exp(
      -TWO_PI * DC_BLOCK_CUTOFF_HZ / outputRate
    );
    this.rdsDcBlockPole = Math.exp(
      -TWO_PI * DC_BLOCK_CUTOFF_HZ / sampleRate
    );
    const noiseBandCenterHz = Math.min(NOISE_BAND_CENTER_HZ, sampleRate * 0.4);
    this.noiseFilter = designBiquadBandPass(
      sampleRate,
      noiseBandCenterHz,
      NOISE_BAND_Q
    );
    this.noisePowerScale =
      parabolicNoiseGain(
        designBiquadBandPass(sampleRate, noiseBandCenterHz, REFERENCE_NOISE_BAND_Q),
        sampleRate,
        1
      ) / parabolicNoiseGain(this.noiseFilter, sampleRate, 2);
    this.setBandwidthHz(bandwidthHz);

    // Mixing to baseband followed by two one-pole sections is inexpensive and
    // rejects the audio and 38 kHz image before the pilot phase detector.
    this.pilotLowPassAlpha = 1 - Math.exp(-TWO_PI * 800 / sampleRate);
    this.noisePowerAlpha = 1 - Math.exp(-1 / (sampleRate * 0.05));
    this.pilotPhaseErrorAlpha = 1 - Math.exp(-4 / (sampleRate * 0.05));
    this.stereoBlendAlpha = 1 - Math.exp(-1 / (sampleRate * 0.02));
    this.pilotNominalStep = TWO_PI * PILOT_HZ / sampleRate;
    this.pilotNominalStepCos = Math.cos(this.pilotNominalStep);
    this.pilotNominalStepSin = Math.sin(this.pilotNominalStep);
    this.pilotMaximumCorrection = TWO_PI * 250 / sampleRate;

    const pilotUpdatesPerSecond = sampleRate / 4;
    this.pilotAcquireUpdates = Math.max(1, Math.round(pilotUpdatesPerSecond * 0.04));
    this.pilotReleaseUpdates = Math.max(1, Math.round(pilotUpdatesPerSecond * 0.08));
    this.signalWindowSamples = Math.max(
      1,
      Math.round(sampleRate / (4 * signalSampleStride))
    );
    this.signalIntervalSamples =
      this.signalWindowSamples * signalSampleStride;

    // Signal-to-noise stereo blend. Stereo costs ~20 dB of program SNR, so
    // the L-R gain is lowered just enough to hold the output near
    // stereoBlendSnrDb as reception weakens: full separation on good signals,
    // gradual narrowing instead of a hard switch into hiss on weak ones.
    // A target of 0 disables blending (full stereo whenever the pilot locks).
    this.stereoBlendSnrDb = stereoBlendSnrDb;
    this.stereoBlendEnabled = stereoBlendSnrDb > 0;
    const monoSnrAbovePilotSnrDb =
      MONO_SNR_ABOVE_PILOT_SNR_DB +
      10 * Math.log10(
        deemphasizedNoisePower(BLEND_REFERENCE_DEEMPHASIS_US * 1e-6, AUDIO_PASSBAND_HZ) /
          deemphasizedNoisePower(deemphasisTau, AUDIO_PASSBAND_HZ)
      );
    this.stereoBlendSnrGain = Math.pow(
      10,
      (monoSnrAbovePilotSnrDb - stereoBlendSnrDb) / 10
    );
    const referenceTau = BLEND_REFERENCE_DEEMPHASIS_US * 1e-6;
    this.stereoNoisePenalty =
      REFERENCE_STEREO_NOISE_PENALTY *
      (deemphasizedDifferenceNoisePower(deemphasisTau, AUDIO_PASSBAND_HZ) /
        deemphasizedNoisePower(deemphasisTau, AUDIO_PASSBAND_HZ)) /
      (deemphasizedDifferenceNoisePower(referenceTau, AUDIO_PASSBAND_HZ) /
        deemphasizedNoisePower(referenceTau, AUDIO_PASSBAND_HZ));
    // The blend follows the SNR over tens of milliseconds, so it is
    // re-evaluated on every 16th pilot update (about every 0.27 ms).
    const blendUpdatesPerSecond = pilotUpdatesPerSecond / BLEND_UPDATE_INTERVAL;
    this.blendWarmupUpdates = Math.round(blendUpdatesPerSecond * BLEND_WARMUP_SECONDS);
    this.blendRiseAlpha = 1 - Math.exp(-1 / (blendUpdatesPerSecond * BLEND_RISE_SECONDS));
    this.blendFallAlpha = 1 - Math.exp(-1 / (blendUpdatesPerSecond * BLEND_FALL_SECONDS));

    // FIR history excludes the newest sample: each block is processed in a
    // linear [history | new samples] buffer so the polyphase decimator never
    // has to wrap a circular index.
    this.sumHistory = new Float64Array(this.audioTaps.length - 1);
    this.diffHistory = new Float64Array(this.audioTaps.length - 1);
    this.reset();
  }

  setBandwidthHz(bandwidthHz) {
    const parsed = Number(bandwidthHz);
    if (!Number.isFinite(parsed) || parsed < 4000 || parsed > this.sampleRate) {
      throw new RangeError(
        `bandwidthHz must be between 4000 Hz and ${this.sampleRate} Hz`
      );
    }

    this.bandwidthHz = parsed;
    // rtl_tcp already band-limits the full-rate stream. The old default
    // biquad added nonlinear I/Q phase at 200 kHz and audibly reduced stereo
    // separation, so reserve it for an explicitly narrowed bandwidth.
    this.channelFilterEnabled =
      parsed < Math.min(DEFAULT_BANDWIDTH_HZ, this.sampleRate);
    this.channelFilter = this.channelFilterEnabled
      ? designBiquadLowPass(
          this.sampleRate,
          Math.min(parsed / 2, this.sampleRate * 0.45)
        )
      : Object.freeze({ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 });
    this.channelI1 = 0;
    this.channelI2 = 0;
    this.channelQ1 = 0;
    this.channelQ2 = 0;
  }

  reset() {
    this.pendingIqByte = -1;
    this.previousPhase = 0;
    this.hasPreviousIq = false;
    this.previousRdsDemodulated = 0;
    this.previousRdsDcOutput = 0;
    this.channelI1 = 0;
    this.channelI2 = 0;
    this.channelQ1 = 0;
    this.channelQ2 = 0;

    this.sumHistory.fill(0);
    this.diffHistory.fill(0);
    this.samplesSinceDiff = this.audioTaps.length;
    this.diffFilterActive = false;
    this.decimationCounter = 0;
    this.previousDcLeftInput = 0;
    this.previousDcRightInput = 0;
    this.dcLeftOutput = 0;
    this.dcRightOutput = 0;
    this.previousDeemphasisLeftInput = 0;
    this.previousDeemphasisRightInput = 0;
    this.deemphasisLeft = 0;
    this.deemphasisRight = 0;

    this.pilotCos = 1;
    this.pilotSin = 0;
    this.pilotStepCos = this.pilotNominalStepCos;
    this.pilotStepSin = this.pilotNominalStepSin;
    this.pilotOscillatorSamples = 0;
    this.pilotFrequencyCorrection = 0;
    this.pilotUpdateCounter = 0;
    this.pilotI1 = 0;
    this.pilotQ1 = 0;
    this.pilotI2 = 0;
    this.pilotQ2 = 0;
    this.pilotPhaseErrorAverage = Math.PI * Math.PI;
    this.pilotAcquireCounter = 0;
    this.pilotReleaseCounter = 0;
    this.stereo = false;
    this.stereoBlend = 0;
    this.snrBlend = 0;
    this.blendUpdateCounter = 0;
    this.blendWarmupRemaining = this.blendWarmupUpdates;

    this.signalCountdown = this.signalIntervalSamples;
    this.signalSnr = 0;
    this.noiseFilter1 = 0;
    this.noiseFilter2 = 0;
    this.noiseFilter3 = 0;
    this.noiseFilter4 = 0;
    this.outOfBandNoisePower = 0;
  }

  setForceMono(forceMono) {
    this.forceMono = forceMono === true || String(forceMono) === '1';
  }

  process(input) {
    if (!(input instanceof Uint8Array)) {
      throw new TypeError('FM stereo input must be a Uint8Array');
    }

    const hadPendingByte = this.pendingIqByte >= 0;
    const totalBytes = input.length + (hadPendingByte ? 1 : 0);
    const sampleCount = totalBytes >> 1;
    const decimation = this.decimation;
    const outputFrames = Math.floor(
      (this.decimationCounter + sampleCount) / decimation
    );
    const pcm = new Int16Array(outputFrames * 2);
    const mpxOutput = this.includeMpx ? new Float32Array(sampleCount) : null;
    const signals = [];

    if (sampleCount === 0) {
      if (!hadPendingByte && input.length > 0) {
        this.pendingIqByte = input[0];
      }
      return this._makeResult(pcm, signals, mpxOutput);
    }

    // Prepend a byte left over from the previous call so the hot loop always
    // reads aligned I/Q pairs.
    let iq = input;
    if (hadPendingByte) {
      iq = scratchIqBuffer(totalBytes);
      iq[0] = this.pendingIqByte;
      iq.set(input, 1);
    }
    this.pendingIqByte = (totalBytes & 1) === 1 ? iq[totalBytes - 1] : -1;

    const audioTaps = this.audioTaps;
    const historyLength = audioTaps.length - 1;
    ensureWorkBuffers(historyLength + sampleCount);
    const sumWork = scratchSum;
    const diffWork = scratchDiff;
    sumWork.set(this.sumHistory, 0);
    diffWork.set(this.diffHistory, 0);

    // Keep chunk-local DSP state in local variables. Committing it once per
    // input block avoids repeated object-property lookups in the 240 kHz
    // loop.
    const phaseTurnsToDemodulated = this.phaseTurnsToDemodulated;
    const rdsDcBlockPole = this.rdsDcBlockPole;
    const stereoBlendAlpha = this.stereoBlendAlpha;
    const forceMono = this.forceMono;
    const pilotLowPassAlpha = this.pilotLowPassAlpha;
    const noisePowerAlpha = this.noisePowerAlpha;
    const pilotPhaseErrorAlpha = this.pilotPhaseErrorAlpha;
    const pilotMaximumCorrection = this.pilotMaximumCorrection;
    const pilotAcquireUpdates = this.pilotAcquireUpdates;
    const pilotReleaseUpdates = this.pilotReleaseUpdates;
    const pilotNominalStepCos = this.pilotNominalStepCos;
    const pilotNominalStepSin = this.pilotNominalStepSin;
    const signalIntervalSamples = this.signalIntervalSamples;
    const stereoMinimumSnrPowerRatio =
      this.stereoMinimumSnrPowerRatio;
    const stereoBlendEnabled = this.stereoBlendEnabled;
    const stereoBlendSnrGain = this.stereoBlendSnrGain;
    const stereoNoisePenalty = this.stereoNoisePenalty;
    const blendRiseAlpha = this.blendRiseAlpha;
    const blendFallAlpha = this.blendFallAlpha;
    const channelFilterEnabled = this.channelFilterEnabled;
    const channelB0 = this.channelFilter.b0;
    const channelB1 = this.channelFilter.b1;
    const channelB2 = this.channelFilter.b2;
    const channelA1 = this.channelFilter.a1;
    const channelA2 = this.channelFilter.a2;
    const noiseB0 = this.noiseFilter.b0;
    const noiseB1 = this.noiseFilter.b1;
    const noiseB2 = this.noiseFilter.b2;
    const noiseA1 = this.noiseFilter.a1;
    const noiseA2 = this.noiseFilter.a2;
    const noisePowerScale = this.noisePowerScale;

    let hasPreviousIq = this.hasPreviousIq;
    let previousPhase = this.previousPhase;
    let previousRdsDemodulated = this.previousRdsDemodulated;
    let previousRdsDcOutput = this.previousRdsDcOutput;
    let stereoBlend = this.stereoBlend;
    let snrBlend = this.snrBlend;
    let blendUpdateCounter = this.blendUpdateCounter;
    let blendWarmupRemaining = this.blendWarmupRemaining;
    let pilotCos = this.pilotCos;
    let pilotSin = this.pilotSin;
    let pilotStepCos = this.pilotStepCos;
    let pilotStepSin = this.pilotStepSin;
    let pilotOscillatorSamples = this.pilotOscillatorSamples;
    let pilotFrequencyCorrection = this.pilotFrequencyCorrection;
    let pilotUpdateCounter = this.pilotUpdateCounter;
    let pilotI1 = this.pilotI1;
    let pilotQ1 = this.pilotQ1;
    let pilotI2 = this.pilotI2;
    let pilotQ2 = this.pilotQ2;
    let pilotPhaseErrorAverage = this.pilotPhaseErrorAverage;
    let pilotAcquireCounter = this.pilotAcquireCounter;
    let pilotReleaseCounter = this.pilotReleaseCounter;
    let stereo = this.stereo;
    let signalCountdown = this.signalCountdown;
    let signalSnr = this.signalSnr;
    let noiseFilter1 = this.noiseFilter1;
    let noiseFilter2 = this.noiseFilter2;
    let noiseFilter3 = this.noiseFilter3;
    let noiseFilter4 = this.noiseFilter4;
    let outOfBandNoisePower = this.outOfBandNoisePower;
    let channelI1 = this.channelI1;
    let channelI2 = this.channelI2;
    let channelQ1 = this.channelQ1;
    let channelQ2 = this.channelQ2;
    // Work-buffer index of the newest non-zero L-R sample, so the decimator
    // can skip the difference convolution while the output is mono.
    let lastActiveDiff = historyLength - 1 - this.samplesSinceDiff;

    for (let sample = 0, byteOffset = 0; sample < sampleCount; sample++, byteOffset += 2) {
      let byteI = iq[byteOffset];
      let byteQ = iq[byteOffset + 1];

      if (channelFilterEnabled) {
        const inputI = byteI - 127.5;
        const filteredI = channelB0 * inputI + channelI1;
        channelI1 =
          channelB1 * inputI - channelA1 * filteredI + channelI2;
        channelI2 = channelB2 * inputI - channelA2 * filteredI;

        const inputQ = byteQ - 127.5;
        const filteredQ = channelB0 * inputQ + channelQ1;
        channelQ1 =
          channelB1 * inputQ - channelA1 * filteredQ + channelQ2;
        channelQ2 = channelB2 * inputQ - channelA2 * filteredQ;

        byteI = Math.max(0, Math.min(255, Math.round(filteredI + 127.5)));
        byteQ = Math.max(0, Math.min(255, Math.round(filteredQ + 127.5)));
      }

      const currentPhase = IQ_PHASE_LOOKUP[(byteI << 8) | byteQ];
      let demodulated = 0;

      if (hasPreviousIq) {
        let phaseDelta = (currentPhase - previousPhase) | 0;
        if (phaseDelta === -0x80000000) {
          // atan2(cross, dot) returns +PI for exact opposite byte vectors.
          phaseDelta = 0x80000000;
        }
        demodulated = phaseDelta * phaseTurnsToDemodulated;
      } else {
        hasPreviousIq = true;
      }
      previousPhase = currentPhase;

      const mpx = demodulated;
      if (mpxOutput !== null) {
        // RDS correlation benefits from removing tuner-frequency/DC error, but
        // program audio must not use this composite-domain high-pass: it
        // rotates L+R bass without applying the same phase shift to L-R.
        const rdsMpx =
          demodulated -
          previousRdsDemodulated +
          rdsDcBlockPole * previousRdsDcOutput;
        previousRdsDemodulated = demodulated;
        previousRdsDcOutput = rdsMpx;
        mpxOutput[sample] = rdsMpx;
      }

      // Standard FM stereo plus RDS ends below 60 kHz. Measuring a narrow band
      // around 80 kHz gives a program-content-independent noise estimate; two
      // cascaded sections reject loud L-R treble (sidebands up to 53 kHz) by
      // about 33 dB so it cannot pass for noise and narrow the stereo blend.
      // Stations using an unusually strong auxiliary subcarrier in this band
      // may need a lower stereoMinimumSnrDb setting.
      const noiseStage = noiseB0 * mpx + noiseFilter1;
      noiseFilter1 =
        noiseB1 * mpx - noiseA1 * noiseStage + noiseFilter2;
      noiseFilter2 =
        noiseB2 * mpx - noiseA2 * noiseStage;
      const outOfBandNoise = noiseB0 * noiseStage + noiseFilter3;
      noiseFilter3 =
        noiseB1 * noiseStage - noiseA1 * outOfBandNoise + noiseFilter4;
      noiseFilter4 =
        noiseB2 * noiseStage - noiseA2 * outOfBandNoise;
      outOfBandNoisePower +=
        noisePowerAlpha *
        (outOfBandNoise * outOfBandNoise * noisePowerScale - outOfBandNoisePower);

      const currentPilotCos = pilotCos;
      const currentPilotSin = pilotSin;
      pilotI1 += pilotLowPassAlpha * (2 * mpx * currentPilotCos - pilotI1);
      pilotQ1 += pilotLowPassAlpha * (-2 * mpx * currentPilotSin - pilotQ1);
      pilotI2 += pilotLowPassAlpha * (pilotI1 - pilotI2);
      pilotQ2 += pilotLowPassAlpha * (pilotQ1 - pilotQ2);

      pilotUpdateCounter++;
      if (pilotUpdateCounter === 4) {
        pilotUpdateCounter = 0;

        const pilotPower = pilotI2 * pilotI2 + pilotQ2 * pilotQ2;
        let phaseError = 0;
        if (pilotPower > 1e-8) {
          phaseError = fastAtan2(pilotQ2, pilotI2);
        }

        const phaseErrorSquared =
          pilotPower > 1e-8 ? phaseError * phaseError : Math.PI * Math.PI;
        pilotPhaseErrorAverage +=
          pilotPhaseErrorAlpha *
          (phaseErrorSquared - pilotPhaseErrorAverage);

        if (pilotPower > 1e-8) {
          pilotFrequencyCorrection = clamp(
            pilotFrequencyCorrection + 0.000002 * phaseError,
            -pilotMaximumCorrection,
            pilotMaximumCorrection
          );

          const angle = 0.0025 * phaseError;
          const angleSquared = angle * angle;
          const correctionCos =
            1 - angleSquared / 2 + angleSquared * angleSquared / 24;
          const correctionSin =
            angle * (1 - angleSquared / 6);
          const unrotatedPilotCos = pilotCos;
          const unrotatedPilotSin = pilotSin;
          pilotCos =
            unrotatedPilotCos * correctionCos -
            unrotatedPilotSin * correctionSin;
          pilotSin =
            unrotatedPilotSin * correctionCos +
            unrotatedPilotCos * correctionSin;

          const correction = pilotFrequencyCorrection;
          const correctionSquared = correction * correction;
          const stepCorrectionCos =
            1 -
            correctionSquared / 2 +
            correctionSquared * correctionSquared / 24;
          const stepCorrectionSin =
            correction * (1 - correctionSquared / 6);
          pilotStepCos =
            pilotNominalStepCos * stepCorrectionCos -
            pilotNominalStepSin * stepCorrectionSin;
          pilotStepSin =
            pilotNominalStepSin * stepCorrectionCos +
            pilotNominalStepCos * stepCorrectionSin;
        }

        const pilotIsUsable =
          pilotPower > 0.000025 &&
          pilotPhaseErrorAverage < 0.65 &&
          pilotPower >=
            outOfBandNoisePower * stereoMinimumSnrPowerRatio;

        if (pilotIsUsable) {
          pilotReleaseCounter = 0;
          if (pilotAcquireCounter < pilotAcquireUpdates) {
            pilotAcquireCounter++;
          }
          if (pilotAcquireCounter >= pilotAcquireUpdates) {
            stereo = true;
          }
        } else {
          pilotAcquireCounter = 0;
          if (stereo) {
            pilotReleaseCounter++;
            if (pilotReleaseCounter >= pilotReleaseUpdates) {
              stereo = false;
              pilotReleaseCounter = 0;
            }
          }
        }

        blendUpdateCounter++;
        if (blendUpdateCounter === BLEND_UPDATE_INTERVAL) {
          blendUpdateCounter = 0;
          // Pick the L-R gain b that keeps (1 + P b^2) noise below the
          // target: b^2 = (monoSnr / targetSnr - 1) / P, from the pilot SNR.
          let blendTarget = 1;
          if (blendWarmupRemaining > 0) {
            // The noise estimator starts from zero after a reset or retune.
            blendWarmupRemaining--;
            blendTarget = 0;
          } else if (stereoBlendEnabled) {
            const blendPower =
              pilotPower *
                stereoBlendSnrGain /
                (outOfBandNoisePower > 1e-12 ? outOfBandNoisePower : 1e-12) -
              1;
            blendTarget = blendPower <= 0
              ? 0
              : blendPower >= stereoNoisePenalty
                ? 1
                : Math.sqrt(blendPower / stereoNoisePenalty);
          }
          snrBlend +=
            (blendTarget > snrBlend ? blendRiseAlpha : blendFallAlpha) *
            (blendTarget - snrBlend);
        }
      }

      const stereoTarget = stereo && !forceMono ? snrBlend : 0;
      stereoBlend += stereoBlendAlpha * (stereoTarget - stereoBlend);

      const workIndex = historyLength + sample;
      sumWork[workIndex] = mpx;
      if (stereoTarget === 0 && stereoBlend <= STEREO_BLEND_SILENCE) {
        // Below -100 dB the fade is inaudible; exact zeros let steady mono
        // skip the whole difference-channel convolution.
        stereoBlend = 0;
        diffWork[workIndex] = 0;
      } else {
        diffWork[workIndex] =
          2 * mpx *
          (currentPilotCos * currentPilotCos -
            currentPilotSin * currentPilotSin) *
          stereoBlend;
        lastActiveDiff = workIndex;
      }

      signalCountdown--;
      if (signalCountdown === 0) {
        signalCountdown = signalIntervalSamples;
        const pilotPower = pilotI2 * pilotI2 + pilotQ2 * pilotQ2;
        signalSnr = clamp(
          10 *
            Math.log10(
              Math.max(pilotPower, 1e-12) /
                Math.max(outOfBandNoisePower, 1e-12)
            ),
          0,
          70
        );
        signals.push({
          snr: Number(signalSnr.toFixed(1)),
          stereo,
          forceMono
        });
      }

      const unadvancedPilotCos = pilotCos;
      const unadvancedPilotSin = pilotSin;
      pilotCos =
        unadvancedPilotCos * pilotStepCos -
        unadvancedPilotSin * pilotStepSin;
      pilotSin =
        unadvancedPilotSin * pilotStepCos +
        unadvancedPilotCos * pilotStepSin;

      pilotOscillatorSamples++;
      if (pilotOscillatorSamples === OSCILLATOR_NORMALIZE_INTERVAL) {
        const inverseMagnitude =
          1 / (Math.hypot(pilotCos, pilotSin) || 1);
        pilotCos *= inverseMagnitude;
        pilotSin *= inverseMagnitude;
        pilotOscillatorSamples = 0;
      }
    }

    this._decimate(
      pcm,
      sumWork,
      diffWork,
      decimation - this.decimationCounter - 1,
      sampleCount,
      lastActiveDiff
    );

    this.decimationCounter = (this.decimationCounter + sampleCount) % decimation;
    this.sumHistory.set(sumWork.subarray(sampleCount, sampleCount + historyLength));
    this.diffHistory.set(diffWork.subarray(sampleCount, sampleCount + historyLength));
    const newestWorkIndex = historyLength + sampleCount - 1;
    this.samplesSinceDiff = Math.min(
      audioTaps.length,
      newestWorkIndex - lastActiveDiff
    );
    this.diffFilterActive = this.samplesSinceDiff < audioTaps.length;

    this.hasPreviousIq = hasPreviousIq;
    this.previousPhase = previousPhase;
    this.previousRdsDemodulated = previousRdsDemodulated;
    this.previousRdsDcOutput = previousRdsDcOutput;
    this.stereoBlend = stereoBlend;
    this.snrBlend = snrBlend;
    this.blendUpdateCounter = blendUpdateCounter;
    this.blendWarmupRemaining = blendWarmupRemaining;
    this.pilotCos = pilotCos;
    this.pilotSin = pilotSin;
    this.pilotStepCos = pilotStepCos;
    this.pilotStepSin = pilotStepSin;
    this.pilotOscillatorSamples = pilotOscillatorSamples;
    this.pilotFrequencyCorrection = pilotFrequencyCorrection;
    this.pilotUpdateCounter = pilotUpdateCounter;
    this.pilotI1 = pilotI1;
    this.pilotQ1 = pilotQ1;
    this.pilotI2 = pilotI2;
    this.pilotQ2 = pilotQ2;
    this.pilotPhaseErrorAverage = pilotPhaseErrorAverage;
    this.pilotAcquireCounter = pilotAcquireCounter;
    this.pilotReleaseCounter = pilotReleaseCounter;
    this.stereo = stereo;
    this.signalCountdown = signalCountdown;
    this.signalSnr = signalSnr;
    this.noiseFilter1 = noiseFilter1;
    this.noiseFilter2 = noiseFilter2;
    this.noiseFilter3 = noiseFilter3;
    this.noiseFilter4 = noiseFilter4;
    this.outOfBandNoisePower = outOfBandNoisePower;
    this.channelI1 = channelI1;
    this.channelI2 = channelI2;
    this.channelQ1 = channelQ1;
    this.channelQ2 = channelQ2;

    return this._makeResult(pcm, signals, mpxOutput);
  }

  /**
   * Low-pass and decimate L+R and L-R to the output rate, then rebuild L/R,
   * remove DC and apply de-emphasis. The symmetric FIR is folded, and it only
   * runs at the 48 kHz output rate, so stereo adds one multiply-add per tap
   * pair rather than a second full-rate filter.
   */
  _decimate(pcm, sumWork, diffWork, firstSample, sampleCount, lastActiveDiff) {
    const taps = this.audioTaps;
    const span = taps.length - 1;
    const middle = span >> 1;
    const decimation = this.decimation;
    const dcBlockPole = this.dcBlockPole;
    const deemphasisPole = this.deemphasisPole;
    const deemphasisB0 = this.deemphasisB0;
    const deemphasisB1 = this.deemphasisB1;

    let previousDcLeftInput = this.previousDcLeftInput;
    let previousDcRightInput = this.previousDcRightInput;
    let dcLeftOutput = this.dcLeftOutput;
    let dcRightOutput = this.dcRightOutput;
    let previousDeemphasisLeftInput = this.previousDeemphasisLeftInput;
    let previousDeemphasisRightInput = this.previousDeemphasisRightInput;
    let deemphasisLeft = this.deemphasisLeft;
    let deemphasisRight = this.deemphasisRight;
    let outputOffset = 0;

    // The output for input sample s uses work[s .. s + span]. Tap pairs are
    // folded and split across two accumulators per channel so consecutive
    // multiply-adds do not wait on each other.
    const pairedTaps = middle & ~1;
    for (let start = firstSample; start < sampleCount; start += decimation) {
      const centre = start + middle;
      let sumEven = sumWork[centre] * taps[middle];
      let sumOdd = 0;
      let diffEven = 0;
      let diffOdd = 0;
      let tap = 0;

      if (lastActiveDiff >= start) {
        diffEven = diffWork[centre] * taps[middle];
        for (; tap < pairedTaps; tap += 2) {
          const oldest = start + tap;
          const newest = start + span - tap;
          const evenCoefficient = taps[tap];
          const oddCoefficient = taps[tap + 1];
          sumEven += (sumWork[oldest] + sumWork[newest]) * evenCoefficient;
          sumOdd += (sumWork[oldest + 1] + sumWork[newest - 1]) * oddCoefficient;
          diffEven += (diffWork[oldest] + diffWork[newest]) * evenCoefficient;
          diffOdd += (diffWork[oldest + 1] + diffWork[newest - 1]) * oddCoefficient;
        }
        for (; tap < middle; tap++) {
          sumEven += (sumWork[start + tap] + sumWork[start + span - tap]) * taps[tap];
          diffEven += (diffWork[start + tap] + diffWork[start + span - tap]) * taps[tap];
        }
      } else {
        for (; tap < pairedTaps; tap += 2) {
          const oldest = start + tap;
          const newest = start + span - tap;
          sumEven += (sumWork[oldest] + sumWork[newest]) * taps[tap];
          sumOdd += (sumWork[oldest + 1] + sumWork[newest - 1]) * taps[tap + 1];
        }
        for (; tap < middle; tap++) {
          sumEven += (sumWork[start + tap] + sumWork[start + span - tap]) * taps[tap];
        }
      }

      const sum = sumEven + sumOdd;
      const diff = diffEven + diffOdd;
      const left = sum + diff;
      const right = sum - diff;

      // Remove tuning/DC error after stereo reconstruction. Applying this
      // filter to composite MPX rotates L+R bass but not the 38 kHz L-R
      // sidebands, which destroys low-frequency stereo separation.
      const dcLeft =
        left - previousDcLeftInput + dcBlockPole * dcLeftOutput;
      const dcRight =
        right - previousDcRightInput + dcBlockPole * dcRightOutput;
      previousDcLeftInput = left;
      previousDcRightInput = right;
      dcLeftOutput = dcLeft;
      dcRightOutput = dcRight;

      deemphasisLeft =
        deemphasisB0 * dcLeft +
        deemphasisB1 * previousDeemphasisLeftInput +
        deemphasisPole * deemphasisLeft;
      deemphasisRight =
        deemphasisB0 * dcRight +
        deemphasisB1 * previousDeemphasisRightInput +
        deemphasisPole * deemphasisRight;
      previousDeemphasisLeftInput = dcLeft;
      previousDeemphasisRightInput = dcRight;

      pcm[outputOffset++] = Math.round(
        clamp(deemphasisLeft, -1, 1) * 32767
      );
      pcm[outputOffset++] = Math.round(
        clamp(deemphasisRight, -1, 1) * 32767
      );
    }

    this.previousDcLeftInput = previousDcLeftInput;
    this.previousDcRightInput = previousDcRightInput;
    this.dcLeftOutput = dcLeftOutput;
    this.dcRightOutput = dcRightOutput;
    this.previousDeemphasisLeftInput = previousDeemphasisLeftInput;
    this.previousDeemphasisRightInput = previousDeemphasisRightInput;
    this.deemphasisLeft = deemphasisLeft;
    this.deemphasisRight = deemphasisRight;
  }

  _makeResult(pcm, signals, mpx) {
    return mpx ? { pcm, signals, mpx } : { pcm, signals };
  }
}

module.exports = {
  FmStereoDecoder
};
