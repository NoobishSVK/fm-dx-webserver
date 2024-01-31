const { spawn } = require('child_process');
const config = require('../userconfig.js');
const consoleCmd = require('../console.js');

function enableAudioStream() {
    var ffmpegCommand;
    // Specify the command and its arguments
    const command = 'ffmpeg';
    const flags = '-fflags +nobuffer+flush_packets -flags low_delay -rtbufsize 6192 -probesize 64';
    const codec = '-acodec pcm_s16le -ar 48000 -ac 2';
    const output = '-f s16le -fflags +nobuffer+flush_packets -packetsize 384 -flush_packets 1 -bufsize 960';
    // Combine all the settings for the ffmpeg command
    if (process.platform === 'win32') {
        // Windows
        ffmpegCommand = `${flags} -f dshow -i audio="${config.audioDeviceName}" ${codec} ${output} pipe:1 | node stream/3las.server.js -port ${config.audioPort} -samplerate 48000 -channels 2`;
      } else {
        // Linux
        ffmpegCommand = `${flags} -f alsa -i "${config.audioDeviceName}" ${codec} ${output} pipe:1 | node stream/3las.server.js -port ${config.audioPort} -samplerate 48000 -channels 2`;
    } 

    consoleCmd.logInfo("Launching audio stream on port " + config.audioPort + ".");
    // Spawn the child process

    if(config.audioDeviceName.length > 2) {
        const childProcess = spawn(command, [ffmpegCommand], { shell: true });

        // Handle the output of the child process (optional)
        childProcess.stdout.on('data', (data) => {
            consoleCmd.logDebug(`stdout: ${data}`);
        });

        childProcess.stderr.on('data', (data) => {
            consoleCmd.logDebug(`stderr: ${data}`);
        });
    
        // Handle the child process exit event
        childProcess.on('close', (code) => {
            consoleCmd.logDebug(`Child process exited with code ${code}`);
        });
    
        // You can also listen for the 'error' event in case the process fails to start
        childProcess.on('error', (err) => {
            consoleCmd.logError(`Error starting child process: ${err}`);
        });
    }
}

module.exports = {
    enableAudioStream
}
