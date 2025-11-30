const http = require('http');
const https = require('https');
const net = require('net');
const crypto = require('crypto');
const dataHandler = require('./datahandler');
const storage = require('./storage');
const consoleCmd = require('./console');
const { serverConfig, configExists, configSave } = require('./server_config');

function parseMarkdown(parsed) {
  parsed = parsed.replace(/<\/?[^>]+(>|$)/g, '');
  
  var grayTextRegex = /--(.*?)--/g;
  parsed = parsed.replace(grayTextRegex, '<span class="text-gray">$1</span>');
  
  var boldRegex = /\*\*(.*?)\*\*/g;
  parsed = parsed.replace(boldRegex, '<strong>$1</strong>');
  
  var italicRegex = /\*(.*?)\*/g;
  parsed = parsed.replace(italicRegex, '<em>$1</em>');
  
  var linkRegex = /\[([^\]]+)]\(([^)]+)\)/g;
  parsed = parsed.replace(linkRegex, '<a href="$2" target="_blank">$1</a>');
  
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

const ipCache = new Map();

function handleConnect(clientIp, currentUsers, ws, callback) {
  if (ipCache.has(clientIp)) {
    // Use cached location info
    processConnection(clientIp, ipCache.get(clientIp), currentUsers, ws, callback);
    return;
  }

  http.get(`http://ip-api.com/json/${clientIp}`, (response) => {
    let data = "";

    response.on("data", (chunk) => {
      data += chunk;
    });

    response.on("end", () => {
      try {
        const locationInfo = JSON.parse(data);
        ipCache.set(clientIp, locationInfo); // Store in cache
        processConnection(clientIp, locationInfo, currentUsers, ws, callback);
      } catch (error) {
        console.error("Error parsing location data:", error);
        callback("User allowed");
      }
    });
  }).on("error", (err) => {
    consoleCmd.logError("Error fetching location data:", err.code);
    callback("User allowed");
  });
}

let bannedASCache = { data: null, timestamp: 0 };

function fetchBannedAS(callback) {
  const now = Date.now();
  if (bannedASCache.data && now - bannedASCache.timestamp < 10 * 60 * 1000) {
    return callback(null, bannedASCache.data);
  }

  const req = https.get("https://fmdx.org/banned_as.json", { family: 4 }, (banResponse) => {
    let banData = "";

    banResponse.on("data", (chunk) => {
      banData += chunk;
    });

    banResponse.on("end", () => {
      try {
        const bannedAS = JSON.parse(banData).banned_as || [];
        bannedASCache = { data: bannedAS, timestamp: now };
        callback(null, bannedAS);
      } catch (error) {
        console.error("Error parsing banned AS list:", error);
        callback(null, []); // Default to allowing user
      }
    });
  });

  // Set timeout for the request (5 seconds)
  req.setTimeout(5000, () => {
    console.error("Error: Request timed out while fetching banned AS list.");
    req.abort();
    callback(null, []); // Default to allowing user
  });

  req.on("error", (err) => {
    console.error("Error fetching banned AS list:", err);
    callback(null, []); // Default to allowing user
  });
}

const recentBannedIps = new Map(); // Store clientIp -> timestamp

