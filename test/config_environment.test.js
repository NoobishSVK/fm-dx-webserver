'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyEnvironmentOverrides,
} = require('../server/config-environment');

function adminConfiguration() {
  return {
    device: 'tef',
    webserver: {
      webserverIp: '192.0.2.10',
      webserverPort: 9090,
    },
    audio: {
      audioBitrate: '96k',
    },
    password: {
      adminPass: 'panel-secret',
    },
    rtlTcp: {
      enabled: false,
      host: 'panel-rtl.example',
      port: 4321,
      sampleRate: 256000,
      gain: '28',
      ppm: 7,
      biasTee: true,
      deemphasisUs: 75,
      deviationHz: 68000,
      bandwidthHz: 180000,
      stereoMinimumSnrDb: 5,
      rdsEnabled: false,
      reconnectDelayMs: 3500,
    },
  };
}

test('empty Docker variables preserve every administrator setting', () => {
  const config = adminConfiguration();
  const expected = structuredClone(config);
  const environment = {
    FMDX_DEVICE: '',
    FMDX_WEB_IP: ' ',
    FMDX_WEB_PORT: '',
    FMDX_AUDIO_BITRATE: '',
    FMDX_ADMIN_PASSWORD: '',
    RTL_TCP_ENABLED: '',
    RTL_TCP_HOST: '',
    RTL_TCP_PORT: '',
    RTL_TCP_SAMPLE_RATE: '',
    RTL_TCP_GAIN: '',
    RTL_TCP_PPM: '',
    RTL_TCP_BIAS_TEE: '',
    RTL_TCP_DEEMPHASIS_US: '',
    RTL_TCP_DEVIATION_HZ: '',
    RTL_TCP_BANDWIDTH_HZ: '',
    RTL_TCP_STEREO_MINIMUM_SNR_DB: '',
    RTL_TCP_RDS_ENABLED: '',
    RTL_TCP_RECONNECT_DELAY_MS: '',
  };

  assert.deepEqual(
    applyEnvironmentOverrides(config, environment),
    expected
  );
});

test('non-empty Docker variables remain explicit deployment overrides', () => {
  const config = applyEnvironmentOverrides(adminConfiguration(), {
    FMDX_DEVICE: 'sdr',
    FMDX_WEB_IP: '0.0.0.0',
    FMDX_WEB_PORT: '8080',
    FMDX_AUDIO_BITRATE: '320K',
    FMDX_ADMIN_PASSWORD: 'deployment-secret',
    RTL_TCP_ENABLED: 'true',
    RTL_TCP_HOST: 'rtl_tcp',
    RTL_TCP_PORT: '1234',
    RTL_TCP_SAMPLE_RATE: '240000',
    RTL_TCP_GAIN: 'auto',
    RTL_TCP_PPM: '0',
    RTL_TCP_BIAS_TEE: 'false',
    RTL_TCP_DEEMPHASIS_US: '50',
    RTL_TCP_DEVIATION_HZ: '75000',
    RTL_TCP_BANDWIDTH_HZ: '200000',
    RTL_TCP_STEREO_MINIMUM_SNR_DB: '3',
    RTL_TCP_RDS_ENABLED: 'yes',
    RTL_TCP_RECONNECT_DELAY_MS: '2000',
  });

  assert.deepEqual(config, {
    device: 'sdr',
    webserver: {
      webserverIp: '0.0.0.0',
      webserverPort: 8080,
    },
    audio: {
      audioBitrate: '320k',
    },
    password: {
      adminPass: 'deployment-secret',
    },
    rtlTcp: {
      enabled: true,
      host: 'rtl_tcp',
      port: 1234,
      sampleRate: 240000,
      gain: 'auto',
      ppm: 0,
      biasTee: false,
      deemphasisUs: 50,
      deviationHz: 75000,
      bandwidthHz: 200000,
      stereoMinimumSnrDb: 3,
      rdsEnabled: true,
      reconnectDelayMs: 2000,
    },
  });
});

test('invalid explicit numeric and bitrate values preserve panel values', () => {
  const config = adminConfiguration();

  applyEnvironmentOverrides(config, {
    FMDX_AUDIO_BITRATE: '500k',
    RTL_TCP_PORT: 'not-a-number',
    RTL_TCP_SAMPLE_RATE: 'NaN',
  });

  assert.equal(config.audio.audioBitrate, '96k');
  assert.equal(config.rtlTcp.port, 4321);
  assert.equal(config.rtlTcp.sampleRate, 256000);
});
