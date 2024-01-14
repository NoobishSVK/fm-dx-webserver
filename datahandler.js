const koffi = require('koffi');
const path = require('path');
const lib = koffi.load(path.join(__dirname, "librds.so"));

koffi.proto('void callback_pi(uint16_t pi, void *user_data)');
koffi.proto('void callback_pty(uint8_t pty, void *user_data)');
koffi.proto('void callback_tp(bool tp, void *user_data)');
koffi.proto('void callback_ta(bool ta, void *user_data)');
koffi.proto('void callback_ms(bool ms, void *user_data)');
koffi.proto('void callback_af(uint8_t af, void *user_data)');
koffi.proto('void callback_ecc(uint8_t ecc, void *user_data)');
koffi.proto('void callback_ps(const char *ps, const uint8_t *errors, void *user_data)');
koffi.proto('void callback_rt(const char *rt, const uint8_t *errors, int flag, void *user_data)');

const librds = {
  new: lib.func('void* librds_new()'),
  clear: lib.func('void librds_clear(void *context)'),
  free: lib.func('void librds_free(void *context)'),
  parse: lib.func('bool librds_parse(void *context, const char *input)'),
  get_ps: lib.func('char* librds_get_ps(void *context)'),
  get_rt: lib.func('char* librds_get_rt(void *context, int flag)'),
  register_pi: lib.func('void librds_register_pi(void *context, callback_pi *cb)'),
  register_pty: lib.func('void librds_register_pty(void *context, callback_pty *cb)'),
  register_tp: lib.func('void librds_register_tp(void *context, callback_tp *cb)'),
  register_ta: lib.func('void librds_register_ta(void *context, callback_ta *cb)'),
  register_ms: lib.func('void librds_register_ms(void *context, callback_ms *cb)'),
  register_af: lib.func('void librds_register_af(void *context, callback_af *cb)'),
  register_ecc: lib.func('void librds_register_ecc(void *context, callback_ecc *cb)'),
  register_ps: lib.func('void librds_register_ps(void *context, callback_ps *cb1)'),
  register_rt: lib.func('void librds_register_rt(void *context, callback_rt *cb)')
}

const callbacks = {
  pi: koffi.register((value) => {
    console.log('PI: ' + value.toString(16).toUpperCase());
  }, 'callback_pi *'),

  pty: koffi.register((value) => {
    dataToSend.pty = value;
  }, 'callback_pty *'),

  tp: koffi.register((value) => {
    dataToSend.tp = value;
  }, 'callback_tp *'),

  ta: koffi.register((value) => {
    console.log('TA: ' + value);
  }, 'callback_ta *'),

  ms: koffi.register((value) => {
    console.log('MS: ' + value);
  }, 'callback_ms *'),

  af: koffi.register((value) => {
    dataToSend.af.push(87500 + value * 100);
  }, 'callback_af *'),

  ecc: koffi.register((value) => {
    console.log('ECC: ' + value.toString(16).toUpperCase());
  }, 'callback_ecc *'),

  ps: koffi.register((value) => {
    dataToSend.ps = value;
  }, 'callback_ps *'),

  rt: koffi.register((value, errors, flag) => {
    if (flag === 0) {
      dataToSend.rt0 = value;
    }
    if (flag === 1) {
      dataToSend.rt1 = value;
    }
  }, 'callback_rt *'),
};


let rds = librds.new()
librds.register_pi(rds, callbacks.pi)
librds.register_pty(rds, callbacks.pty)
librds.register_tp(rds, callbacks.tp)
librds.register_ta(rds, callbacks.ta)
librds.register_ms(rds, callbacks.ms)
librds.register_af(rds, callbacks.af)
librds.register_ecc(rds, callbacks.ecc)
librds.register_ps(rds, callbacks.ps)
librds.register_rt(rds, callbacks.rt)

const updateInterval = 75;
const clientUpdateIntervals = new Map(); // Store update intervals for each client

// Initialize the data object
var dataToSend = {
  pi: '?',
  freq: 0,
  signal: '',
  st: false,
  rds: '',
  ps: '',
  tp: false,
  pty: 0,
  af: [],
  rt0: '',
  rt1: '',
};

const initialData = {
  pi: '?',
  freq: 0,
  signal: '',
  st: false,
  rds: '',
  ps: '',
  tp: false,
  pty: 0,
  af: [],
  rt0: '',
  rt1: '',
};

const resetToDefault = dataToSend => Object.assign(dataToSend, initialData);

var rdsBuffer = [];
function handleBuffer() {

  for (let group of rdsBuffer)
    {
      librds.parse(rds, group);
    }
}

function handleData(ws, receivedData) {
  // Retrieve the last update time for this client
  let lastUpdateTime = clientUpdateIntervals.get(ws) || 0;
  const currentTime = Date.now();
  let modifiedData, parsedValue;

    switch (true) {
      case receivedData.startsWith('P'):
        modifiedData = receivedData.substring(1, 5);
        dataToSend.pi = modifiedData;
        break;

      case receivedData.startsWith('T'):
        rdsBuffer = [];
        resetToDefault(dataToSend);
        dataToSend.af.length = 0;
        librds.clear(rds);
        modifiedData = receivedData.substring(1);
        parsedValue = parseFloat(modifiedData);

        if (!isNaN(parsedValue)) {
          dataToSend.freq = (parsedValue / 1000).toFixed(3);
          dataToSend.pi = '?';
        }
        break;

      case receivedData.startsWith('Sm'):
        modifiedData = receivedData.substring(2);
        parsedValue = parseFloat(modifiedData);
        dataToSend.st = false;

        if (!isNaN(parsedValue)) {
          dataToSend.signal = parsedValue.toFixed(1);
        }
        break;
      case receivedData.startsWith('Ss'):
        modifiedData = receivedData.substring(2);
        parsedValue = parseFloat(modifiedData);
        dataToSend.st = true;

        if (!isNaN(parsedValue)) {
          dataToSend.signal = parsedValue.toFixed(1);
        }
        break;

      case receivedData.startsWith('R'):
        modifiedData = dataToSend.pi.toUpperCase() + receivedData.slice(1, -1).toUpperCase();

        // Ensure modifiedData is exactly 18 characters long
        if (modifiedData.length < 18) {
          modifiedData = modifiedData.padEnd(18, '0'); // Add zeroes at the end
        } else if (modifiedData.length > 18) {
          modifiedData = modifiedData.slice(0, 18); // Truncate to 18 characters
        }

        dataToSend.rds = modifiedData;
        if (rdsBuffer.length > 1000) {
          rdsBuffer.shift();
        }
        rdsBuffer.push(modifiedData);
        if (rdsBuffer.length > 1) {
          handleBuffer();
        }
        break;

    }

    // Send the updated data to the client
    const dataToSendJSON = JSON.stringify(dataToSend);
      if (currentTime - lastUpdateTime >= updateInterval) {
    clientUpdateIntervals.set(ws, currentTime); // Update the last update time for this client
    ws.send(dataToSendJSON);
  }
}


module.exports = {
  handleData
};