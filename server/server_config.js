/* Libraries / Imports */
const fs = require('fs');
const path = require('path');
const { logDebug, logError, logInfo, logWarn } = require('./console');

let configName = 'config';

const index = process.argv.indexOf('--config');
if (index !== -1 && index + 1 < process.argv.length) {
  configName = process.argv[index + 1];
  logInfo('Loading with a custom config file:', configName + '.json');
}

const configPath = path.join(__dirname, '../' + configName + '.json');

let serverConfig = {
  webserver: {
    webserverIp: "0.0.0.0",
    webserverPort: 8080,
    banlist: [],
    chatEnabled: true,
    tuningLimit: false,
    tuningLowerLimit: "100",
    tuningUpperLimit: "108",
    presets: [
      "87.5",
      "87.5",
      "87.5",
      "87.5"
    ],
    defaultTheme: "theme1",
    bgImage: "",
    rdsMode: false
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
    audioBitrate: "128k",
    softwareMode: false,
    startupVolume: "0.95"
  },
  identification: {
    token: null,
    tunerName: "",
    tunerDesc: "",
    lat: "",
    lon: "",
    broadcastTuner: false,
    proxyIp: "",
    contact: null,
  },
  password: {
    tunePass: "",
    adminPass: ""
  },
  antennas: {
    enabled: false,
    ant1: {
      enabled: true,
      name: "Ant A"
    },
    ant2: {
      enabled: true,
      name: "Ant B"
    },
    ant3: {
      enabled: false,
      name: "Ant C"
    },
    ant4: {
      enabled: false,
      name: "Ant D"
    }
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
  enableDefaultFreq: false,
  defaultFreq: "87.5",
  testThing: "yes it works"
};

function deepMerge(target, source) {
  Object.keys(source).forEach(function(key) {
    if (typeof source[key] === 'object' && source[key] !== null) {
      if (!target[key]) target[key] = {};  // Create missing object
      deepMerge(target[key], source[key]); // Recursively merge
    } else {
      if (target[key] === undefined) {
        target[key] = source[key]; // Add missing fields
      }
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

if (configExists()) {
  const configFileContents = fs.readFileSync(configPath, 'utf8');
  try {
    const configFile = JSON.parse(configFileContents);
    deepMerge(configFile, serverConfig); 
    serverConfig = configFile;
    configSave();
  } catch (err) {
    logError('Error parsing config file:', err);
  }
}

module.exports = {
    configName, serverConfig, configUpdate, configSave, configExists, configPath
};
