/* Libraries / Imports */
const fs = require('fs');
const { logDebug, logError, logInfo, logWarn } = require('./console');
const { serverConfig, configUpdate, configSave } = require('./server_config')

let timeoutID = null;

function send(request) {
  const url = "https://list.fmdx.pl/api/";

  const options = {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(request)
  };

  fetch(url, options)
    .then(response => response.json())
    .then(data => {
        if (data.success && data.token)
        {
          if (!serverConfig.identification.token)
          {
            logInfo("Succesfully registered in FM-DX Server Map.");
            serverConfig.identification.token = data.token;
            configSave();
          }
          else
          {
            logInfo("Succesfully updated FM-DX Server Map.");
          }
        }
        else
        {
          logWarn("Failed to update FM-DX Server Map: " + (data.error ? data.error : 'unknown error'));
        }
    })
    .catch(error => {
        logWarn("Failed to update FM-DX Server Map: " + error);
    });
}

function sendKeepalive() {
  if (!serverConfig.identification.token)
  {
    return;
  }

  const request = {
    token: serverConfig.identification.token,
    status: (serverConfig.lockToAdmin ? 2 : 1)
  };

  send(request);
}

function sendUpdate() {
  const request = {
    status: (serverConfig.lockToAdmin ? 2 : 1),
    coords: [serverConfig.identification.lat, serverConfig.identification.lon],
    name: serverConfig.identification.tunerName,
    desc: serverConfig.identification.tunerDesc
  };

  if (serverConfig.identification.token)
  {
    request.token = serverConfig.identification.token;
  }

  if (serverConfig.identification.proxyIp.length)
  {
    request.url = serverConfig.identification.proxyIp;
  }
  else
  {
    request.port = serverConfig.webserver.webserverPort;
  }

  send(request);
}

function update() {
  if (timeoutID !== null) {
      clearTimeout(timeoutID);
  }

  if (!serverConfig.identification.broadcastTuner)
  {
    return;
  }

  sendUpdate();
  timeoutID = setInterval(sendKeepalive, 5 * 60 * 1000);
}

module.exports = {
    update
};
