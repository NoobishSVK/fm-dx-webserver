'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const WebSocket = require('ws');
const { OpusServer } = require('../server/stream/opus_server');

test('encodes a generated live source and streams Opus packets over WebSocket', { timeout: 10000 }, async t => {
    if (spawnSync('ffmpeg', ['-version']).error) return t.skip('FFmpeg unavailable');
    const fakeCapture = (command, args, options) => command === 'arecord'
        ? spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000', '-ac', '2', '-f', 's16le', 'pipe:1'], options)
        : spawn(command, args, options);
    const errors = [];
    const stream = new OpusServer({ audioDevice: 'test', audioChannels: '2' }, { info() {}, warn(message) { errors.push(message); }, error(message) { errors.push(message); } }, fakeCapture);
    const server = http.createServer();
    server.on('upgrade', (req, socket, head) => stream.upgrade(req, socket, head));
    try { await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve)); }
    catch (error) { if (error.code === 'EPERM') return t.skip('Loopback listening is restricted'); throw error; }
    t.after(() => { stream.stop(); server.close(); });
    stream.start();
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/audio`);
    t.after(() => socket.terminate());
    const packets = [];
    let format;
    await new Promise((resolve, reject) => {
        socket.on('error', reject);
        socket.on('message', (data, binary) => {
            if (!binary) format = JSON.parse(data.toString());
            else { packets.push(data); if (packets.length >= 5) resolve(); }
        });
    });
    assert.equal(format.codec, 'opus');
    assert.equal(format.channels, 2);
    assert.ok(packets.every(packet => packet.length > 0));
    assert.equal(errors.some(message => message.includes('restarting')), false, errors.join('\n'));

    const disconnected = new Promise(resolve => socket.once('close', resolve));
    stream.capture.kill('SIGKILL');
    await disconnected;
    const replacement = new WebSocket(`ws://127.0.0.1:${server.address().port}/audio`);
    t.after(() => replacement.terminate());
    await new Promise((resolve, reject) => {
        replacement.on('error', reject);
        replacement.on('message', (_data, binary) => { if (binary) resolve(); });
    });
    assert.ok(errors.some(message => message.includes('restarting')));
});
