// Library imports
const express = require('express');
const endpoints = require('./endpoints');
const session = require('express-session');
const bodyParser = require('body-parser');
const http = require('http');
const httpProxy = require('http-proxy');
const https = require('https');
const app = express();
const httpServer = http.createServer(app);
const WebSocket = require('ws');
const wss = new WebSocket.Server({ noServer: true });
const chatWss = new WebSocket.Server({ noServer: true });
const path = require('path');
const net = require('net');
const client = new net.Socket();
const crypto = require('crypto');
const { SerialPort } = require('serialport')

// File imports
const helpers = require('./helpers');
const dataHandler = require('./datahandler');
const fmdxList = require('./fmdx_list');
const { logDebug, logError, logInfo, logWarn, logChat } = require('./console');
const storage = require('./storage');
const { serverConfig, configExists } = require('./server_config');
const pjson = require('../package.json');

console.log(`\x1b[32m
 _____ __  __       ______  __ __        __   _                                  
|  ___|  \\/  |     |  _ \\ \\/ / \\ \\      / /__| |__  ___  ___ _ ____   _____ _ __ 
| |_  | |\\/| |_____| | | \\  /   \\ \\ /\\ / / _ \\ '_ \\/ __|/ _ \\ '__\\ \\ / / _ \\ '__|
|  _| | |  | |_____| |_| /  \\    \\ V  V /  __/ |_) \\__ \\  __/ |   \\ V /  __/ |   
|_|   |_|  |_|     |____/_/\\_\\    \\_/\\_/ \\___|_.__/|___/\\___|_|    \\_/ \\___|_|                                                
`);
console.log('\x1b[0mFM-DX-Webserver', pjson.version);
console.log('\x1b[90m―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――');

// Start ffmpeg
require('./stream/index');
require('./plugins');

// Create a WebSocket proxy instance
const proxy = httpProxy.createProxyServer({
  target: 'ws://localhost:' + (Number(serverConfig.webserver.webserverPort) + 10), // WebSocket httpServer's address
  ws: true, // Enable WebSocket proxying
  changeOrigin: true // Change the origin of the host header to the target URL
});

let currentUsers = 0;
let serialport;

app.use(bodyParser.urlencoded({ extended: true }));
const sessionMiddleware = session({
  secret: 'GTce3tN6U8odMwoI',
  resave: false,
  saveUninitialized: true,
});
app.use(sessionMiddleware);
app.use(bodyParser.json());

connectToXdrd();
connectToSerial();

// Serial Connection
function connectToSerial() {
  if (serverConfig.xdrd.wirelessConnection === false) {
    
    serialport = new SerialPort({path: serverConfig.xdrd.comPort, baudRate: 115200 });

    serialport.on('open', () => {
      logInfo('Using COM device: ' + serverConfig.xdrd.comPort);
      serialport.write('x\n');
	  setTimeout(() => {
		serialport.write('Q0\n');
		serialport.write('M0\n');
		serialport.write('Z0\n');

		if(serverConfig.defaultFreq && serverConfig.enableDefaultFreq === true) {
			serialport.write('T' + Math.round(serverConfig.defaultFreq * 1000) +'\n');
			dataHandler.initialData.freq = Number(serverConfig.defaultFreq).toFixed(3);
			dataHandler.dataToSend.freq = Number(serverConfig.defaultFreq).toFixed(3);
		} else {
			serialport.write('T87500\n');
		}

		serialport.write('A0\n');
		serialport.write('F-1\n');
		serialport.write('W0\n');
		serialport.write('D0\n');
		serialport.write('G00\n');
		serverConfig.audio.startupVolume ? serialport.write('Y' + (serverConfig.audio.startupVolume * 100).toFixed(0) + '\n') : serialport.write('Y100\n');
	  }, 3000);
      
      serialport.on('data', (data) => {
        helpers.resolveDataBuffer(data, wss);
      });
    });

    serialport.on('error', (error) => {
      logError(error.message);
    });

    return serialport;
  }
}

