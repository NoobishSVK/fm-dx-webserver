/**
 * tunequeue.js — Fair-share tuning queue for FM-DX Webserver.
 *
 * Problem: every client's tune command goes straight to the one tuner chip,
 * so whoever tunes last wins and everyone else gets tuned over.
 *
 * This module implements a "tune token": exactly one client holds it, and only
 * the holder's frequency (T) commands reach the hardware. Everyone else waits in
 * a FIFO queue. Holders keep the token while actively tuning; idling past
 * maxTuneSeconds (or disconnecting) hands it to the next client automatically.
 *
 * True simultaneous tuning of one TEF6686/XDR chip is impossible (hardware),
 * so this makes sharing fair and explicit instead.
 *
 * ---------------------------------------------------------------------------
 * INTEGRATION (server/index.js)
 *
 * 1. Near the other requires at the top:
 *      const tuneQueue = require('./tunequeue');
 *
 * 2. Inside wss.on('connection') -> ws.on('message'), right BEFORE the final
 *    permission gate that calls output.write(`${command}\n`):
 *
 *      // --- fair-share tuning queue ---
 *      if (command.startsWith('T') && tuneQueue.isEnabled() && !isAdminAuthenticated) {
 *          const verdict = tuneQueue.tryAcquire(ws, normalizedClientIp);
 *          if (verdict === 'granted' || verdict === 'already-holder') {
 *              tuneQueue.activity(ws); // holder tuned -> refresh idle timer
 *          } else {
 *              return; // queued / queue full -> command swallowed, client notified
 *          }
 *      }
 *      // --- end queue ---
 *
 *    (Keep this AFTER the existing tuningLimit range check so the queue only
 *    gates *who* may tune, while existing code still gates *what* is tunable.)
 *
 * 3. Inside ws.on('close'), next to the tunerLockTracker cleanup:
 *
 *      tuneQueue.release(ws);
 *
 * 4. Config (server/server_config.js) — add alongside tunePass/publicTuner:
 *
 *      tuneQueue: {
 *        enabled: false,     // opt-in; default off = today's behavior
 *        maxTuneSeconds: 120, // holder idle timeout before auto-release
 *        maxQueueLength: 10,   // max waiters; further joiners get TQ:FULL
 *      },
 *
 * ---------------------------------------------------------------------------
 * CLIENT PROTOCOL (server -> browser, plain strings like the existing 'KICK')
 *
 *   TQ:QUEUED:<n>   you are #n in the tuning queue
 *   TQ:GRANTED       it's your turn — tune away
 *   TQ:RELEASED      your turn ended (idle timeout)
 *   TQ:FULL          queue is full, try again later
 *
 * Handle these in web/js/main.js next to the existing KICK handler and show
 * them via web/js/toast.js.
 * ---------------------------------------------------------------------------
 */

const WebSocket = require('ws');
const { serverConfig } = require('./server_config');
const { logInfo, logWarn } = require('./console');

// -- Config with safe defaults ----------------------------------------------
function cfg() {
    const t = serverConfig.tuneQueue || {};
    return {
        enabled: t.enabled === true,
        maxTuneSeconds: Number(t.maxTuneSeconds) > 0 ? Number(t.maxTuneSeconds) : 120,
        maxQueueLength: Number(t.maxQueueLength) > 0 ? Number(t.maxQueueLength) : 10,
    };
}

// -- State -------------------------------------------------------------------
let holder = null;          // { ws, ip, acquiredAt, lastActivity } | null
let queue = [];             // [{ ws, ip, enqueuedAt }] FIFO
let sweeper = null;

function safeSend(ws, msg) {
    try {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(msg);
            return true;
        }
    } catch (e) {
        // Socket died mid-send; caller treats it as gone.
    }
    return false;
}

function describeIp(ip) {
    return ip || 'unknown';
}

// -- Public API ---------------------------------------------------------------

/** Whether the queue is enabled in config (checked live each call). */
function isEnabled() {
    return cfg().enabled;
}

/** True if this socket currently holds the tune token. */
function isHolder(ws) {
    return holder !== null && holder.ws === ws;
}

