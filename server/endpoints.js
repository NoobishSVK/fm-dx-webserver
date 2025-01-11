// Library imports
const express = require('express');
const router = express.Router();
const fs = require('fs');
const { SerialPort } = require('serialport')
const path = require('path');
const https = require('https');

// File Imports
const { parseAudioDevice } = require('./stream/parser');
const { configName, serverConfig, configUpdate, configSave, configExists, configPath } = require('./server_config');
const helpers = require('./helpers');
const storage = require('./storage');
const { logInfo, logDebug, logWarn, logError, logFfmpeg, logs } = require('./console');
const dataHandler = require('./datahandler');
const fmdxList = require('./fmdx_list');
const { allPluginConfigs } = require('./plugins');

// Endpoints
router.get('/', (req, res) => {
    let requestIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const normalizedIp = requestIp.replace(/^::ffff:/, '');
    const isBanned = serverConfig.webserver.banlist.some(banEntry => banEntry[0] === normalizedIp);

    if (isBanned) {
        res.render('403');
        logInfo(`Web client (${requestIp}) is banned`);
        return;
    }

    const noPlugins = req.query.noPlugins === 'true';

    if (configExists() === false) {
        let serialPorts;
        
        SerialPort.list()
        .then((deviceList) => {
            serialPorts = deviceList.map(port => ({
                path: port.path,
                friendlyName: port.friendlyName,
            }));
            
            parseAudioDevice((result) => {
                res.render('wizard', {
                    isAdminAuthenticated: true,
                    videoDevices: result.audioDevices,
                    audioDevices: result.videoDevices,
                    serialPorts: serialPorts
                });
            });
        });
    } else {
        res.render('index', {
            isAdminAuthenticated: req.session.isAdminAuthenticated,
            isTuneAuthenticated: req.session.isTuneAuthenticated,
            tunerName: serverConfig.identification.tunerName,
            tunerDesc: helpers.parseMarkdown(serverConfig.identification.tunerDesc),
            tunerDescMeta: helpers.removeMarkdown(serverConfig.identification.tunerDesc),
            tunerLock: serverConfig.lockToAdmin,
            publicTuner: serverConfig.publicTuner,
            ownerContact: serverConfig.identification.contact,
            antennas: serverConfig.antennas ? serverConfig.antennas : {},
            tuningLimit: serverConfig.webserver.tuningLimit,
            tuningLowerLimit: serverConfig.webserver.tuningLowerLimit,
            tuningUpperLimit: serverConfig.webserver.tuningUpperLimit,
            chatEnabled: serverConfig.webserver.chatEnabled,
            device: serverConfig.device,
            noPlugins,
            plugins: serverConfig.plugins,
            fmlist_integration: typeof(serverConfig.extras?.fmlistIntegration) !== undefined ? serverConfig.extras?.fmlistIntegration : true,
            bwSwitch: serverConfig.bwSwitch ? serverConfig.bwSwitch : false
        });
    }
});

router.get('/403', (req, res) => {
    res.render('403');
})

router.get('/wizard', (req, res) => {
    let serialPorts;
    
    if(!req.session.isAdminAuthenticated) {
        res.render('login');
        return;
    }

    SerialPort.list()
    .then((deviceList) => {
        serialPorts = deviceList.map(port => ({
            path: port.path,
            friendlyName: port.friendlyName,
        }));
        
        parseAudioDevice((result) => {
            res.render('wizard', {
                isAdminAuthenticated: req.session.isAdminAuthenticated,
                videoDevices: result.audioDevices,
                audioDevices: result.videoDevices,
                serialPorts: serialPorts
            });
        });
    })
})
  
  router.get('/setup', (req, res) => {
      let serialPorts; 
      function loadConfig() {
        if (fs.existsSync(configPath)) {
          const configFileContents = fs.readFileSync(configPath, 'utf8');
          return JSON.parse(configFileContents);
        }
        return serverConfig;
      }
  
      if(!req.session.isAdminAuthenticated) {
          res.render('login');
          return;
      }
      
      SerialPort.list()
      .then((deviceList) => {
          serialPorts = deviceList.map(port => ({
              path: port.path,
              friendlyName: port.friendlyName,
          }));
          
          parseAudioDevice((result) => {
              const processUptimeInSeconds = Math.floor(process.uptime());
              const formattedProcessUptime = helpers.formatUptime(processUptimeInSeconds);
              
              const updatedConfig = loadConfig();  // Reload the config every time
              res.render('setup', {
                  isAdminAuthenticated: req.session.isAdminAuthenticated,
                  videoDevices: result.audioDevices,
                  audioDevices: result.videoDevices,
                  serialPorts: serialPorts,
                  memoryUsage: (process.memoryUsage.rss() / 1024 / 1024).toFixed(1) + ' MB',
                  processUptime: formattedProcessUptime,
                  consoleOutput: logs,
                  plugins: allPluginConfigs,
                  enabledPlugins: updatedConfig.plugins,
                  onlineUsers: dataHandler.dataToSend.users,
                  connectedUsers: storage.connectedUsers,
                  banlist: updatedConfig.webserver.banlist // Updated banlist from the latest config
              });
          });
      }) 
  });
  

