// Library imports
const express = require('express');
const endpoints = require('./endpoints');
const session = require('express-session');
const bodyParser = require('body-parser');
const http = require('http');
const httpProxy = require('http-proxy');
const readline = require('readline');
const app = express();
const httpServer = http.createServer(app);
const WebSocket = require('ws');
const wss = new WebSocket.Server({ noServer: true, perMessageDeflate: true });
const chatWss = new WebSocket.Server({ noServer: true });
const rdsWss = new WebSocket.Server({ noServer: true });
const pluginsWss = new WebSocket.Server({ noServer: true, perMessageDeflate: true });
const fs = require('fs');
const path = require('path');
const net = require('net');
const client = new net.Socket();
const { SerialPort } = require('serialport');
const tunnel = require('./tunnel');

// File imports
const helpers = require('./helpers');
const dataHandler = require('./datahandler');
const fmdxList = require('./fmdx_list');
const { logDebug, logError, logInfo, logWarn, logChat } = require('./console');
const storage = require('./storage');
const { serverConfig, configExists, configSave } = require('./server_config');
const pjson = require('../package.json');

// Function to find server files based on the plugins listed in config
function findServerFiles(plugins) {
  let results = [];
  plugins.forEach(plugin => {
    // Remove .js extension if present
    if (plugin.endsWith('.js')) {
      plugin = plugin.slice(0, -3);
    }
	
    const pluginPath = path.join(__dirname, '..', 'plugins', `${plugin}_server.js`);
    if (fs.existsSync(pluginPath) && fs.statSync(pluginPath).isFile()) {
      results.push(pluginPath);
    }
  });
  return results;
}

// Start plugins with delay
function startPluginsWithDelay(plugins, delay) {
  plugins.forEach((pluginPath, index) => {
    setTimeout(() => {
      const pluginName = path.basename(pluginPath, '.js'); // Extract plugin name from path
      logInfo(`-----------------------------------------------------------------`);
      logInfo(`Plugin ${pluginName} loaded successfully!`);
      require(pluginPath);
    }, delay * index);
  });

  // Add final log line after all plugins are loaded
  setTimeout(() => {
    logInfo(`-----------------------------------------------------------------`);
  }, delay * plugins.length);
}

// Get all plugins from config and find corresponding server files
const plugins = findServerFiles(serverConfig.plugins);

// Start the first plugin after 3 seconds, then the rest with 3 seconds delay
if (plugins.length > 0) {
  setTimeout(() => {
    startPluginsWithDelay(plugins, 3000); // Start plugins with 3 seconds interval
  }, 3000); // Initial delay of 3 seconds for the first plugin
}

const terminalWidth = readline.createInterface({
  input: process.stdin,
  output: process.stdout
}).output.columns;


console.log(`\x1b[32m
 _____ __  __       ______  __ __        __   _                                  
|  ___|  \\/  |     |  _ \\ \\/ / \\ \\      / /__| |__  ___  ___ _ ____   _____ _ __ 
| |_  | |\\/| |_____| | | \\  /   \\ \\ /\\ / / _ \\ '_ \\/ __|/ _ \\ '__\\ \\ / / _ \\ '__|
|  _| | |  | |_____| |_| /  \\    \\ V  V /  __/ |_) \\__ \\  __/ |   \\ V /  __/ |   
|_|   |_|  |_|     |____/_/\\_\\    \\_/\\_/ \\___|_.__/|___/\\___|_|    \\_/ \\___|_|                                                
`);
console.log('\x1b[32m\x1b[2mby Noobish @ \x1b[4mFMDX.org\x1b[0m');
console.log("v" + pjson.version)
console.log('\x1b[90m' + '─'.repeat(terminalWidth - 1) + '\x1b[0m');

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
let timeoutAntenna;

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
tunnel.connect();

// Serialport retry code when port is open but communication is lost (additional code in datahandler.js)
dataHandler.state.isSerialportRetrying = false;

setInterval(() => {
  if (!dataHandler.state.isSerialportAlive && serverConfig.xdrd.wirelessConnection === false) {
    dataHandler.state.isSerialportAlive = true;
    dataHandler.state.isSerialportRetrying = true;
    if (serialport && serialport.isOpen) {
      logWarn('Communication lost from ' + serverConfig.xdrd.comPort + ', force closing serialport.');
      setTimeout(() => {
        serialport.close((err) => {
          if (err) {
            logError('Error closing serialport: ', err.message);
          }
        });
      }, 1000);
    } else {
      logWarn('Communication lost from ' + serverConfig.xdrd.comPort + '.');
    }
  }
}, 2000);

