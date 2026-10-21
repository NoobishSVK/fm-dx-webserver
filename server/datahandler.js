/* Libraries / Imports */
const { serverConfig } = require('./server_config');
const { fetchTx } = require('./tx_search');
const { createRDSReceiver } = require('./receiver');

const updateInterval = 75;

// Initialize the data object
var dataToSend = {
  pi: '?',
  freq: 87.500.toFixed(3),
  sig: 0,
  sigRaw: '',
  sigTop: -Infinity,
  bw: 0,
  st: false,
  stForced: false,
  rds: false,
  ps: '',
  lps: '',
  tp: 0,
  ta: 0,
  ms: -1,
  pty: 0,
  ecc: null,
  af: [],
  rt0: '',
  rt1: '',
  rt_flag: '',
  ims: 0,
  eq: 0,
  agc: 0,
  ant: 0,
  txInfo: {
    tx: '',
    pol: '',
    erp: '',
    city: '',
    itu: '',
    dist: '',
    azi: '',
    id: '',
    reg: false,
    pi: '',
  },
  country_name: '',
  country_iso: 'UN',
  users: 0,
};

// One RDS parser instance per receiver; callbacks update the existing WebSocket payload.
const rds = createRDSReceiver(dataToSend);

const filterMappings = {
  'G11': { eq: 1, ims: 1 },
  'G01': { eq: 0, ims: 1 },
  'G10': { eq: 1, ims: 0 },
  'G00': { eq: 0, ims: 0 }
};


var legacyRdsPiBuffer = null;
var lastUpdateTime = Date.now();
const initialData = { ...dataToSend };
const resetToDefault = dataToSend => Object.assign(dataToSend, initialData);

// Serialport reconnect variables
const ServerStartTime = process.hrtime();
var serialportUpdateTime = process.hrtime();
let checkSerialport = false;
let rdsTimeoutTimer = null;

function rdsReceived() {
  if (rdsTimeoutTimer) {
    clearTimeout(rdsTimeoutTimer);
    rdsTimeoutTimer = null;
  }
  if (serverConfig.webserver.rdsTimeout && serverConfig.webserver.rdsTimeout != 0) {
    rdsTimeoutTimer = setTimeout(rdsReset, serverConfig.webserver.rdsTimeout * 1000);
  }
}

function rdsReset() {
  resetToDefault(dataToSend);
  dataToSend.af.length = 0;
  rds.clear();
  if (rdsTimeoutTimer) {
    clearTimeout(rdsTimeoutTimer);
    rdsTimeoutTimer = null;
  }
}

