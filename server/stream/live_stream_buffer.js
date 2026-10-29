'use strict';

const MIN_CLIENT_BUFFER_BYTES = 4 * 1024;
// Allow brief network stalls to drain without forcing a reconnect.
// This is a hard ceiling, not a target or an intentional send delay.
const MAX_CLIENT_BACKLOG_SECONDS = 1;

function bitrateToBytesPerSecond(bitrate) {
    const match = /^\s*(\d+(?:\.\d+)?)\s*([km]?)\s*$/i.exec(`${bitrate}`);
    if (!match) return 16000;

    const value = Number(match[1]);
    const suffix = match[2].toLowerCase();
    const multiplier = suffix === 'm' ? 1000000 : suffix === 'k' ? 1000 : 1;
    return Math.ceil((value * multiplier) / 8);
}

function getMaxClientBufferBytes(bitrate) {
    return Math.max(
        MIN_CLIENT_BUFFER_BYTES,
        bitrateToBytesPerSecond(bitrate) * MAX_CLIENT_BACKLOG_SECONDS
    );
}

function hasExceededClientBuffer(bufferedAmount, maximumBytes) {
    return bufferedAmount > maximumBytes;
}

module.exports = {
    bitrateToBytesPerSecond,
    getMaxClientBufferBytes,
    hasExceededClientBuffer
};
