"use strict";

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  getMp3FfmpegArguments
} = require('../server/stream/ffmpeg-arguments');

test('MP3 encoder starts raw PCM promptly without duplicate real-time pacing', () => {
  const args = getMp3FfmpegArguments({
    sampleRate: 48000,
    sampleRateOffset: 0,
    channels: 2,
    audioBitrate: '320k'
  });
  const inputIndex = args.indexOf('-i');
  assert.notEqual(inputIndex, -1);
  assert.equal(args[inputIndex + 1], 'pipe:0');

  const inputArgs = args.slice(0, inputIndex);
  assert.equal(inputArgs[inputArgs.indexOf('-probesize') + 1], '32');
  for (const harmfulFlag of [
    '-readrate',
    '-fflags',
    '-flags',
    '-rtbufsize'
  ]) {
    assert.equal(
      inputArgs.includes(harmfulFlag),
      false,
      `${harmfulFlag} must not alter raw PCM input pacing`
    );
  }

  const formatIndex = inputArgs.indexOf('-f');
  assert.equal(inputArgs[formatIndex + 1], 's16le');
  assert.equal(
    args[args.indexOf('-af') + 1],
    'asetnsamples=n=576:p=0'
  );
  assert.equal(
    args.some((argument) => String(argument).includes('arealtime')),
    false
  );
  assert.equal(args[args.indexOf('-c:a') + 1], 'libmp3lame');
  assert.equal(args[args.indexOf('-b:a') + 1], '320k');
  assert.equal(args[args.indexOf('-reservoir') + 1], '0');
});