// Serial Connection
function connectToSerial() {
if (serverConfig.xdrd.wirelessConnection === false) {
    
  // Configure the SerialPort with DTR and RTS options
  serialport = new SerialPort({
    path: serverConfig.xdrd.comPort,
    baudRate: 115200,
    autoOpen: false, // Prevents automatic opening
    dtr: false, // Disable DTR
    rts: false  // Disable RTS
  });

  // Open the port manually after configuring DTR and RTS
  serialport.open((err) => {
    if (err) {
      logError('Error opening port: ' + err.message);
      setTimeout(() => {
          connectToSerial();
      }, 5000);
      return;
    }
    
    logInfo('Using COM device: ' + serverConfig.xdrd.comPort);
    dataHandler.state.isSerialportAlive = true;
    setTimeout(() => {
        serialport.write('x\n');
    }, 3000);
    
    setTimeout(() => {
      serialport.write('Q0\n');
      serialport.write('M0\n');
      serialport.write(`Z${serverConfig.antennaStartup}\n`); // Antenna on startup

      if (serverConfig.defaultFreq && serverConfig.enableDefaultFreq === true) {
        serialport.write('T' + Math.round(serverConfig.defaultFreq * 1000) + '\n');
        dataHandler.initialData.freq = Number(serverConfig.defaultFreq).toFixed(3);
        dataHandler.dataToSend.freq = Number(serverConfig.defaultFreq).toFixed(3);
      } else if (dataHandler.state.lastFrequencyAlive && dataHandler.state.isSerialportRetrying) { // Serialport retry code when port is open but communication is lost
        serialport.write('T' + (dataHandler.state.lastFrequencyAlive * 1000) + '\n');
      } else {
        serialport.write('T87500\n');
      }
      dataHandler.state.isSerialportRetrying = false;

      serialport.write('A0\n');
      serialport.write('F-1\n');
      serialport.write('W0\n');
      serverConfig.webserver.rdsMode ? serialport.write('D1\n') : serialport.write('D0\n');
      // cEQ and iMS combinations
      if (serverConfig.ceqStartup === "0" && serverConfig.imsStartup === "0") {
        serialport.write("G00\n"); // Both Disabled
      } else if (serverConfig.ceqStartup === "1" && serverConfig.imsStartup === "0") {
        serialport.write(`G10\n`);
      } else if (serverConfig.ceqStartup === "0" && serverConfig.imsStartup === "1") {
        serialport.write(`G01\n`);
      } else if (serverConfig.ceqStartup === "1" && serverConfig.imsStartup === "1") {
        serialport.write("G11\n"); // Both Enabled
      }
      // Handle stereo mode
      if (serverConfig.stereoStartup === "1") {
        serialport.write("B1\n"); // Mono
      }
      serverConfig.audio.startupVolume 
        ? serialport.write('Y' + (serverConfig.audio.startupVolume * 100).toFixed(0) + '\n') 
        : serialport.write('Y100\n');
    }, 6000);
    
    serialport.on('data', (data) => {
      helpers.resolveDataBuffer(data, wss, rdsWss);
    });

    serialport.on('error', (error) => {
      logError(error.message);
    });
  });

  // Handle port closure
  serialport.on('close', () => {
    logWarn('Disconnected from ' + serverConfig.xdrd.comPort + '. Attempting to reconnect.');
    setTimeout(() => {
        dataHandler.state.isSerialportRetrying = true;
        connectToSerial();
    }, 5000);
  });
  return serialport;
}
}
// xdrd connection
function connectToXdrd() {
  const { xdrd } = serverConfig;

  if (xdrd.wirelessConnection && configExists()) {
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
            helpers.authenticateWithXdrd(client, authFlags.receivedSalt, xdrd.xdrdPassword);
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
              serverConfig.webserver.rdsMode ? client.write('D1\n') : client.write('D0\n');
              client.off('data', authDataHandler);
              return;
            }
          }
        }
      };
      
      client.on('data', (data) => {
        helpers.resolveDataBuffer(data, wss, rdsWss);
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

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../web'));
app.use('/', endpoints);

function antispamProtection(message, clientIp, ws, userCommands, lastWarn, userCommandHistory, lengthCommands, endpointName) {
  const command = message.toString();
  const now = Date.now();
  if (endpointName === 'text') logDebug(`Command received from \x1b[90m${clientIp}\x1b[0m: ${command}`);
  // Initialize user command history if not present
  if (!userCommandHistory[clientIp]) {
      userCommandHistory[clientIp] = [];
  }
  
  // Record the current timestamp for the user
  userCommandHistory[clientIp].push(now);
  
  // Remove timestamps older than 20 ms from the history
  userCommandHistory[clientIp] = userCommandHistory[clientIp].filter(timestamp => now - timestamp <= 20);
  
  // Check if there are 8 or more commands in the last 20 ms
  if (userCommandHistory[clientIp].length >= 8) {
      logWarn(`User \x1b[90m${clientIp}\x1b[0m is spamming with rapid commands. Connection will be terminated and user will be banned.`);
      
      // Add to banlist if not already banned
      if (!serverConfig.webserver.banlist.includes(clientIp)) {
          serverConfig.webserver.banlist.push(clientIp);
          logInfo(`User \x1b[90m${clientIp}\x1b[0m has been added to the banlist due to extreme spam.`);
          console.log(serverConfig.webserver.banlist);
          configSave();
      }
      
      ws.close(1008, 'Bot-like behavior detected');
      return command; // Return command value before closing connection
  }
  // Update the last message time for general spam detection
  lastMessageTime = now;
  // Initialize command history for rate-limiting checks
  if (!userCommands[command]) {
      userCommands[command] = [];
  }
  // Record the current timestamp for this command
  userCommands[command].push(now);
  // Remove timestamps older than 1 second
  userCommands[command] = userCommands[command].filter(timestamp => now - timestamp <= 1000);
  // If command count exceeds limit, close connection
  if (userCommands[command].length > lengthCommands) {
      if (now - lastWarn.time > 1000) { // Check if 1 second has passed
          logWarn(`User \x1b[90m${clientIp}\x1b[0m is spamming command "${command}" in /${endpointName}. Connection will be terminated.`);
          lastWarn.time = now; // Update the last warning time
      }
      ws.close(1008, 'Spamming detected');
      return command; // Return command value before closing connection
  }
  return command; // Return command value for normal execution
}


/**
 * WEBSOCKET BLOCK
 */
const tunerLockTracker = new WeakMap();

wss.on('connection', (ws, request) => {
    const output = serverConfig.xdrd.wirelessConnection ? client : serialport;
    let clientIp = request.headers['x-forwarded-for'] || request.connection.remoteAddress;
    const userCommandHistory = {};
    const normalizedClientIp = clientIp?.replace(/^::ffff:/, '');

    if (serverConfig.webserver.banlist?.includes(clientIp)) {
        ws.close(1008, 'Banned IP');
        return;
    }

    if (clientIp.includes(',')) {
        clientIp = clientIp.split(',')[0].trim();
    }

    if (clientIp !== '::ffff:127.0.0.1' || (request.connection && request.connection.remoteAddress && request.connection.remoteAddress !== '::ffff:127.0.0.1') || (request.headers && request.headers['origin'] && request.headers['origin'].trim() !== '')) {
      currentUsers++;
    }

    if (timeoutAntenna) clearTimeout(timeoutAntenna);

    helpers.handleConnect(clientIp, currentUsers, ws, (result) => {
      if (result === "User banned") {
          ws.close(1008, 'Banned IP');
          return;
      }

    dataHandler.showOnlineUsers(currentUsers);

    if (currentUsers === 1 && serverConfig.autoShutdown === true && serverConfig.xdrd.wirelessConnection) {
        serverConfig.xdrd.wirelessConnection ? connectToXdrd() : serialport.write('x\n');
    }
  });  

    const userCommands = {};
    let lastWarn = { time: 0 };

    ws.on('message', (message) => {
        const command = helpers.antispamProtection(message, clientIp, ws, userCommands, lastWarn, userCommandHistory, '18', 'text');

        if (!clientIp.includes("127.0.0.1")) {
            if (((command.startsWith('X') || command.startsWith('Y')) && !request.session.isAdminAuthenticated) || 
               ((command.startsWith('F') || command.startsWith('W')) && serverConfig.bwSwitch === false)) {
                logWarn(`User \x1b[90m${clientIp}\x1b[0m attempted to send a potentially dangerous command: ${command.slice(0, 64)}.`);
                return;
            }
        }

        if (command.includes("\'")) {
            return;
        }

        const { isAdminAuthenticated, isTuneAuthenticated } = request.session || {};

        if (command.startsWith('w') && (isAdminAuthenticated || isTuneAuthenticated)) {
            switch (command) {
                case 'wL1': 
                    if (isAdminAuthenticated) serverConfig.lockToAdmin = true; 
                    break;
                case 'wL0': 
                    if (isAdminAuthenticated) serverConfig.lockToAdmin = false; 
                    break;
                case 'wT0': 
                    serverConfig.publicTuner = true; 
                    if(!isAdminAuthenticated) tunerLockTracker.delete(ws); 
                    break;
                case 'wT1': 
                    serverConfig.publicTuner = false;
                    if(!isAdminAuthenticated) tunerLockTracker.set(ws, true);
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

        if ((serverConfig.publicTuner && !serverConfig.lockToAdmin) || isAdminAuthenticated || (!serverConfig.publicTuner && !serverConfig.lockToAdmin && isTuneAuthenticated)) {
            output.write(`${command}\n`);
        }
    });

    ws.on('close', (code, reason) => {
      if (clientIp !== '::ffff:127.0.0.1' || (request.connection && request.connection.remoteAddress && request.connection.remoteAddress !== '::ffff:127.0.0.1') || (request.headers && request.headers['origin'] && request.headers['origin'].trim() !== '')) {
        currentUsers--;
      }
        dataHandler.showOnlineUsers(currentUsers);

        const index = storage.connectedUsers.findIndex(user => user.ip === clientIp);
        if (index !== -1) {
            storage.connectedUsers.splice(index, 1);
        }

        if (currentUsers === 0) {
            storage.connectedUsers = [];

            if (serverConfig.bwAutoNoUsers === "1") {
                output.write("W0\n"); // Auto BW 'Enabled'
            }

            // cEQ and iMS combinations
            if (serverConfig.ceqNoUsers === "1" && serverConfig.imsNoUsers === "1") {
                output.write("G00\n"); // Both Disabled
            } else if (serverConfig.ceqNoUsers === "1" && serverConfig.imsNoUsers === "0") {
                output.write(`G0${dataHandler.dataToSend.ims}\n`);
            } else if (serverConfig.ceqNoUsers === "0" && serverConfig.imsNoUsers === "1") {
                output.write(`G${dataHandler.dataToSend.eq}0\n`);
            } else if (serverConfig.ceqNoUsers === "2" && serverConfig.imsNoUsers === "0") {
                output.write(`G1${dataHandler.dataToSend.ims}\n`);
            } else if (serverConfig.ceqNoUsers === "0" && serverConfig.imsNoUsers === "2") {
                output.write(`G${dataHandler.dataToSend.eq}1\n`);
            } else if (serverConfig.ceqNoUsers === "2" && serverConfig.imsNoUsers === "2") {
                output.write("G11\n"); // Both Enabled
            }

            // Handle stereo mode
            if (serverConfig.stereoNoUsers === "1") {
                output.write("B0\n");
            } else if (serverConfig.stereoNoUsers === "2") {
                output.write("B1\n");
            }

            // Handle Antenna selection
            if (timeoutAntenna) clearTimeout(timeoutAntenna);
            timeoutAntenna = setTimeout(() => {
                if (serverConfig.antennaNoUsers === "1") {
                    output.write("Z0\n");
                } else if (serverConfig.antennaNoUsers === "2") {
                    output.write("Z1\n");
                } else if (serverConfig.antennaNoUsers === "3") {
                    output.write("Z2\n");
                } else if (serverConfig.antennaNoUsers === "4") {
                    output.write("Z3\n");
                }
            }, serverConfig.antennaNoUsersDelay ? 15000 : 0);
        }

        if (tunerLockTracker.has(ws)) {
            logInfo(`User who locked the tuner left. Unlocking the tuner.`);
            output.write('wT0\n')
            tunerLockTracker.delete(ws);
            serverConfig.publicTuner = true;
        }

        if (currentUsers === 0 && serverConfig.enableDefaultFreq === true && 
            serverConfig.autoShutdown !== true && serverConfig.xdrd.wirelessConnection === true) {
            setTimeout(function() {
                if (currentUsers === 0) {
                    output.write('T' + Math.round(serverConfig.defaultFreq * 1000) + '\n');
                    dataHandler.resetToDefault(dataHandler.dataToSend);
                    dataHandler.dataToSend.freq = Number(serverConfig.defaultFreq).toFixed(3);
                    dataHandler.initialData.freq = Number(serverConfig.defaultFreq).toFixed(3);
                }
            }, 10000);
        }

        if (currentUsers === 0 && serverConfig.autoShutdown === true && serverConfig.xdrd.wirelessConnection === true) {
            client.write('X\n');
        }

        if (code !== 1008) {
          logInfo(`Web client \x1b[31mdisconnected\x1b[0m (${normalizedClientIp}) \x1b[90m[${currentUsers}]`);
        }
    });

    ws.on('error', console.error);
});

// CHAT WEBSOCKET BLOCK
chatWss.on('connection', (ws, request) => {
  const clientIp = request.headers['x-forwarded-for'] || request.connection.remoteAddress;
  const userCommandHistory = {};
  if (serverConfig.webserver.banlist?.includes(clientIp)) {
    ws.close(1008, 'Banned IP');
    return;
  }

  // Send chat history to the newly connected client
  storage.chatHistory.forEach(function(message) {
    message.history = true;
    !request.session.isAdminAuthenticated ? delete message.ip : null;
    ws.send(JSON.stringify(message));
  });

  const ipMessage = {
    type: 'clientIp',
    ip: clientIp,
    admin: request.session.isAdminAuthenticated
  };
  ws.send(JSON.stringify(ipMessage));

  // Anti-spam tracking for each client
  const userCommands = {};
  let lastWarn = { time: 0 };

  ws.on('message', function incoming(message) {
    // Anti-spam
    const command = helpers.antispamProtection(message, clientIp, ws, userCommands, lastWarn, userCommandHistory, '5', 'chat');

    let messageData;

    try {
      messageData = JSON.parse(message);
    } catch (error) {
      ws.send(JSON.stringify({ error: "Invalid message format" }));
      return;
    }

    // Escape nickname and other potentially unsafe fields
    if (messageData.nickname) {
      messageData.nickname = helpers.escapeHtml(messageData.nickname);
    }

    messageData.ip = clientIp;
    const currentTime = new Date();
    
    const hours = String(currentTime.getHours()).padStart(2, '0');
    const minutes = String(currentTime.getMinutes()).padStart(2, '0');
    messageData.time = `${hours}:${minutes}`; // Adding current time to the message object in hours:minutes format

    if (serverConfig.webserver.banlist?.includes(clientIp)) { return; }
    if (request.session.isAdminAuthenticated === true) { messageData.admin = true; }
    if (messageData.message.length > 255) { messageData.message = messageData.message.substring(0, 255); }

    storage.chatHistory.push(messageData);
    if (storage.chatHistory.length > 50) { storage.chatHistory.shift(); }
    logChat(messageData);
    
    chatWss.clients.forEach(function each(client) {
      if (client.readyState === WebSocket.OPEN) {
        // Only include IP for admin clients
        let responseMessage = { ...messageData };
  
        if (request.session.isAdminAuthenticated !== true) {
          delete responseMessage.ip;
        }
  
        const modifiedMessage = JSON.stringify(responseMessage);
        client.send(modifiedMessage); 
      }
    });
  });

  ws.on('close', function close() {});
});

// Additional web socket for using plugins
pluginsWss.on('connection', (ws, request) => { 
    const clientIp = request.headers['x-forwarded-for'] || request.connection.remoteAddress;
    const userCommandHistory = {};
    if (serverConfig.webserver.banlist?.includes(clientIp)) {
      ws.close(1008, 'Banned IP');
      return;
    }
    // Anti-spam tracking for each client
    const userCommands = {};
    let lastWarn = { time: 0 };

    ws.on('message', message => {
        // Anti-spam
        const command = helpers.antispamProtection(message, clientIp, ws, userCommands, lastWarn, userCommandHistory, '10', 'data_plugins');

        let messageData;

        try {
            messageData = JSON.parse(message); // Attempt to parse the JSON
        } catch (error) {
            // console.error("Failed to parse message:", error); // Log the error
            return; // Exit if parsing fails
        }

        const modifiedMessage = JSON.stringify(messageData);

        // Broadcast the message to all other clients
        pluginsWss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(modifiedMessage); // Send the message to all clients
            }
        });
    });

    ws.on('close', () => {
        // logInfo('WebSocket Extra connection closed'); // Use custom logInfo function
    });

    ws.on('error', error => {
        logError('WebSocket Extra error: ' + error); // Use custom logError function
    });
});

// Additional web socket for using plugins
pluginsWss.on('connection', (ws, request) => { 
    const clientIp = request.headers['x-forwarded-for'] || request.connection.remoteAddress;
    const userCommandHistory = {};
    if (serverConfig.webserver.banlist?.includes(clientIp)) {
      ws.close(1008, 'Banned IP');
      return;
    }
    // Anti-spam tracking for each client
    const userCommands = {};
    let lastWarn = { time: 0 };

    ws.on('message', message => {
        // Anti-spam
        const command = antispamProtection(message, clientIp, ws, userCommands, lastWarn, userCommandHistory, '10', 'data_plugins');

        let messageData;

        try {
            messageData = JSON.parse(message); // Attempt to parse the JSON
        } catch (error) {
            // console.error("Failed to parse message:", error); // Log the error
            return; // Exit if parsing fails
        }

        const modifiedMessage = JSON.stringify(messageData);

        // Broadcast the message to all other clients
        pluginsWss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(modifiedMessage); // Send the message to all clients
            }
        });
    });

    ws.on('close', () => {
        // logInfo('WebSocket Extra connection closed'); // Use custom logInfo function
    });

    ws.on('error', error => {
        logError('WebSocket Extra error: ' + error); // Use custom logError function
    });
});