// xdrd connection
function connectToXdrd() {
  const { xdrd } = serverConfig;

  if (xdrd.wirelessConnection) {
    client.connect(xdrd.xdrdPort, xdrd.xdrdIp, () => {
      logInfo('Connection to xdrd established successfully.');
      
      let authFlags = {
        authMsg: false,
        firstClient: false,
        receivedSalt: '',
        receivedPassword: false,
        messageCount: 0,
      };
      
      const authDataHandler = (data) => {
        authFlags.messageCount++
        const receivedData = data.toString();
        const lines = receivedData.split('\n');

        for (const line of lines) {
          if (authFlags.receivedPassword === false) {
            authFlags.receivedSalt = line.trim();
            authFlags.receivedPassword = true;
            authenticateWithXdrd(client, authFlags.receivedSalt, xdrd.xdrdPassword);
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
              const value = line.substring(1); 
              dataHandler.initialData.eq = value.charAt(0);
              dataHandler.dataToSend.eq = value.charAt(0); 
              dataHandler.initialData.ims = value.charAt(1); 
              dataHandler.dataToSend.ims = value.charAt(1);         
            } else if (line.startsWith('Z')) {
              let modifiedLine = line.slice(1);
              dataHandler.initialData.ant = modifiedLine;
              dataHandler.dataToSend.ant = modifiedLine;
            }
            
            if (authFlags.authMsg === true && authFlags.firstClient === true) {
              client.write('x\n');
              client.write(serverConfig.defaultFreq && serverConfig.enableDefaultFreq === true ? 'T' + Math.round(serverConfig.defaultFreq * 1000) + '\n' : 'T87500\n');
              dataHandler.initialData.freq = serverConfig.defaultFreq && serverConfig.enableDefaultFreq === true ? Number(serverConfig.defaultFreq).toFixed(3) : (87.5).toFixed(3);
              dataHandler.dataToSend.freq = serverConfig.defaultFreq && serverConfig.enableDefaultFreq === true ? Number(serverConfig.defaultFreq).toFixed(3) : (87.5).toFixed(3);
              client.write('A0\n');
              client.write(serverConfig.audio.startupVolume ? 'Y' + (serverConfig.audio.startupVolume * 100).toFixed(0) + '\n' : 'Y100\n');
              client.off('data', authDataHandler);
              return;
            }
          }
        }
      };
      
      client.on('data', (data) => {
        helpers.resolveDataBuffer(data, wss);
        if (authFlags.authMsg == true && authFlags.messageCount > 1) {
          // If the limit is reached, remove the 'data' event listener
          client.off('data', authDataHandler);
          return;
          }
          authDataHandler(data);
      });
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

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../web'));
app.use('/', endpoints);

/**
 * WEBSOCKET BLOCK
 */
wss.on('connection', (ws, request) => {
  const output = serverConfig.xdrd.wirelessConnection ? client : serialport;
  const clientIp = request.headers['x-forwarded-for'] || request.connection.remoteAddress;
  currentUsers++;
  dataHandler.showOnlineUsers(currentUsers);
  if(currentUsers === 1 && serverConfig.autoShutdown === true && serverConfig.xdrd.wirelessConnection) {
    serverConfig.xdrd.wirelessConnection === true ? connectToXdrd() : serialport.write('x\n');
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
          const userData = { ip: clientIp, location: 'Unknown', time: connectionTime, instance: ws };
          storage.connectedUsers.push(userData);
          logInfo(`Web client \x1b[32mconnected\x1b[0m (${clientIp}) \x1b[90m[${currentUsers}]\x1b[0m`);
        } else {
          const userLocation = `${locationInfo.city}, ${locationInfo.region}, ${locationInfo.country}`;
          const userData = { ip: clientIp, location: userLocation, time: connectionTime, instance: ws };
          storage.connectedUsers.push(userData);
          logInfo(`Web client \x1b[32mconnected\x1b[0m (${clientIp}) \x1b[90m[${currentUsers}]\x1b[0m Location: ${locationInfo.city}, ${locationInfo.region}, ${locationInfo.country}`);
        }
      } catch (error) {
        logInfo(`Web client \x1b[32mconnected\x1b[0m (${clientIp}) \x1b[90m[${currentUsers}]\x1b[0m`);
      }
    });
  });

  ws.on('message', (message) => {
    const command = message.toString();
    logDebug(`Command received from \x1b[90m${clientIp}\x1b[0m: ${command}`);

    if ((command.startsWith('X') || command.startsWith('Y')) && !request.session.isAdminAuthenticated) {
        logWarn(`User \x1b[90m${clientIp}\x1b[0m attempted to send a potentially dangerous command. You may consider blocking this user.`);
        return;
    }

    if (command.includes("\'")) {
        return;
    }

    if (command.startsWith('w') && request.session.isAdminAuthenticated) {
        switch (command) {
            case 'wL1':
                serverConfig.lockToAdmin = true;
                break;
            case 'wL0':
                serverConfig.lockToAdmin = false;
                break;
            case 'wT0':
                serverConfig.publicTuner = true;
                break;
            case 'wT1':
                serverConfig.publicTuner = false;
                break;
            default:
                break;
        }
    }

    if (command.startsWith('T')) {
        const tuneFreq = Number(command.slice(1)) / 1000;
        const { tuningLimit, tuningLowerLimit, tuningUpperLimit } = serverConfig.webserver;
        
        if (tuningLimit && (tuneFreq < tuningLowerLimit || tuneFreq > tuningUpperLimit) || isNaN(tuneFreq)) {
            return;
        }
    }

    const { isAdminAuthenticated, isTuneAuthenticated } = request.session || {};  

    if (serverConfig.publicTuner && !serverConfig.lockToAdmin) {
      output.write(`${command}\n`);
    } else {
      if (serverConfig.lockToAdmin) {
        if(isAdminAuthenticated) {
          output.write(`${command}\n`);
        }
      } else {
        if(isTuneAuthenticated) {
          output.write(`${command}\n`);
        }
      }
    }
    
  });

  ws.on('close', (code, reason) => {
    currentUsers--;
    dataHandler.showOnlineUsers(currentUsers);
  
    // Find the index of the user's data in storage.connectedUsers array
    const index = storage.connectedUsers.findIndex(user => user.ip === clientIp);
    if (index !== -1) {
      storage.connectedUsers.splice(index, 1); // Remove the user's data from storage.connectedUsers array
    }

    if(currentUsers === 0) {
      storage.connectedUsers = [];
    }

    if (currentUsers === 0 && serverConfig.enableDefaultFreq === true && serverConfig.autoShutdown !== true && serverConfig.xdrd.wirelessConnection === true) {
      setTimeout(function() {
        if(currentUsers === 0) {
          output.write('T' + Math.round(serverConfig.defaultFreq * 1000) +'\n');
          dataHandler.resetToDefault(dataHandler.dataToSend);
          dataHandler.dataToSend.freq = Number(serverConfig.defaultFreq).toFixed(3);
          dataHandler.initialData.freq = Number(serverConfig.defaultFreq).toFixed(3);
        }
      }, 10000)
    }
  
    if (currentUsers === 0 && serverConfig.autoShutdown === true && serverConfig.xdrd.wirelessConnection === true) {
      client.write('X\n');
    }

    logInfo(`Web client \x1b[31mdisconnected\x1b[0m (${clientIp}) \x1b[90m[${currentUsers}]`);
  });  

  ws.on('error', console.error);
});

