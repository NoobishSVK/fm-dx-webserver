"use strict";

const {
  clamp,
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
const AUDIO_FILTER_LENGTH = 159;
const AUDIO_CUTOFF_HZ = 16500;
const AUDIO_PASSBAND_HZ = 15000;
const DC_BLOCK_CUTOFF_HZ = 5;
const NOISE_BAND_CENTER_HZ = 80000;
const NOISE_BAND_Q = 4;
const OSCILLATOR_NORMALIZE_INTERVAL = 4096;
const STEREO_BLEND_SILENCE = 1e-5;
const IQ_BYTE_VALUES = 256;
const PHASE_TURNS = 0x100000000;
const RADIANS_TO_PHASE_TURNS = PHASE_TURNS / TWO_PI;

function createIqPhaseLookup() {
  const phases = new Uint32Array(IQ_BYTE_VALUES * IQ_BYTE_VALUES);

  for (let byteI = 0; byteI < IQ_BYTE_VALUES; byteI++) {
    const centeredI = byteI - 127.5;
    const rowOffset = byteI << 8;

    for (let byteQ = 0; byteQ < IQ_BYTE_VALUES; byteQ++) {
      phases[rowOffset | byteQ] = Math.round(
        Math.atan2(byteQ - 127.5, centeredI) * RADIANS_TO_PHASE_TURNS
      ) >>> 0;
    }
  }

  return phases;
}

// rtl_tcp samples are unsigned 8-bit I/Q, so all possible vector phases fit
// in one shared table. Unsigned 32-bit turns make wrap-around exact, including
// anti-parallel vectors, without evaluating atan2 for all 240k samples/s.
const IQ_PHASE_LOOKUP = createIqPhaseLookup();

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
    this.noiseFilter = designBiquadBandPass(
      sampleRate,
      Math.min(NOISE_BAND_CENTER_HZ, sampleRate * 0.4),
      NOISE_BAND_Q
    );
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

    this.sumHistory = new Float64Array(this.audioTaps.length);
    this.diffHistory = new Float64Array(this.audioTaps.length);
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
    this.historyIndex = 0;
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
    this.diffFilterActive = false;

    this.signalStrideCounter = 0;
    this.signalPowerSamples = 0;
    this.signalSnr = 0;
    this.noiseFilter1 = 0;
    this.noiseFilter2 = 0;
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
    const sampleCount = Math.floor((input.length + (hadPendingByte ? 1 : 0)) / 2);
    const outputFrames = Math.floor(
      (this.decimationCounter + sampleCount) / this.decimation
    );
    const pcm = new Int16Array(outputFrames * 2);
    const mpxOutput = this.includeMpx ? new Float32Array(sampleCount) : null;
    const signals = [];

    let inputOffset = 0;
    let outputOffset = 0;
    let mpxOffset = 0;
    let pendingI = this.pendingIqByte;
    this.pendingIqByte = -1;

    if (sampleCount === 0) {
      if (pendingI >= 0) {
        this.pendingIqByte = pendingI;
      } else if (input.length > 0) {
        this.pendingIqByte = input[0];
      }
      return this._makeResult(pcm, signals, mpxOutput);
    }

    // Keep chunk-local DSP state in local variables. Committing it once per
    // input block avoids repeated object-property and typed-array lookups in
    // the 240 kHz hot loop without changing its arithmetic or output ordering.
    const audioTaps = this.audioTaps;
    const sumHistory = this.sumHistory;
    const diffHistory = this.diffHistory;
    const historyLength = audioTaps.length;
    const middleTap = (historyLength - 1) >> 1;
    const decimation = this.decimation;
    const phaseTurnsToDemodulated = this.phaseTurnsToDemodulated;
    const dcBlockPole = this.dcBlockPole;
    const rdsDcBlockPole = this.rdsDcBlockPole;
    const stereoBlendAlpha = this.stereoBlendAlpha;
    const deemphasisPole = this.deemphasisPole;
    const deemphasisB0 = this.deemphasisB0;
    const deemphasisB1 = this.deemphasisB1;
    const forceMono = this.forceMono;
    const pilotLowPassAlpha = this.pilotLowPassAlpha;
    const noisePowerAlpha = this.noisePowerAlpha;
    const pilotPhaseErrorAlpha = this.pilotPhaseErrorAlpha;
    const pilotMaximumCorrection = this.pilotMaximumCorrection;
    const pilotAcquireUpdates = this.pilotAcquireUpdates;
    const pilotReleaseUpdates = this.pilotReleaseUpdates;
    const pilotNominalStepCos = this.pilotNominalStepCos;
    const pilotNominalStepSin = this.pilotNominalStepSin;
    const signalSampleStride = this.signalSampleStride;
    const signalWindowSamples = this.signalWindowSamples;
    const stereoMinimumSnrPowerRatio =
      this.stereoMinimumSnrPowerRatio;
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

    let hasPreviousIq = this.hasPreviousIq;
    let previousPhase = this.previousPhase;
    let previousRdsDemodulated = this.previousRdsDemodulated;
    let previousRdsDcOutput = this.previousRdsDcOutput;
    let stereoBlend = this.stereoBlend;
    let diffFilterActive = this.diffFilterActive;
    let historyIndex = this.historyIndex;
    let decimationCounter = this.decimationCounter;
    let previousDcLeftInput = this.previousDcLeftInput;
    let previousDcRightInput = this.previousDcRightInput;
    let dcLeftOutput = this.dcLeftOutput;
    let dcRightOutput = this.dcRightOutput;
    let previousDeemphasisLeftInput =
      this.previousDeemphasisLeftInput;
    let previousDeemphasisRightInput =
      this.previousDeemphasisRightInput;
    let deemphasisLeft = this.deemphasisLeft;
    let deemphasisRight = this.deemphasisRight;
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
    let signalStrideCounter = this.signalStrideCounter;
    let signalPowerSamples = this.signalPowerSamples;
    let signalSnr = this.signalSnr;
    let noiseFilter1 = this.noiseFilter1;
    let noiseFilter2 = this.noiseFilter2;
    let outOfBandNoisePower = this.outOfBandNoisePower;
    let channelI1 = this.channelI1;
    let channelI2 = this.channelI2;
    let channelQ1 = this.channelQ1;
    let channelQ2 = this.channelQ2;

    while (mpxOffset < sampleCount) {
      let byteI;
      let byteQ;

      if (pendingI >= 0) {
        byteI = pendingI;
        byteQ = input[inputOffset++];
        pendingI = -1;
      } else {
        byteI = input[inputOffset++];
        byteQ = input[inputOffset++];
      }

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
      if (mpxOutput) {
        // RDS correlation benefits from removing tuner-frequency/DC error, but
        // program audio must not use this composite-domain high-pass: it
        // rotates L+R bass without applying the same phase shift to L-R.
        const rdsMpx =
          demodulated -
          previousRdsDemodulated +
          rdsDcBlockPole * previousRdsDcOutput;
        previousRdsDemodulated = demodulated;
        previousRdsDcOutput = rdsMpx;
        mpxOutput[mpxOffset] = rdsMpx;
      }
      mpxOffset++;

      // Standard FM stereo plus RDS ends below 57 kHz. Measuring a narrow band
      // around 80 kHz gives a program-content-independent noise estimate,
      // unlike the former adjacent-sample correlation metric that could switch
      // clean music to mono solely because of its pitch. Stations using an
      // unusually strong auxiliary subcarrier in this band may need a lower
      // stereoMinimumSnrDb setting.
      const outOfBandNoise = noiseB0 * mpx + noiseFilter1;
      noiseFilter1 =
        noiseB1 * mpx - noiseA1 * outOfBandNoise + noiseFilter2;
      noiseFilter2 =
        noiseB2 * mpx - noiseA2 * outOfBandNoise;
      outOfBandNoisePower +=
        noisePowerAlpha *
        (outOfBandNoise * outOfBandNoise - outOfBandNoisePower);

      // Pilot tracking, stereo reconstruction, and signal metering share the
      // same sample cadence. Keeping their scalar state local lets V8 optimize
      // this as one numeric loop instead of materializing state between helper
      // calls. The operation order is deliberately identical to the former
      // helpers.
      const currentPilotCos = pilotCos;
      const currentPilotSin = pilotSin;
      const mixedPilotI = 2 * mpx * currentPilotCos;
      const mixedPilotQ = -2 * mpx * currentPilotSin;

      pilotI1 += pilotLowPassAlpha * (mixedPilotI - pilotI1);
      pilotQ1 += pilotLowPassAlpha * (mixedPilotQ - pilotQ1);
      pilotI2 += pilotLowPassAlpha * (pilotI1 - pilotI2);
      pilotQ2 += pilotLowPassAlpha * (pilotQ1 - pilotQ2);

      pilotUpdateCounter++;
      if (pilotUpdateCounter === 4) {
        pilotUpdateCounter = 0;

        const pilotPower = pilotI2 * pilotI2 + pilotQ2 * pilotQ2;
        let phaseError = 0;
        if (pilotPower > 1e-8) {
          phaseError = Math.atan2(pilotQ2, pilotI2);
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
      }

      const stereoTarget = stereo && !forceMono ? 1 : 0;
      stereoBlend +=
        stereoBlendAlpha * (stereoTarget - stereoBlend);

      const stereoCos =
        currentPilotCos * currentPilotCos -
        currentPilotSin * currentPilotSin;
      sumHistory[historyIndex] = mpx;
      diffHistory[historyIndex] =
        2 * mpx * stereoCos * stereoBlend;
      if (stereoTarget !== 0 || stereoBlend > STEREO_BLEND_SILENCE) {
        diffFilterActive = true;
      } else if (diffFilterActive) {
        // Once the fade has fallen below -100 dB, clearing the audio-FIR tail
        // is inaudible and lets steady forced-mono/no-pilot operation skip the
        // complete difference-channel convolution.
        diffHistory.fill(0);
        diffFilterActive = false;
      }
      historyIndex++;
      if (historyIndex === historyLength) historyIndex = 0;

      decimationCounter++;
      if (decimationCounter === decimation) {
        decimationCounter = 0;

        let sum = 0;
        let diff = 0;
        let newestIndex = historyIndex;
        let oldestIndex = historyIndex;
        for (let tapIndex = 0; tapIndex < middleTap; tapIndex++) {
          newestIndex--;
          if (newestIndex < 0) newestIndex = historyLength - 1;
          const tap = audioTaps[tapIndex];
          sum +=
            (sumHistory[newestIndex] + sumHistory[oldestIndex]) * tap;
          if (diffFilterActive) {
            diff +=
              (diffHistory[newestIndex] + diffHistory[oldestIndex]) * tap;
          }
          oldestIndex++;
          if (oldestIndex === historyLength) oldestIndex = 0;
        }
        sum += sumHistory[oldestIndex] * audioTaps[middleTap];
        if (diffFilterActive) {
          diff += diffHistory[oldestIndex] * audioTaps[middleTap];
        }

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

      if (signalStrideCounter === 0) {
        signalPowerSamples++;

        if (signalPowerSamples >= signalWindowSamples) {
          const pilotPower =
            pilotI2 * pilotI2 + pilotQ2 * pilotQ2;
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
          signalPowerSamples = 0;
        }
      }

      signalStrideCounter++;
      if (signalStrideCounter === signalSampleStride) {
        signalStrideCounter = 0;
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

    this.hasPreviousIq = hasPreviousIq;
    this.previousPhase = previousPhase;
    this.previousRdsDemodulated = previousRdsDemodulated;
    this.previousRdsDcOutput = previousRdsDcOutput;
    this.stereoBlend = stereoBlend;
    this.diffFilterActive = diffFilterActive;
    this.historyIndex = historyIndex;
    this.decimationCounter = decimationCounter;
    this.previousDcLeftInput = previousDcLeftInput;
    this.previousDcRightInput = previousDcRightInput;
    this.dcLeftOutput = dcLeftOutput;
    this.dcRightOutput = dcRightOutput;
    this.previousDeemphasisLeftInput =
      previousDeemphasisLeftInput;
    this.previousDeemphasisRightInput =
      previousDeemphasisRightInput;
    this.deemphasisLeft = deemphasisLeft;
    this.deemphasisRight = deemphasisRight;
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
    this.signalStrideCounter = signalStrideCounter;
    this.signalPowerSamples = signalPowerSamples;
    this.signalSnr = signalSnr;
    this.noiseFilter1 = noiseFilter1;
    this.noiseFilter2 = noiseFilter2;
    this.outOfBandNoisePower = outOfBandNoisePower;
    this.channelI1 = channelI1;
    this.channelI2 = channelI2;
    this.channelQ1 = channelQ1;
    this.channelQ2 = channelQ2;

    if (inputOffset < input.length) {
      this.pendingIqByte = input[inputOffset];
    }

    return this._makeResult(pcm, signals, mpxOutput);
  }

  _makeResult(pcm, signals, mpx) {
    return mpx ? { pcm, signals, mpx } : { pcm, signals };
  }
}

module.exports = {
  FmStereoDecoder
};
