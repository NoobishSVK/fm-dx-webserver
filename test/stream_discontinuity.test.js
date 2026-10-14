"use strict";

const assert = require('node:assert/strict');
const test = require('node:test');
const audioServer = require('../server/stream/3las.server');

function useFakeEncoders(t, server) {
  const originalClients = server.Clients;
  const originalFallbackClients = server.FallbackClients;
  const originalProviders = server.FallbackProvider;
  const starts = [];
  server.Clients = new Set();
  server.FallbackClients = { mp3: new Set(), wav: new Set() };
  server.FallbackProvider = {
    mp3: { Start() { starts.push('mp3'); }, Stop() {}, PrimeClient() {} }
  };
  t.after(() => {
    server.Clients = originalClients;
    server.FallbackClients = originalFallbackClients;
    server.FallbackProvider = originalProviders;
  });
  return starts;
}

function fakeSocket() {
  return { on() {}, close() {}, terminate() {} };
}

test('audio listener count follows clients that pick a format', async (t) => {
  await audioServer.waitUntilReady;
  const server = audioServer.Server;
  useFakeEncoders(t, server);
  const counts = [];
  const unsubscribe = audioServer.onClientCountChange((count) => counts.push(count));
  t.after(unsubscribe);

  server.OnServerConnection(fakeSocket());
  const [client] = server.Clients;
  assert.deepEqual(counts, [], 'a socket that has not chosen a format is not a listener');

  server.SetFallback(client, 'mp3');
  server.DestroyClient(client);

  assert.deepEqual(counts, [1, 0]);
});

test('a destroyed audio client cannot re-register or start an encoder', async (t) => {
  await audioServer.waitUntilReady;
  const server = audioServer.Server;
  const starts = useFakeEncoders(t, server);

  server.OnServerConnection(fakeSocket());
  const [client] = server.Clients;
  server.DestroyClient(client);
  // A fallback request still queued on the closing socket.
  server.SetFallback(client, 'mp3');

  assert.equal(server.FallbackClients.mp3.size, 0);
  assert.deepEqual(starts, []);
});

test('stream discontinuity drops queued PCM before resetting active encoders', async (t) => {
  await audioServer.waitUntilReady;
  const server = audioServer.Server;
  const originalStdIn = server.StdIn;
  const originalClients = server.Clients;
  const originalProviders = server.FallbackProvider;
  t.after(() => {
    server.StdIn = originalStdIn;
    server.Clients = originalClients;
    server.FallbackProvider = originalProviders;
  });

  const calls = [];
  const queued = [Buffer.from('old pcm'), null];
  server.StdIn = {
    pause() {
      calls.push('pause');
    },
    read() {
      calls.push('read');
      const chunk = queued.shift();
      if (chunk) server.OnStdInData(chunk);
      return chunk;
    },
    resume() {
      calls.push('resume');
    }
  };
  server.Clients = new Set([{
    Format: 'mp3',
    SendText(message) {
      calls.push(`client:${message}`);
    }
  }]);
  server.FallbackProvider = {
    mp3: {
      Backpressured: false,
      Resetting: false,
      Reset() {
        calls.push('reset');
      },
      InsertData() {
        calls.push('insert');
        return true;
      }
    }
  };

  server.Discontinuity();

  assert.deepEqual(calls, [
    'pause',
    'read',
    'read',
    'client:{"type":"discontinuity"}',
    'reset',
    'resume'
  ]);
});

test('provider reset suppresses stale output and respawns only after close', async (t) => {
  await audioServer.waitUntilReady;
  const server = audioServer.Server;
  const provider = server.FallbackProvider.mp3;
  const originalClients = server.FallbackClients.mp3;
  const originalStart = provider.Start;
  const originalOnData = provider.OnData;
  const originalProcess = provider.Process;
  const originalBackpressured = provider.Backpressured;
  const originalResetting = provider.Resetting;
  const originalStopping = provider.Stopping;
  const originalRestartTimer = provider.RestartTimer;
  t.after(() => {
    server.FallbackClients.mp3 = originalClients;
    provider.Start = originalStart;
    provider.OnData = originalOnData;
    provider.Process = originalProcess;
    provider.Backpressured = originalBackpressured;
    provider.Resetting = originalResetting;
    provider.Stopping = originalStopping;
    clearTimeout(provider.RestartTimer);
    provider.RestartTimer = originalRestartTimer;
  });

  const calls = [];
  const child = {
    stdin: {
      end() {
        calls.push('end');
      }
    },
    kill(signal) {
      calls.push(`kill:${signal}`);
    }
  };
  server.FallbackClients.mp3 = new Set([{}]);
  provider.Process = child;
  provider.Backpressured = false;
  provider.Resetting = false;
  provider.Stopping = false;
  provider.RestartTimer = null;
  provider.Start = () => {
    calls.push('start');
  };
  provider.OnData = () => {
    calls.push('data');
  };

  provider.Reset();
  provider.OnProcessData(child, Buffer.from('stale encoded audio'));

  assert.deepEqual(calls, ['end', 'kill:SIGTERM']);
  assert.equal(provider.Resetting, true);
  assert.equal(provider.Backpressured, true);
  assert.equal(provider.InsertData(Buffer.alloc(4)), false);

  provider.OnProcessClose(child);

  assert.deepEqual(calls, ['end', 'kill:SIGTERM', 'start']);
  assert.equal(provider.Resetting, false);
  assert.equal(provider.Backpressured, false);
});
