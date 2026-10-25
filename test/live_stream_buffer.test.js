'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    bitrateToBytesPerSecond,
    getMaxClientBufferBytes,
    hasExceededClientBuffer
} = require('../server/stream/live_stream_buffer');

test('converts configured audio bitrates to bytes per second', () => {
    assert.equal(bitrateToBytesPerSecond('128k'), 16000);
    assert.equal(bitrateToBytesPerSecond('1m'), 125000);
});

test('allows approximately one quarter second of client backlog', () => {
    assert.equal(getMaxClientBufferBytes('128k'), 4096);
    assert.equal(getMaxClientBufferBytes('320k'), 10000);
});

test('uses a minimum buffer for lower audio bitrates', () => {
    assert.equal(getMaxClientBufferBytes('64k'), 4096);
});

test('detects an existing client backlog above the limit', () => {
    assert.equal(hasExceededClientBuffer(5000, 4096), true);
    assert.equal(hasExceededClientBuffer(4000, 4096), false);
});
