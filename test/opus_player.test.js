'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('reconnects a silent open socket without waiting for close and stops its watchdog', async () => {
    let now = 0, click;
    const intervals = new Set(), timers = new Set(), sockets = [];
    const nodes = new Map();
    const tracks = [], connections = [], disconnections = [], events = [];
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
            createMediaStreamDestination() {
                const track = { stopped: false, stop() { this.stopped = true; } };
                tracks.push(track);
                return { stream: { getTracks: () => [track] } };
            }
        },
        AudioWorkletNode: class {
            constructor() { this.port = { postMessage() {} }; }
            connect(node) { connections.push(node); return node; }
            disconnect(node) { disconnections.push(node); }
        },
        alert(message) { throw new Error(message); }
    });
    vm.runInContext(fs.readFileSync(require.resolve('../web/js/opus-player.js'), 'utf8'), context);
    const api = context.window.fmdxAudio;
    const unsubscribe = api.subscribe(event => events.push(event));
    api.subscribe(() => { throw new Error('broken plugin must not break audio'); });
    const [tap1, tap2] = await Promise.all([api.createStream(), api.createStream()]);
    assert.equal(sockets.length, 1, 'plugins share one connection and startup');
    assert.equal(connections.length, 3, 'worklet feeds playback and two pre-volume taps');
    tap1.release(); tap1.release();
    assert.equal(disconnections.length, 1, 'release affects only that tap');
    assert.equal(tracks[0].stopped, true);
    assert.equal(tracks[1].stopped, false);
    assert.ok(context.window.fmdxAudio.getOutput().node);
    await sockets[0].onmessage({ data: JSON.stringify({ type: 'format', codec: 'opus', channels: 2 }) });
    await sockets[0].onmessage({ data: JSON.stringify({ type: 'levels', channels: [{ peakDb: -6, rmsDb: -9 }] }) });
    assert.equal(context.window.fmdxAudio.getInputLevels().channels[0].peakDb, -6);
    assert.equal(events.filter(event => event.type === 'levels').length, 1);
    now = 4000;
    assert.equal(context.window.fmdxAudio.getInputLevels(), null, 'stale input readings expire');
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
    assert.equal(tracks[1].stopped, false, 'tap survives network reconnect');
    await click();
    assert.equal(context.window.fmdxAudio.getOutput(), null);
    assert.equal(tracks[1].stopped, true);
    assert.equal(events.at(-1).state, 'stopped');
    unsubscribe(); tap2.release();
    assert.equal(intervals.size, 0);
    assert.equal(timers.size, 0);
});
