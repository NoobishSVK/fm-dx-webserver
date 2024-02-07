const verboseMode = process.argv.includes('--debug');
const verboseModeFfmpeg = process.argv.includes('--ffmpegdebug');

const getCurrentTime = () => {
    const currentTime = new Date();
    const hours = currentTime.getHours().toString().padStart(2, '0');
    const minutes = currentTime.getMinutes().toString().padStart(2, '0');
    return `\x1b[90m[${hours}:${minutes}]\x1b[0m`;
};

const MESSAGE_PREFIX = {
    DEBUG: "\x1b[36m[DEBUG]\x1b[0m",
    ERROR: "\x1b[31m[ERROR]\x1b[0m",
    FFMPEG: "\x1b[36m[FFMPEG]\x1b[0m",
    INFO: "\x1b[32m[INFO]\x1b[0m",
    WARN: "\x1b[33m[WARN]\x1b[0m",
};

// Initialize an array to store logs
const logs = [];
const maxLogLines = 100;

const logDebug = (...messages) => {
    if (verboseMode) {
        const logMessage = `${getCurrentTime()} ${MESSAGE_PREFIX.DEBUG} ${messages.join(' ')}`;
        logs.push(logMessage);
        if (logs.length > maxLogLines) {
            logs.shift(); // Remove the oldest log if the array exceeds the maximum number of lines
        }
        console.log(logMessage);
    }
};

const logError = (...messages) => {
    const logMessage = `${getCurrentTime()} ${MESSAGE_PREFIX.ERROR} ${messages.join(' ')}`;
    logs.push(logMessage);
    if (logs.length > maxLogLines) {
        logs.shift(); // Remove the oldest log if the array exceeds the maximum number of lines
    }
    console.log(logMessage);
};

const logFfmpeg = (...messages) => {
    if (verboseModeFfmpeg) {
        const logMessage = `${getCurrentTime()} ${MESSAGE_PREFIX.FFMPEG} ${messages.join(' ')}`;
        logs.push(logMessage);
        if (logs.length > maxLogLines) {
            logs.shift(); // Remove the oldest log if the array exceeds the maximum number of lines
        }
        console.log(logMessage);
    }
};

const logInfo = (...messages) => {
    const logMessage = `${getCurrentTime()} ${MESSAGE_PREFIX.INFO} ${messages.join(' ')}`;
    logs.push(logMessage);
    if (logs.length > maxLogLines) {
        logs.shift(); // Remove the oldest log if the array exceeds the maximum number of lines
    }
    console.log(logMessage);
};

const logWarn = (...messages) => {
    const logMessage = `${getCurrentTime()} ${MESSAGE_PREFIX.WARN} ${messages.join(' ')}`;
    logs.push(logMessage);
    if (logs.length > maxLogLines) {
        logs.shift(); // Remove the oldest log if the array exceeds the maximum number of lines
    }
    console.log(logMessage);
};

module.exports = {
    logError, logDebug, logFfmpeg, logInfo, logWarn, logs
};
