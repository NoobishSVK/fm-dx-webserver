/**
 * LIBRARIES AND IMPORTS
 */

// Web handling
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const http = require('http');
const httpProxy = require('http-proxy');
const https = require('https');
const app = express();
const httpServer = http.createServer(app);

// Websocket handling
const WebSocket = require('ws');
const wss = new WebSocket.Server({ noServer: true });
const path = require('path');
const net = require('net');
const client = new net.Socket();

// Create a WebSocket proxy instance
const proxy = httpProxy.createProxyServer({
  target: 'ws://localhost:8081', // WebSocket httpServer's address
  ws: true, // Enable WebSocket proxying
  changeOrigin: true // Change the origin of the host header to the target URL
});

// Other files and libraries
const crypto = require('crypto');
const fs = require('fs');
const commandExists = require('command-exists-promise');
const dataHandler = require('./datahandler');
const fmdxList = require('./fmdx_list');
const consoleCmd = require('./console');
const audioStream = require('./stream/index.js');
const { parseAudioDevice } = require('./stream/parser.js');
const { configName, serverConfig, configUpdate, configSave } = require('./server_config');

const { logDebug, logError, logInfo, logWarn } = consoleCmd;

let currentUsers = 0;
let streamEnabled = false;
let incompleteDataBuffer = '';

app.use(bodyParser.urlencoded({ extended: true }));
const sessionMiddleware = session({
  secret: 'GTce3tN6U8odMwoI',
  resave: false,
  saveUninitialized: true,
});
app.use(sessionMiddleware);
app.use(bodyParser.json());

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

connectToXdrd();