/** 1-based queue position, 0 = holder, -1 = not involved. */
function position(ws) {
    if (isHolder(ws)) return 0;
    const i = queue.findIndex(e => e.ws === ws);
    return i === -1 ? -1 : i + 1;
}

/**
 * Request tuning rights for a socket.
 * Returns: 'granted' | 'already-holder' | 'queued' | 'already-queued' | 'queue-full'
 * Notifies the client of the outcome via TQ:* messages.
 */
function tryAcquire(ws, ip) {
    if (!isEnabled()) return 'granted'; // queue off -> legacy behavior
    if (isHolder(ws)) return 'already-holder';

    const at = queue.findIndex(e => e.ws === ws);
    if (at !== -1) {
        safeSend(ws, `TQ:QUEUED:${at + 1}`);
        return 'already-queued';
    }

    if (holder === null) {
        holder = { ws, ip, acquiredAt: Date.now(), lastActivity: Date.now() };
        safeSend(ws, 'TQ:GRANTED');
        logInfo(`Tune token granted to ${describeIp(ip)} (queue was empty)`);
        return 'granted';
    }

    if (queue.length >= cfg().maxQueueLength) {
        safeSend(ws, 'TQ:FULL');
        logWarn(`Tune queue full; ${describeIp(ip)} turned away`);
        return 'queue-full';
    }

    queue.push({ ws, ip, enqueuedAt: Date.now() });
    safeSend(ws, `TQ:QUEUED:${queue.length}`);
    logInfo(`Tune token busy; ${describeIp(ip)} queued at #${queue.length}`);
    return 'queued';
}

/** Record holder activity (call when the holder issues a tune command). */
function activity(ws) {
    if (isHolder(ws)) {
        holder.lastActivity = Date.now();
    }
}

/**
 * Release a socket's involvement (call on websocket close).
 * Promotes the next waiter if the holder left.
 */
function release(ws) {
    if (isHolder(ws)) {
        logInfo(`Tune token holder ${describeIp(holder.ip)} left; promoting next`);
        holder = null;
        promote();
        return;
    }
    const at = queue.findIndex(e => e.ws === ws);
    if (at !== -1) {
        queue.splice(at, 1);
        broadcastPositions();
        logInfo(`Queued client ${describeIp(ws._tqIp || '')} left; queue now ${queue.length}`);
    }
}

/** Snapshot for admin/debug views. */
function status() {
    return {
        enabled: isEnabled(),
        holder: holder ? { ip: holder.ip, since: holder.acquiredAt, lastActivity: holder.lastActivity } : null,
        queue: queue.map((e, i) => ({ position: i + 1, ip: e.ip, waitingSince: e.enqueuedAt })),
    };
}

// -- Internals ----------------------------------------------------------------

function broadcastPositions() {
    queue.forEach((e, i) => safeSend(e.ws, `TQ:QUEUED:${i + 1}`));
}

/** Hand the token to the next live waiter (skips dead sockets). */
function promote() {
    while (queue.length > 0) {
        const next = queue.shift();
        if (next.ws.readyState === WebSocket.OPEN) {
            holder = { ws: next.ws, ip: next.ip, acquiredAt: Date.now(), lastActivity: Date.now() };
            safeSend(next.ws, 'TQ:GRANTED');
            broadcastPositions();
            logInfo(`Tune token granted to ${describeIp(next.ip)} (promoted from queue)`);
            return;
        }
        logInfo(`Skipped dead socket while promoting tune token`);
    }
    holder = null;
}

/** Periodically release holders idle past maxTuneSeconds. */
function sweep() {
    if (!isEnabled() || holder === null) return;
    const idleMs = Date.now() - holder.lastActivity;
    if (idleMs >= cfg().maxTuneSeconds * 1000) {
        logInfo(`Tune token idle timeout (${cfg().maxTuneSeconds}s) for ${describeIp(holder.ip)}; releasing`);
        safeSend(holder.ws, 'TQ:RELEASED');
        holder = null;
        promote();
    }
}

function startSweeper() {
    if (sweeper) return;
    sweeper = setInterval(sweep, 5000);
    if (sweeper.unref) sweeper.unref(); // don't hold the process open
}
startSweeper();

module.exports = {
    isEnabled,
    isHolder,
    position,
    tryAcquire,
    activity,
    release,
    status,
};
