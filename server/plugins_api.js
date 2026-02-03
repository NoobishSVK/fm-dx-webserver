// plugins_api.js
// Shared API for server plugins:
// - Provides privileged/admin command access
// - Holds the output reference for internal use
// - Exposes WebSocket and server context to plugins safely

const { logInfo, logWarn, logError } = require('./console');

let output = null;
let wss = null;
let pluginsWss = null;
let httpServer = null;
let serverConfig = null;

// ---- registration server side ----

function registerServerContext(ctx) {
    if (ctx.wss) wss = ctx.wss;
    if (ctx.pluginsWss) pluginsWss = ctx.pluginsWss;
    if (ctx.httpServer) httpServer = ctx.httpServer;
    if (ctx.serverConfig) serverConfig = ctx.serverConfig;
}

function setOutput(newOutput) {
    output = newOutput;
}

function clearOutput() {
    output = null;
}

// ---- accessors plugin side ----

function getWss() {
    return wss;
}

function getPluginsWss() {
    return pluginsWss;
}

function getHttpServer() {
    return httpServer;
}

function getServerConfig() {
    return serverConfig;
}

async function sendPrivilegedCommand(command, isPluginInternal = false) {
    const maxWait = 10000;
    const interval = 500;
    let waited = 0;

    while (!output && waited < maxWait) {
        await new Promise(resolve => setTimeout(resolve, interval));
        waited += interval;
    }

    if (!output) {
        logError(`[Privileged Send] Timeout waiting for output connection (${command})`);
        return false;
    }

    if (isPluginInternal) {
        output.write(`${command}\n`);
        //logInfo(`[Privileged Plugin] Command sent: ${command}`); // Debug
        return true;
    }

    logWarn(`[Privileged Send] Rejected: Not internal (${command.slice(0, 64)})`);
    return false;
}

module.exports = {
    // server registration
    registerServerContext,
    setOutput,
    clearOutput,

    // plugin-facing API
    getWss,
    getPluginsWss,
    getHttpServer,
    getServerConfig,
    sendPrivilegedCommand
};
