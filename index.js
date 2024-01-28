/* Libraries / Imports */
const express = require('express');
const app = express();
const http = require('http');
const https = require('https');
const httpServer = http.createServer(app);
const WebSocket = require('ws');
const wss = new WebSocket.Server({ noServer: true });
const path = require('path');
const net = require('net');
const client = new net.Socket();
const crypto = require('crypto');
const commandExists = require('command-exists-promise');
const dataHandler = require('./datahandler');
const consoleCmd = require('./console');
const config = require('./userconfig');
const audioStream = require('./stream/index.js');

const { webServerHost, webServerPort, webServerName, audioPort, xdrdServerHost, xdrdServerPort, xdrdPassword, qthLatitude, qthLongitude } = config;
const { logDebug, logError, logInfo, logWarn } = consoleCmd;

let currentUsers = 0;
let streamEnabled = false;
let incompleteDataBuffer = '';

/* Audio Stream */
commandExists('ffmpeg')
  .then(exists => {
    if (exists) {
      logInfo("An existing installation of ffmpeg found, enabling audio stream.");
      audioStream.enableAudioStream();
      streamEnabled = true;
    } else {
      logError("No ffmpeg installation found. Audio stream won't be available.");
    }
  })
  .catch(err => {
    // Should never happen but better handle it just in case
  })

/* webSocket handlers */
wss.on('connection', (ws, request) => {
  const clientIp = request.connection.remoteAddress;
  currentUsers++;
  dataHandler.showOnlineUsers(currentUsers);

  // Use ipinfo.io API to get geolocation information
  https.get(`https://ipinfo.io/${clientIp}/json`, (response) => {
    let data = '';

    response.on('data', (chunk) => {
      data += chunk;
    });

    response.on('end', () => {
      try {
        const locationInfo = JSON.parse(data);
        console.log(locationInfo.country);
        if(locationInfo.country === undefined) {
          logInfo(`Web client \x1b[32mconnected\x1b[0m (${clientIp}) \x1b[90m[${currentUsers}]\x1b[0m`);
        } else {
          logInfo(`Web client \x1b[32mconnected\x1b[0m (${clientIp}) \x1b[90m[${currentUsers}]\x1b[0m Location: ${locationInfo.city}, ${locationInfo.region}, ${locationInfo.country}`);
        }
      } catch (error) {
        logInfo(`Web client \x1b[32mconnected\x1b[0m (${clientIp}) \x1b[90m[${currentUsers}]\x1b[0m`);
      }
    });
  });

  ws.on('message', (message) => {
    logDebug('Received message from client:', message.toString());
    command = message.toString();
    client.write(command + "\n");
  });

  ws.on('close', (code, reason) => {
    currentUsers--;
    logInfo(`Web client \x1b[31mdisconnected\x1b[0m (${clientIp}) \x1b[90m[${currentUsers}]`);
  });

  ws.on('error', console.error);
});

/* Serving of HTML files */
app.use(express.static(path.join(__dirname, 'web')));

// Function to authenticate with the xdrd server
function authenticateWithXdrd(client, salt, password) {
  const sha1 = crypto.createHash('sha1');
  const saltBuffer = Buffer.from(salt, 'utf-8');
  const passwordBuffer = Buffer.from(password, 'utf-8');
  sha1.update(saltBuffer);
  sha1.update(passwordBuffer);

  const hashedPassword = sha1.digest('hex');
  client.write(hashedPassword + '\n');
  client.write('x\n');
}

// WebSocket client connection
client.connect(xdrdServerPort, xdrdServerHost, () => {
  logInfo('Connection to xdrd established successfully.');

  const authFlags = {
    authMsg: false,
    firstClient: false,
    receivedPassword: false
  };

  const authDataHandler = (data) => {
    const receivedData = data.toString();
    const lines = receivedData.split('\n');

    for (const line of lines) {

      if (!authFlags.receivedPassword) {
        authFlags.receivedSalt = line.trim();
        authenticateWithXdrd(client, authFlags.receivedSalt, xdrdPassword);
        authFlags.receivedPassword = true;
      } else {
        if (line.startsWith('a')) {
          authFlags.authMsg = true;
          logWarn('Authentication with xdrd failed. Is your password set correctly?');
        } else if (line.startsWith('o1,')) {
          authFlags.firstClient = true;
        } else if (line.startsWith('T') && line.length <= 7) {
          const freq = line.slice(1) / 1000;
          dataHandler.dataToSend.freq = freq.toFixed(3);
        } else if (line.startsWith('OK')) {
          authFlags.authMsg = true;
          logInfo('Authentication with xdrd successful.');
        }

        if (authFlags.authMsg && authFlags.firstClient) {
          client.write('T87500\n');
          client.write('A0\n');
          client.write('G11\n');
          client.off('data', authDataHandler);
          return;
        }
      }
    }
  };

  client.on('data', (data) => {
    var receivedData = incompleteDataBuffer + data.toString();
    const isIncomplete = (receivedData.slice(-1) != '\n');

    if (isIncomplete) {
      const position = receivedData.lastIndexOf('\n');
      if (position < 0) {
        incompleteDataBuffer = receivedData;
        receivedData = '';
      } else {
        incompleteDataBuffer = receivedData.slice(position + 1);
        receivedData = receivedData.slice(0, position + 1);
      }
    } else {
      incompleteDataBuffer = '';
    }

    if (receivedData.length) {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          dataHandler.handleData(client, receivedData);
        }
      });
    }
  });

  client.on('data', authDataHandler);
});

client.on('close', () => {
  console.log('Disconnected from xdrd');
});

client.on('error', (err) => {
  switch (true) {
    case err.message.includes("ECONNRESET"):
      logError("Connection to xdrd lost. Exiting...");
      break;

    case err.message.includes("ETIMEDOUT"):
      logError("Connection to xdrd @ " + xdrdServerHost + ":" + xdrdServerPort + " timed out.");
      break;

    default:
      logError("Unhandled error: ", err.message);
  }

  process.exit(1);
});


/* HTTP Server */

httpServer.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

httpServer.listen(webServerPort, webServerHost, () => {
  logInfo(`Web server is running at \x1b[34mhttp://${webServerHost}:${webServerPort}\x1b[0m.`);
});

/* Static data are being sent through here on connection - these don't change when the server is running */
app.get('/static_data', (req, res) => {
  res.json({ qthLatitude, qthLongitude, webServerName, audioPort, streamEnabled});
});
