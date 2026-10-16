"use strict";

// Regenerates fir-wasm.js from fir.wat. The compiler is only needed when the
// kernel changes, so it is not a dependency of the server:
//   npm install --no-save wabt@1.0.37 && node server/rtl_tcp/dsp/build-fir-wasm.js

const fs = require('fs');
const path = require('path');

async function main() {
  const wabt = await require('wabt')();
  const source = fs.readFileSync(path.join(__dirname, 'fir.wat'), 'utf8');
  const module = wabt.parseWat('fir.wat', source, { simd: true });
  module.validate();
  const { buffer } = module.toBinary({});
  const lines = Buffer.from(buffer)
    .toString('base64')
    .match(/.{1,76}/g)
    .map((line) => `  '${line}'`)
    .join(' +\n');

  fs.writeFileSync(
    path.join(__dirname, 'fir-wasm.js'),
    `"use strict";

// Generated from fir.wat by build-fir-wasm.js. Do not edit.
module.exports = Buffer.from(
${lines},
  'base64'
);
`
  );
  console.log(`fir-wasm.js: ${buffer.length} bytes of WebAssembly`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
