'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLinuxOpusPipeline } = require('../server/stream/opus_pipeline');

test('preserves configured ALSA timing and sends 20 ms Opus pages', () => {
    const pipeline = buildLinuxOpusPipeline({ audioDevice: 'hw:Tuner', audioChannels: '2', alsaLatencyProfile: 'stable', samplerateOffset: '0', audioBitrate: '256k' });
    assert.equal(pipeline.captureArgs[1], 'hw:Tuner');
    assert.equal(pipeline.captureArgs[pipeline.captureArgs.indexOf('--buffer-time') + 1], '80000');
    assert.equal(pipeline.encoderArgs[pipeline.encoderArgs.indexOf('-page_duration') + 1], '20000');
    assert.equal(pipeline.encoderArgs[pipeline.encoderArgs.indexOf('-c:a') + 1], 'libopus');
    assert.equal(pipeline.encoderArgs[pipeline.encoderArgs.indexOf('-b:a') + 1], '256k');
});

test('honors compatibility mode and rejects invalid channel values', () => {
    const pipeline = buildLinuxOpusPipeline({ audioDevice: 'hw:Tuner', audioChannels: '1', softwareMode: true });
    assert.equal(pipeline.captureArgs[1], 'plughw:Tuner');
    assert.throws(() => buildLinuxOpusPipeline({ audioDevice: 'hw:Tuner', audioChannels: '0' }), /channels/);
});
