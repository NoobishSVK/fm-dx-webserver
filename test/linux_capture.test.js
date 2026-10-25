'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildArecordArgs,
    containsAlsaSetupError,
    containsAlsaXrun,
    getAlsaFallbackProfile,
    resolveAlsaLatencyProfile
} = require('../server/stream/linux_capture');

test('uses the low-latency profile by default', () => {
    assert.deepEqual(resolveAlsaLatencyProfile(), {
        name: 'low',
        bufferTime: 40000,
        periodTime: 10000
    });
});

test('falls back to the default for an unknown profile', () => {
    assert.equal(resolveAlsaLatencyProfile('unknown').name, 'low');
});

test('builds arecord arguments with explicit ALSA timing', () => {
    const command = buildArecordArgs('hw:1,0', 2, 'experimental');

    assert.deepEqual(command.args, [
        '-D', 'hw:1,0',
        '-f', 'S16_LE',
        '-r', '48000',
        '-c', '2',
        '-t', 'raw',
        '--buffer-time', '20000',
        '--period-time', '5000'
    ]);
});

test('steps down through safer profiles', () => {
    assert.equal(getAlsaFallbackProfile('experimental'), 'low');
    assert.equal(getAlsaFallbackProfile('low'), 'stable');
    assert.equal(getAlsaFallbackProfile('stable'), 'system');
    assert.equal(getAlsaFallbackProfile('system'), null);
});

test('system profile preserves the previous arecord defaults', () => {
    const command = buildArecordArgs('default', 1, 'system');

    assert.equal(command.args.includes('--buffer-time'), false);
    assert.equal(command.args.includes('--period-time'), false);
});

test('recognizes ALSA overrun messages', () => {
    assert.equal(containsAlsaXrun('overrun!!! (at least 12.3 ms long)'), true);
    assert.equal(containsAlsaXrun('ALSA xrun detected'), true);
    assert.equal(containsAlsaXrun('Recording WAVE stdin'), false);
});

test('recognizes rejected ALSA timing parameters', () => {
    assert.equal(containsAlsaSetupError('Unable to set hw params for PLAYBACK: Invalid argument'), true);
    assert.equal(containsAlsaSetupError('cannot set period time 5000 for capture'), true);
    assert.equal(containsAlsaSetupError('Recording WAVE stdin'), false);
});
