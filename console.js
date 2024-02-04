const verboseMode = process.argv.includes('--debug');

const getCurrentTime = () => {
    const currentTime = new Date();
    const hours = currentTime.getHours().toString().padStart(2, '0');
    const minutes = currentTime.getMinutes().toString().padStart(2, '0');
    return `\x1b[90m[${hours}:${minutes}]\x1b[0m`;
};

const MESSAGE_PREFIX = {
    DEBUG: "\x1b[36m[DEBUG]\x1b[0m",
    ERROR: "\x1b[31m[ERROR]\x1b[0m",
    INFO: "\x1b[32m[INFO]\x1b[0m",
    WARN: "\x1b[33m[WARN]\x1b[0m",
};

const logDebug = (...messages) => verboseMode ? console.log(getCurrentTime(), MESSAGE_PREFIX.DEBUG, ...messages) : '';
const logError = (...messages) => console.log(getCurrentTime(), MESSAGE_PREFIX.ERROR, ...messages);
const logInfo = (...messages) => console.log(getCurrentTime(), MESSAGE_PREFIX.INFO, ...messages);
const logWarn = (...messages) => console.log(getCurrentTime(), MESSAGE_PREFIX.WARN, ...messages);

module.exports = {
    logError, logDebug, logInfo, logWarn
};
