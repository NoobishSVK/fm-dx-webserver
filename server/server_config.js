/* Libraries / Imports */
const fs = require('fs');
const path = require('path');
const { logDebug, logError, logInfo, logWarn } = require('./console');

let configName = 'config';

const index = process.argv.indexOf('--config');
if (index !== -1 && index + 1 < process.argv.length) {
  configName = process.argv[index + 1];
  logInfo('Loading with a custom config file:', configName + '.json')
}

const configPath = path.join(__dirname, '../' + configName + '.json');

let serverConfig = {
  webserver: {
    webserverIp: "0.0.0.0",
    webserverPort: 8080,
    banlist: [],
    chatEnabled: true
  },
  xdrd: {
    wirelessConnection: true,
    comPort: "",
    xdrdIp: "127.0.0.1",
    xdrdPort: 7373,
    xdrdPassword: ""
  },
  audio: {
    audioDevice: "Microphone (High Definition Audio Device)",
    audioChannels: 2,
    audioBitrate: "128k"
  },
  identification: {
    token: null,
    tunerName: "",
    tunerDesc: "",
    lat: "0",
    lon: "0",
    broadcastTuner: false,
    proxyIp: "",
  },
  password: {
    tunePass: "",
    adminPass: ""
  },
  extras: {
    fmlistIntegration: true,
    fmlistOmid: "",
  },
  tunnel: {
    enabled: false,
    username: "",
    token: "",
    lowLatencyMode: false,
    subdomain: "",
    httpName: "",
    httpPassword: "",
  },
  plugins: [],
  device: 'tef',
  defaultFreq: 87.5,
  publicTuner: true,
  lockToAdmin: false,
  autoShutdown: false,
  enableDefaultFreq: false
};

function deepMerge(target, source)
{
  Object.keys(source).forEach(function(key) {
    if (typeof target[key] === 'object' && target[key] !== null) {
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  });
}

function configUpdate(newConfig) {
  if (newConfig.webserver && (newConfig.webserver.banlist !== undefined || newConfig.plugins !== undefined)) {
    // If new banlist is provided, replace the existing one
    serverConfig.webserver.banlist = newConfig.webserver.banlist;
    serverConfig.plugins = newConfig.plugins;
    delete newConfig.webserver.banlist; // Remove banlist from newConfig to avoid merging
  }
  
  deepMerge(serverConfig, newConfig);
}


function configSave() {
  fs.writeFile(configPath, JSON.stringify(serverConfig, null, 2), (err) => {
    if (err) {
      logError(err);
    } else {
      logInfo('Server config saved successfully.');
    }
  });
}

function configExists() {
  return fs.existsSync(configPath);
}

if (fs.existsSync(configPath)) {
  const configFileContents = fs.readFileSync(configPath, 'utf8');
  serverConfig = JSON.parse(configFileContents);
}

module.exports = {
    configName, serverConfig, configUpdate, configSave, configExists, configPath
};