function handleData(wss, receivedData, rdsWss, onBandChange) {
  // Retrieve the last update time for this client
  const currentTime = Date.now();

  let modifiedData, parsedValue;
  const receivedLines = receivedData.split('\n');
  
  for (const receivedLine of receivedLines) {
    switch (true) {
      case receivedLine.startsWith('F'): // Bandwidth
        initialData.bw = receivedLine.substring(1);
        dataToSend.bw = receivedLine.substring(1);
        break;
      case receivedLine.startsWith('P'): // PI Code
        rdsReceived();
        modifiedData = receivedLine.slice(1);
        legacyRdsPiBuffer = modifiedData;
        if (dataToSend.pi.length >= modifiedData.length || dataToSend.pi == '?') {
          dataToSend.pi = modifiedData;
        }
        break;
      case receivedLine.startsWith('T'): // Frequency
        modifiedData = receivedLine.substring(1).split(",")[0];
        const previousFrequency = Number(dataToSend.freq);

        rdsReset();
        if((modifiedData / 1000).toFixed(3) == dataToSend.freq) {
          return; // Prevent tune spamming using scrollwheel
        }

        parsedValue = parseFloat(modifiedData);

        if (!isNaN(parsedValue)) {
          initialData.freq = (parsedValue / 1000).toFixed(3);
          dataToSend.freq = (parsedValue / 1000).toFixed(3);
          dataToSend.pi = '?';
          dataToSend.txInfo.reg = false;

          rdsWss.clients.forEach((client) => {
            client.send("G:\r\nRESET-------\r\n\r\n");
          });

          const currentFrequency = Number(dataToSend.freq);
          if (previousFrequency >= 30 && currentFrequency < 30 && typeof onBandChange === 'function') {
            onBandChange('am');
          } else if (previousFrequency < 30 && currentFrequency >= 30 && typeof onBandChange === 'function') {
            onBandChange('fm');
          }
        }
        break;
      case receivedLine.startsWith('Z'): // Antenna
        dataToSend.ant = receivedLine.substring(1);
        initialData.ant = receivedLine.substring(1);
        rdsReset();
        break;
      case receivedLine.startsWith('A'): // AGC
        dataToSend.agc = receivedLine.substring(1);
        initialData.agc = receivedLine.substring(1);
        break;
      case receivedLine.startsWith('G'): // EQ / iMS (RF+/IF+)
        const mapping = filterMappings[receivedLine];
        if (mapping) {
          initialData.eq = mapping.eq;
          initialData.ims = mapping.ims;
          dataToSend.eq = mapping.eq;
          dataToSend.ims = mapping.ims;
        }
        break;
      case receivedLine.startsWith('W'): // Bandwidth
        initialData.bw = receivedLine.substring(1);
        dataToSend.bw = receivedLine.substring(1);
        break;
      case receivedLine.startsWith('Sm'):
        processSignal(receivedLine, false, false);
        break;
      case receivedLine.startsWith('Ss'):
        processSignal(receivedLine, true, false);
        break;
      case receivedLine.startsWith('SS'):
        processSignal(receivedLine, true, true);
        break;
      case receivedLine.startsWith('SM'):
          processSignal(receivedLine, false, true);
          break;
      case receivedLine.startsWith('R'): // RDS HEX
        rdsReceived();
        modifiedData = receivedLine.slice(1);
        dataToSend.rds = true;

        if (modifiedData.length == 14) {
          // Handle legacy RDS message
          var errorsNew = 0;
          var pi;

          if (legacyRdsPiBuffer !== null &&
              legacyRdsPiBuffer.length >= 4) {
            pi = legacyRdsPiBuffer.slice(0, 4);
            // PI message does not carry explicit information about
            // error correction, but this is a good substitute.
            errorsNew = (legacyRdsPiBuffer.length - 4) << 6;
          } else {
            pi = '0000';
            errorsNew = (0x03 << 6);
          }

          let errorsOld = parseInt(modifiedData.slice(12), 16);
          errorsNew |= (errorsOld & 0x03) << 4;
          errorsNew |= (errorsOld & 0x0C);
          errorsNew |= (errorsOld & 0x30) >> 4;

          modifiedData = pi + modifiedData.slice(0, 12);
          modifiedData += errorsNew.toString(16).padStart(2, '0');
        }

        rdsWss.clients.forEach((client) => {
          const errors = parseInt(modifiedData.slice(-2), 16);
          let data = (((errors & 0xC0) == 0) ? modifiedData.slice(0, 4) : '----');
          data += (((errors & 0x30) == 0) ? modifiedData.slice(4, 8) : '----');
          data += (((errors & 0x0C) == 0) ? modifiedData.slice(8, 12) : '----');
          data += (((errors & 0x03) == 0) ? modifiedData.slice(12, 16) : '----');

          const newDataString = "G:\r\n" + data + "\r\n\r\n";
          const finalBuffer = Buffer.from(newDataString, 'utf-8');
          client.send(finalBuffer);
        });

        rds.parseString(modifiedData);
        dataToSend.lps = rds.getLPS();
        legacyRdsPiBuffer = null;
        break;
    }
  }

  // Get the received TX info
  fetchTx(parseFloat(dataToSend.freq).toFixed(1), dataToSend.pi, dataToSend.ps)
  .then((currentTx) => {
      if (currentTx && currentTx.station !== undefined && parseInt(currentTx.distance) < 4000) {
          dataToSend.txInfo = {
              tx: currentTx.station,
              pol: currentTx.pol,
              erp: currentTx.erp,
              city: currentTx.city,
              itu: currentTx.itu,
              dist: currentTx.distance,
              azi: currentTx.azimuth,
              id: currentTx.id,
              pi: currentTx.pi,
              reg: currentTx.reg,
              otherMatches: currentTx.others,
              score: currentTx.score,
          };
      }
  })
  .catch((error) => {
      console.log("Error fetching Tx info:", error);
  });

    // Send the updated data to the client
    const dataToSendJSON = JSON.stringify(dataToSend);
    if (currentTime - lastUpdateTime >= updateInterval) {
      wss.clients.forEach((client) => {
          client.send(dataToSendJSON);
      });
      lastUpdateTime = Date.now();
      serialportUpdateTime = process.hrtime();
    }
}

// Serialport retry code when port is open but communication is lost (additional code in index.js)
let state = {
  isSerialportAlive: true,
  isSerialportRetrying: false,
  lastFrequencyAlive: '87.500'
};

setInterval(() => {
  state.lastFrequencyAlive = initialData.freq;
  const serialportElapsedTime = process.hrtime(serialportUpdateTime)[0];
  // Activate serialport retry if handleData has not been executed for over 8 seconds
  if (checkSerialport && (serialportElapsedTime > 8) && !state.isSerialportRetrying && serverConfig.xdrd.wirelessConnection === false) {
    state.isSerialportAlive = false;
    state.isSerialportRetrying = true;
  }
}, 2000);

// Delay checking Serialport status on startup for 10 seconds
async function checkSerialPortStatus() {
    const ServerStartTime = process.hrtime();

    while (!checkSerialport) {
        const ServerElapsedSeconds = process.hrtime(ServerStartTime)[0];

        if (ServerElapsedSeconds > 10) {
            checkSerialport = true;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
    }
}
checkSerialPortStatus();

function showOnlineUsers(currentUsers) {
  dataToSend.users = currentUsers;
  initialData.users = currentUsers;
}

let prevFreq = initialData.freq || '87.500';
function processSignal(receivedData, st, stForced) {
  if (initialData.freq !== prevFreq) {
    prevFreq = initialData.freq;
    dataToSend.ps_errors = '';
  }

  const modifiedData = receivedData.substring(2);
  const parsedValue = parseFloat(modifiedData);
  dataToSend.st = st;
  dataToSend.stForced = stForced;
  initialData.st = st;
  initialData.stForced = stForced;

  if (!isNaN(parsedValue)) {
    // Convert parsedValue to a number
    var signal = parseFloat(parsedValue.toFixed(2));
    dataToSend.sig = signal;
    initialData.sig = signal;
    dataToSend.sigRaw = receivedData;
    initialData.sigRaw = receivedData;

    // Convert highestSignal to a number for comparison
    var highestSignal = parseFloat(dataToSend.sigTop);
    if (signal > highestSignal) {
        dataToSend.sigTop = signal.toString(); // Convert back to string for consistency
    }
}

}

module.exports = {
  handleData, showOnlineUsers, dataToSend, initialData, resetToDefault, state
};
