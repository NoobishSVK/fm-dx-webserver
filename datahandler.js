/* Libraries / Imports */
const fs = require('fs');
const https = require('https');
const koffi = require('koffi');
const path = require('path');
const os = require('os');
const platform = os.platform();
const cpuArchitecture = os.arch();
let unicode_type;
let shared_Library;

if (platform === 'win32') {
  unicode_type = 'int16_t';
  shared_Library=path.join(__dirname, "libraries", "librdsparser.dll");
} else if (platform === 'linux') {
  unicode_type = 'int32_t';
  shared_Library=path.join(__dirname, "libraries", "librdsparser_" + cpuArchitecture + ".so");
} 

const lib = koffi.load(shared_Library);
const { fetchTx } = require('./tx_search.js');

koffi.proto('void callback_pi(void *rds, void *user_data)');
koffi.proto('void callback_pty(void *rds, void *user_data)');
koffi.proto('void callback_tp(void *rds, void *user_data)');
koffi.proto('void callback_ta(void *rds, void *user_data)');
koffi.proto('void callback_ms(void *rds, void *user_data)');
koffi.proto('void callback_ecc(void *rds, void *user_data)');
koffi.proto('void callback_country(void *rds, void *user_data)');
koffi.proto('void callback_af(void *rds, uint32_t af, void *user_data)');
koffi.proto('void callback_ps(void *rds, void *user_data)');
koffi.proto('void callback_rt(void *rds, int flag, void *user_data)');
koffi.proto('void callback_ptyn(void *rds, void *user_data)');
koffi.proto('void callback_ct(void *rds, void *ct, void *user_data)');

const rdsparser = {
  new: lib.func('void* rdsparser_new()'),
  free: lib.func('void rdsparser_free(void *rds)'),
  clear: lib.func('void rdsparser_clear(void *rds)'),
  parse_string: lib.func('bool rdsparser_parse_string(void *rds, const char *input)'),
  set_text_correction: lib.func('bool rdsparser_set_text_correction(void *rds, uint8_t text, uint8_t type, uint8_t error)'),
  set_text_progressive: lib.func('bool rdsparser_set_text_progressive(void *rds, uint8_t string, bool state)'),
  get_pi: lib.func('int32_t rdsparser_get_pi(void *rds)'),
  get_pty: lib.func('int8_t rdsparser_get_pty(void *rds)'),
  get_tp: lib.func('int8_t rdsparser_get_tp(void *rds)'),
  get_ta: lib.func('int8_t rdsparser_get_ta(void *rds)'),
  get_ms: lib.func('int8_t rdsparser_get_ms(void *rds)'),
  get_ecc: lib.func('int16_t rdsparser_get_ecc(void *rds)'),
  get_country: lib.func('int rdsparser_get_country(void *rds)'),
  get_ps: lib.func('void* rdsparser_get_ps(void *rds)'),
  get_rt: lib.func('void* rdsparser_get_rt(void *rds, int flag)'),
  get_ptyn: lib.func('void* rdsparser_get_ptyn(void *rds)'),
  register_pi: lib.func('void rdsparser_register_pi(void *rds, void *cb)'),
  register_pty: lib.func('void rdsparser_register_pty(void *rds, void *cb)'),
  register_tp: lib.func('void rdsparser_register_tp(void *rds, void *cb)'),
  register_ta: lib.func('void rdsparser_register_ta(void *rds, void *cb)'),
  register_ms: lib.func('void rdsparser_register_ms(void *rds, void *cb)'),
  register_ecc: lib.func('void rdsparser_register_ecc(void *rds, void *cb)'),
  register_country: lib.func('void rdsparser_register_country(void *rds, void *cb)'),
  register_af: lib.func('void rdsparser_register_af(void *rds, void *cb)'),
  register_ps: lib.func('void rdsparser_register_ps(void *rds, void *cb)'),
  register_rt: lib.func('void rdsparser_register_rt(void *rds, void *cb)'),
  register_ptyn: lib.func('void rdsparser_register_ptyn(void *rds, void *cb)'),
  register_ct: lib.func('void rdsparser_register_ct(void *rds, void *cb)'),
  string_get_content: lib.func(unicode_type + '* rdsparser_string_get_content(void *string)'),
  string_get_errors: lib.func('uint8_t* rdsparser_string_get_errors(void *string)'),
  string_get_length: lib.func('uint8_t rdsparser_string_get_length(void *string)'),
  ct_get_year: lib.func('uint16_t rdsparser_ct_get_year(void *ct)'),
  ct_get_month: lib.func('uint8_t rdsparser_ct_get_month(void *ct)'),
  ct_get_day: lib.func('uint8_t rdsparser_ct_get_day(void *ct)'),
  ct_get_hour: lib.func('uint8_t rdsparser_ct_get_hour(void *ct)'),
  ct_get_minute: lib.func('uint8_t rdsparser_ct_get_minute(void *ct)'),
  ct_get_offset: lib.func('int8_t rdsparser_ct_get_offset(void *ct)'),
  pty_lookup_short: lib.func('const char* rdsparser_pty_lookup_short(int8_t pty, bool rbds)'),
  pty_lookup_long: lib.func('const char* rdsparser_pty_lookup_long(int8_t pty, bool rbds)'),
  country_lookup_name: lib.func('const char* rdsparser_country_lookup_name(int country)'),
  country_lookup_iso: lib.func('const char* rdsparser_country_lookup_iso(int country)')
}

