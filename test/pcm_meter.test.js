'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PcmMeter } = require('../server/stream/pcm_meter');

test('measures independent digital channels across arbitrary pipe boundaries', () => {
    const meter = new PcmMeter(2);
    const pcm = Buffer.alloc(4800 * 4);
    for (let i = 0; i < 4800; i++) {
        pcm.writeInt16LE(i % 2 ? -16384 : 16384, i * 4);
        pcm.writeInt16LE(8192, i * 4 + 2);
    }
    const readings = [];
    for (let i = 0; i < pcm.length; i += 137) readings.push(...meter.push(pcm.subarray(i, i + 137)));
    assert.equal(readings.length, 1);
    const [left, right] = readings[0].channels;
    assert.ok(Math.abs(left.peakDb + 6.0206) < 0.0001);
    assert.ok(Math.abs(right.peakDb + 12.0412) < 0.0001);
    assert.equal(left.rmsDb, left.peakDb);
    assert.equal(left.fullScale, false);
});

test('preserves polarity peaks and resets full-scale readings for silence', () => {
    const meter = new PcmMeter(1);
    const pcm = Buffer.alloc(9600);
    pcm.writeInt16LE(-32768, 0);
    const [reading] = meter.push(pcm);
    assert.equal(reading.channels[0].peakDb, 0);
    assert.equal(reading.channels[0].fullScale, true);
    assert.ok(reading.channels[0].rmsDb < -30);
    const [silent] = meter.push(Buffer.alloc(9600));
    assert.deepEqual(silent.channels[0], { peakDb: null, rmsDb: null, fullScale: false });
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(silent)));
});
