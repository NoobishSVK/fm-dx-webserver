/* Libraries / Imports */
const express = require('express');
const app = express();
const http = require('http');
const httpServer = http.createServer(app);
const WebSocket = require('ws');
const wss = new WebSocket.Server({ noServer: true });
const path = require('path');
const net = require('net');
const client = new net.Socket();
const crypto = require('crypto');
const dataHandler = require('./datahandler');
const consoleCmd = require('./console');
const config = require('./userconfig');

const { webServerHost, webServerPort, webServerName, xdrdServerHost, xdrdServerPort, xdrdPassword, qthLatitude, qthLongitude } = config;
const { logInfo, logDebug } = consoleCmd;

let receivedSalt = '';
let receivedPassword = false;
let currentUsers = 0;

/* webSocket handlers */
wss.on('connection', (ws, request) => {
  const clientIp = request.connection.remoteAddress;
  currentUsers++;
  dataHandler.showOnlineUsers(currentUsers);
  consoleCmd.logInfo(`Web client \x1b[32mconnected\x1b[0m (${clientIp}) \x1b[90m[${currentUsers}]`);

  ws.on('message', (message) => {
    consoleCmd.logDebug('Received message from client:', message.toString());
    newFreq = message.toString() * 1000; 
    client.write("T" + newFreq + '\n');
  });

  ws.on('close', (code, reason) => {
    currentUsers--;
    dataHandler.showOnlineUsers(currentUsers);
    consoleCmd.logInfo(`Web client \x1b[31mdisconnected\x1b[0m (${clientIp}) \x1b[90m[${currentUsers}]`);
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
  consoleCmd.logInfo('Connection to xdrd established successfully.');

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
          consoleCmd.logWarn('Authentication with xdrd failed. Is your password set correctly?');
        } else if (line.startsWith('o1,')) {
          authFlags.firstClient = true;
        } else if (line.startsWith('T') && line.length <= 7) {
          const freq = line.slice(1) / 1000;
          dataHandler.dataToSend.freq = freq.toFixed(3);
        } else if (line.startsWith('OK')) {
          authFlags.authMsg = true;
          consoleCmd.logInfo('Authentication with xdrd successful.');
        }

        if (authFlags.authMsg && authFlags.firstClient) {
          client.write('T87500\n');
          client.off('data', authDataHandler);
          return;
        }
      }
    }
  };

  client.on('data', (data) => {
    const receivedData = data.toString();

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        dataHandler.handleData(client, receivedData);
      }
    });
  });

  client.on('data', authDataHandler);
});

client.on('close', () => {
  console.log('Disconnected from xdrd');
});

/* HTTP Server */

httpServer.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

httpServer.listen(webServerPort, webServerHost, () => {
  consoleCmd.logInfo(`Web server is running at \x1b[34mhttp://${webServerHost}:${webServerPort}\x1b[0m.`);
});

/* Static data are being sent through here on connection - these don't change when the server is running */
app.get('/static_data', (req, res) => {
  res.json({ qthLatitude, qthLongitude, webServerName });
});