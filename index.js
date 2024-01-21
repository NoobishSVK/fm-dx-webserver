// Libraries
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const dataHandler = require('./datahandler');
const config = require('./userconfig');

/* Server settings */
const { webServerHost, webServerPort, webServerName, xdrdServerHost, xdrdServerPort, xdrdPassword, qthLatitude, qthLongitude } = config;

const infoMsg = "\x1b[32m[INFO]\x1b[0m";
const debugMsg = "\x1b[36m[DEBUG]\x1b[0m";

let receivedSalt = '';
let receivedPassword = false;
let currentUsers = 0;

const wss = new WebSocket.Server({ noServer: true });

const app = express();
const httpServer = http.createServer(app);
/* connection to xdrd */
const client = new net.Socket();

/* webSocket handlers */
wss.on('connection', (ws, request) => {
  const clientIp = request.connection.remoteAddress;
  currentUsers++;
  dataHandler.showOnlineUsers(currentUsers);
  console.log(infoMsg, `Web client \x1b[32mconnected\x1b[0m (${clientIp}) \x1b[90m[${currentUsers}]`);

  ws.on('message', (message) => {
    if(config.verboseMode === true) {
      console.log(debugMsg,'Received message from client:', message.toString());
    }
    newFreq = message.toString() * 1000; 
    client.write("T" + newFreq + '\n');
  });

  ws.on('close', (code, reason) => {
    currentUsers--;
    dataHandler.showOnlineUsers(currentUsers);
    console.log(infoMsg, `Web client \x1b[31mdisconnected\x1b[0m (${clientIp}) \x1b[90m[${currentUsers}]`);
  });

  ws.on('error', console.error);

});

// Serve static files from the "web" folder
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
  console.log(infoMsg, 'Connected to xdrd successfully.');
  
  client.once('data', (data) => {
    const receivedData = data.toString();
    const lines = receivedData.split('\n');

    // Salt reading, so we can authenticate
    if (lines.length > 0 && !receivedPassword) {
      receivedSalt = lines[0].trim();
      authenticateWithXdrd(client, receivedSalt, xdrdPassword);
      receivedPassword = true;
    }
  });
});

client.on('data', (data) => {
  const receivedData = data.toString();

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      dataHandler.handleData(client, receivedData);
    }
  });
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
  console.log(infoMsg, `Web server is running at \x1b[34mhttp://${webServerHost}:${webServerPort}\x1b[0m.`);
});


app.get('/static_data', (req, res) => {
  res.json({ qthLatitude, qthLongitude, webServerName });
});