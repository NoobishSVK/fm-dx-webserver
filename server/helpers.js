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

const cleanIp = (ip) => String(ip || '').replace(/\s+/g, '').replace(/^::ffff:/, '').split('%')[0];

// All IPs from x-forwarded-for (or the socket), normalized
function getClientIps(req) {
  const raw = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
  return raw.split(',').map(cleanIp).filter(Boolean);
}

const getClientIp = (req) => getClientIps(req)[0];

// Who is connecting, from the request
function getClient(req) {
  const ip = getClientIp(req);
  return {
    ip,
    // LAN/loopback, exempt from the per-IP connection limit
    isLocal: !ip || ip === '127.0.0.1' || ip === '::1' || /^(10\.|192\.168\.|172\.16\.)/.test(ip),
    // Server-side localhost socket (no browser Origin), not counted as a user
    isInternal: ip === '127.0.0.1' && !req.headers.origin?.trim(),
  };
}

// Returns the matching ban entry. Any IP in the proxy chain matches, and an entry may hold several comma-separated IPs
function isBanned(req) {
  const ips = getClientIps(req);
  return (serverConfig.webserver.banlist || []).find(entry =>
    String(Array.isArray(entry) ? entry[0] : entry).split(',').some(ip => ips.includes(cleanIp(ip))));
}

function fetchIpInfo(ip, timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (!ip || !net.isIP(ip)) return resolve({});

    // ip-api.com free tier is HTTP only, 45 req/min
    const req = http.get(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,isp,as`, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.status === 'success' ? data : {});
        } catch (e) {
          resolve({});
        }
      });
    });

    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve({}));
  });
}

const ipInfoCache = new Map(); // ip -> Promise of info, shared by parallel connects

function handleConnect(clientIp, currentUsers, ws, callback) {
  if (!ipInfoCache.has(clientIp)) {
    ipInfoCache.set(clientIp, fetchIpInfo(clientIp).then((info) => {
      if (!info.country) ipInfoCache.delete(clientIp); // retry failed lookups next time
      return info;
    }));
  }
  ipInfoCache.get(clientIp).then((info) => processConnection(clientIp, info, currentUsers, ws, callback));
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

  fetchBannedAS((error, bannedAS) => {
    if (error) {
      console.error("Error fetching banned AS list:", error);
    }

    if (bannedAS.some((as) => locationInfo.as?.includes(as))) {
      const now = Date.now();
      const lastSeen = recentBannedIps.get(clientIp) || 0;

      if (now - lastSeen > 300 * 1000) {
        consoleCmd.logWarn(`Banned AS list client kicked (${clientIp})`);
        recentBannedIps.set(clientIp, now);
      }

      return callback("User banned");
    }

    const userLocation =
      locationInfo && locationInfo.country !== undefined
        ? [
            locationInfo.city,
            locationInfo.regionName && /\p{L}/u.test(String(locationInfo.regionName))
              ? locationInfo.regionName
              : undefined,
            locationInfo.countryCode,
          ]
            .filter(Boolean)
            .join(', ')
        : 'Unknown';

    const userLocationForLog = locationInfo?.isp ? `${userLocation} (${locationInfo.isp})` : userLocation;

    storage.connectedUsers.push({
      ip: clientIp,
      location: userLocation,
      isp: locationInfo?.isp,
      as: locationInfo?.as,
      time: connectionTime,
      instance: ws,
    });

    consoleCmd.logInfo(
      `Web client \x1b[32mconnected\x1b[0m (${clientIp}) \x1b[90m[${currentUsers}]\x1b[0m Location: ${userLocationForLog}`
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

function resolveDataBuffer(data, wss, rdsWss, onBandChange) {
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
        dataHandler.handleData(wss, receivedData, rdsWss, onBandChange);
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

function checkLatency(host, port = 80, timeout = 2000) {
  return new Promise(resolve => {
    const start = Date.now();

    const socket = net.connect({ host, port });

    socket.setTimeout(timeout);

    socket.on("connect", () => {
      const latency = Date.now() - start;
      socket.destroy();
      resolve(latency);  // ms
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);     // timed out
    });

    socket.on("error", () => {
      resolve(null);     // offline
    });
  });
}

// Returns a per-connection filter: (message) => command
function createAntispam(ws, clientIp, lengthCommands, endpointName, maxPayloadSize = 1024 * 1024) {
  const userCommands = {};
  let recentCommands = [];
  let lastWarn = 0;

  return (message) => {
    const command = message.toString().replace(/[\r\n]+/g, '');
    const now = Date.now();
    if (endpointName === 'text') consoleCmd.logDebug(`Command received from \x1b[90m${clientIp}\x1b[0m: ${command}`);

    if (command.length > maxPayloadSize) {
      consoleCmd.logWarn(`Command from \x1b[90m${clientIp}\x1b[0m on \x1b[90m/${endpointName}\x1b[0m exceeded maximum payload size (${parseInt(command.length / 1024)} KB / ${parseInt(maxPayloadSize / 1024)} KB).`);
      return "";
    }

    // 8 or more commands within 20 ms = bot, auto ban
    recentCommands = recentCommands.filter(t => now - t <= 20);
    recentCommands.push(now);
    if (recentCommands.length >= 8) {
      consoleCmd.logWarn(`User \x1b[90m${clientIp}\x1b[0m is spamming with rapid commands. Connection will be terminated and user will be banned.`);

      if (!serverConfig.webserver.banlist.some(banEntry => banEntry[0] === clientIp)) {
        serverConfig.webserver.banlist.push([clientIp, 'Unknown', Date.now(), '[Auto ban] Spam']);
        consoleCmd.logInfo(`User \x1b[90m${clientIp}\x1b[0m has been added to the banlist due to extreme spam.`);
        configSave();
      }

      ws.close(1008, 'Bot-like behavior detected');
      return command;
    }

    // Same command more than lengthCommands times per second = kick
    userCommands[command] = (userCommands[command] || []).filter(t => now - t <= 1000);
    userCommands[command].push(now);
    if (userCommands[command].length > lengthCommands) {
      if (now - lastWarn > 1000) {
        consoleCmd.logWarn(`User \x1b[90m${clientIp}\x1b[0m is spamming command "${command}" in /${endpointName}. Connection will be terminated.`);
        lastWarn = now;
      }
      ws.close(1008, 'Spamming detected');
    }

    return command;
  };
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
  authenticateWithXdrd, parseMarkdown, handleConnect, removeMarkdown, formatUptime, resolveDataBuffer, kickClient, checkIPv6Support, checkLatency, createAntispam, getClient, getClientIp, isBanned, escapeHtml
}
