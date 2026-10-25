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

test('decoded audio waits when the scheduled buffer reaches its target', () => {
    const originalWindow = global.window;
    global.window = {
        clearTimeout() {},
        setTimeout() { return 1; }
    };

    try {
        const fallback = Object.create(Fallback.prototype);
        const samples = [{ duration: 0.05 }, { duration: 0.05 }];
        fallback.FormatReader = {
            SamplesAvailable() { return samples.length > 0; },
            PopSamples() { return samples.shift(); }
        };
        fallback.PendingSamples = [];
        fallback.PendingSamplesDuration = 0;
        fallback.SamplePumpTimer = 0;
        let scheduled = 0;
        fallback.Player = {
            CanScheduleBuffer() { return scheduled === 0; },
            PushBuffer() { scheduled++; }
        };

        fallback.OnReaderDataReady();

        assert.equal(scheduled, 1);
        assert.equal(fallback.PendingSamples.length, 1);
        assert.equal(Math.round(fallback.PendingSamplesDuration * 1000), 50);
        assert.equal(fallback.SamplePumpTimer, 1);
    } finally {
        global.window = originalWindow;
    }
});
