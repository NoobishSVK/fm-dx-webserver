'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SharedAudioRecording } = require('../web/js/audio-recorder');

test('records shared audio, survives reconnect, and includes final chunk on playback stop', async () => {
    let listener, releases = 0, result;
    const stream = {};
    const api = {
        async createStream() { return { stream, release() { releases++; } }; },
        subscribe(fn) { listener = fn; return () => { listener = null; }; }
    };
    class Recorder {
        static isTypeSupported(type) { return type === 'audio/ogg;codecs=opus'; }
        constructor(input, options) { assert.equal(input, stream); this.mimeType = options.mimeType; }
        start() { this.state = 'recording'; this.ondataavailable({ data: new Blob(['first']) }); }
        stop() {
            this.state = 'inactive';
            this.ondataavailable({ data: new Blob(['last']) });
            this.onstop();
        }
    }
    const recording = new SharedAudioRecording(api, Recorder, (blob, extension) => { result = { blob, extension }; }, assert.fail);
    await recording.start();
    listener({ type: 'state', state: 'reconnecting' });
    assert.equal(recording.recorder.state, 'recording');
    listener({ type: 'state', state: 'stopped' });
    assert.equal(await result.blob.text(), 'firstlast');
    assert.equal(result.extension, 'ogg');
    assert.equal(result.blob.type, 'audio/ogg;codecs=opus');
    assert.equal(releases, 1);
    assert.equal(listener, null);
    await recording.start();
    recording.stop();
    assert.equal(releases, 2, 'another recording can start after completion');
});

test('releases the tap when MediaRecorder construction fails', async () => {
    let released = false;
    const api = { async createStream() { return { stream: {}, release() { released = true; } }; } };
    class Recorder {
        static isTypeSupported() { return true; }
        constructor() { throw new Error('encoder unavailable'); }
    }
    const recording = new SharedAudioRecording(api, Recorder, assert.fail, assert.fail);
    await assert.rejects(recording.start(), /encoder unavailable/);
    assert.equal(released, true);
});

test('unsupported browsers fail before opening audio', async () => {
    const recording = new SharedAudioRecording({ createStream: assert.fail }, undefined, assert.fail, assert.fail);
    await assert.rejects(recording.start(), /does not support/);
});