const callbacks = {
  pi: koffi.register(rds => (
    value = rdsparser.get_pi(rds)
    //console.log('PI: ' + value.toString(16).toUpperCase())
  ), 'callback_pi*'),

  pty: koffi.register(rds => (
    value = rdsparser.get_pty(rds),
    dataToSend.pty = value
  ), 'callback_pty*'),

  tp: koffi.register(rds => (
    value = rdsparser.get_tp(rds),
    dataToSend.tp = value
  ), 'callback_tp*'),

  ta: koffi.register(rds => (
    value = rdsparser.get_ta(rds),
    dataToSend.ta = value
  ), 'callback_ta*'),

  ms: koffi.register(rds => (
    value = rdsparser.get_ms(rds),
    dataToSend.ms = value
  ), 'callback_ms*'),

  af: koffi.register((rds, value) => (
    dataToSend.af.push(value)
  ), 'callback_af*'),

  ecc: koffi.register(rds => (
    value = rdsparser.get_ecc(rds)
  ), 'callback_ecc*'),

  country: koffi.register(rds => (
    value = rdsparser.get_country(rds),
    display = rdsparser.country_lookup_name(value),
    iso = rdsparser.country_lookup_iso(value),
    dataToSend.country_name = display,
    dataToSend.country_iso = iso
  ), 'callback_country*'),

  ps: koffi.register(rds => (
    ps = rdsparser.get_ps(rds),
    dataToSend.ps = decode_unicode(ps),
    dataToSend.ps_errors = decode_errors(ps)
  ), 'callback_ps*'),

  rt: koffi.register((rds, flag) => {
    const rt = rdsparser.get_rt(rds, flag);

    if (flag === 0) {
      dataToSend.rt0 = decode_unicode(rt);
      dataToSend.rt0_errors = decode_errors(rt);
    }

    if (flag === 1) {
      dataToSend.rt1 = decode_unicode(rt);
      dataToSend.rt1_errors = decode_errors(rt);
    }
  }, 'callback_rt*'),

  ptyn: koffi.register((rds, flag) => (
    value = decode_unicode(rdsparser.get_ptyn(rds))
    /*console.log('PTYN: ' + value)*/
  ), 'callback_ptyn*'),

  ct: koffi.register((rds, ct) => (
    year = rdsparser.ct_get_year(ct),
    month = String(rdsparser.ct_get_month(ct)).padStart(2, '0'),
    day = String(rdsparser.ct_get_day(ct)).padStart(2, '0'),
    hour = String(rdsparser.ct_get_hour(ct)).padStart(2, '0'),
    minute = String(rdsparser.ct_get_minute(ct)).padStart(2, '0'),
    offset = rdsparser.ct_get_offset(ct),
    tz_sign = (offset >= 0 ? '+' : '-'),
    tz_hour = String(Math.abs(Math.floor(offset / 60))).padStart(2, '0'),
    tz_minute = String(Math.abs(offset % 60)).padStart(2, '0')
    //console.log('CT: ' + year + '-' + month + '-' + day + ' ' + hour + ':' + minute + ' (' + tz_sign + tz_hour + ':' + tz_minute + ')')
  ), 'callback_ct*')
};

