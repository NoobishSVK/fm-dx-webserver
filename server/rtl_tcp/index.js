"use strict";

const { serverConfig } = require('../server_config');
const { getRtlTcpClientOptions } = require('../backend-config');
const { RtlTcpClient } = require('./client');

const rtlBackend = new RtlTcpClient(getRtlTcpClientOptions(serverConfig));

module.exports = rtlBackend;
