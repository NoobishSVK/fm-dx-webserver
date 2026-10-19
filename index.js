// Tiny supervisor: runs the server as a child process and starts it again
// when it exits with RESTART_CODE (used by the admin panel restart button).
// The child is this same file, so require.main stays the root index.js (plugins resolve paths from it).
if (process.env.FMDX_SERVER) {
  require('./server/index.js');
} else {
  const { fork } = require('child_process');
  const RESTART_CODE = 75;

  let child;
  function start() {
    child = fork(__filename, process.argv.slice(2), { env: { ...process.env, FMDX_SERVER: '1' } });
    child.on('exit', (code) => code === RESTART_CODE ? start() : process.exit(code ?? 1));
  }

  // Ctrl+C reaches the child directly; the child's exit then ends us. Forward kill signals.
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => child.kill('SIGTERM'));

  start();
}

/**
 * FM-DX Webserver
 *
 * Github repo: https://github.com/NoobishSVK/fm-dx-webserver
 * Server files: /server
 * Client files (web): /web
 * Plugin files: /plugins
 */
