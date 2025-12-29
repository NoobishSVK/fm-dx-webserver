const { logDebug, logError, logInfo, logWarn, logFfmpeg } = require('./console');
const { serverConfig } = require('./server_config');
const { Readable } = require('stream');
const { finished } = require('stream/promises');
const fs = require('fs/promises');
const fs2 = require('fs');
const path = require('path');
const os = require('os');
const ejs = require('ejs');
const { spawn } = require('child_process');
const readline = require('readline');

const fileExists = path => new Promise(resolve => fs.access(path, fs.constants.F_OK).then(() => resolve(true)).catch(() => resolve(false)));

async function connect() {
  if (serverConfig.tunnel?.enabled === true) {
    const librariesDir = path.resolve(__dirname, '../libraries');
    if (!await fileExists(librariesDir)) {
      await fs.mkdir(librariesDir);
    }
    const frpcPath = path.resolve(librariesDir, 'frpc' + (os.platform() === 'win32' ? '.exe' : ''));
    if (!await fileExists(frpcPath)) {
      logInfo('frpc binary required for tunnel is not available. Downloading now...');
      const frpcFileName = `frpc_${os.platform}_${os.arch}` + (os.platform() === 'win32' ? '.exe' : '');
      
      try {
        const res = await fetch('https://fmtuner.org/binaries/' + frpcFileName);
        if (res.status === 404) {
          throw new Error('404 error');
        }
        const stream = fs2.createWriteStream(frpcPath);
        await finished(Readable.fromWeb(res.body).pipe(stream));
      } catch (err) {
        logError('Failed to download frpc, reason: ' + err);
        return;
      }
      logInfo('Downloading of frpc is completed.')
      if (os.platform() === 'linux' || os.platform() === 'darwin') {
        await fs.chmod(frpcPath, 0o770);
      }
    }
    const cfg = ejs.render(frpcConfigTemplate, {
      cfg: serverConfig.tunnel,
      host: serverConfig.tunnel.community.enabled ? serverConfig.tunnel.community.host : serverConfig.tunnel.region + ".fmtuner.org",
      server: {
        port: serverConfig.webserver.webserverPort
      }
    });
    const cfgPath = path.resolve(librariesDir, 'frpc.toml');
    await fs.writeFile(cfgPath, cfg);
    const child = spawn(frpcPath, ['-c', cfgPath]);
    process.on('exit', () => {
      child.kill();
    });

    const rl = readline.createInterface({
      input: child.stdout,
      terminal: false
    });

    rl.on('line', (line) => {
      if (line.includes('connect to server error')) {
        const reason = line.substring(line.indexOf(': ')+2);
        logError('Failed to connect to tunnel, reason: ' + reason);
      } else if (line.includes('invalid user or token')) {
        logError('Failed to connect to tunnel, reason: invalid user or token');
      } else if (line.includes('start proxy success')) {
        logInfo('Tunnel established successfully');
      } else if (line.includes('login to server success')) {
        logInfo('Connection to tunnel server was successful');
      } else {
        logDebug('Tunnel log:', line);
      }
    });
  
    child.on('error', (err) => {
      logError('Failed to start tunnel process:', err);
    });
  
    child.on('close', (code) => {
      logInfo(`Tunnel process exited with code ${code}`);
    });

  }
}

const frpcConfigTemplate = `
serverAddr = "<%= host %>"
serverPort = 7000
loginFailExit = false
log.disablePrintColor = true
user = "<%= cfg.username %>"
metadatas.token = "<%= cfg.token %>"
<% if (cfg.lowLatencyMode) { %>
transport.protocol = "kcp"
<% } %>

[[proxies]]
name = "web"
type = "http"
localPort = <%= server.port %>
subdomain = "<%= cfg.subdomain %>"
<% if (cfg.httpName != "") { %>
httpUser = "<%= cfg.httpName %>"
httpPassword = "<%= cfg.httpPassword %>"
<% } %>
`;

module.exports = {
  connect
};