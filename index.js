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
const process = require("process");

// Websocket handling
const WebSocket = require('ws');
const wss = new WebSocket.Server({ noServer: true });
const chatWss = new WebSocket.Server({ noServer: true });
const path = require('path');
const net = require('net');
const client = new net.Socket();

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
var pjson = require('./package.json');

console.log(`\x1b[32m
 _____ __  __       ______  __ __        __   _                                  
|  ___|  \\/  |     |  _ \\ \\/ / \\ \\      / /__| |__  ___  ___ _ ____   _____ _ __ 
| |_  | |\\/| |_____| | | \\  /   \\ \\ /\\ / / _ \\ '_ \\/ __|/ _ \\ '__\\ \\ / / _ \\ '__|
|  _| | |  | |_____| |_| /  \\    \\ V  V /  __/ |_) \\__ \\  __/ |   \\ V /  __/ |   
|_|   |_|  |_|     |____/_/\\_\\    \\_/\\_/ \\___|_.__/|___/\\___|_|    \\_/ \\___|_|                                                
`);
console.log('\x1b[0mFM-DX-Webserver', pjson.version);
console.log('\x1b[90m======================================================');



// Create a WebSocket proxy instance
const proxy = httpProxy.createProxyServer({
  target: 'ws://localhost:' + (Number(serverConfig.webserver.webserverPort) + 10), // WebSocket httpServer's address
  ws: true, // Enable WebSocket proxying
  changeOrigin: true // Change the origin of the host header to the target URL
});

let currentUsers = 0;
let connectedUsers = [];
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
              client.write('x\n');
              if(serverConfig.defaultFreq) {
                client.write('T' + Math.round(serverConfig.defaultFreq * 1000) +'\n')
              }
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
  if(serverConfig.autoShutdown === false) {
    logWarn('Disconnected from xdrd. Attempting to reconnect.');
    setTimeout(function () {
      connectToXdrd();
    }, 2000)
  } else {
    logWarn('Disconnected from xdrd.');
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
    streamEnabled: streamEnabled,
    presets: serverConfig.webserver.presets || [],
    defaultTheme: serverConfig.webserver.defaultTheme || 'theme1'
  });
});

app.get('/server_time', (req, res) => {
  /*const serverTime = new Date().toISOString(); // Get server time in ISO format
  const serverTimezoneOffset = new Date().getTimezoneOffset(); // Get server timezone offset in minutes*/

  const serverTime = new Date(); // Get current server time
  const serverTimeUTC = new Date(serverTime.getTime() - (serverTime.getTimezoneOffset() * 60000)); // Adjust server time to UTC
  res.json({
      serverTime: serverTimeUTC,
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

function parseMarkdown(parsed) {
  parsed = parsed.replace(/<\/?[^>]+(>|$)/g, '');

  var grayTextRegex = /--(.*?)--/g;
  parsed = parsed.replace(grayTextRegex, '<span class="text-gray">$1</span>');

  var boldRegex = /\*\*(.*?)\*\*/g;
  parsed = parsed.replace(boldRegex, '<strong>$1</strong>');

  var italicRegex = /\*(.*?)\*/g;
  parsed = parsed.replace(italicRegex, '<em>$1</em>');

  var linkRegex = /\[([^\]]+)]\(([^)]+)\)/g;
  parsed = parsed.replace(linkRegex, '<a href="$2">$1</a>');

  parsed = parsed.replace(/\n/g, '<br>');

  return parsed;
}

function removeMarkdown(parsed) {
  parsed = parsed.replace(/<\/?[^>]+(>|$)/g, '');

  var grayTextRegex = /--(.*?)--/g;
  parsed = parsed.replace(grayTextRegex, '$1');

  var boldRegex = /\*\*(.*?)\*\*/g;
  parsed = parsed.replace(boldRegex, '$1');

  var italicRegex = /\*(.*?)\*/g;
  parsed = parsed.replace(italicRegex, '$1');

  var linkRegex = /\[([^\]]+)]\(([^)]+)\)/g;
  parsed = parsed.replace(linkRegex, '$1');

  return parsed;
}

