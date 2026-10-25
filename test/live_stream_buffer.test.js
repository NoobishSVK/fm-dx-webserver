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

test('allows approximately one second of client backlog', () => {
    assert.equal(getMaxClientBufferBytes('320k'), 40000);
});

test('uses a minimum buffer for lower audio bitrates', () => {
    assert.equal(getMaxClientBufferBytes('64k'), 16384);
});

test('detects an existing client backlog above the limit', () => {
    assert.equal(hasExceededClientBuffer(17000, 16384), true);
    assert.equal(hasExceededClientBuffer(12000, 16384), false);
});
