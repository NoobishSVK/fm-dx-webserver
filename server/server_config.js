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
    rdsMode: false,
    rdsTimeout: 0,
    txIdAlgorithm: 0
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
    audioBoost: false,
    softwareMode: false,
    startupVolume: "0.95",
    ffmpeg: false,
    samplerateOffset: "0"
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
    fmlistAdminOnly: false,
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
  bwSwitch: false,
  bwAutoStartup: "0",
  bwAutoNoUsers: "0",
  ceqStartup: "0",
  ceqNoUsers: "0",
  imsStartup: "0",
  imsNoUsers: "0",
  stereoStartup: "0",
  stereoNoUsers: "0",
  antennaStartup: "0",
  antennaNoUsers: "0",
  antennaNoUsersDelay: false
};

// Function to add missing fields without overwriting existing values
function addMissingFields(target, source) {
  Object.keys(source).forEach(function(key) {
    if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
      if (!target[key]) {
        target[key] = {}; // Create missing object
      }
      addMissingFields(target[key], source[key]); // Recursively add missing fields
    } else {
      if (target[key] === undefined) {
        target[key] = source[key]; // Add missing fields only
      }
    }
  });
}

// Function to merge new configuration, overwriting existing values
function deepMerge(target, source) {
  Object.keys(source).forEach(function(key) {
    if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
      if (!target[key] || typeof target[key] !== 'object') {
        target[key] = {}; // Ensure target[key] is an object before merging
      }
      deepMerge(target[key], source[key]); // Recursively merge objects
    } else {
      target[key] = source[key]; // Overwrite or add the value
    }
  });
}

// Function to update the configuration at runtime
function configUpdate(newConfig) {
  if (newConfig.webserver && (newConfig.webserver.banlist !== undefined || newConfig.plugins !== undefined)) {
    serverConfig.webserver.banlist = newConfig.webserver.banlist;
    serverConfig.plugins = newConfig.plugins;
    delete newConfig.webserver.banlist;
  }
  
  deepMerge(serverConfig, newConfig); // Overwrite with newConfig values
  configSave();
}

// Function to save the configuration to the file system
function configSave() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(serverConfig, null, 2));
    setTimeout(() => logInfo('Server config saved successfully.'), 0);
  } catch (err) {
    logError(err);
  }
}

// Function to check if the configuration file exists
function configExists() {
  return fs.existsSync(configPath);
}

// On startup, check for missing fields and add them if necessary
if (configExists()) {
  const configFileContents = fs.readFileSync(configPath, 'utf8');
  try {
    const configFile = JSON.parse(configFileContents);
    addMissingFields(configFile, serverConfig); // Add only missing fields from serverConfig
    serverConfig = configFile; // Use the updated configFile as the new serverConfig
    configSave(); // Save the merged config back to the file
  } catch (err) {
    logError('Error parsing config file:', err);
  }
}


module.exports = {
    configName, serverConfig, configUpdate, configSave, configExists, configPath
};
