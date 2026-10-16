"use strict";

function getMp3FfmpegArguments({
  sampleRate,
  sampleRateOffset,
  channels,
  audioBitrate
}) {
  return [
    "-probesize", "32",
    "-f", "s16le",
    "-ar", Number(sampleRate) + Number(sampleRateOffset),
    "-ac", String(channels),
    "-i", "pipe:0",
    // The SDR and capture sources already deliver PCM at wall-clock rate.
    // Keeping only the half-frame batching preserves prompt MP3 output without
    // paying for a second real-time pacing loop inside FFmpeg.
    "-af", "asetnsamples=n=576:p=0",
    "-c:a", "libmp3lame",
    "-b:a", audioBitrate,
    "-ac", String(channels),
    "-reservoir", "0",
    "-f", "mp3", "-write_xing", "0", "-id3v2_version", "0",
    "-fflags", "+nobuffer", "-flush_packets", "1",
    "pipe:1"
  ];
}

module.exports = {
  getMp3FfmpegArguments
};
