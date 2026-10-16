"use strict";

const DEFAULT_FREQUENCY_MHZ = 87.5;

function isRtlTcpBackend(config) {
  return config.device === 'sdr' && config.rtlTcp?.enabled === true;
}

function getStartupFrequencyMhz(config) {
  if (config.enableDefaultFreq !== true) return DEFAULT_FREQUENCY_MHZ;

  const configuredFrequency = Number(config.defaultFreq);
  return Number.isFinite(configuredFrequency) && configuredFrequency > 0
    ? configuredFrequency
    : DEFAULT_FREQUENCY_MHZ;
}

function getRtlTcpClientOptions(config) {
  return {
    ...(config.rtlTcp || {}),
    frequencyHz: Math.round(getStartupFrequencyMhz(config) * 1000000),
    forceMono: config.stereoStartup === "1"
  };
}

module.exports = {
  DEFAULT_FREQUENCY_MHZ,
  getRtlTcpClientOptions,
  getStartupFrequencyMhz,
  isRtlTcpBackend
};
