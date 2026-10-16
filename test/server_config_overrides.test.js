"use strict";

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const serverConfigModule = path.join(__dirname, '../server/server_config.js');

// Loads server_config in a fresh process (it reads the environment and the
// config file at require time), runs `script`, and returns its JSON output.
function runWithConfig(t, fileConfig, environment, script) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fmdx-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(fileConfig));

  const output = execFileSync(process.execPath, ['-e', `
    const config = require(${JSON.stringify(serverConfigModule)});
    const result = (${script})(config);
    setTimeout(() => {
      process.stdout.write('\\n@@' + JSON.stringify(result));
      process.exit(0);
    }, 20);
  `], {
    cwd: directory,
    env: { ...process.env, ...environment, FMDX_CONFIG_PATH: configPath },
    encoding: 'utf8'
  });

  return {
    result: JSON.parse(output.slice(output.lastIndexOf('@@') + 2)),
    saved: JSON.parse(fs.readFileSync(configPath, 'utf8'))
  };
}

test('environment overrides are never written to the config file', (t) => {
  const { result, saved } = runWithConfig(
    t,
    { password: { adminPass: 'stored-admin', tunePass: '' }, rtlTcp: { host: '127.0.0.1' } },
    { FMDX_ADMIN_PASSWORD: 'deployment-admin', RTL_TCP_HOST: 'rtl_tcp' },
    `({ serverConfig, configSave }) => {
      configSave();
      return {
        adminPass: serverConfig.password.adminPass,
        host: serverConfig.rtlTcp.host
      };
    }`
  );

  assert.deepEqual(result, { adminPass: 'deployment-admin', host: 'rtl_tcp' });
  assert.equal(saved.password.adminPass, 'stored-admin');
  assert.equal(saved.rtlTcp.host, '127.0.0.1');
});

test('a panel save keeps environment overrides in effect', (t) => {
  const { result, saved } = runWithConfig(
    t,
    { password: { adminPass: 'stored-admin', tunePass: '' }, rtlTcp: { host: '127.0.0.1' } },
    { FMDX_ADMIN_PASSWORD: 'deployment-admin', RTL_TCP_HOST: 'rtl_tcp' },
    `({ serverConfig, configUpdate }) => {
      // The setup page posts back the stored file values it loaded.
      configUpdate({
        password: { adminPass: 'stored-admin', tunePass: 'tune-secret' },
        rtlTcp: { host: 'panel-host' }
      });
      return {
        adminPass: serverConfig.password.adminPass,
        tunePass: serverConfig.password.tunePass,
        host: serverConfig.rtlTcp.host
      };
    }`
  );

  assert.deepEqual(result, {
    adminPass: 'deployment-admin',
    tunePass: 'tune-secret',
    host: 'rtl_tcp'
  });
  assert.equal(saved.password.adminPass, 'stored-admin');
  assert.equal(saved.password.tunePass, 'tune-secret');
  assert.equal(saved.rtlTcp.host, 'panel-host');
});
