'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    AlsaStderrParser,
    DEFAULT_CAPTURE_STALL_TIMEOUT_MS,
    buildArecordArgs,
    containsAlsaSetupError,
    containsAlsaXrun,
    getAlsaCaptureDevice,
    getAlsaFallbackProfile,
    hasAudioCaptureStalled,
    parseArecordDeviceList,
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

test('discovers every ALSA capture PCM endpoint', () => {
    const output = `**** List of CAPTURE Hardware Devices ****
card 1: Device [USB PnP Sound Device], device 0: USB Audio [USB Audio]
  Subdevices: 1/1
card 2: Interface [Multi Input Interface], device 0: USB Audio [USB Audio]
card 2: Interface [Multi Input Interface], device 1: USB Audio [USB Audio]
card 2: Interface [Multi Input Interface], device 1: USB Audio [USB Audio]`;

    assert.deepEqual(parseArecordDeviceList(output), [
        { name: 'hw:Device,0' },
        { name: 'hw:Interface,0' },
        { name: 'hw:Interface,1' }
    ]);
});

test('software mode only converts direct hardware devices', () => {
    assert.equal(getAlsaCaptureDevice('hw:Device,0', true), 'plughw:Device,0');
    assert.equal(getAlsaCaptureDevice('plughw:Device,0', true), 'plughw:Device,0');
    assert.equal(getAlsaCaptureDevice('default', true), 'default');
    assert.equal(getAlsaCaptureDevice('sysdefault:CARD=Device', true), 'sysdefault:CARD=Device');
    assert.equal(getAlsaCaptureDevice('hw:Device,0', false), 'hw:Device,0');
});

test('recognizes ALSA overrun messages', () => {
    assert.equal(containsAlsaXrun('overrun!!! (at least 12.3 ms long)'), true);
    assert.equal(containsAlsaXrun('ALSA xrun detected'), true);
    assert.equal(containsAlsaXrun('Recording WAVE stdin'), false);
});

test('recognizes rejected ALSA timing parameters', () => {
    assert.equal(containsAlsaSetupError('Unable to set hw params for PLAYBACK: Invalid argument'), true);
    assert.equal(containsAlsaSetupError('Unable to install hw params:'), true);
    assert.equal(containsAlsaSetupError('cannot set period time 5000 for capture'), true);
    assert.equal(containsAlsaSetupError('buffer time 20000 not available'), true);
    assert.equal(containsAlsaSetupError('Recording WAVE stdin'), false);
});

test('reassembles ALSA stderr lines split across chunks', () => {
    const parser = new AlsaStderrParser();

    assert.deepEqual(parser.Push('Unable to install hw pa'), []);
    assert.deepEqual(parser.Push('rams:\nALSA xrun detected\npartial'), [
        'Unable to install hw params:',
        'ALSA xrun detected'
    ]);
    assert.deepEqual(parser.Flush(), ['partial']);
});

test('detects a stalled audio capture after the timeout', () => {
    assert.equal(hasAudioCaptureStalled(1000, 1000 + DEFAULT_CAPTURE_STALL_TIMEOUT_MS - 1), false);
    assert.equal(hasAudioCaptureStalled(1000, 1000 + DEFAULT_CAPTURE_STALL_TIMEOUT_MS), true);
});
