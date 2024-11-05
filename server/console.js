const fs = require('fs').promises;

const verboseMode = process.argv.includes('--debug');
const verboseModeFfmpeg = process.argv.includes('--ffmpegdebug');

const LOG_FILE = 'serverlog.txt';
const ANSI_ESCAPE_CODE_PATTERN = /\x1b\[[0-9;]*m/g;
const MAX_LOG_LINES = 5000;
const FLUSH_INTERVAL = 60000;
const logs = [];
const maxConsoleLogLines = 250;
let logBuffer = [];

// Message prefixes with ANSI codes
const MESSAGE_PREFIX = {
    CHAT: "\x1b[36m[CHAT]\x1b[0m",
    DEBUG: "\x1b[36m[DEBUG]\x1b[0m",
    ERROR: "\x1b[31m[ERROR]\x1b[0m",
    FFMPEG: "\x1b[36m[FFMPEG]\x1b[0m",
    INFO: "\x1b[32m[INFO]\x1b[0m",
    WARN: "\x1b[33m[WARN]\x1b[0m",
};

const getCurrentTime = () => {
    const currentTime = new Date();
    const date = currentTime.toLocaleDateString().replace(/\ /g, '');
    const time = currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `\x1b[90m[${date} ${time}]\x1b[0m`;
};

const removeANSIEscapeCodes = (str) => str.replace(ANSI_ESCAPE_CODE_PATTERN, ''); // Strip ANSI escape codes from a string

const logMessage = (type, messages, verbose = false) => {
    const logMessage = `${getCurrentTime()} ${MESSAGE_PREFIX[type]} ${messages.join(' ')}`;

    if (type === 'DEBUG' && verboseMode || type === 'FFMPEG' && verboseModeFfmpeg || type !== 'DEBUG' && type !== 'FFMPEG') {
        logs.push(logMessage);
        if (logs.length > maxConsoleLogLines) logs.shift();
        console.log(logMessage);
    }

    if(type !== 'FFMPEG') {
        appendLogToBuffer(logMessage);
    }
};

const logDebug = (...messages) => logMessage('DEBUG', messages, verboseMode);
const logChat = (message) => logMessage('CHAT', [`${message.nickname} (${message.ip}) sent a chat message: ${message.message}`]);
const logError = (...messages) => logMessage('ERROR', messages);
const logFfmpeg = (...messages) => logMessage('FFMPEG', messages, verboseModeFfmpeg);
const logInfo = (...messages) => logMessage('INFO', messages);
const logWarn = (...messages) => logMessage('WARN', messages);

function appendLogToBuffer(logMessage) {
    const cleanLogMessage = removeANSIEscapeCodes(logMessage);
    logBuffer.push(cleanLogMessage + '\n');
}

async function flushLogBuffer() {
    if (logBuffer.length === 0) return;

    const logContent = logBuffer.join('');
    logBuffer = [];

    try {
        await fs.appendFile(LOG_FILE, logContent);

        const data = await fs.readFile(LOG_FILE, 'utf8');
        const lines = data.split('\n');
        if (lines.length > MAX_LOG_LINES) {
            const truncatedContent = lines.slice(-MAX_LOG_LINES).join('\n');
            await fs.writeFile(LOG_FILE, truncatedContent);
        }
    } catch (err) {
        console.error('Error flushing log buffer:', err);
    }
}

setInterval(flushLogBuffer, FLUSH_INTERVAL);

const gracefulExit = async () => {
    await flushLogBuffer();
    process.exit();
};

process.on('exit', flushLogBuffer);
process.on('SIGINT', gracefulExit);
process.on('SIGTERM', gracefulExit);

module.exports = { logError, logDebug, logFfmpeg, logInfo, logWarn, logs, logChat };