let rds = rdsparser.new()
rdsparser.set_text_correction(rds, 0, 0, 2);
rdsparser.set_text_correction(rds, 0, 1, 2);
rdsparser.set_text_correction(rds, 1, 0, 2);
rdsparser.set_text_correction(rds, 1, 1, 2);
rdsparser.set_text_progressive(rds, 0, true)
rdsparser.set_text_progressive(rds, 1, true)
rdsparser.register_pi(rds, callbacks.pi);
rdsparser.register_pty(rds, callbacks.pty);
rdsparser.register_tp(rds, callbacks.tp);
rdsparser.register_ta(rds, callbacks.ta);
rdsparser.register_ms(rds, callbacks.ms);
rdsparser.register_ecc(rds, callbacks.ecc);
rdsparser.register_country(rds, callbacks.country);
rdsparser.register_af(rds, callbacks.af);
rdsparser.register_ps(rds, callbacks.ps);
rdsparser.register_rt(rds, callbacks.rt);
rdsparser.register_ptyn(rds, callbacks.ptyn);
rdsparser.register_ct(rds, callbacks.ct);

const decode_unicode = function(string) {
    let length = rdsparser.string_get_length(string);
    if (length) {
      let content = rdsparser.string_get_content(string);
      let array = koffi.decode(content, unicode_type + ' [' + length + ']');
      return String.fromCodePoint.apply(String, array);
    }
    return '';
};

const decode_errors = function(string) {
    let length = rdsparser.string_get_length(string);
    if (length) {
      let errors = rdsparser.string_get_errors(string);
      let array = koffi.decode(errors, 'uint8_t [' + length + ']');
      return Uint8Array.from(array).toString();
    }
    return '';
};

const updateInterval = 75;
const clientUpdateIntervals = new Map(); // Store update intervals for each client

// Initialize the data object
var dataToSend = {
  pi: '?',
  freq: 87.500,
  previousFreq: 87.500,
  signal: 0,
  st: false,
  st_forced: false,
  ps: '',
  tp: false,
  ta: 0,
  ms: -1,
  pty: 0,
  af: [],
  rt0: '',
  rt1: '',
  ims: 0,
  eq: 0,
  ant: 0,
  txInfo: {
    station: '',
    pol: '',
    erp: '',
    city: '',
    itu: '',
    distance: '',
    azimuth: ''
  },
  country_name: '',
  country_iso: 'UN',
  users: '',
};

var legacyRdsPiBuffer = null;
const initialData = { ...dataToSend };
const resetToDefault = dataToSend => Object.assign(dataToSend, initialData);


