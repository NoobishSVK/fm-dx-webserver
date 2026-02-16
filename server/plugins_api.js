// plugins_api.js
// Shared API for server plugins:
// - Provides privileged/admin command access
// - Exposes server-side hooks for inter-plugin communication
// - Optionally broadcasts events to connected plugin WebSocket clients

const { EventEmitter } = require('events');
const { logInfo, logWarn, logError } = require('./console');

let output = null;
let wss = null;
let pluginsWss = null;
let httpServer = null;
let serverConfig = null;

// ---- internal plugin event bus ----

const pluginEvents = new EventEmitter();
// prevent accidental memory leak warnings
pluginEvents.setMaxListeners(50);

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

// ---- privileged command path ----

async function sendPrivilegedCommand(command, isPluginInternal = false) {
    const maxWait = 10000;
    const interval = 500;
    let waited = 0;

    while (!output && waited < maxWait) {
        await new Promise(resolve => setTimeout(resolve, interval));
        waited += interval;
    }

    if (!output) {
        logError(`[Privileged Send] Timeout waiting for output (${command})`);
        return false;
    }

    if (isPluginInternal) {
        output.write(`${command}\n`);
        //logInfo(`[Privileged Plugin] Command sent: ${command}`); // Debug
        return true;
    }

    logWarn(`[Privileged Send] Rejected (not internal): ${command.slice(0, 64)}`);
    return false;
}

// ---- plugin hook API ----

function emitPluginEvent(event, payload, opts = {}) {
    pluginEvents.emit(event, payload);

    // Stop here unless option to broadcast to clients if true
    if (opts.broadcast === false) return;

    // Broadcast to connected plugin WebSocket clients if available
    if (pluginsWss) {
        const message = JSON.stringify({ type: event, value: payload });
        pluginsWss.clients.forEach((client) => {
            if (client.readyState === client.OPEN) {
                try {
                    // Send event to client
                    client.send(message);
                } catch (err) {
                    logWarn(`[plugins_api] Failed to send ${event} to client: ${err.message}`);
                }
            }
        });
    }
}

function onPluginEvent(event, handler) {
    pluginEvents.on(event, handler);
}

function offPluginEvent(event, handler) {
    pluginEvents.off(event, handler);
}

// ---- exports ----

module.exports = {
    // server registration
    registerServerContext,
    setOutput,
    clearOutput,

    // server context access
    getWss,
    getPluginsWss,
    getHttpServer,
    getServerConfig,

    // privileged control
    sendPrivilegedCommand,

    // inter-plugin hooks
    emitPluginEvent,
    onPluginEvent,
    offPluginEvent
};
