"use strict";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * atan2 with a maximum error of about 1e-5 rad (Abramowitz & Stegun 4.4.49).
 *
 * Math.atan2 is several times slower and dominated the 60 kHz pilot loop;
 * this accuracy is far below what the phase detector can resolve.
 */
function fastAtan2(y, x) {
  const absX = Math.abs(x);
  const absY = Math.abs(y);
  if (absX === 0 && absY === 0) return 0;

  const swap = absY > absX;
  const ratio = swap ? absX / absY : absY / absX;
  const ratioSquared = ratio * ratio;
  let angle = ratio * (0.9998660 + ratioSquared * (-0.3302995 +
    ratioSquared * (0.1801410 + ratioSquared * (-0.0851330 +
    ratioSquared * 0.0208351))));
  if (swap) angle = Math.PI / 2 - angle;
  if (x < 0) angle = Math.PI - angle;
  return y < 0 ? -angle : angle;
}

/**
 * Design an odd-length, unity-gain low-pass FIR with a Hamming window.
 *
 * Frequencies are expressed in Hz. The returned taps are ordered so tap zero
 * multiplies the newest sample in a circular history buffer.
 */
function designLowPass(sampleRate, cutoffHz, length = 63) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new TypeError('sampleRate must be a finite positive number');
  }
  if (!Number.isFinite(cutoffHz) || cutoffHz <= 0 || cutoffHz >= sampleRate / 2) {
    throw new RangeError('cutoffHz must be finite, positive, and below Nyquist');
  }
  if (!Number.isInteger(length) || length < 3 || (length & 1) === 0) {
    throw new RangeError('FIR length must be an odd integer of at least 3');
  }

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
    const tap = sinc * window;
    taps[index] = tap;
    sum += tap;
  }

  for (let index = 0; index < length; index++) {
    taps[index] /= sum;
  }

  return taps;
}

function designBiquadLowPass(sampleRate, cutoffHz, q = Math.SQRT1_2) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new TypeError('sampleRate must be a finite positive number');
  }
  if (!Number.isFinite(cutoffHz) || cutoffHz <= 0 || cutoffHz >= sampleRate / 2) {
    throw new RangeError('cutoffHz must be finite, positive, and below Nyquist');
  }
  if (!Number.isFinite(q) || q <= 0) {
    throw new RangeError('q must be a finite positive number');
  }

  const omega = 2 * Math.PI * cutoffHz / sampleRate;
  const cosine = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * q);
  const a0 = 1 + alpha;

  return Object.freeze({
    b0: ((1 - cosine) / 2) / a0,
    b1: (1 - cosine) / a0,
    b2: ((1 - cosine) / 2) / a0,
    a1: (-2 * cosine) / a0,
    a2: (1 - alpha) / a0
  });
}

/**
 * Design a constant-peak-gain band-pass biquad.
 *
 * This is used for inexpensive power measurements inside a frequency band;
 * it is not part of the program-audio path.
 */
function designBiquadBandPass(sampleRate, centerHz, q = 4) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new TypeError('sampleRate must be a finite positive number');
  }
  if (!Number.isFinite(centerHz) || centerHz <= 0 || centerHz >= sampleRate / 2) {
    throw new RangeError('centerHz must be finite, positive, and below Nyquist');
  }
  if (!Number.isFinite(q) || q <= 0) {
    throw new RangeError('q must be a finite positive number');
  }

  const omega = 2 * Math.PI * centerHz / sampleRate;
  const cosine = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * q);
  const a0 = 1 + alpha;

  return Object.freeze({
    b0: alpha / a0,
    b1: 0,
    b2: -alpha / a0,
    a1: (-2 * cosine) / a0,
    a2: (1 - alpha) / a0
  });
}

module.exports = {
  clamp,
  fastAtan2,
  designLowPass,
  designBiquadLowPass,
  designBiquadBandPass
};
