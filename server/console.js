const fs = require('fs');

const verboseMode = process.argv.includes('--debug');
const verboseModeFfmpeg = process.argv.includes('--ffmpegdebug');

const ANSI_ESCAPE_CODE_PATTERN = /\x1b\[[0-9;]*m/g;
const MAX_LOG_LINES = 5000;

const getCurrentTime = () => {
    const currentTime = new Date();
    const hours = currentTime.getHours().toString().padStart(2, '0');
    const minutes = currentTime.getMinutes().toString().padStart(2, '0');
    return `\x1b[90m[${hours}:${minutes}]\x1b[0m`;
};

const removeANSIEscapeCodes = (str) => {
    return str.replace(ANSI_ESCAPE_CODE_PATTERN, '');
};

const MESSAGE_PREFIX = {
    CHAT: "\x1b[36m[CHAT]\x1b[0m",
    DEBUG: "\x1b[36m[DEBUG]\x1b[0m",
    ERROR: "\x1b[31m[ERROR]\x1b[0m",
    FFMPEG: "\x1b[36m[FFMPEG]\x1b[0m",
    INFO: "\x1b[32m[INFO]\x1b[0m",
    WARN: "\x1b[33m[WARN]\x1b[0m",
};

// Initialize an array to store logs
const logs = [];
const maxLogLines = 250;

const logDebug = (...messages) => {
    const logMessage = `${getCurrentTime()} ${MESSAGE_PREFIX.DEBUG} ${messages.join(' ')}`;
    if (verboseMode) {
        logs.push(logMessage);
        if (logs.length > maxLogLines) {
            logs.shift();
        }
    console.log(logMessage);
    }
    appendLogToFile(logMessage);
};

const logChat = (...messages) => {
    const logMessage = `${getCurrentTime()} ${MESSAGE_PREFIX.CHAT} ${messages[0].nickname} (${messages[0].ip}) sent a chat message: ${messages[0].message}`;
    appendLogToFile(logMessage);
};

const logError = (...messages) => {
    const logMessage = `${getCurrentTime()} ${MESSAGE_PREFIX.ERROR} ${messages.join(' ')}`;
    logs.push(logMessage);
    if (logs.length > maxLogLines) {
        logs.shift();
    }
    console.log(logMessage);
    appendLogToFile(logMessage);
};

const logFfmpeg = (...messages) => {
    if (verboseModeFfmpeg) {
        const logMessage = `${getCurrentTime()} ${MESSAGE_PREFIX.FFMPEG} ${messages.join(' ')}`;
        logs.push(logMessage);
        if (logs.length > maxLogLines) {
            logs.shift(); 
        }
    console.log(logMessage);
    appendLogToFile(logMessage);
    }
};

const logInfo = (...messages) => {
    const logMessage = `${getCurrentTime()} ${MESSAGE_PREFIX.INFO} ${messages.join(' ')}`;
    logs.push(logMessage);
    if (logs.length > maxLogLines) {
        logs.shift(); 
    }
    console.log(logMessage);
    appendLogToFile(logMessage);
};

const logWarn = (...messages) => {
    const logMessage = `${getCurrentTime()} ${MESSAGE_PREFIX.WARN} ${messages.join(' ')}`;
    logs.push(logMessage);
    if (logs.length > maxLogLines) {
        logs.shift(); 
    }
    console.log(logMessage);
    appendLogToFile(logMessage);
};

function appendLogToFile(logMessage) {
    const date = new Date();
    const cleanLogMessage = date.toLocaleDateString() + ' | ' + removeANSIEscapeCodes(logMessage);

    fs.appendFile('serverlog.txt', cleanLogMessage + '\n', (err) => {
        if (err) {
            console.error('Error writing to server log:', err);
        } else {
            fs.readFile('serverlog.txt', 'utf8', (err, data) => {
                if (err) {
                    console.error('Error reading server log:', err);
                } else {
                    const lineCount = data.split('\n').length;
                    if (lineCount > MAX_LOG_LINES) {
                        const excessLines = lineCount - MAX_LOG_LINES;
                        const truncatedContent = data.split('\n').slice(excessLines).join('\n');
                        fs.writeFile('serverlog.txt', truncatedContent, (err) => {
                            if (err) {
                                console.error('Error truncating server log:', err);
                            }
                        });
                    }
                }
            });
        }
    });
}

module.exports = {
    logError, logDebug, logFfmpeg, logInfo, logWarn, logs, logChat
};
