'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('reconnects a silent open socket without waiting for close and stops its watchdog', async () => {
    let now = 0, click;
    const intervals = new Set(), timers = new Set(), sockets = [];
    const nodes = new Map();
    class Socket {
        static OPEN = 1;
        constructor() { this.readyState = 1; sockets.push(this); }
        close() { this.readyState = 2; } // Simulate a stuck close handshake.
    }
    class Decoder {
        static async isConfigSupported() { return { supported: true }; }
        configure() { this.state = 'configured'; }
        decode() {}
        close() { this.state = 'closed'; }
    }
    const button = { setAttribute() {}, querySelector() {}, addEventListener(_, fn) { click = fn; } };
    const context = vm.createContext({
        console: { warn() {}, error() {} },
        window: { AudioDecoder: Decoder, EncodedAudioChunk: class {} },
        AudioDecoder: Decoder, EncodedAudioChunk: class {}, WebSocket: Socket,
        location: { protocol: 'https:', host: 'example.test' }, performance: { now: () => now },
        setInterval(fn) { intervals.add(fn); return fn; }, clearInterval(fn) { intervals.delete(fn); },
        setTimeout(fn) { timers.add(fn); return fn; }, clearTimeout(fn) { timers.delete(fn); },
        document: {
            querySelectorAll: () => [button], addEventListener: (_, fn) => fn(),
            getElementById(id) { if (!nodes.has(id)) nodes.set(id, { value: 1, addEventListener() {} }); return nodes.get(id); }
        },
        AudioContext: class {
            constructor() { this.sampleRate = 48000; this.audioWorklet = { addModule: async () => {} }; }
            async resume() {} async close() {}
            createGain() { return { gain: {}, connect() {} }; }
        },
        AudioWorkletNode: class { constructor() { this.port = { postMessage() {} }; } connect(gain) { return gain; } },
        alert(message) { throw new Error(message); }
    });
    vm.runInContext(fs.readFileSync(require.resolve('../web/js/opus-player.js'), 'utf8'), context);
    await click();
    assert.ok(context.window.fmdxAudio.getOutput().node);
    await sockets[0].onmessage({ data: JSON.stringify({ type: 'format', codec: 'opus', channels: 2 }) });
    now = 4000;
    await sockets[0].onmessage({ data: new ArrayBuffer(10) });
    now = 8000;
    for (const fn of [...intervals]) fn();
    assert.equal(timers.size, 0, 'recent audio prevents a reconnect');
    now = 9000;
    for (const fn of [...intervals]) fn();
    assert.equal(nodes.get('opus-state').textContent, 'Reconnecting');
    assert.equal(timers.size, 1);
    for (const fn of [...timers]) { timers.delete(fn); fn(); }
    assert.equal(sockets.length, 2);
    await click();
    assert.equal(context.window.fmdxAudio.getOutput(), null);
    assert.equal(intervals.size, 0);
    assert.equal(timers.size, 0);
});
