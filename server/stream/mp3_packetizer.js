'use strict';

const MPEG1_LAYER3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_LAYER3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const MPEG1_SAMPLE_RATES = [44100, 48000, 32000];

function getMp3FrameLength(buffer, offset = 0) {
    if (buffer.length - offset < 4) return 0;

    const byte1 = buffer[offset];
    const byte2 = buffer[offset + 1];
    const byte3 = buffer[offset + 2];

    if (byte1 !== 0xff || (byte2 & 0xe0) !== 0xe0) return 0;

    const versionBits = (byte2 >> 3) & 0x03;
    const layerBits = (byte2 >> 1) & 0x03;
    const bitrateIndex = (byte3 >> 4) & 0x0f;
    const sampleRateIndex = (byte3 >> 2) & 0x03;
    const padding = (byte3 >> 1) & 0x01;

    if (versionBits === 1 || layerBits !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
        return 0;
    }

    const isMpeg1 = versionBits === 3;
    const bitrateTable = isMpeg1 ? MPEG1_LAYER3_BITRATES : MPEG2_LAYER3_BITRATES;
    const bitrate = bitrateTable[bitrateIndex];
    const sampleRateDivisor = isMpeg1 ? 1 : versionBits === 2 ? 2 : 4;
    const sampleRate = MPEG1_SAMPLE_RATES[sampleRateIndex] / sampleRateDivisor;
    const coefficient = isMpeg1 ? 144000 : 72000;

    return Math.floor((coefficient * bitrate) / sampleRate) + padding;
}

class Mp3Packetizer {
    constructor(framesPerPacket = 2) {
        if (!Number.isInteger(framesPerPacket) || framesPerPacket < 1) {
            throw new Error('framesPerPacket must be a positive integer.');
        }
        this.FramesPerPacket = framesPerPacket;
        this.Buffer = Buffer.alloc(0);
        this.PendingFrames = [];
    }

    Push(chunk) {
        if (!Buffer.isBuffer(chunk) || chunk.length === 0) return [];

        this.Buffer = Buffer.concat([this.Buffer, chunk]);
        const packets = [];

        while (this.Buffer.length >= 4) {
            let frameStart = -1;
            let frameLength = 0;

            for (let offset = 0; offset <= this.Buffer.length - 4; offset++) {
                frameLength = getMp3FrameLength(this.Buffer, offset);
                if (frameLength > 0) {
                    frameStart = offset;
                    break;
                }
            }

            if (frameStart === -1) {
                this.Buffer = this.Buffer.subarray(Math.max(0, this.Buffer.length - 3));
                break;
            }

            if (frameStart > 0) this.Buffer = this.Buffer.subarray(frameStart);
            if (this.Buffer.length < frameLength) break;

            this.PendingFrames.push(this.Buffer.subarray(0, frameLength));
            this.Buffer = this.Buffer.subarray(frameLength);

            if (this.PendingFrames.length === this.FramesPerPacket) {
                packets.push(Buffer.concat(this.PendingFrames));
                this.PendingFrames = [];
            }
        }

        return packets;
    }
}

module.exports = { Mp3Packetizer, getMp3FrameLength };
