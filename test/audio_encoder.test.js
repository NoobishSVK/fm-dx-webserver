'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getAudioFilterArguments } = require('../server/stream/audio_encoder');

test('enables the shared audio boost filter once', () => {
    assert.deepEqual(getAudioFilterArguments(true), ['-af', 'volume=1.7']);
    assert.deepEqual(getAudioFilterArguments(false), []);
});
