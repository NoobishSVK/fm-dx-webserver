"use strict";

const { serverConfig } = require('../server_config');
const { RtlTcpClient } = require('./client');

const rtlTcpConfig = serverConfig.rtlTcp || {};

const rtlBackend = new RtlTcpClient({
  ...rtlTcpConfig,
  frequencyHz: Number(serverConfig.defaultFreq || 87.5) * 1000000,
  audioChannels: serverConfig.audio.audioChannels
});

module.exports = rtlBackend;
