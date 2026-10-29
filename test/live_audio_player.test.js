'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LiveAudioPlayer = require('../web/js/3las/fallback/3las.liveaudioplayer');

function createAudioContext() {
    return {
        currentTime: 0,
        destination: {},
        createGain() {
            return {
                gain: {
                    value: 1,
                    cancelScheduledValues() {},
                    exponentialRampToValueAtTime() {}
                },
                connect() {}
            };
        },
        createBufferSource() {
            return {
                playbackRate: { value: 1 },
                connect() {},
                disconnect() {},
                start() {}
            };
        }
    };
}

const logger = { Log() {} };
const decodedBuffer = { duration: 0.048 };

test('keeps learned protection through a few quiet minutes', () => {
    const player = new LiveAudioPlayer(createAudioContext(), logger, 1, 0.2, false);
    player.TargetBufferLength = 0.35;
    player.LastUnderrunTime = Date.now() - 180000;
    player.LastBufferAdjustmentTime = player.LastUnderrunTime;
    player.UpdateAdaptiveBufferTarget();
    assert.equal(player.TargetBufferLength, 0.35);
});

test('starts with a 200 ms adaptive audio target', () => {
    const audio = createAudioContext();
    const player = new LiveAudioPlayer(audio, logger, 1, 0.2, false);

    player.PushBuffer(decodedBuffer);

    assert.equal(player.GetStats().TargetBufferMs, 200);
    assert.equal(player.GetStats().Underruns, 0);
});

test('raises the target after an underrun and refills before resuming', () => {
    const audio = createAudioContext();
    const player = new LiveAudioPlayer(audio, logger, 1, 0.2, false);
    player.PushBuffer(decodedBuffer);
    audio.currentTime = player.NextScheduleTime + 0.001;

    player.PushBuffer(decodedBuffer);

    const stats = player.GetStats();
    assert.equal(stats.TargetBufferMs, 250);
    assert.equal(stats.Underruns, 1);
    assert.ok(stats.ScheduledBufferMs >= 250);
});

test('reduces an elevated target after five stable minutes', () => {
    const audio = createAudioContext();
    const player = new LiveAudioPlayer(audio, logger, 1, 0.2, false);
    player.TargetBufferLength = 0.3;
    player.NextScheduleTime = 0.3;
    player.LastUnderrunTime = Date.now() - LiveAudioPlayer.StablePeriodMs - 1;
    player.LastBufferAdjustmentTime = player.LastUnderrunTime;

    player.PushBuffer(decodedBuffer);

    assert.equal(Math.round(player.GetStats().TargetBufferMs), 250);
    assert.ok(player.GetStats().PlaybackSpeed > 1);
});

test('preserves the learned target across an automatic stream restart', () => {
    const audio = createAudioContext();
    const player = new LiveAudioPlayer(audio, logger, 1, 0.2, false);
    player.TargetBufferLength = 0.35;

    player.Reset();

    assert.equal(Math.round(player.GetStats().TargetBufferMs), 350);
    assert.equal(player.GetStats().Underruns, 0);
});
