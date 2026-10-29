'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness() {
    let now = 10000;
    let id = 0;
    const intervals = new Map();
    const timeouts = new Map();
    let connections = 0;
    const context = vm.createContext({
        console: { log() {} }, window: { location: { protocol: 'http:', pathname: '/' } },
        performance: { now: () => now }, isAndroid: false, Stream: true,
        shouldReconnect: true, requiresAudioStreamRestart: false,
        setInterval: fn => { intervals.set(++id, fn); return id; },
        clearInterval: key => intervals.delete(key),
        setTimeout: fn => { timeouts.set(++id, fn); return id; },
        clearTimeout: key => timeouts.delete(key),
        WebSocketClient: function () { connections++; this.Close = () => {}; this.OnClose = () => {}; }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/js/3las/3las.js'), 'utf8'), context);
    const player = Object.create(context._3LAS.prototype);
    player.Logger = { Log() {} };
    player.Settings = { SocketHost: 'localhost', SocketPort: 8080 };
    player.Fallback = { OnSocketDisconnect() {}, Stop() {}, Reset() {} };
    return { player, context, intervals, timeouts, advance: ms => { now += ms; }, connections: () => connections };
}

test('repeated starts keep only one watchdog and Stop cancels pending reconnects', () => {
    const h = harness();
    h.player.Start();
    h.player.Start();
    assert.equal(h.intervals.size, 1);
    h.advance(3000);
    h.intervals.get(h.player.ReconnectWatchdog)();
    assert.equal(h.timeouts.size, 1);
    h.player.Stop();
    assert.equal(h.intervals.size, 0);
    assert.equal(h.timeouts.size, 0);
});

test('audio recovering during the grace period cancels the restart', () => {
    const h = harness();
    h.player.Start();
    h.advance(3000);
    h.intervals.get(h.player.ReconnectWatchdog)();
    h.context.window.startTimeConnectionWatchdog = h.context.performance.now();
    h.advance(1000);
    h.timeouts.get(h.player.ReconnectTimer)();
    assert.equal(h.connections(), 1);
});

test('radio data recovery does not restart healthy audio', () => {
    const h = harness();
    h.player.Start();
    h.context.requiresAudioStreamRestart = true;
    h.advance(3000);
    h.context.window.startTimeConnectionWatchdog = h.context.performance.now();
    for (const callback of h.intervals.values()) callback();
    assert.equal(h.connections(), 1);
    assert.equal(h.timeouts.size, 0);
});

test('a sustained audio stall still restarts the stream', () => {
    const h = harness();
    h.player.Start();
    h.advance(3000);
    h.intervals.get(h.player.ReconnectWatchdog)();
    h.advance(2000);
    h.timeouts.get(h.player.ReconnectTimer)();
    assert.equal(h.connections(), 2);
    assert.equal(h.intervals.size, 1);
});

test('a closed socket reconnects without waiting for the decode watchdog', () => {
    const h = harness();
    h.player.Start();
    h.player.OnSocketDisconnect({ code: 1006, reason: '', wasClean: false });
    assert.equal(h.player.ReconnectDelay, 250);
    h.timeouts.get(h.player.ReconnectTimer)();
    assert.equal(h.connections(), 2);
    h.player.OnSocketDisconnect({ code: 1006 });
    assert.equal(h.player.ReconnectDelay, 500);
    h.player.Stop();
    const count = h.timeouts.size;
    h.player.OnSocketDisconnect({ code: 1000 });
    assert.equal(h.timeouts.size, count);
});