// xdrd connection
function connectToXdrd() {
  if (serverConfig.xdrd.xdrdPassword.length > 1) {
    client.connect(serverConfig.xdrd.xdrdPort, serverConfig.xdrd.xdrdIp, () => {
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
            authenticateWithXdrd(client, authFlags.receivedSalt, serverConfig.xdrd.xdrdPassword);
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
            } else if (line.startsWith('G')) {
                switch (line) {
                  case 'G11':
                    dataHandler.initialData.eq = 1;
                    dataHandler.dataToSend.eq = 1;
                    dataHandler.initialData.ims = 1;
                    dataHandler.dataToSend.ims = 1;
                    break;
                  case 'G01':
                    dataHandler.initialData.eq = 0;
                    dataHandler.dataToSend.eq = 0;
                    dataHandler.initialData.ims = 1;
                    dataHandler.dataToSend.ims = 1;
                    break;
                  case 'G10':
                    dataHandler.initialData.eq = 1;
                    dataHandler.dataToSend.eq = 1;
                    dataHandler.initialData.ims = 0;
                    dataHandler.dataToSend.ims = 0;
                    break;
                  case 'G00':
                    dataHandler.initialData.eq = 0;
                    dataHandler.initialData.ims = 0;
                    dataHandler.dataToSend.eq = 0;
                    dataHandler.dataToSend.ims = 0;
                    break;
                  }
            }
            
            if (authFlags.authMsg && authFlags.firstClient) {
              client.write('T87500\n');
              client.write('A0\n');
              client.write('G00\n');
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
  }
}

client.on('close', () => {
  logWarn('Disconnected from xdrd. Attempting to reconnect.');
  if(serverConfig.autoShutdown === false) {
    setTimeout(function () {
      connectToXdrd();
    }, 2000)
  }
});

client.on('error', (err) => {
  switch (true) {
    case err.message.includes("ECONNRESET"):
      logError("Connection to xdrd lost. Reconnecting...");
      break;

    case err.message.includes("ETIMEDOUT"):
      logError("Connection to xdrd @ " + serverConfig.xdrd.xdrdIp + ":" + serverConfig.xdrd.xdrdPort + " timed out.");
      break;

    case err.message.includes("ECONNREFUSED"):
      logError("Connection to xdrd @ " + serverConfig.xdrd.xdrdIp + ":" + serverConfig.xdrd.xdrdPort + " failed. Is xdrd running?");
      break;

    case err.message.includes("EINVAL"):
      logError("Attempts to reconnect are failing repeatedly. Consider checking your settings or restarting xdrd.");
      break;

    default:
      logError("Unhandled error: ", err.message);
      break;
  }
});

/* Static data are being sent through here on connection - these don't change when the server is running */
app.get('/static_data', (req, res) => {
  res.json({
    qthLatitude: serverConfig.identification.lat,
    qthLongitude: serverConfig.identification.lon,
    audioPort: serverConfig.webserver.audioPort,
    streamEnabled: streamEnabled
  });
});

app.get('/server_time', (req, res) => {
  const serverTime = new Date().toISOString();
  res.json({
    serverTime
  });
});

app.get('/ping', (req, res) => {
  res.send('pong');
});


/**
 * AUTHENTICATION BLOCK
 */
const authenticate = (req, res, next) => {
  const { password } = req.body;

  // Check if the entered password matches the admin password
  if (password === serverConfig.password.adminPass) {
    req.session.isAdminAuthenticated = true;
    req.session.isTuneAuthenticated = true;
    logInfo('User from ' + req.connection.remoteAddress + ' logged in as an administrator.');
    next();
  } else if (password === serverConfig.password.tunePass) {
    req.session.isAdminAuthenticated = false;
    req.session.isTuneAuthenticated = true;
    logInfo('User from ' + req.connection.remoteAddress + ' logged in with tune permissions.');
    next();
  } else {
    res.status(403).json({ message: 'Login failed. Wrong password?' });
  }
};

app.set('view engine', 'ejs'); // Set EJS as the template engine
app.set('views', path.join(__dirname, '/web'))

app.get('/', (req, res) => {
  if (!fs.existsSync(configName + '.json')) {
    parseAudioDevice((result) => {
      res.render('setup', { 
        isAdminAuthenticated: true,
        videoDevices: result.audioDevices,
        audioDevices: result.videoDevices,
        consoleOutput: consoleCmd.logs });
      });;
  } else {
  res.render('index', { 
    isAdminAuthenticated: req.session.isAdminAuthenticated,
    isTuneAuthenticated: req.session.isTuneAuthenticated,
    tunerName: serverConfig.identification.tunerName,
    tunerDesc: serverConfig.identification.tunerDesc,
    tunerLock: serverConfig.lockToAdmin,
    publicTuner: serverConfig.publicTuner
   })
  }
});

app.get('/setup', (req, res) => {
  parseAudioDevice((result) => {
  res.render('setup', { 
    isAdminAuthenticated: req.session.isAdminAuthenticated,
    videoDevices: result.audioDevices,
    audioDevices: result.videoDevices,
    consoleOutput: consoleCmd.logs });
  });
});


// Route for login
app.post('/login', authenticate, (req, res) => {
  // Redirect to the main page after successful login
  res.status(200).json({ message: 'Logged in successfully, refreshing the page...' });
});

app.get('/logout', (req, res) => {
  // Clear the session and redirect to the main page
  req.session.destroy(() => {
    res.status(200).json({ message: 'Logged out successfully, refreshing the page...' });
  });
});

app.post('/saveData', (req, res) => {
  const data = req.body;
  let firstSetup;
  if(req.session.isAdminAuthenticated || !fs.existsSync(configName + '.json')) {
    configUpdate(data);
    fmdxList.update();

    if(!fs.existsSync(configName + '.json')) {
      firstSetup = true;
    }

    /* TODO: Refactor to server_config.js */
    // Save data to a JSON file
    fs.writeFile(configName + '.json', JSON.stringify(serverConfig, null, 2), (err) => {
      if (err) {
        logError(err);
        res.status(500).send('Internal Server Error');
      } else {
        logInfo('Server config changed successfully.');
        if(firstSetup === true) {
          res.status(200).send('Data saved successfully!\nPlease, restart the server to load your configuration.');
        } else {
        res.status(200).send('Data saved successfully!\nSome settings may need a server restart to apply.');
        }
      }
    });
  }
});

// Serve the data.json file when the /getData endpoint is accessed
app.get('/getData', (req, res) => {  
  if(req.session.isAdminAuthenticated) {
    // Check if the file exists
    fs.access(configName + '.json', fs.constants.F_OK, (err) => {
      if (err) {
        // File does not exist
        res.status(404).send('Data not found');
      } else {
        // File exists, send it as the response
        res.sendFile(path.join(__dirname) + '/' + configName + '.json');
      }
    });
  }
});

app.get('/getDevices', (req, res) => {
  if (req.session.isAdminAuthenticated || !fs.existsSync(configName + '.json')) {
    parseAudioDevice((result) => {
        res.json(result);
    });
  } else {
    res.status(403).json({ error: 'Unauthorized' });
  }
});

/**
 * WEBSOCKET BLOCK
 */

wss.on('connection', (ws, request) => {
  const clientIp = request.headers['x-forwarded-for'] || request.connection.remoteAddress;
  currentUsers++;
  dataHandler.showOnlineUsers(currentUsers);
  if(currentUsers > 0 && serverConfig.autoShutdown === true) {
    client.write('x\n'); 
  }

  // Use ipinfo.io API to get geolocation information
  https.get(`https://ipinfo.io/${clientIp}/json`, (response) => {
    let data = '';

    response.on('data', (chunk) => {
      data += chunk;
    });

    response.on('end', () => {
      try {
        const locationInfo = JSON.parse(data);
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
    logDebug('Command received from \x1b[90m' + clientIp + '\x1b[0m:', message.toString());
    command = message.toString();

    if(command.startsWith('X')) {
      logWarn('Remote tuner shutdown attempted by \x1b[90m' + clientIp + '\x1b[0m. You may consider blocking this user.');
      return;
    }

    if((serverConfig.publicTuner === true) || (request.session && request.session.isTuneAuthenticated === true)) {

      if(serverConfig.lockToAdmin === true) {
        if(request.session && request.session.isAdminAuthenticated === true) {
          client.write(command + "\n");
        } else {
          return;
        }
      } else {
        client.write(command + "\n");
      }
    }
  });

  ws.on('close', (code, reason) => {
    currentUsers--;
    dataHandler.showOnlineUsers(currentUsers);
    if(currentUsers === 0 && serverConfig.autoShutdown === true) {
      client.write('X\n'); 
    }
    logInfo(`Web client \x1b[31mdisconnected\x1b[0m (${clientIp}) \x1b[90m[${currentUsers}]`);
  });

  ws.on('error', console.error);
});

// Handle upgrade requests to proxy WebSocket connections
httpServer.on('upgrade', (request, socket, head) => {
  if (request.url === '/text') {
    sessionMiddleware(request, {}, () => {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    });
  } else if (request.url === '/audio') {
    proxy.ws(request, socket, head);
  } else {
    socket.destroy();
  }
}
);

/* Serving of HTML files */
app.use(express.static(path.join(__dirname, 'web')));

httpServer.listen(serverConfig.webserver.webserverPort, serverConfig.webserver.webserverIp, () => {
  let currentAddress = serverConfig.webserver.webserverIp;
  currentAddress == '0.0.0.0' ? currentAddress = 'localhost' : currentAddress = serverConfig.webserver.webserverIp; 
  logInfo(`Web server is running at \x1b[34mhttp://${currentAddress}:${serverConfig.webserver.webserverPort}\x1b[0m.`);
});

fmdxList.update();
