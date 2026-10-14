"use strict";

/*
 * The RDS check matrix, offset constants, short-burst correction strategy, and
 * block-sync state machine below follow the corresponding concepts in redsea:
 *
 * Copyright (c) Oona Räisänen
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * The streaming 57 kHz matched correlator and timing recovery are original to
 * this implementation.
 */

const RDS_BIT_RATE = 1187.5;
const RDS_SUBCARRIER_HZ = 57000;
const BLOCK_BITS = 26;
const DATA_BITS = 16;
const CHECK_BITS = 10;
const BLOCK_MASK = 0x03ffffff;
const MAX_STORAGE_SAMPLES = 2000000;
const DEFAULT_MINIMUM_COHERENT_RATIO = 0.002;
const SYNDROME_TABLE_BITS = BLOCK_BITS / 2;
const SYNDROME_TABLE_SIZE = 1 << SYNDROME_TABLE_BITS;
const SYNDROME_TABLE_MASK = SYNDROME_TABLE_SIZE - 1;

const OFFSET = Object.freeze({
  A: 'A',
  B: 'B',
  C: 'C',
  C_PRIME: 'C_PRIME',
  D: 'D'
});

// IEC 62106 offset syndromes.
const OFFSET_SYNDROMES = Object.freeze({
  [OFFSET.A]: 0b1111011000,
  [OFFSET.B]: 0b1111010100,
  [OFFSET.C]: 0b1001011100,
  [OFFSET.C_PRIME]: 0b1111001100,
  [OFFSET.D]: 0b1001011000
});

// Offset words are used when constructing the short-burst correction table.
const OFFSET_WORDS = Object.freeze({
  [OFFSET.A]: 0b0011111100,
  [OFFSET.B]: 0b0110011000,
  [OFFSET.C]: 0b0101101000,
  [OFFSET.C_PRIME]: 0b1101010000,
  [OFFSET.D]: 0b0110110100
});

const PARITY_CHECK_MATRIX = Object.freeze([
  0b1000000000,
  0b0100000000,
  0b0010000000,
  0b0001000000,
  0b0000100000,
  0b0000010000,
  0b0000001000,
  0b0000000100,
  0b0000000010,
  0b0000000001,
  0b1011011100,
  0b0101101110,
  0b0010110111,
  0b1010000111,
  0b1110011111,
  0b1100010011,
  0b1101010101,
  0b1101110110,
  0b0110111011,
  0b1000000001,
  0b1111011100,
  0b0111101110,
  0b0011110111,
  0b1010100111,
  0b1110001111,
  0b1100011011
]);

function createSyndromeContributionTable(bitOffset) {
  const table = new Uint16Array(SYNDROME_TABLE_SIZE);

  for (let value = 1; value < table.length; value++) {
    const leastSignificantBit = value & -value;
    const bitIndex = 31 - Math.clz32(leastSignificantBit);
    table[value] =
      table[value ^ leastSignificantBit] ^
      PARITY_CHECK_MATRIX[BLOCK_BITS - 1 - bitOffset - bitIndex];
  }

  return table;
}

// The RDS parity operation is linear. Splitting the 26-bit word into two
// 13-bit contribution tables turns the acquisition hot path into two lookups
// and one XOR while preserving the exact syndrome.
const LOW_SYNDROME_CONTRIBUTIONS = createSyndromeContributionTable(0);
const HIGH_SYNDROME_CONTRIBUTIONS =
  createSyndromeContributionTable(SYNDROME_TABLE_BITS);

const SYNDROME_TO_OFFSET = new Map(
  Object.entries(OFFSET_SYNDROMES).map(([offset, syndrome]) => [syndrome, offset])
);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOption(value, fallback, label) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return parsed;
}

function calculateSyndrome(inputVector) {
  const word = Number(inputVector) & BLOCK_MASK;
  return LOW_SYNDROME_CONTRIBUTIONS[word & SYNDROME_TABLE_MASK] ^
    HIGH_SYNDROME_CONTRIBUTIONS[
      (word >>> SYNDROME_TABLE_BITS) & SYNDROME_TABLE_MASK
    ];
}

function offsetForSyndrome(syndrome) {
  return SYNDROME_TO_OFFSET.get(Number(syndrome) & 0x03ff) || null;
}

function offsetForBlock(blockWord) {
  return offsetForSyndrome(calculateSyndrome(blockWord));
}

