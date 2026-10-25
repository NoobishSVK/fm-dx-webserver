'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Mp3Packetizer, getMp3FrameLength } = require('../server/stream/mp3_packetizer');

function createMpeg1Layer3Frame(fillByte) {
    const frame = Buffer.alloc(384, fillByte);
    frame.set([0xff, 0xfb, 0x94, 0x00], 0); // 128 kbps, 48 kHz, no padding
    return frame;
}

test('calculates MPEG-1 Layer III frame length', () => {
    assert.equal(getMp3FrameLength(createMpeg1Layer3Frame(0)), 384);
});

test('emits complete two-frame packets from split chunks', () => {
    const packetizer = new Mp3Packetizer(2);
    const firstFrame = createMpeg1Layer3Frame(0x11);
    const secondFrame = createMpeg1Layer3Frame(0x22);
    const stream = Buffer.concat([firstFrame, secondFrame]);

    assert.deepEqual(packetizer.Push(stream.subarray(0, 137)), []);
    const packets = packetizer.Push(stream.subarray(137));

    assert.equal(packets.length, 1);
    assert.deepEqual(packets[0], stream);
});

test('resynchronizes after bytes before the first MP3 frame', () => {
    const packetizer = new Mp3Packetizer(2);
    const expected = Buffer.concat([
        createMpeg1Layer3Frame(0x33),
        createMpeg1Layer3Frame(0x44)
    ]);

    const packets = packetizer.Push(Buffer.concat([Buffer.from([1, 2, 3, 4, 5]), expected]));

    assert.equal(packets.length, 1);
    assert.deepEqual(packets[0], expected);
});
