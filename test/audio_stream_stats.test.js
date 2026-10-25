'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Fallback } = require('../web/js/3las/fallback/3las.fallback');

test('packet timing uses a rolling median and ignores a single timing outlier', () => {
    const fallback = Object.create(Fallback.prototype);
    fallback.PacketIntervals = new Array(119).fill(48);
    fallback.PacketIntervals.push(500);

    const timing = fallback.GetPacketTiming();

    assert.equal(timing.IntervalMs, 48);
    assert.equal(timing.JitterMs, 0);
});
