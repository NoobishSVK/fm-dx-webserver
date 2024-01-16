// Libraries
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const net = require('net');
const cors = require('cors');
const axios = require('axios');

// Other JS files
const dataHandler = require('./datahandler');

/* Server settings */
const webServerHost = '192.168.1.14'; // IP of the web server
const webServerPort = 8080; // web server port

const xdrdServerHost = '192.168.1.15'; // xdrd server iP
const xdrdServerPort = 7373; // xdrd server port

const wss = new WebSocket.Server({ noServer: true });

const app = express();
const httpServer = http.createServer(app);


/* webSocket handlers */
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');

  ws.on('message', (message) => {
    console.log('Received message from client:', message);
  });
});


// Serve static files from the "web" folder
app.use(express.static(path.join(__dirname, 'web')));

/* connection to xdrd */
const client = new net.Socket();

client.connect(xdrdServerPort, xdrdServerHost, () => {
  console.log('Connected to xdrd');
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

client.write('x');

/* HTTP Server */

httpServer.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

httpServer.listen(webServerPort, webServerHost, () => {
  console.log(`Web server is running at http://${webServerHost}:${webServerPort}`);
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