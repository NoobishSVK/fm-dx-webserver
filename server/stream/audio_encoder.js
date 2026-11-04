'use strict';

function getAudioFilterArguments(audioBoost) {
    return audioBoost ? ['-af', 'volume=1.7'] : [];
}

module.exports = { getAudioFilterArguments };
