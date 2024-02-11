/* Libraries / Imports */
const fs = require('fs');
const { logDebug, logError, logInfo, logWarn } = require('./console');

let serverConfig = {
  webserver: {
    webserverIp: "0.0.0.0",
    webserverPort: "8080",
    audioPort: "8081"
  },
  xdrd: {
    xdrdIp: "127.0.0.1",
    xdrdPort: "7373",
    xdrdPassword: ""
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
  publicTuner: true,
  lockToAdmin: false
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
  deepMerge(serverConfig, newConfig);
}

function configSave() {
  fs.writeFile('config.json', JSON.stringify(serverConfig, null, 2), (err) => {
    if (err) {
      logError(err);
    } else {
      logInfo('Server config saved successfully.');
    }
  });
}

if (fs.existsSync('config.json')) {
  const configFileContents = fs.readFileSync('config.json', 'utf8');
  serverConfig = JSON.parse(configFileContents);
}

module.exports = {
    serverConfig, configUpdate, configSave
};