function isPortOpen(host, port, timeout = 1000) {
    return new Promise((resolve) => {
        const socket = new net.Socket();

        const onError = () => {
            socket.destroy();
            resolve(false);
        };

        socket.setTimeout(timeout);
        socket.once('error', onError);
        socket.once('timeout', onError);

        socket.connect(port, host, () => {
            socket.end();
            resolve(true);
        });
    });
}

// Websocket register for /text, /audio and /chat paths 
httpServer.on('upgrade', (request, socket, head) => {
  if (request.url === '/text') {
    sessionMiddleware(request, {}, () => {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    });
  } else if (request.url === '/audio') {
    isPortOpen('localhost', (Number(serverConfig.webserver.webserverPort) + 10)).then((open) => {
        if (open) {
            proxy.ws(request, socket, head);
        } else {
            logWarn(`Audio stream port ${(Number(serverConfig.webserver.webserverPort) + 10)} not yet open — skipping proxy connection.`);
            socket.end(); // close socket so client isn't left hanging
        }
    });
} else if (request.url === '/chat') {
    sessionMiddleware(request, {}, () => {
      chatWss.handleUpgrade(request, socket, head, (ws) => {
        chatWss.emit('connection', ws, request);
      });
    });
  } else if (request.url === '/rds' || request.url === '/rdsspy') {
    sessionMiddleware(request, {}, () => {
      rdsWss.handleUpgrade(request, socket, head, (ws) => {
        rdsWss.emit('connection', ws, request);

            const clientIp = request.headers['x-forwarded-for'] || request.connection.remoteAddress;
            const userCommandHistory = {};
            if (serverConfig.webserver.banlist?.includes(clientIp)) {
              ws.close(1008, 'Banned IP');
              return;
            }

            // Anti-spam tracking for each client
            const userCommands = {};
            let lastWarn = { time: 0 };

            ws.on('message', function incoming(message) {
              // Anti-spam
              const command = helpers.antispamProtection(message, clientIp, ws, userCommands, lastWarn, userCommandHistory, '5', 'rds');
            });

      });
    });
  } else if (request.url === '/data_plugins') {
    sessionMiddleware(request, {}, () => {
      pluginsWss.handleUpgrade(request, socket, head, (ws) => {
        pluginsWss.emit('connection', ws, request);
      });
    });
  } else {
    socket.destroy();
  }
});

