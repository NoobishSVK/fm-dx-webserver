const tunerProfiles = [
  {
    id: 'tef',
    label: 'TEF668x / TEA685x',
    fmBandwidths: [
      { value: 0, label: 'Auto' },
      { value: 56000, label: '56 kHz' },
      { value: 64000, label: '64 kHz' },
      { value: 72000, label: '72 kHz' },
      { value: 84000, label: '84 kHz' },
      { value: 97000, label: '97 kHz' },
      { value: 114000, label: '114 kHz' },
      { value: 133000, label: '133 kHz' },
      { value: 151000, label: '151 kHz' },
      { value: 184000, label: '184 kHz' },
      { value: 200000, label: '200 kHz' },
      { value: 217000, label: '217 kHz' },
      { value: 236000, label: '236 kHz' },
      { value: 254000, label: '254 kHz' },
      { value: 287000, label: '287 kHz' },
      { value: 311000, label: '311 kHz' }
    ],
    details: ''
  },
  {
    id: 'xdr',
    label: 'XDR (F1HD / S10HDiP)',
    fmBandwidths: [
      { value: 0, value2: -1, label: 'Auto' },
      { value: 55000, value2: 0, label: '55 kHz' },
      { value: 73000, value2: 1, label: '73 kHz' },
      { value: 90000, value2: 2, label: '90 kHz' },
      { value: 108000, value2: 3, label: '108 kHz' },
      { value: 125000, value2: 4, label: '125 kHz' },
      { value: 142000, value2: 5, label: '142 kHz' },
      { value: 159000, value2: 6, label: '159 kHz' },
      { value: 177000, value2: 7, label: '177 kHz' },
      { value: 194000, value2: 8, label: '194 kHz' },
      { value: 211000, value2: 9, label: '211 kHz' },
      { value: 229000, value2: 10, label: '229 kHz' },
      { value: 246000, value2: 11, label: '246 kHz' },
      { value: 263000, value2: 12, label: '263 kHz' },
      { value: 281000, value2: 13, label: '281 kHz' },
      { value: 298000, value2: 14, label: '298 kHz' },
      { value: 309000, value2: 15, label: '309 kHz' }
    ],
    details: ''
  },
  {
    id: 'sdr',
    label: 'SDR (RTL-SDR / AirSpy)',
    fmBandwidths: [
      { value: 0, label: 'Auto' },
      { value: 4000, label: '4 kHz' },
      { value: 8000, label: '8 kHz' },
      { value: 10000, label: '10 kHz' },
      { value: 20000, label: '20 kHz' },
      { value: 30000, label: '30 kHz' },
      { value: 50000, label: '50 kHz' },
      { value: 75000, label: '75 kHz' },
      { value: 100000, label: '100 kHz' },
      { value: 125000, label: '125 kHz' },
      { value: 150000, label: '150 kHz' },
      { value: 175000, label: '175 kHz' },
      { value: 200000, label: '200 kHz' },
      { value: 225000, label: '225 kHz' }
    ],
    details: ''
  },
  {
    id: 'si47xx',
    label: 'SI47XX (SI4735 / SI4732 / SI47XX)',
    fmBandwidths: [
      { value: 0, label: 'Auto' },
      { value: 40000, label: '40 kHz' },
      { value: 60000, label: '60 kHz' },
      { value: 84000, label: '84 kHz' },
      { value: 110000, label: '110 kHz' }
    ],
    details: ''
  }
];

module.exports = tunerProfiles;
