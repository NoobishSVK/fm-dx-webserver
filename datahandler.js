const koffi = require('koffi');
const path = require('path');
//const lib = koffi.load(path.join(__dirname, "librds.so"));
//const lib = koffi.load(path.join(__dirname, "librds.dll"));
const os = require('os');
const win32 = (os.platform() == "win32");
const unicode_type = (win32 ? 'int16_t' : 'int32_t');
const lib = koffi.load(path.join(__dirname, "librdsparser." + (win32 ? "dll" : "so")));

koffi.proto('void callback_pi(void *rds, void *user_data)');
koffi.proto('void callback_pty(void *rds, void *user_data)');
koffi.proto('void callback_tp(void *rds, void *user_data)');
koffi.proto('void callback_ta(void *rds, void *user_data)');
koffi.proto('void callback_ms(void *rds, void *user_data)');
koffi.proto('void callback_ecc(void *rds, void *user_data)');
koffi.proto('void callback_af(void *rds, uint32_t af, void *user_data)');
koffi.proto('void callback_ps(void *rds, void *user_data)');
koffi.proto('void callback_rt(void *rds, int flag, void *user_data)');
koffi.proto('void callback_ptyn(void *rds, void *user_data)');

const rdsparser = {
    new: lib.func('void* rdsparser_new()'),
    clear: lib.func('void rdsparser_clear(void *rds)'),
    free: lib.func('void rdsparser_free(void *rds)'),
    parse_string: lib.func('bool rdsparser_parse_string(void *rds, const char *input)'),
    get_pi: lib.func('int32_t rdsparser_get_pi(void *rds)'),
    get_pty: lib.func('int8_t rdsparser_get_pty(void *rds)'),
    get_tp: lib.func('int8_t rdsparser_get_tp(void *rds)'),
    get_ta: lib.func('int8_t rdsparser_get_ta(void *rds)'),
    get_ms: lib.func('int8_t rdsparser_get_ms(void *rds)'),
    get_ecc: lib.func('int8_t rdsparser_get_ecc(void *rds)'),
    get_ps: lib.func('void* rdsparser_get_ps(void *rds)'),
    get_rt: lib.func('void* rdsparser_get_rt(void *rds, int flag)'),
    get_ptyn: lib.func('void* rdsparser_get_ptyn(void *rds)'),
    register_pi: lib.func('void rdsparser_register_pi(void *rds, callback_pi *cb)'),
    register_pty: lib.func('void rdsparser_register_pty(void *rds, callback_pty *cb)'),
    register_tp: lib.func('void rdsparser_register_tp(void *rds, callback_tp *cb)'),
    register_ta: lib.func('void rdsparser_register_ta(void *rds, callback_ta *cb)'),
    register_ms: lib.func('void rdsparser_register_ms(void *rds, callback_ms *cb)'),
    register_ecc: lib.func('void rdsparser_register_ecc(void *rds, callback_ecc *cb)'),
    register_af: lib.func('void rdsparser_register_af(void *rds, callback_af *cb)'),
    register_ps: lib.func('void rdsparser_register_ps(void *rds, callback_ps *cb)'),
    register_rt: lib.func('void rdsparser_register_rt(void *rds, callback_rt *cb)'),
    register_ptyn: lib.func('void rdsparser_register_ptyn(void *rds, callback_ptyn *cb)'),
    string_get_content: lib.func(unicode_type + '* rdsparser_string_get_content(void *string)'),
    string_get_length: lib.func('uint8_t rdsparser_string_get_length(void *string)')
}

const decode_unicode = function(string)
{
    let content = rdsparser.string_get_content(string);
    let length = rdsparser.string_get_length(string);
    let array = koffi.decode(content, koffi.array(unicode_type, length));
    return Buffer.from(array, 'utf-8').toString();
};

