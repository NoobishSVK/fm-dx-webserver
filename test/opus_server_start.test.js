'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const { OpusServer } = require('../server/stream/opus_server');

test('uses the resolved bundled encoder path', async () => {
    const commands = [];
    const spawn = command => {
        commands.push(command);
        const child = new EventEmitter();
        child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
        child.kill = () => {};
        return child;
    };
    const server = new OpusServer({ audioDevice: 'test', audioChannels: 2 }, { info() {} }, spawn, async () => '/bundled/ffmpeg');
    try {
        await server.start();
        assert.deepEqual(commands, ['arecord', '/bundled/ffmpeg']);
    } finally { server.stop(); }
});

test('stop during executable resolution prevents capture from launching', async () => {
    let resolve;
    const server = new OpusServer({}, console, () => assert.fail('must not spawn'), () => new Promise(r => { resolve = r; }));
    const starting = server.start();
    server.stop();
    resolve('/bundled/ffmpeg');
    await starting;
});
