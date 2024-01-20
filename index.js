// Libraries
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const net = require('net');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

let receivedSalt = '';
let receivedPassword = false;
let currentUsers = 0;

const infoMsg = "\x1b[32m[INFO]\x1b[0m";
const debugMsg = "\x1b[36m[DEBUG]\x1b[0m";

// Other JS files
const dataHandler = require('./datahandler');
const config = require('./userconfig');

/* Server settings */
const { webServerHost, webServerPort, xdrdServerHost, xdrdServerPort, xdrdPassword, qthLatitude, qthLongitude } = config;

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
  console.log(infoMsg, `WebSocket client connected\nIP: ${clientIp}\nUsers online: ${currentUsers}`);

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
    console.log(infoMsg, `WebSocket client disconnected\nIP: ${clientIp}\nCode: ${code} ${reason}\nUsers online: ${currentUsers}`);
  });

  ws.on('error', console.error);

});

// Serve static files from the "web" folder
app.use(express.static(path.join(__dirname, 'web')));

// Function to authenticate with the xdrd server
function authenticateWithXdrd(client, salt, password) {
  const sha1 = crypto.createHash('sha1');

  // Convert salt and password to buffers
  const saltBuffer = Buffer.from(salt, 'utf-8');
  const passwordBuffer = Buffer.from(password, 'utf-8');

  // Update the hash context with salt and password
  sha1.update(saltBuffer);
  sha1.update(passwordBuffer);

  // Finalize the hash and get the hashed password
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

    // Assuming that the first message contains the salt
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


app.get('/coordinates', (req, res) => {
  // Sending the coordinates to the client
  res.json({ qthLatitude, qthLongitude });
});
/* Audio */

app.get('/audio-proxy', (req, res) => {
  const audioStreamUrl = 'http://fmdx.pl:8000/noobish.opus';

  axios.get(audioStreamUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    },
    responseType: 'stream', // Specify the response type as a stream
  })
  .then((response) => {
    const contentType = response.headers['content-type'] || 'audio/ogg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    console.log(contentType);
    response.data.pipe(res);
  })
  .catch((error) => {
    console.error('Error in audio proxy request:', error);
    res.status(500).send('Error in audio proxy request');
  });
});

app.use('/audio-proxy', cors());