function blockIndexForOffset(offset) {
  switch (offset) {
    case OFFSET.A: return 0;
    case OFFSET.B: return 1;
    case OFFSET.C:
    case OFFSET.C_PRIME: return 2;
    case OFFSET.D: return 3;
    default: return -1;
  }
}

function nextOffset(offset, blockB = null) {
  switch (offset) {
    case OFFSET.A:
      return OFFSET.B;
    case OFFSET.B:
      if (blockB === null) return null;
      return (blockB & 0x0800) === 0 ? OFFSET.C : OFFSET.C_PRIME;
    case OFFSET.C:
    case OFFSET.C_PRIME:
      return OFFSET.D;
    case OFFSET.D:
      return OFFSET.A;
    default:
      return null;
  }
}

function offsetCanFollow(previous, current) {
  if (previous === OFFSET.A) return current === OFFSET.B;
  if (previous === OFFSET.B) return current === OFFSET.C || current === OFFSET.C_PRIME;
  if (previous === OFFSET.C || previous === OFFSET.C_PRIME) return current === OFFSET.D;
  if (previous === OFFSET.D) return current === OFFSET.A;
  return false;
}

let checkwordForSyndrome;

function getCheckwordTable() {
  if (checkwordForSyndrome) return checkwordForSyndrome;

  checkwordForSyndrome = new Int16Array(1 << CHECK_BITS);
  checkwordForSyndrome.fill(-1);
  for (let checkword = 0; checkword < (1 << CHECK_BITS); checkword++) {
    checkwordForSyndrome[calculateSyndrome(checkword)] = checkword;
  }
  return checkwordForSyndrome;
}

function encodeBlock(data, offset) {
  if (!Number.isInteger(data) || data < 0 || data > 0xffff) {
    throw new RangeError('RDS block data must be an unsigned 16-bit integer');
  }
  if (!Object.hasOwn(OFFSET_SYNDROMES, offset)) {
    throw new RangeError(`Unknown RDS offset ${String(offset)}`);
  }

  const dataWord = data << CHECK_BITS;
  const neededSyndrome = calculateSyndrome(dataWord) ^ OFFSET_SYNDROMES[offset];
  const checkword = getCheckwordTable()[neededSyndrome];
  if (checkword < 0) throw new Error('Unable to construct RDS checkword');
  return (dataWord | checkword) & BLOCK_MASK;
}

let correctionTables;

function getCorrectionTables() {
  if (correctionTables) return correctionTables;

  correctionTables = Object.create(null);
  for (const offset of Object.values(OFFSET)) {
    const table = new Map();

    // Prefer a one-bit correction if two patterns ever share a syndrome.
    for (const [pattern, errorLevel] of [[0b1, 1], [0b11, 2]]) {
      for (let shift = 0; shift < BLOCK_BITS; shift++) {
        const errorVector = (pattern << shift) & BLOCK_MASK;
        if (errorVector === 0) continue;
        const syndrome = calculateSyndrome(errorVector ^ OFFSET_WORDS[offset]);
        if (!table.has(syndrome)) table.set(syndrome, { errorVector, errorLevel });
      }
    }
    correctionTables[offset] = table;
  }

  return correctionTables;
}

function normalizeExpectedOffsets(expectedOffset) {
  if (expectedOffset === null || expectedOffset === undefined) {
    return Object.values(OFFSET);
  }
  if (Array.isArray(expectedOffset)) return expectedOffset;
  return [expectedOffset];
}

function decodeBlock(rawWord, expectedOffset = null) {
  const raw = Number(rawWord) & BLOCK_MASK;
  const syndrome = calculateSyndrome(raw);
  const actualOffset = offsetForSyndrome(syndrome);
  const expectedOffsets = normalizeExpectedOffsets(expectedOffset);

  if (actualOffset && expectedOffsets.includes(actualOffset)) {
    return {
      data: raw >>> CHECK_BITS,
      offset: actualOffset,
      errors: 0,
      raw
    };
  }

  const tables = getCorrectionTables();
  for (const offset of expectedOffsets) {
    if (!Object.hasOwn(OFFSET_SYNDROMES, offset)) continue;
    const correction = tables[offset].get(syndrome);
    if (!correction) continue;

    const correctedRaw = (raw ^ correction.errorVector) & BLOCK_MASK;
    if (offsetForBlock(correctedRaw) !== offset) continue;
    return {
      data: correctedRaw >>> CHECK_BITS,
      offset,
      errors: correction.errorLevel,
      raw: correctedRaw
    };
  }

  return {
    data: null,
    offset: null,
    errors: 3,
    raw
  };
}