function handleData(ws, receivedData) {
  // Retrieve the last update time for this client
  let lastUpdateTime = clientUpdateIntervals.get(ws) || 0;
  const currentTime = Date.now();
  let modifiedData, parsedValue;
  const receivedLines = receivedData.split('\n');
  for (const receivedLine of receivedLines) {
    switch (true) {
      case receivedLine.startsWith('P'):
        modifiedData = receivedLine.slice(1);
        legacyRdsPiBuffer = modifiedData;
        if (dataToSend.pi.length >= modifiedData.length || dataToSend.pi == '?') {
          dataToSend.pi = modifiedData;
        }
        break;
      case receivedLine.startsWith('T'):
        resetToDefault(dataToSend);
        dataToSend.af.length = 0;
        rdsparser.clear(rds);
        modifiedData = receivedLine.substring(1);
        parsedValue = parseFloat(modifiedData);

        if (!isNaN(parsedValue)) {
          initialData.freq = (parsedValue / 1000).toFixed(3);
          dataToSend.freq = (parsedValue / 1000).toFixed(3);
          dataToSend.pi = '?';
        }
        break;
      case receivedLine.startsWith('Z'):
        dataToSend.ant = receivedLine.substring(1);
        initialData.ant = receivedLine.substring(1);
        break;
      case receivedLine.startsWith('G'):
        switch (receivedLine) {
          case 'G11':
            initialData.eq = 1;
            dataToSend.eq = 1;
            initialData.ims = 1;
            dataToSend.ims = 1;
            break;
          case 'G01':
            initialData.eq = 0;
            dataToSend.eq = 0;
            initialData.ims = 1;
            dataToSend.ims = 1;
            break;
          case 'G10':
            initialData.eq = 1;
            dataToSend.eq = 1;
            initialData.ims = 0;
            dataToSend.ims = 0;
            break;
          case 'G00':
            initialData.eq = 0;
            initialData.ims = 0;
            dataToSend.eq = 0;
            dataToSend.ims = 0;
            break;
          }
      case receivedLine.startsWith('Sm'):
        modifiedData = receivedLine.substring(2);
        parsedValue = parseFloat(modifiedData);
        dataToSend.st = false;
        dataToSend.st_forced = false;
        initialData.st = false;
        initialData.st_forced = false;

        if (!isNaN(parsedValue)) {
          dataToSend.signal = parsedValue.toFixed(2);
          initialData.signal = parsedValue.toFixed(2);
        }
        break;
      case receivedData.startsWith('Ss'):
        modifiedData = receivedData.substring(2);
        parsedValue = parseFloat(modifiedData);
        dataToSend.st = true;
        dataToSend.st_forced = false;
        initialData.st = true;
        initialData.st_forced = false;

        if (!isNaN(parsedValue)) {
          dataToSend.signal = parsedValue.toFixed(2);
          initialData.signal = parsedValue.toFixed(2);
        }
        break;
      case receivedData.startsWith('SS'):
        modifiedData = receivedData.substring(2);
        parsedValue = parseFloat(modifiedData);
        dataToSend.st = true;
        dataToSend.st_forced = true;
        initialData.st = true;
        initialData.st_forced = true;
  
        if (!isNaN(parsedValue)) {
          dataToSend.signal = parsedValue.toFixed(2);
          initialData.signal = parsedValue.toFixed(2);
        }
        break;
      case receivedData.startsWith('SM'):
        modifiedData = receivedData.substring(2);
        parsedValue = parseFloat(modifiedData);
        dataToSend.st = false;
        dataToSend.st_forced = true;
        initialData.st = false;
        initialData.st_forced = true;
    
        if (!isNaN(parsedValue)) {
          dataToSend.signal = parsedValue.toFixed(2);
          initialData.signal = parsedValue.toFixed(2);
        }
        break;
      case receivedLine.startsWith('R'):
        modifiedData = receivedLine.slice(1);

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

        rdsparser.parse_string(rds, modifiedData);
        legacyRdsPiBuffer = null;
        break;
    }
  }

  // Get the received TX info
  const currentTx = fetchTx(parseFloat(dataToSend.freq).toFixed(1), dataToSend.pi, dataToSend.ps);
  if(currentTx && currentTx.station !== undefined) {
    dataToSend.txInfo = {
      station: currentTx.station,
      pol: currentTx.pol,
      erp: currentTx.erp,
      city: currentTx.city,
      itu: currentTx.itu,
      distance: currentTx.distance,
      azimuth: currentTx.azimuth
    }
  }

    // Send the updated data to the client
    const dataToSendJSON = JSON.stringify(dataToSend);
    if (currentTime - lastUpdateTime >= updateInterval) {
      clientUpdateIntervals.set(ws, currentTime); // Update the last update time for this client
      ws.send(dataToSendJSON);
    }
}

function showOnlineUsers(currentUsers) {
  dataToSend.users = currentUsers;
  initialData.users = currentUsers;
}

module.exports = {
  handleData, showOnlineUsers, dataToSend, initialData
};