app.get('/', (req, res) => {
  if (!fs.existsSync(configName + '.json')) {
    parseAudioDevice((result) => {
      res.render('wizard', { 
        isAdminAuthenticated: true,
        videoDevices: result.audioDevices,
        audioDevices: result.videoDevices });
      });
  } else {
  res.render('index', { 
    isAdminAuthenticated: req.session.isAdminAuthenticated,
    isTuneAuthenticated: req.session.isTuneAuthenticated,
    tunerName: serverConfig.identification.tunerName,
    tunerDesc: parseMarkdown(serverConfig.identification.tunerDesc),
    tunerDescMeta: removeMarkdown(serverConfig.identification.tunerDesc),
    tunerLock: serverConfig.lockToAdmin,
    publicTuner: serverConfig.publicTuner,
    ownerContact: serverConfig.identification.contact,
    antennaSwitch: serverConfig.antennaSwitch,
    tuningLimit: serverConfig.webserver.tuningLimit,
    tuningLowerLimit: serverConfig.webserver.tuningLowerLimit,
    tuningUpperLimit: serverConfig.webserver.tuningUpperLimit,
    chatEnabled: serverConfig.webserver.chatEnabled,
   })
  }
});

app.get('/wizard', (req, res) => {
    parseAudioDevice((result) => {
      res.render('wizard', { 
        isAdminAuthenticated: req.session.isAdminAuthenticated,
        videoDevices: result.audioDevices,
        audioDevices: result.videoDevices });
      });
})

app.get('/setup', (req, res) => {
  parseAudioDevice((result) => {
    const processUptimeInSeconds = Math.floor(process.uptime());
    const formattedProcessUptime = formatUptime(processUptimeInSeconds);

    res.render('setup', { 
      isAdminAuthenticated: req.session.isAdminAuthenticated,
      videoDevices: result.audioDevices,
      audioDevices: result.videoDevices,
      memoryUsage: (process.memoryUsage.rss() / 1024 / 1024).toFixed(1) + ' MB',
      processUptime: formattedProcessUptime,
      consoleOutput: consoleCmd.logs,
      onlineUsers: dataHandler.dataToSend.users,
      connectedUsers: connectedUsers
    });
  });
});

app.get('/api', (req, res) => {
  let data = { ...dataHandler.dataToSend };
  delete data.ps_errors;
  delete data.rt0_errors;
  delete data.rt1_errors;
  delete data.ims;
  delete data.eq;
  delete data.ant;
  delete data.st_forced;
  delete data.previousFreq;
  delete data.txInfo;
  res.json(data);
});

function formatUptime(uptimeInSeconds) {
    const secondsInMinute = 60;
    const secondsInHour = secondsInMinute * 60;
    const secondsInDay = secondsInHour * 24;

    const days = Math.floor(uptimeInSeconds / secondsInDay);
    const hours = Math.floor((uptimeInSeconds % secondsInDay) / secondsInHour);
    const minutes = Math.floor((uptimeInSeconds % secondsInHour) / secondsInMinute);

    return `${days}d ${hours}h ${minutes}m`;
}



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
let lastDisconnectTime = null;