function wordToBits(word) {
  const bits = new Array(BLOCK_BITS);
  const raw = Number(word) & BLOCK_MASK;
  for (let index = 0; index < BLOCK_BITS; index++) {
    bits[index] = (raw >>> (BLOCK_BITS - 1 - index)) & 1;
  }
  return bits;
}

class RdsBlockSynchronizer {
  constructor(options = {}) {
    this.lockBlocks = finiteOption(options.lockBlocks, 4, 'lockBlocks');
    this.maxConsecutiveBadBlocks = finiteOption(
      options.maxConsecutiveBadBlocks,
      5,
      'maxConsecutiveBadBlocks'
    );
    if (!Number.isInteger(this.lockBlocks) || this.lockBlocks < 3 || this.lockBlocks > 32) {
      throw new RangeError('lockBlocks must be an integer between 3 and 32');
    }
    if (!Number.isInteger(this.maxConsecutiveBadBlocks) ||
        this.maxConsecutiveBadBlocks < 2 ||
        this.maxConsecutiveBadBlocks > 100) {
      throw new RangeError(
        'maxConsecutiveBadBlocks must be an integer between 2 and 100'
      );
    }
    this.reset();
  }

  reset() {
    this.inputRegister = 0;
    this.bitPosition = 0;
    this.synced = false;
    this.expectedOffset = null;
    this.bitsUntilBlock = 1;
    this.syncPulses = [];
    this.consecutiveBadBlocks = 0;
    this.groupBlocks = [null, null, null, null];
    this.groupErrors = [3, 3, 3, 3];
    this.groupStarted = false;
  }

  pushBit(bit) {
    this.inputRegister = ((this.inputRegister << 1) | (bit ? 1 : 0)) & BLOCK_MASK;
    this.bitPosition++;

    if (!this.synced) return this._scanForSync();

    this.bitsUntilBlock--;
    if (this.bitsUntilBlock > 0) return [];
    this.bitsUntilBlock = BLOCK_BITS;
    return this._consumeSynchronizedBlock();
  }

  _scanForSync() {
    const offset = offsetForBlock(this.inputRegister);
    if (!offset) return [];

    let chainLength = 1;
    for (const pulse of this.syncPulses) {
      if (this.bitPosition - pulse.bitPosition === BLOCK_BITS &&
          offsetCanFollow(pulse.offset, offset)) {
        chainLength = Math.max(chainLength, pulse.chainLength + 1);
      }
    }

    this.syncPulses.push({ offset, bitPosition: this.bitPosition, chainLength });
    const oldestUsefulBit = this.bitPosition - BLOCK_BITS * 2;
    while (this.syncPulses[0]?.bitPosition < oldestUsefulBit) this.syncPulses.shift();

    if (chainLength < this.lockBlocks) return [];

    this.synced = true;
    this.bitsUntilBlock = BLOCK_BITS;
    this.consecutiveBadBlocks = 0;
    this._resetGroup();
    return this._acceptDecodedBlock({
      data: this.inputRegister >>> CHECK_BITS,
      offset,
      errors: 0,
      raw: this.inputRegister
    });
  }

  _consumeSynchronizedBlock() {
    const expectedWasThirdBlock = this.expectedOffset === null;
    const expectedOffsets = expectedWasThirdBlock
      ? [OFFSET.C, OFFSET.C_PRIME]
      : [this.expectedOffset];
    const decoded = decodeBlock(this.inputRegister, expectedOffsets);

    if (decoded.data === null) {
      this.consecutiveBadBlocks++;
    } else {
      this.consecutiveBadBlocks = 0;
    }

    // If B was uncorrectable, C/C' cannot be distinguished. We still know the
    // block position and must advance to D even when this third block is bad.
    const groups = this._acceptDecodedBlock(
      decoded,
      expectedWasThirdBlock ? OFFSET.C : this.expectedOffset
    );
    if (this.consecutiveBadBlocks >= this.maxConsecutiveBadBlocks) {
      this.synced = false;
      this.expectedOffset = null;
      this.bitsUntilBlock = 1;
      this.syncPulses = [];
      this._resetGroup();
    }
    return groups;
  }

