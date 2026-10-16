'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getRtlTcpClientOptions,
  getStartupFrequencyMhz,
  isRtlTcpBackend,
} = require('../server/backend-config');

function configuration(overrides = {}) {
  return {
    device: 'sdr',
    enableDefaultFreq: true,
    defaultFreq: '101.7',
    stereoStartup: '0',
    rtlTcp: {
      enabled: true,
      host: 'panel-rtl.example',
      port: 4321,
      sampleRate: 240000,
      rdsEnabled: false,
    },
    ...overrides,
  };
}

test('the administrator device selection controls the active backend', () => {
  assert.equal(isRtlTcpBackend(configuration()), true);
  assert.equal(isRtlTcpBackend(configuration({ device: 'tef' })), false);
  assert.equal(isRtlTcpBackend(configuration({ device: 'xdr' })), false);
  assert.equal(isRtlTcpBackend(configuration({
    rtlTcp: { enabled: false },
  })), false);
});

test('RTL client options preserve panel settings and startup stereo mode', () => {
  const options = getRtlTcpClientOptions(configuration({
    stereoStartup: '1',
  }));

  assert.equal(options.host, 'panel-rtl.example');
  assert.equal(options.port, 4321);
  assert.equal(options.sampleRate, 240000);
  assert.equal(options.rdsEnabled, false);
  assert.equal(options.frequencyHz, 101700000);
  assert.equal(options.forceMono, true);
});

test('disabled or invalid default frequency starts at the normal 87.5 MHz', () => {
  assert.equal(
    getStartupFrequencyMhz(configuration({ enableDefaultFreq: false })),
    87.5
  );
  assert.equal(
    getStartupFrequencyMhz(configuration({ defaultFreq: 'invalid' })),
    87.5
  );
});
