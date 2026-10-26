/* SPDX-License-Identifier: LGPL-2.1-or-later
 * FM-DX Webserver adapter for the @barteqcz/rdsparser npm package.
 * Receives the same 18-character RDS hex frames as the previous C binding.
 */
const { RDSParser, TEXT, BLOCK_TYPE, PROGRESSIVE, countryName, countryISO } = require('@barteqcz/rdsparser');

function serialiseErrors(snapshot) {
  return snapshot.errors.slice(0, snapshot.length).join(',');
}

function createRDSReceiver(dataToSend) {
  const parser = new RDSParser();

  for (const text of [TEXT.PS, TEXT.RT]) {
    parser.setTextCorrection(text, BLOCK_TYPE.INFO, 2);
    parser.setTextCorrection(text, BLOCK_TYPE.DATA, 2);
    parser.setTextProgressive(text, PROGRESSIVE.AUTO);
  }

  parser.on('pty', value => { dataToSend.pty = value; });
  parser.on('tp', value => { dataToSend.tp = value; });
  parser.on('ta', value => { dataToSend.ta = value; });
  parser.on('ms', value => { dataToSend.ms = value; });
  parser.on('ecc', value => { dataToSend.ecc = value; });
  parser.on('af', frequencyKhz => { dataToSend.af.push(frequencyKhz); });
  parser.on('country', value => {
    const name = countryName(value);
    const iso = countryISO(value);
    dataToSend.country_name = name;
    dataToSend.country_iso = name.startsWith('USA') ? 'US' : /^[A-Z]{2}$/.test(iso) ? iso : 'UN';
  });
  parser.on('ps', snapshot => {
    dataToSend.ps = snapshot.text;
    dataToSend.ps_errors = serialiseErrors(snapshot);
  });
  parser.on('rt', (snapshot, flag) => {
    dataToSend[`rt${flag}`] = snapshot.text;
    dataToSend[`rt${flag}_errors`] = serialiseErrors(snapshot);
    dataToSend.rt_flag = flag;
  });

  return parser;
}

module.exports = { createRDSReceiver, serialiseErrors };