  _acceptDecodedBlock(decoded, positionOffset = null) {
    const expected = decoded.offset || positionOffset || this.expectedOffset;
    const blockIndex = blockIndexForOffset(expected);

    if (expected === OFFSET.A) {
      this._resetGroup();
      this.groupStarted = true;
    }

    if (this.groupStarted && blockIndex >= 0) {
      this.groupBlocks[blockIndex] = decoded.data;
      this.groupErrors[blockIndex] = decoded.errors;
    }

    const groups = [];
    if (expected === OFFSET.D) {
      if (this.groupStarted) {
        groups.push({
          blocks: this.groupBlocks.slice(),
          errors: this.groupErrors.slice()
        });
      }
      this._resetGroup();
    }

    if (expected === OFFSET.B) {
      this.expectedOffset = decoded.data === null
        ? null
        : nextOffset(OFFSET.B, decoded.data);
    } else {
      this.expectedOffset = nextOffset(expected);
    }

    return groups;
  }

  _resetGroup() {
    this.groupBlocks = [null, null, null, null];
    this.groupErrors = [3, 3, 3, 3];
    this.groupStarted = false;
  }
}

function scoreOffsetSequence(bits, lockBlocks, bitCount = bits.length) {
  let inputRegister = 0;
  let bitPosition = 0;
  let bestChain = 0;
  const pulses = [];

  for (let bitIndex = 0; bitIndex < bitCount; bitIndex++) {
    const bit = bits[bitIndex];
    inputRegister = ((inputRegister << 1) | (bit ? 1 : 0)) & BLOCK_MASK;
    bitPosition++;
    const offset = offsetForBlock(inputRegister);
    if (!offset) continue;

    let chainLength = 1;
    for (const pulse of pulses) {
      if (bitPosition - pulse.bitPosition === BLOCK_BITS &&
          offsetCanFollow(pulse.offset, offset)) {
        chainLength = Math.max(chainLength, pulse.chainLength + 1);
      }
    }
    pulses.push({ offset, bitPosition, chainLength });
    while (pulses[0]?.bitPosition < bitPosition - BLOCK_BITS * 2) pulses.shift();
    bestChain = Math.max(bestChain, chainLength);
    if (bestChain >= lockBlocks) break;
  }

  return bestChain;
}

function compareTimingCandidates(left, right) {
  return right.chain - left.chain ||
    right.coherentRatio - left.coherentRatio;
}

