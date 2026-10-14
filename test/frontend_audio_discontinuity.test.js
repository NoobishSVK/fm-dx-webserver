"use strict";

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');

function loadBrowserScript(relativePath, globals = {}) {
  const context = vm.createContext({
    console,
    Set,
    Uint8Array,
    ...globals
  });
  const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
  vm.runInContext(source, context, { filename: relativePath });
  return context;
}

test('fallback handles a generic discontinuity separately from binary audio', () => {
  const context = loadBrowserScript('web/js/3las/fallback/3las.fallback.js');
  const Fallback = vm.runInContext('Fallback', context);
  const fallback = Object.create(Fallback.prototype);
  const calls = [];
  fallback.PacketModCounter = 12;
  fallback.FormatReader = {
    Reset() {
      calls.push('reader-reset');
    },
    PushData(data) {
      calls.push(['binary', [...data]]);
    }
  };
  fallback.Player = {
    Reset() {
      calls.push('player-reset');
    }
  };

  fallback.OnSocketDataReady('{"type":"discontinuity"}');
  fallback.OnSocketDataReady(new Uint8Array([1, 2, 3]).buffer);

  assert.equal(fallback.PacketModCounter, 1);
  assert.deepEqual(calls, [
    'reader-reset',
    'player-reset',
    ['binary', [1, 2, 3]]
  ]);
});

test('player reset immediately stops and forgets scheduled audio sources', () => {
  const sources = [];
  const audio = {
    currentTime: 10,
    destination: {},
    createGain() {
      return {
        gain: {
          value: 1,
          cancelScheduledValues() {},
          exponentialRampToValueAtTime() {}
        },
        connect() {}
      };
    },
    createBufferSource() {
      const source = {
        connect() {},
        start(when, offset) {
          this.started = [when, offset];
        },
        stop() {
          this.stopped = true;
        },
        disconnect() {
          this.disconnected = true;
        }
      };
      sources.push(source);
      return source;
    }
  };
  const context = loadBrowserScript(
    'web/js/3las/fallback/3las.liveaudioplayer.js'
  );
  const LiveAudioPlayer = vm.runInContext('LiveAudioPlayer', context);
  const player = new LiveAudioPlayer(audio, { Log() {} }, 1, 0.33, false);

  player.PushBuffer({ duration: 0.25 });
  assert.equal(player.ScheduledSources.size, 1);
  assert.deepEqual(sources[0].started, [10.33, 0]);

  player.Reset();

  assert.equal(sources[0].stopped, true);
  assert.equal(sources[0].disconnected, true);
  assert.equal(player.ScheduledSources.size, 0);
  assert.equal(player.NextScheduleTime, 0);
});

test('format reader ignores decode callbacks from before a reset', () => {
  const context = loadBrowserScript(
    'web/js/3las/fallback/3las.formatreader.js',
    { Audio: function Audio() {} }
  );
  const AudioFormatReader = vm.runInContext('AudioFormatReader', context);
  let readyCalls = 0;
  const reader = new AudioFormatReader(
    {},
    { Log() {} },
    () => {},
    () => true,
    () => {
      readyCalls++;
    }
  );
  const staleId = reader.Id++;

  reader.Reset();
  const currentId = reader.Id++;
  reader.OnDataReady(staleId, 'old station');
  reader.OnDataReady(currentId, 'new station');

  assert.equal(readyCalls, 1);
  assert.equal(reader.PopSamples(), 'new station');
  assert.equal(reader.SamplesAvailable(), false);
});
