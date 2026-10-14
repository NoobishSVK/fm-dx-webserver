/* Libraries / Imports */
const fs = require('fs');
const path = require('path');
const { logDebug, logError, logInfo, logWarn } = require('./console');
const { applyEnvironmentOverrides } = require('./config-environment');

let configName = 'config';

const index = process.argv.indexOf('--config');
if (index !== -1 && index + 1 < process.argv.length) {
  configName = process.argv[index + 1];
  logInfo('Loading with a custom config file:', configName + '.json');
}

const configPath = process.env.FMDX_CONFIG_PATH
  ? path.resolve(process.env.FMDX_CONFIG_PATH)
  : path.join(__dirname, '../' + configName + '.json');

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
  rtlTcp: {
    enabled: false,
    host: "127.0.0.1",
    port: 1234,
    sampleRate: 240000,
    gain: "auto",
    ppm: 0,
    biasTee: false,
    deemphasisUs: 50,
    deviationHz: 75000,
    bandwidthHz: 200000,
    stereoMinimumSnrDb: 3,
    stereoBlendSnrDb: 40,
    rdsEnabled: true,
    reconnectDelayMs: 2000
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
    gpsMode: false,
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
  si47xx: {
    agcControl: false
  },
  tunnel: {
    enabled: false,
    username: "",
    token: "",
    region: "eu",
    lowLatencyMode: false,
    subdomain: "",
    httpName: "",
    httpPassword: "",
    community: {
      enabled: false,
      host: ""
    }
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

// Environment overrides active in memory, as { path, value, persisted }:
// `value` comes from the environment and `persisted` is what the config file
// holds (and keeps holding) for that setting.
let environmentOverrides = [];

function getPath(object, keys) {
  return keys.reduce((value, key) => (value == null ? undefined : value[key]), object);
}

function setPath(object, keys, value) {
  let target = object;
  for (const key of keys.slice(0, -1)) {
    if (typeof target[key] !== 'object' || target[key] === null) target[key] = {};
    target = target[key];
  }
  target[keys[keys.length - 1]] = value;
}

function changedLeafPaths(before, after, prefix = []) {
  const paths = [];
  for (const key of Object.keys(after)) {
    const value = after[key];
    const path = [...prefix, key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      paths.push(...changedLeafPaths(before?.[key], value, path));
    } else if (before?.[key] !== value) {
      paths.push(path);
    }
  }
  return paths;
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
  
  // A panel save updates the stored value of an overridden setting, but the
  // environment value stays in effect.
  for (const override of environmentOverrides) {
    const submitted = getPath(newConfig, override.path);
    if (submitted !== undefined) override.persisted = submitted;
  }
  deepMerge(serverConfig, newConfig); // Overwrite with newConfig values
  for (const override of environmentOverrides) {
    setPath(serverConfig, override.path, override.value);
  }
  configSave();
}

// Function to save the configuration to the file system
function configSave() {
  try {
    const persistedConfig = structuredClone(serverConfig);
    for (const override of environmentOverrides) {
      setPath(persistedConfig, override.path, override.persisted);
    }
    fs.writeFileSync(configPath, JSON.stringify(persistedConfig, null, 2));
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

// Empty Docker variables preserve values saved by the administrator. A
// non-empty environment value is an explicit deployment override: it is
// applied in memory, never written to the config file, and survives saves.
const configBeforeOverrides = structuredClone(serverConfig);
applyEnvironmentOverrides(serverConfig);
environmentOverrides = changedLeafPaths(configBeforeOverrides, serverConfig).map((path) => ({
  path,
  value: getPath(serverConfig, path),
  persisted: getPath(configBeforeOverrides, path)
}));

module.exports = {
    configName, serverConfig, configUpdate, configSave, configExists, configPath
};