class RdsDecoder {
  constructor(options = {}) {
    if (typeof options === 'number') options = { sampleRate: options };

    this.sampleRate = finiteOption(options.sampleRate, 240000, 'sampleRate');
    this.bitRate = finiteOption(options.bitRate, RDS_BIT_RATE, 'bitRate');
    this.subcarrierHz = finiteOption(
      options.subcarrierHz,
      RDS_SUBCARRIER_HZ,
      'subcarrierHz'
    );
    this.lockBlocks = finiteOption(options.lockBlocks, 4, 'lockBlocks');
    this.acquisitionBits = finiteOption(
      options.acquisitionBits,
      260,
      'acquisitionBits'
    );
    this.timingProbeFraction = finiteOption(
      options.timingProbeFraction,
      0.06,
      'timingProbeFraction'
    );
    this.timingGain = finiteOption(options.timingGain, 0.35, 'timingGain');
    this.maximumTimingCorrection = finiteOption(
      options.maximumTimingCorrection,
      0.35,
      'maximumTimingCorrection'
    );
    this.acquisitionIntervalMs = finiteOption(
      options.acquisitionIntervalMs,
      250,
      'acquisitionIntervalMs'
    );
    this.maximumAcquisitionIntervalMs = finiteOption(
      options.maximumAcquisitionIntervalMs,
      1000,
      'maximumAcquisitionIntervalMs'
    );
    this.coarsePhaseStep = finiteOption(
      options.coarsePhaseStep,
      4,
      'coarsePhaseStep'
    );
    this.minimumCoherentRatio = finiteOption(
      options.minimumCoherentRatio,
      DEFAULT_MINIMUM_COHERENT_RATIO,
      'minimumCoherentRatio'
    );

    if (this.sampleRate < 128000) {
      throw new RangeError('RDS sample rate must be finite and at least 128000 Hz');
    }
    if (this.bitRate < 100 || this.bitRate > this.sampleRate / 8) {
      throw new RangeError(
        'RDS bit rate must be between 100 Hz and one eighth of the sample rate'
      );
    }
    if (this.subcarrierHz <= 0 ||
        this.subcarrierHz + 3000 >= this.sampleRate / 2) {
      throw new RangeError('RDS subcarrier must leave at least 3 kHz below Nyquist');
    }
    if (!Number.isInteger(this.lockBlocks) ||
        this.lockBlocks < 3 ||
        this.lockBlocks > 32) {
      throw new RangeError('lockBlocks must be an integer between 3 and 32');
    }
    if (!Number.isInteger(this.acquisitionBits) ||
        this.acquisitionBits < this.lockBlocks * BLOCK_BITS + 2 ||
        this.acquisitionBits > 4096) {
      throw new RangeError(
        `acquisitionBits must be an integer between ${
          this.lockBlocks * BLOCK_BITS + 2
        } and 4096`
      );
    }
    if (this.timingProbeFraction <= 0 ||
        this.timingProbeFraction >= 0.2) {
      throw new RangeError('RDS timing probe fraction must be between 0 and 0.2');
    }
    if (this.timingGain < 0 || this.timingGain > 10) {
      throw new RangeError('timingGain must be between 0 and 10');
    }
    if (this.maximumTimingCorrection < 0) {
      throw new RangeError('maximumTimingCorrection must be non-negative');
    }
    if (this.acquisitionIntervalMs < 50 || this.acquisitionIntervalMs > 5000) {
      throw new RangeError('acquisitionIntervalMs must be between 50 and 5000');
    }
    if (this.maximumAcquisitionIntervalMs < this.acquisitionIntervalMs ||
        this.maximumAcquisitionIntervalMs > 10000) {
      throw new RangeError(
        'maximumAcquisitionIntervalMs must be between acquisitionIntervalMs and 10000'
      );
    }
    if (!Number.isInteger(this.coarsePhaseStep) ||
        this.coarsePhaseStep < 1 ||
        this.coarsePhaseStep > 32) {
      throw new RangeError('coarsePhaseStep must be an integer between 1 and 32');
    }
    if (this.minimumCoherentRatio < 0 || this.minimumCoherentRatio > 1) {
      throw new RangeError('minimumCoherentRatio must be between 0 and 1');
    }

    this.samplesPerBit = this.sampleRate / this.bitRate;
    if (this.maximumTimingCorrection >= this.samplesPerBit * 0.1) {
      throw new RangeError(
        'maximumTimingCorrection must be below 10% of the samples per bit'
      );
    }
    this.oscillatorStep = 2 * Math.PI * this.subcarrierHz / this.sampleRate;
    this.oscillatorCosStep = Math.cos(this.oscillatorStep);
    this.oscillatorSinStep = Math.sin(this.oscillatorStep);
    this.requiredAcquisitionSamples = Math.ceil(
      (this.acquisitionBits + 2) * this.samplesPerBit
    );
    this.maximumBufferedSamples = Math.ceil(
      (this.acquisitionBits + 3) * this.samplesPerBit * 2
    );
    if (this.maximumBufferedSamples > MAX_STORAGE_SAMPLES) {
      throw new RangeError(
        `RDS configuration requires more than ${MAX_STORAGE_SAMPLES} buffered samples`
      );
    }
    this.storageCapacity = this.maximumBufferedSamples + 2;
    this.processSliceSamples = Math.max(
      1024,
      Math.floor(this.maximumBufferedSamples / 4)
    );
    this.acquisitionIntervalSamples = Math.max(
      1,
      Math.round(this.sampleRate * this.acquisitionIntervalMs / 1000)
    );
    this.maximumAcquisitionIntervalSamples = Math.max(
      this.acquisitionIntervalSamples,
      Math.round(this.sampleRate * this.maximumAcquisitionIntervalMs / 1000)
    );
    this.prefixI = new Float64Array(this.storageCapacity);
    this.prefixQ = new Float64Array(this.storageCapacity);
    this.prefixPower = new Float64Array(this.storageCapacity);
    this.candidateBits = new Uint8Array(this.acquisitionBits + 1);
    this.correlationScratch = new Float64Array(6);
    this.blockSync = new RdsBlockSynchronizer({ lockBlocks: this.lockBlocks });
    this.reset();
  }

  get synced() {
    return this.timingLocked && this.blockSync.synced;
  }