function processConnection(clientIp, locationInfo, currentUsers, ws, callback) {
  const options = { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" };
  const connectionTime = new Date().toLocaleString([], options);
  const normalizedClientIp = clientIp?.replace(/^::ffff:/, '');

  fetchBannedAS((error, bannedAS) => {
    if (error) {
      console.error("Error fetching banned AS list:", error);
    }

    if (bannedAS.some((as) => locationInfo.as?.includes(as))) {
      const now = Date.now();
      const lastSeen = recentBannedIps.get(normalizedClientIp) || 0;

      if (now - lastSeen > 300 * 1000) {
        consoleCmd.logWarn(`Banned AS list client kicked (${normalizedClientIp})`);
        recentBannedIps.set(normalizedClientIp, now);
      }

      return callback("User banned");
    }

    const userLocation =
      locationInfo.country === undefined
        ? "Unknown"
        : `${locationInfo.city}, ${locationInfo.regionName}, ${locationInfo.countryCode}`;

    storage.connectedUsers.push({
      ip: clientIp,
      location: userLocation,
      time: connectionTime,
      instance: ws,
    });

    consoleCmd.logInfo(
      `Web client \x1b[32mconnected\x1b[0m (${normalizedClientIp}) \x1b[90m[${currentUsers}]\x1b[0m Location: ${userLocation}`
    );

    callback("User allowed");
  });
}

function formatUptime(uptimeInSeconds) {
  const secondsInMinute = 60;
  const secondsInHour = secondsInMinute * 60;
  const secondsInDay = secondsInHour * 24;
  
  const days = Math.floor(uptimeInSeconds / secondsInDay);
  const hours = Math.floor((uptimeInSeconds % secondsInDay) / secondsInHour);
  const minutes = Math.floor((uptimeInSeconds % secondsInHour) / secondsInMinute);
  
  return `${days}d ${hours}h ${minutes}m`;
}

let incompleteDataBuffer = '';

function resolveDataBuffer(data, wss, rdsWss) {
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
        dataHandler.handleData(wss, receivedData, rdsWss);
    };
}

function kickClient(ipAddress) {
  // Find the entry in connectedClients associated with the provided IP address
  const targetClient = storage.connectedUsers.find(client => client.ip === ipAddress);
  if (targetClient && targetClient.instance) {
    // Send a termination message to the client
    targetClient.instance.send('KICK');
    
    // Close the WebSocket connection after a short delay to allow the client to receive the message
    setTimeout(() => {
      targetClient.instance.close();
      consoleCmd.logInfo(`Web client kicked (${ipAddress})`);
    }, 500);
  } else {
    consoleCmd.logInfo(`Kicking client ${ipAddress} failed. No suitable client found.`);
  }
}

function checkIPv6Support(callback) {
  const server = net.createServer();

  server.listen(0, '::1', () => {
    server.close(() => callback(true));
  }).on('error', (error) => {
    if (error.code === 'EADDRNOTAVAIL') {
      callback(false);
    } else {
      callback(false);
    }
  });
}

function checkLatency(host) {
  return new Promise(resolve => {
    const start = Date.now();

    const req = http.get({ host, timeout: 2000 }, res => {
      res.resume(); // discard body
      resolve(Date.now() - start);
    });

    req.on("error", () => resolve(null)); // server offline
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

function antispamProtection(message, clientIp, ws, userCommands, lastWarn, userCommandHistory, lengthCommands, endpointName) {
  const command = message.toString();
  const now = Date.now();
  const normalizedClientIp = clientIp?.replace(/^::ffff:/, '');
  if (endpointName === 'text') consoleCmd.logDebug(`Command received from \x1b[90m${clientIp}\x1b[0m: ${command}`);

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
      consoleCmd.logWarn(`User \x1b[90m${clientIp}\x1b[0m is spamming with rapid commands. Connection will be terminated and user will be banned.`);
      
    // Check if the normalized IP is already in the banlist
    const isAlreadyBanned = serverConfig.webserver.banlist.some(banEntry => banEntry[0] === normalizedClientIp);

    if (!isAlreadyBanned) {
        // Add the normalized IP to the banlist
        serverConfig.webserver.banlist.push([normalizedClientIp, 'Unknown', Date.now(), '[Auto ban] Spam']);
        consoleCmd.logInfo(`User \x1b[90m${normalizedClientIp}\x1b[0m has been added to the banlist due to extreme spam.`);
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
          consoleCmd.logWarn(`User \x1b[90m${clientIp}\x1b[0m is spamming command "${command}" in /${endpointName}. Connection will be terminated.`);
          lastWarn.time = now; // Update the last warning time
      }
      ws.close(1008, 'Spamming detected');
      return command; // Return command value before closing connection
  }

  return command; // Return command value for normal execution
}

const escapeHtml = (unsafe) => {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};


module.exports = {
  authenticateWithXdrd, parseMarkdown, handleConnect, removeMarkdown, formatUptime, resolveDataBuffer, kickClient, checkIPv6Support, checkLatency, antispamProtection, escapeHtml
}