const callbacks = {
  pi: koffi.register(rds => (
    value = rdsparser.get_pi(rds),
    console.log('PI: ' + value.toString(16).toUpperCase())
  ), 'callback_pi *'),

  pty: koffi.register(rds => (
    value = rdsparser.get_pty(rds),
    dataToSend.pty = value
  ), 'callback_pty *'),

  tp: koffi.register(rds => (
    value = rdsparser.get_tp(rds),
    dataToSend.tp = value
  ), 'callback_tp *'),

  ta: koffi.register(rds => (
    value = rdsparser.get_ta(rds),
    console.log('TA: ' + value)
  ), 'callback_ta *'),

  ms: koffi.register(rds => (
    value = rdsparser.get_ms(rds),
    console.log('MS: ' + value)
  ), 'callback_ms *'),

  af: koffi.register((rds, value) => (
    dataToSend.af.push(value)
  ), 'callback_af *'),

  ecc: koffi.register(rds => (
    value = rdsparser.get_ecc(rds),
    console.log('ECC: ' + value.toString(16).toUpperCase())
  ), 'callback_ecc *'),

  ps: koffi.register(rds => (
    value = decode_unicode(rdsparser.get_ps(rds)),
    dataToSend.ps = value
  ), 'callback_ps *'),

  rt: koffi.register((rds, flag) => {
    const value = decode_unicode(rdsparser.get_rt(rds, flag));

    if (flag === 0) {
      dataToSend.rt0 = value;
    }

    if (flag === 1) {
      dataToSend.rt1 = value;
    }
  }, 'callback_rt *'),

  ptyn: koffi.register((rds, flag) => (
    value = decode_unicode(rdsparser.get_ptyn(rds))
    /*console.log('PTYN: ' + value)*/
), 'callback_ptyn *')
};


let rds = rdsparser.new()
rdsparser.register_pi(rds, callbacks.pi);
rdsparser.register_pty(rds, callbacks.pty);
rdsparser.register_tp(rds, callbacks.tp);
rdsparser.register_ta(rds, callbacks.ta);
rdsparser.register_ms(rds, callbacks.ms);
rdsparser.register_ecc(rds, callbacks.ecc);
rdsparser.register_af(rds, callbacks.af);
rdsparser.register_ps(rds, callbacks.ps);
rdsparser.register_rt(rds, callbacks.rt);
rdsparser.register_ptyn(rds, callbacks.ptyn);

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
      rdsparser.parse_string(rds, group);
    }
}

function handleData(ws, receivedData) {
  // Retrieve the last update time for this client
  let lastUpdateTime = clientUpdateIntervals.get(ws) || 0;
  const currentTime = Date.now();
  let modifiedData, parsedValue;
  const receivedLines = receivedData.split('\n');

  for (const receivedLine of receivedLines) {

    switch (true) {
      case receivedLine.startsWith('P'):
        modifiedData = receivedLine.substring(1, 5);
        dataToSend.pi = modifiedData;
        break;

      case receivedLine.startsWith('T'):
        rdsBuffer = [];
        resetToDefault(dataToSend);
        dataToSend.af.length = 0;
        rdsparser.clear(rds);
        modifiedData = receivedLine.substring(1);
        parsedValue = parseFloat(modifiedData);

        if (!isNaN(parsedValue)) {
          dataToSend.freq = (parsedValue / 1000).toFixed(3);
          dataToSend.pi = '?';
        }
        break;

      case receivedLine.startsWith('Sm'):
        modifiedData = receivedLine.substring(2);
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

      case receivedLine.startsWith('R'):
        modifiedData = receivedLine.slice(1, -1).toUpperCase();
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
  }

    // Send the updated data to the client
    const dataToSendJSON = JSON.stringify(dataToSend);
      if (currentTime - lastUpdateTime >= updateInterval) {
    clientUpdateIntervals.set(ws, currentTime); // Update the last update time for this client
    ws.send(dataToSendJSON);
    }
}

/*setInterval(function () {
  // some code
  if (rdsBuffer.length > 50) {
    handleBuffer();
    //console.log("handling buffer");
  }
  //console.log(rdsBuffer.length);
}, 150);*/

module.exports = {
  handleData
};