  reset() {
    this.prefixI.fill(0);
    this.prefixQ.fill(0);
    this.prefixPower.fill(0);
    this.bufferStart = 0;
    this.totalSamples = 0;
    this.cumulativeI = 0;
    this.cumulativeQ = 0;
    this.cumulativePower = 0;
    this.oscillatorCos = 1;
    this.oscillatorSin = 0;
    this.oscillatorSamples = 0;
    this.lastAcquisitionAttemptSample = -Infinity;
    this.acquisitionAttempts = 0;
    this.acquisitionFailures = 0;
    this.currentAcquisitionIntervalSamples = this.acquisitionIntervalSamples;
    this.timingLocked = false;
    this.nextBitStart = 0;
    this.previousSymbolI = 0;
    this.previousSymbolQ = 0;
    this.havePreviousSymbol = false;
    this.filteredTimingError = 0;
    this.blockSync.reset();
  }

  process(mpx) {
    if (!(mpx instanceof Float32Array) && !(mpx instanceof Float64Array)) {
      throw new TypeError(
        'RDS process() expects a Float32Array or Float64Array MPX chunk'
      );
    }
    if (mpx.length === 0) return [];

    const groups = [];
    for (let offset = 0; offset < mpx.length; offset += this.processSliceSamples) {
      const end = Math.min(offset + this.processSliceSamples, mpx.length);
      this._appendMpx(mpx, offset, end);
      groups.push(...this._processAvailableSamples());
    }
    return groups;
  }

  _processAvailableSamples() {
    let groups = [];
    if (!this.timingLocked) {
      groups = this._tryAcquireTiming();
      if (!this.timingLocked) {
        this._trimAcquisitionBuffer();
        return groups;
      }
    }

    groups.push(...this._processLockedBits());
    this._trimLockedBuffer();
    return groups;
  }

  _appendMpx(mpx, start = 0, end = mpx.length) {
    let cos = this.oscillatorCos;
    let sin = this.oscillatorSin;
    let cumulativeI = this.cumulativeI;
    let cumulativeQ = this.cumulativeQ;
    let cumulativePower = this.cumulativePower;
    let totalSamples = this.totalSamples;

    for (let index = start; index < end; index++) {
      const sample = Number.isFinite(mpx[index]) ? mpx[index] : 0;
      cumulativeI += sample * cos;
      cumulativeQ -= sample * sin;
      cumulativePower += sample * sample;
      totalSamples++;
      const storageIndex = totalSamples % this.storageCapacity;
      this.prefixI[storageIndex] = cumulativeI;
      this.prefixQ[storageIndex] = cumulativeQ;
      this.prefixPower[storageIndex] = cumulativePower;

      const nextCos = cos * this.oscillatorCosStep - sin * this.oscillatorSinStep;
      sin = sin * this.oscillatorCosStep + cos * this.oscillatorSinStep;
      cos = nextCos;

      this.oscillatorSamples++;
      if ((this.oscillatorSamples & 0x0fff) === 0) {
        const magnitude = Math.hypot(cos, sin) || 1;
        cos /= magnitude;
        sin /= magnitude;
      }
    }

    this.oscillatorCos = cos;
    this.oscillatorSin = sin;
    this.cumulativeI = cumulativeI;
    this.cumulativeQ = cumulativeQ;
    this.cumulativePower = cumulativePower;
    this.totalSamples = totalSamples;
    this.bufferStart = Math.max(
      this.bufferStart,
      this.totalSamples - (this.storageCapacity - 1)
    );
  }

  _storedPrefix(prefix, sampleBoundary) {
    return prefix[sampleBoundary % this.storageCapacity];
  }

  _prefixAt(prefix, position) {
    const boundedPosition = clamp(position, this.bufferStart, this.totalSamples);
    const whole = Math.floor(boundedPosition);
    const fraction = boundedPosition - whole;
    const current = this._storedPrefix(prefix, whole);
    if (fraction === 0 || whole >= this.totalSamples) return current;
    const next = this._storedPrefix(prefix, whole + 1);
    return current + fraction * (next - current);
  }