app.use(express.static(path.join(__dirname, '../web'))); // Serve the entire web folder to the user
fmdxList.update();

helpers.checkIPv6Support((isIPv6Supported) => {
  const ipv4Address = serverConfig.webserver.webserverIp === '0.0.0.0' ? 'localhost' : serverConfig.webserver.webserverIp;
  const ipv6Address = '::'; // This will bind to all available IPv6 interfaces
  const port = serverConfig.webserver.webserverPort;

  const logServerStart = (address, isIPv6) => {
    const formattedAddress = isIPv6 ? `[${address}]` : address;
    logInfo(`Web server has started on address \x1b[34mhttp://${formattedAddress}:${port}\x1b[0m.`);
  };

  const startServer = (address, isIPv6) => {
    httpServer.listen(port, address, () => {
      if (!isIPv6 && !configExists()) {
        logInfo(`Open your browser and proceed to \x1b[34mhttp://${address}:${port}\x1b[0m to continue with setup.`);
      } else {
        logServerStart(address, isIPv6);
      }
    });
  };

  if (isIPv6Supported) {
    startServer(ipv4Address, false); // Start on IPv4
    startServer(ipv6Address, true);  // Start on IPv6
  } else {
    startServer(ipv4Address, false); // Start only on IPv4
  }
});