router.get('/rds', (req, res) => {
    res.send('Please connect using a WebSocket compatible app to obtain RDS stream.');
});

router.get('/rdsspy', (req, res) => {
    res.send('Please connect using a WebSocket compatible app to obtain RDS stream.');
});

router.get('/rds', (req, res) => {
    res.send('Please c onnect using a WebSocket compatible app to obtain RDS stream.');
});

router.get('/rdsspy', (req, res) => {
    res.send('Please connect using a WebSocket compatible app to obtain RDS stream.');
});

router.get('/api', (req, res) => {
    const { ps_errors, rt0_errors, rt1_errors, ims, eq, ant, st_forced, previousFreq, txInfo, ...dataToSend } = dataHandler.dataToSend;
    res.json({
        ...dataToSend,
        txInfo: txInfo,
        ps_errors: ps_errors,
        ant: ant
    });
});


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

// Route for login
router.post('/login', authenticate, (req, res) => {
    // Redirect to the main page after successful login
    res.status(200).json({ message: 'Logged in successfully, refreshing the page...' });
});

router.get('/logout', (req, res) => {
    // Clear the session and redirect to the main page
    req.session.destroy(() => {
        res.status(200).json({ message: 'Logged out successfully, refreshing the page...' });
    });
});

router.get('/kick', (req, res) => {
    const ipAddress = req.query.ip; // Extract the IP address parameter from the query string
    // Terminate the WebSocket connection for the specified IP address
    if(req.session.isAdminAuthenticated) {
        helpers.kickClient(ipAddress);
    }
    setTimeout(() => {
        res.redirect('/setup');
    }, 500);
});

router.get('/addToBanlist', (req, res) => {
    const ipAddress = req.query.ip;
    const location = 'Unknown';
    const date = Date.now();
    const reason = req.query.reason;

    userBanData = [ipAddress, location, date, reason];

    if (typeof serverConfig.webserver.banlist !== 'object') {
        serverConfig.webserver.banlist = [];
    }

    if (req.session.isAdminAuthenticated) {
        serverConfig.webserver.banlist.push(userBanData);
        configSave();
        res.json({ success: true, message: 'IP address added to banlist.' });
        helpers.kickClient(ipAddress);
    } else {
        res.status(403).json({ success: false, message: 'Unauthorized access.' });
    }
});

router.get('/removeFromBanlist', (req, res) => {
    const ipAddress = req.query.ip;

    if (typeof serverConfig.webserver.banlist !== 'object') {
        serverConfig.webserver.banlist = [];
    }

    const banIndex = serverConfig.webserver.banlist.findIndex(ban => ban[0] === ipAddress);

    if (banIndex === -1) {
        return res.status(404).json({ success: false, message: 'IP address not found in banlist.' });
    }

    serverConfig.webserver.banlist.splice(banIndex, 1);
    configSave();

    res.json({ success: true, message: 'IP address removed from banlist.' });
});


