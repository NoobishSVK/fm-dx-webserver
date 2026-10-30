# Shared client audio API

Use `window.fmdxAudio` (version 1) instead of connecting to `/audio` in a plugin.
The player owns the WebSocket, Opus decoder, playback buffer, and reconnection.

- `await start()`: start playback from a user gesture; concurrent calls share startup.
- `await createStream()`: returns `{ stream, release }`. The MediaStream contains
  decoded stereo audio **before the browser volume slider**, but after server
  encoding/boost and playback buffering. Call `release()` when finished. This
  disconnects only this plugin's branch, not playback or other plugins.
- `subscribe(callback)`: returns an unsubscribe function. Events are
  `{ type: 'state', state }` or `{ type: 'levels', levels }`.
- `getState()`: `stopped`, `starting`, `connecting`, `receiving`, or `reconnecting`.
- `getInputLevels()`: recent raw capture readings, or `null` when unavailable.
  These are server-side input levels before boost and encoding, not levels of
  the decoded plugin stream.
- `getOutput()`: existing `{ context, node }` output **after browser volume**,
  or `null`. Prefer `createStream()` for recording.

Streams survive network reconnects (with silence while playback is unavailable).
Stopping audio emits `stopped` and releases all plugin streams. A recorder should
finish its file on that event. Start a new stream after playback starts again.
Listener exceptions are isolated from audio handling.

```js
const tap = await window.fmdxAudio.createStream();
const recorder = new MediaRecorder(tap.stream, { mimeType: 'audio/webm;codecs=opus' });
// Check MediaRecorder.isTypeSupported first; collect dataavailable chunks and
// save only after stop, including its final dataavailable chunk.
const unsubscribe = window.fmdxAudio.subscribe(event => {
    if (event.type === 'state' && event.state === 'stopped' && recorder.state !== 'inactive') recorder.stop();
});
recorder.onstop = () => { unsubscribe(); tap.release(); };
recorder.start(1000);
```

`web/js/audio-recorder.js` is the maintained Audio Recorder integration. The
Jax-installed plugin loads that script. It chooses WebM/Opus, Ogg/Opus, or MP4
using browser support checks. It records decoded audio with MediaRecorder, so
this is a new encoding, not a lossless copy of the incoming Opus packets.
