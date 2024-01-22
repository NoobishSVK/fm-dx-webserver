const { verboseMode } = require('./userconfig');

const MESSAGE_PREFIX = {
    INFO: "\x1b[32m[INFO]\x1b[0m",
    DEBUG: "\x1b[36m[DEBUG]\x1b[0m",
  };
  
const logInfo = (...messages) => console.log(MESSAGE_PREFIX.INFO, ...messages);
const logDebug = (...messages) => {
    if (verboseMode) {
      console.log(MESSAGE_PREFIX.DEBUG, ...messages);
    }
};

module.exports = {
    logInfo, logDebug
}