// CHAT WEBSOCKET BLOCK
chatWss.on('connection', (ws, request) => {
  const clientIp = request.headers['x-forwarded-for'] || request.connection.remoteAddress;

  // Send chat history to the newly connected client
  storage.chatHistory.forEach(function(message) {
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
      return;
    }

    if(request.session.isAdminAuthenticated === true) {
      messageData.admin = true;
    }

    if (messageData.message.length > 255) {
      messageData.message = messageData.message.substring(0, 255);
    }

    storage.chatHistory.push(messageData);
    if (storage.chatHistory.length > 50) {
      storage.chatHistory.shift();
    }
    logChat(messageData);
    
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

// Websocket register for /text, /audio and /chat paths 
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

app.use(express.static(path.join(__dirname, '../web'))); // Serve the entire web folder to the user

httpServer.listen(serverConfig.webserver.webserverPort, serverConfig.webserver.webserverIp, () => {
  let currentAddress = serverConfig.webserver.webserverIp;
  currentAddress == '0.0.0.0' ? currentAddress = 'localhost' : currentAddress = serverConfig.webserver.webserverIp; 
  if(configExists()) {
    logInfo(`Web server has started on address \x1b[34mhttp://${currentAddress}:${serverConfig.webserver.webserverPort}\x1b[0m.`);
  } else {
    logInfo(`Open your browser and proceed to \x1b[34mhttp://${currentAddress}:${serverConfig.webserver.webserverPort}\x1b[0m to continue with setup.`);
  }
});

fmdxList.update();