  _correlateInto(bitStart, output, outputOffset = 0) {
    const midpoint = bitStart + this.samplesPerBit / 2;
    const bitEnd = bitStart + this.samplesPerBit;
    const iStart = this._prefixAt(this.prefixI, bitStart);
    const iMiddle = this._prefixAt(this.prefixI, midpoint);
    const iEnd = this._prefixAt(this.prefixI, bitEnd);
    const qStart = this._prefixAt(this.prefixQ, bitStart);
    const qMiddle = this._prefixAt(this.prefixQ, midpoint);
    const qEnd = this._prefixAt(this.prefixQ, bitEnd);

    output[outputOffset] = 2 * iMiddle - iStart - iEnd;
    output[outputOffset + 1] = 2 * qMiddle - qStart - qEnd;
  }

  _correlate(bitStart) {
    const result = new Float64Array(2);
    this._correlateInto(bitStart, result);
    return { i: result[0], q: result[1] };
  }

  _meanPower(start, end) {
    const duration = end - start;
    if (duration <= 0) return 0;
    const power = this._prefixAt(this.prefixPower, end) -
      this._prefixAt(this.prefixPower, start);
    return Math.max(0, power / duration);
  }

  _tryAcquireTiming() {
    const availableEnd = this.totalSamples;
    if (availableEnd - this.bufferStart < this.requiredAcquisitionSamples) return [];
    if (availableEnd - this.lastAcquisitionAttemptSample <
        this.currentAcquisitionIntervalSamples) {
      return [];
    }
    this.lastAcquisitionAttemptSample = availableEnd;
    this.acquisitionAttempts++;

    const phaseCount = Math.ceil(this.samplesPerBit);
    const searchStart = Math.max(
      this.bufferStart,
      availableEnd - this.requiredAcquisitionSamples
    );
    const coarseCandidates = [];

    for (let phase = 0; phase < phaseCount; phase += this.coarsePhaseStep) {
      coarseCandidates.push(this._evaluateTimingCandidate(searchStart + phase, phase));
    }
    coarseCandidates.sort(compareTimingCandidates);

    const phasesSeen = new Set(coarseCandidates.map(({ phase }) => phase));
    const candidatesToRefine = coarseCandidates.slice(0, 3);
    for (const candidate of candidatesToRefine) {
      const firstPhase = Math.max(0, candidate.phase - this.coarsePhaseStep + 1);
      const lastPhase = Math.min(
        phaseCount - 1,
        candidate.phase + this.coarsePhaseStep - 1
      );
      for (let phase = firstPhase; phase <= lastPhase; phase++) {
        if (phasesSeen.has(phase)) continue;
        phasesSeen.add(phase);
        coarseCandidates.push(
          this._evaluateTimingCandidate(searchStart + phase, phase)
        );
      }
    }
    coarseCandidates.sort(compareTimingCandidates);
    const best = coarseCandidates[0];

    if (!best ||
        best.chain < this.lockBlocks ||
        best.coherentRatio < this.minimumCoherentRatio) {
      this.acquisitionFailures++;
      if (this.acquisitionFailures >= 2) {
        this.currentAcquisitionIntervalSamples = Math.min(
          this.maximumAcquisitionIntervalSamples,
          this.acquisitionIntervalSamples *
            (2 ** Math.min(3, this.acquisitionFailures - 1))
        );
      }
      return [];
    }

    // Re-evaluate the winning phase so candidateBits contains its exact bit
    // sequence after the coarse/refine scans reused the bounded scratch space.
    const selected = this._evaluateTimingCandidate(best.start, best.phase);

    this.timingLocked = true;
    this.acquisitionFailures = 0;
    this.currentAcquisitionIntervalSamples = this.acquisitionIntervalSamples;
    this.nextBitStart = selected.start + selected.symbolCount * this.samplesPerBit;
    this.previousSymbolI = selected.lastI;
    this.previousSymbolQ = selected.lastQ;
    this.havePreviousSymbol = true;
    this.filteredTimingError = 0;

    const groups = [];
    for (let index = 0; index < selected.bitCount; index++) {
      groups.push(...this.blockSync.pushBit(this.candidateBits[index]));
    }
    return groups;
  }