wss.on('connection', (ws, request) => {
  const clientIp = request.headers['x-forwarded-for'] || request.connection.remoteAddress;
  currentUsers++;
  dataHandler.showOnlineUsers(currentUsers);
  if(currentUsers > 0 && serverConfig.autoShutdown === true) {
    connectToXdrd(); 
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
        const options = { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' };
        const connectionTime = new Date().toLocaleString([], options);

        if(locationInfo.country === undefined) {
          const userData = { ip: clientIp, location: 'Unknown', time: connectionTime };
          connectedUsers.push(userData);
          logInfo(`Web client \x1b[32mconnected\x1b[0m (${clientIp}) \x1b[90m[${currentUsers}]\x1b[0m`);
        } else {
          const userLocation = `${locationInfo.city}, ${locationInfo.region}, ${locationInfo.country}`;
          const userData = { ip: clientIp, location: userLocation, time: connectionTime };
          connectedUsers.push(userData);
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

    if(command.startsWith('T')) {
      let tuneFreq = Number(command.slice(1)) / 1000;
      
      if(serverConfig.webserver.tuningLimit === true && (tuneFreq < serverConfig.webserver.tuningLowerLimit || tuneFreq > serverConfig.webserver.tuningUpperLimit)) {
        return;
      }
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
  
    // Find the index of the user's data in connectedUsers array
    const index = connectedUsers.findIndex(user => user.ip === clientIp);
    if (index !== -1) {
      connectedUsers.splice(index, 1); // Remove the user's data from connectedUsers array
    }

    if (currentUsers === 0 && serverConfig.defaultFreq && serverConfig.enableDefaultFreq && serverConfig.enableDefaultFreq === true) {
      setTimeout(function() {
        if(currentUsers === 0) {
          client.write('T' + Math.round(serverConfig.defaultFreq * 1000) +'\n');
          dataHandler.dataToSend.freq = Number(serverConfig.defaultFreq).toFixed(3);
        }
      }, 10000)
    }
  
    if (currentUsers === 0 && serverConfig.autoShutdown === true) {
      client.write('X\n');
    }

    logInfo(`Web client \x1b[31mdisconnected\x1b[0m (${clientIp}) \x1b[90m[${currentUsers}]`);
  });  

  ws.on('error', console.error);
});

// CHAT WEBSOCKET BLOCK
// Assuming chatWss is your WebSocket server instance
// Initialize an array to store chat messages
let chatHistory = [];

chatWss.on('connection', (ws, request) => {
  const clientIp = request.headers['x-forwarded-for'] || request.connection.remoteAddress;

  // Send chat history to the newly connected client
  chatHistory.forEach(function(message) {
    message.history = true; // Adding the history parameter
    ws.send(JSON.stringify(message));
  });

  const ipMessage = {
    type: 'clientIp',
    ip: clientIp,
    admin: request.session.isAdminAuthenticated
  };
  ws.send(JSON.stringify(ipMessage));
  
  ws.on('message', function incoming(message) {
    const messageData = JSON.parse(message);
    messageData.ip = clientIp; // Adding IP address to the message object
    const currentTime = new Date();
    
    const hours = String(currentTime.getHours()).padStart(2, '0');
    const minutes = String(currentTime.getMinutes()).padStart(2, '0');
    messageData.time = `${hours}:${minutes}`; // Adding current time to the message object in hours:minutes format

    if (serverConfig.webserver.banlist?.includes(clientIp)) {
      return; // Do not proceed further if banned
    }

    if(request.session.isAdminAuthenticated === true) {
      messageData.admin = true;
    }

    // Limit message length to 255 characters
    if (messageData.message.length > 255) {
      messageData.message = messageData.message.substring(0, 255);
    }

    // Add the new message to chat history and keep only the latest 50 messages
    chatHistory.push(messageData);
    if (chatHistory.length > 50) {
      chatHistory.shift(); // Remove the oldest message if the history exceeds 50 messages
    }
    
    const modifiedMessage = JSON.stringify(messageData);
    
    chatWss.clients.forEach(function each(client) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(modifiedMessage);
      }
    });
});

  ws.on('close', function close() {
  });
});


// Handle upgrade requests to /text and proxy /audio WebSocket connections
httpServer.on('upgrade', (request, socket, head) => {
  if (request.url === '/text') {
    sessionMiddleware(request, {}, () => {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    });
  } else if (request.url === '/audio') {
    proxy.ws(request, socket, head);
  } else if (request.url === '/chat') {
    sessionMiddleware(request, {}, () => {
      chatWss.handleUpgrade(request, socket, head, (ws) => {
        chatWss.emit('connection', ws, request);
      });
    });
  } else {
    socket.destroy();
  }
});

/* Serving of HTML files */
app.use(express.static(path.join(__dirname, 'web')));

httpServer.listen(serverConfig.webserver.webserverPort, serverConfig.webserver.webserverIp, () => {
  let currentAddress = serverConfig.webserver.webserverIp;
  currentAddress == '0.0.0.0' ? currentAddress = 'localhost' : currentAddress = serverConfig.webserver.webserverIp; 
  logInfo(`Web server is running at \x1b[34mhttp://${currentAddress}:${serverConfig.webserver.webserverPort}\x1b[0m.`);
});

fmdxList.update();