router.post('/saveData', (req, res) => {
    const data = req.body;
    let firstSetup;
    if(req.session.isAdminAuthenticated || configExists() === false) {
        configUpdate(data);
        fmdxList.update();
        
        if(configExists() === false) {
            firstSetup = true;
        }
        
        /* TODO: Refactor to server_config.js */
        // Save data to a JSON file
        fs.writeFile(configPath, JSON.stringify(serverConfig, null, 2), (err) => {
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

router.get('/getData', (req, res) => {  
    if (configExists() === false) {
        res.json(serverConfig);
    }
    
    if(req.session.isAdminAuthenticated) {
        // Check if the file exists
        fs.access(configPath, fs.constants.F_OK, (err) => {
            if (err) {
                console.log(err);
            } else {
                // File exists, send it as the response
                res.sendFile(path.join(__dirname, '../' + configName + '.json'));
            }
        });
    }
});

router.get('/getDevices', (req, res) => {
    if (req.session.isAdminAuthenticated || !fs.existsSync(configName + '.json')) {
        parseAudioDevice((result) => {
            res.json(result);
        });
    } else {
        res.status(403).json({ error: 'Unauthorized' });
    }
});

/* Static data are being sent through here on connection - these don't change when the server is running */
router.get('/static_data', (req, res) => {
    res.json({
        qthLatitude: serverConfig.identification.lat,
        qthLongitude: serverConfig.identification.lon,
        presets: serverConfig.webserver.presets || [],
        defaultTheme: serverConfig.webserver.defaultTheme || 'theme1',
        bgImage: serverConfig.webserver.bgImage || '',
        rdsMode: serverConfig.webserver.rdsMode || false,
        tunerName: serverConfig.identification.tunerName || '',
        tunerDesc: serverConfig.identification.tunerDesc || '',
        ant: serverConfig.antennas || {}
    });
});

router.get('/server_time', (req, res) => {
    const serverTime = new Date(); // Get current server time
    const serverTimeUTC = new Date(serverTime.getTime() - (serverTime.getTimezoneOffset() * 60000)); // Adjust server time to UTC
    res.json({
        serverTime: serverTimeUTC,
    });
});

router.get('/ping', (req, res) => {
    res.send('pong');
});  

const logHistory = {};

// Function to check if the ID has been logged within the last 60 minutes
function canLog(id) {
    const now = Date.now();
    const sixtyMinutes = 60 * 60 * 1000; // 60 minutes in milliseconds
    if (logHistory[id] && (now - logHistory[id]) < sixtyMinutes) {
        return false; // Deny logging if less than 60 minutes have passed
    }
    logHistory[id] = now; // Update with the current timestamp
    return true;
}

router.get('/log_fmlist', (req, res) => {
    if (dataHandler.dataToSend.txInfo.tx.length === 0) {
        res.status(500).send('No suitable transmitter to log.');
        return;
    }

    if (serverConfig.extras?.fmlistIntegration === false) {
        res.status(500).send('FMLIST Integration is not enabled on this server.');
        return;
    }

    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const txId = dataHandler.dataToSend.txInfo.id; // Extract the ID

    // Check if the ID can be logged (i.e., not logged within the last 60 minutes)
    if (!canLog(txId)) {
        res.status(429).send(`ID ${txId} was already logged recently. Please wait before logging again.`);
        return;
    }

    const postData = JSON.stringify({
        station: {
            freq: dataHandler.dataToSend.freq,
            pi: dataHandler.dataToSend.pi,
            id: dataHandler.dataToSend.txInfo.id,
            rds_ps: dataHandler.dataToSend.ps.replace(/'/g, "\\'"), // Escape quotes
            signal: dataHandler.dataToSend.sig,
            tp: dataHandler.dataToSend.tp,
            ta: dataHandler.dataToSend.ta,
            af_list: dataHandler.dataToSend.af,
        },
        server: {
            uuid: serverConfig.identification.token,
            latitude: serverConfig.identification.lat,
            longitude: serverConfig.identification.lon,
            address: serverConfig.identification.proxyIp.length > 1 ? serverConfig.identification.proxyIp : ('Matches request IP with port ' + serverConfig.webserver.port),
            webserver_name: serverConfig.identification.tunerName.replace(/'/g, "\\'"), // Escape quotes
            omid: serverConfig.extras?.fmlistOmid || '',
        },
        client: {
            request_ip: clientIp
        },
        log_msg: "Logged PS: " + dataHandler.dataToSend.ps.replace(/\s+/g, '_') + ", PI: " + dataHandler.dataToSend.pi + ", Signal: " + dataHandler.dataToSend.sig.toFixed(0) + " dBf",
    });

    const options = {
        hostname: 'api.fmlist.org',
        path: '/fmdx.org/slog.php',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData) // Use Buffer.byteLength for accurate content length
        }
    };

    const request = https.request(options, (response) => {
        let data = '';

        // Collect response chunks
        response.on('data', (chunk) => {
            data += chunk;
        });

        // Response ended
        response.on('end', () => {
            res.status(200).send(data);
        });
    });

    // Handle errors in the request
    request.on('error', (error) => {
        console.error('Error sending POST request:', error);
        res.status(500).send(error.message); // Send error message to client
    });

    // Write the postData and end the request properly
    request.write(postData);
    request.end();
});

module.exports = router;
