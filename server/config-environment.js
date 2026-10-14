'use strict';

const AUDIO_BITRATES = new Set([
  '64k',
  '96k',
  '128k',
  '192k',
  '256k',
  '320k',
]);

function environmentValue(environment, name) {
  const value = environment[name];
  if (value === undefined || String(value).trim() === '') return undefined;
  return String(value).trim();
}

function environmentString(environment, name, fallback) {
  return environmentValue(environment, name) ?? fallback;
}

function environmentNumber(environment, name, fallback) {
  const value = environmentValue(environment, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function environmentBoolean(environment, name, fallback) {
  const value = environmentValue(environment, name);
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function environmentAudioBitrate(environment, name, fallback) {
  const value = environmentValue(environment, name)?.toLowerCase();
  return value && AUDIO_BITRATES.has(value) ? value : fallback;
}

function applyEnvironmentOverrides(config, environment = process.env) {
  config.device = environmentString(
    environment,
    'FMDX_DEVICE',
    config.device
  );
  config.webserver.webserverIp = environmentString(
    environment,
    'FMDX_WEB_IP',
    config.webserver.webserverIp
  );
  config.webserver.webserverPort = environmentNumber(
    environment,
    'FMDX_WEB_PORT',
    config.webserver.webserverPort
  );
  config.audio.audioBitrate = environmentAudioBitrate(
    environment,
    'FMDX_AUDIO_BITRATE',
    config.audio.audioBitrate
  );
  config.password.adminPass = environmentString(
    environment,
    'FMDX_ADMIN_PASSWORD',
    config.password.adminPass
  );

  config.rtlTcp.enabled = environmentBoolean(
    environment,
    'RTL_TCP_ENABLED',
    config.rtlTcp.enabled
  );
  config.rtlTcp.host = environmentString(
    environment,
    'RTL_TCP_HOST',
    config.rtlTcp.host
  );
  config.rtlTcp.port = environmentNumber(
    environment,
    'RTL_TCP_PORT',
    config.rtlTcp.port
  );
  config.rtlTcp.sampleRate = environmentNumber(
    environment,
    'RTL_TCP_SAMPLE_RATE',
    config.rtlTcp.sampleRate
  );
  config.rtlTcp.gain = environmentString(
    environment,
    'RTL_TCP_GAIN',
    config.rtlTcp.gain
  );
  config.rtlTcp.ppm = environmentNumber(
    environment,
    'RTL_TCP_PPM',
    config.rtlTcp.ppm
  );
  config.rtlTcp.biasTee = environmentBoolean(
    environment,
    'RTL_TCP_BIAS_TEE',
    config.rtlTcp.biasTee
  );
  config.rtlTcp.deemphasisUs = environmentNumber(
    environment,
    'RTL_TCP_DEEMPHASIS_US',
    config.rtlTcp.deemphasisUs
  );
  config.rtlTcp.deviationHz = environmentNumber(
    environment,
    'RTL_TCP_DEVIATION_HZ',
    config.rtlTcp.deviationHz
  );
  config.rtlTcp.bandwidthHz = environmentNumber(
    environment,
    'RTL_TCP_BANDWIDTH_HZ',
    config.rtlTcp.bandwidthHz
  );
  config.rtlTcp.stereoMinimumSnrDb = environmentNumber(
    environment,
    'RTL_TCP_STEREO_MINIMUM_SNR_DB',
    config.rtlTcp.stereoMinimumSnrDb
  );
  config.rtlTcp.rdsEnabled = environmentBoolean(
    environment,
    'RTL_TCP_RDS_ENABLED',
    config.rtlTcp.rdsEnabled
  );
  config.rtlTcp.reconnectDelayMs = environmentNumber(
    environment,
    'RTL_TCP_RECONNECT_DELAY_MS',
    config.rtlTcp.reconnectDelayMs
  );

  return config;
}

module.exports = {
  applyEnvironmentOverrides,
  environmentAudioBitrate,
  environmentBoolean,
  environmentNumber,
  environmentString,
};
