"use strict";

const { performance } = require('perf_hooks');
const { parentPort, workerData } = require('worker_threads');
const { FmStereoDecoder } = require('./dsp/fm-stereo');
const { RdsDecoder } = require('./dsp/rds');

if (!parentPort) {
  throw new Error('rtl_tcp DSP worker must run inside a Worker thread');
}

const decoder = new FmStereoDecoder({
  ...workerData,
  includeMpx: workerData.rdsEnabled
});
const rdsDecoder = workerData.rdsEnabled
  ? new RdsDecoder({ sampleRate: workerData.sampleRate })
  : null;

parentPort.on('message', (message) => {
  if (message.type === 'mono') {
    decoder.setForceMono(message.forceMono);
    return;
  }

  if (message.type === 'bandwidth') {
    decoder.setBandwidthHz(message.bandwidthHz);
    rdsDecoder?.reset();
    return;
  }

  if (message.type !== 'iq') return;

  const startedAt = performance.now();
  const iq = new Uint8Array(message.buffer);
  const result = decoder.process(iq);
  const groups = rdsDecoder ? rdsDecoder.process(result.mpx) : [];
  const pcmBuffer = result.pcm.buffer;

  parentPort.postMessage(
    {
      type: 'result',
      id: message.id,
      inputBytes: iq.byteLength,
      pcm: pcmBuffer,
      signals: result.signals,
      groups,
      stereo: decoder.stereo,
      processingMs: performance.now() - startedAt
    },
    [pcmBuffer]
  );
});

parentPort.postMessage({ type: 'ready' });
