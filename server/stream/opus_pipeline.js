'use strict';

const { buildArecordArgs, getAlsaCaptureDevice } = require('./linux_capture');
const { getAudioFilterArguments } = require('./audio_encoder');

// Build one capture and one shared encoder. Keep ALSA timing in arecord: the
// FFmpeg ALSA input does not expose the existing buffer/period settings.
function buildLinuxOpusPipeline(audio) {
    const channels = Number(audio.audioChannels);
    if (channels !== 1 && channels !== 2) throw new Error('Audio channels must be 1 or 2');
    if (typeof audio.audioDevice !== 'string' || !audio.audioDevice.trim()) throw new Error('Audio device is required');
    const offset = Number(audio.samplerateOffset || 0);
    if (!Number.isInteger(offset) || Math.abs(offset) > 10) throw new Error('Sample-rate offset must be between -10 and 10');
    const bitrate = audio.audioBitrate || '128k';
    if (typeof bitrate !== 'string' || !/^(64|96|128|192|256|320)k$/.test(bitrate)) throw new Error('Unsupported audio bitrate');
    const device = getAlsaCaptureDevice(audio.audioDevice, audio.softwareMode);
    const capture = buildArecordArgs(device, channels, audio.alsaLatencyProfile);
    const encoderArgs = [
        '-hide_banner', '-loglevel', 'warning',
        '-f', 's16le', '-ar', String(48000 + offset), '-ac', String(channels), '-i', 'pipe:0',
        ...getAudioFilterArguments(audio.audioBoost),
        '-c:a', 'libopus', '-application', 'audio', '-frame_duration', '20',
        '-b:a', bitrate, '-ar', '48000', '-ac', String(channels),
        '-f', 'ogg', '-page_duration', '20000', '-flush_packets', '1', 'pipe:1'
    ];
    return { captureArgs: capture.args, profile: capture.profile, encoderArgs };
}

module.exports = { buildLinuxOpusPipeline };