  _evaluateTimingCandidate(start, phase) {
    const availableBits = Math.floor(
      (this.totalSamples - start) / this.samplesPerBit
    );
    const symbolCount = Math.min(this.acquisitionBits + 1, availableBits);
    if (symbolCount < this.lockBlocks * BLOCK_BITS + 1) {
      return {
        start,
        phase,
        chain: 0,
        coherentRatio: 0,
        symbolCount: 0,
        bitCount: 0,
        lastI: 0,
        lastQ: 0
      };
    }

    const correlation = this.correlationScratch;
    this._correlateInto(start, correlation);
    let previousI = correlation[0];
    let previousQ = correlation[1];
    let lastI = previousI;
    let lastQ = previousQ;
    let energy = previousI * previousI + previousQ * previousQ;
    let bitCount = 0;

    for (let index = 1; index < symbolCount; index++) {
      this._correlateInto(start + index * this.samplesPerBit, correlation);
      const currentI = correlation[0];
      const currentQ = correlation[1];
      this.candidateBits[bitCount++] =
        currentI * previousI + currentQ * previousQ < 0 ? 1 : 0;
      energy += currentI * currentI + currentQ * currentQ;
      previousI = currentI;
      previousQ = currentQ;
      lastI = currentI;
      lastQ = currentQ;
    }

    const meanEnergy = energy / symbolCount;
    const end = start + symbolCount * this.samplesPerBit;
    const meanPower = this._meanPower(start, end);
    const coherentRatio = meanEnergy /
      Math.max(
        Number.EPSILON,
        this.samplesPerBit * this.samplesPerBit * meanPower
      );
    const chain = coherentRatio >= this.minimumCoherentRatio
      ? scoreOffsetSequence(
          this.candidateBits,
          this.lockBlocks,
          bitCount
        )
      : 0;

    return {
      start,
      phase,
      chain,
      coherentRatio,
      symbolCount,
      bitCount,
      lastI,
      lastQ
    };
  }

  _processLockedBits() {
    const groups = [];
    const availableEnd = this.totalSamples;
    const probe = this.samplesPerBit * this.timingProbeFraction;
    const correlation = this.correlationScratch;

    while (this.nextBitStart + this.samplesPerBit + probe <= availableEnd) {
      this._correlateInto(this.nextBitStart, correlation, 0);
      const symbolI = correlation[0];
      const symbolQ = correlation[1];
      if (this.havePreviousSymbol) {
        const dot = symbolI * this.previousSymbolI + symbolQ * this.previousSymbolQ;
        groups.push(...this.blockSync.pushBit(dot < 0 ? 1 : 0));
      }

      this._correlateInto(this.nextBitStart - probe, correlation, 2);
      this._correlateInto(this.nextBitStart + probe, correlation, 4);
      const earlyMagnitude = Math.hypot(correlation[2], correlation[3]);
      const lateMagnitude = Math.hypot(correlation[4], correlation[5]);
      const timingError = (lateMagnitude - earlyMagnitude) /
        Math.max(Number.EPSILON, lateMagnitude + earlyMagnitude);
      this.filteredTimingError = 0.9 * this.filteredTimingError + 0.1 * timingError;
      const correction = clamp(
        this.filteredTimingError * this.timingGain,
        -this.maximumTimingCorrection,
        this.maximumTimingCorrection
      );

      this.previousSymbolI = symbolI;
      this.previousSymbolQ = symbolQ;
      this.havePreviousSymbol = true;
      this.nextBitStart += this.samplesPerBit + correction;
    }

    return groups;
  }

  _dropSamples(count) {
    const available = this.totalSamples - this.bufferStart;
    const drop = clamp(Math.floor(count), 0, available);
    if (!Number.isFinite(drop) || drop <= 0) return;
    this.bufferStart += drop;
  }

  _trimAcquisitionBuffer() {
    const available = this.totalSamples - this.bufferStart;
    if (available > this.maximumBufferedSamples) {
      this._dropSamples(available - this.maximumBufferedSamples);
    }
  }

  _trimLockedBuffer() {
    const available = this.totalSamples - this.bufferStart;
    if (available < this.sampleRate / 2) return;
    const keepFrom = this.nextBitStart - this.samplesPerBit * 3;
    this._dropSamples(keepFrom - this.bufferStart);
  }
}

module.exports = {
  RDS_BIT_RATE,
  RDS_SUBCARRIER_HZ,
  BLOCK_BITS,
  OFFSET,
  OFFSET_SYNDROMES,
  PARITY_CHECK_MATRIX,
  calculateSyndrome,
  offsetForSyndrome,
  offsetForBlock,
  blockIndexForOffset,
  nextOffset,
  encodeBlock,
  decodeBlock,
  wordToBits,
  RdsBlockSynchronizer,
  RdsDecoder
};
