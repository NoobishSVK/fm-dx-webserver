const { spawn } = require('child_process');
const consoleCmd = require('../console.js');
const { configName, serverConfig, configUpdate, configSave } = require('../server_config');
const { logDebug, logError, logInfo, logWarn } = require('../console');
const commandExists = require('command-exists-promise');

// Check if FFmpeg is installed
commandExists('ffmpeg')
  .then(exists => {
    if (exists) {
      logInfo("An existing installation of ffmpeg found, enabling audio stream.");
      enableAudioStream();
    } else {
      logError("No ffmpeg installation found. Audio stream won't be available.");
    }
  })

function enableAudioStream() {
    var ffmpegCommand;
    serverConfig.webserver.webserverPort = Number(serverConfig.webserver.webserverPort);
    // Specify the command and its arguments
    const command = 'ffmpeg';
    const flags = `-fflags +nobuffer+flush_packets -flags low_delay -rtbufsize 6192 -probesize 32`;
    const codec = `-acodec pcm_s16le -ar 48000 -ac ${serverConfig.audio.audioChannels}`;
    const output = `-f s16le -fflags +nobuffer+flush_packets -packetsize 384 -flush_packets 1 -bufsize 960`;
    // Combine all the settings for the ffmpeg command
    if (process.platform === 'win32') {
        // Windows
        ffmpegCommand = `${flags} -f dshow -audio_buffer_size 50 -i audio="${serverConfig.audio.audioDevice}" ${codec} ${output} pipe:1 | node server/stream/3las.server.js -port ${serverConfig.webserver.webserverPort + 10} -samplerate 48000 -channels ${serverConfig.audio.audioChannels}`;
      } else {
        // Linux
        ffmpegCommand = `${flags} -f alsa -i "${serverConfig.audio.softwareMode && serverConfig.audio.softwareMode == true ? 'plug' : ''}${serverConfig.audio.audioDevice}" ${codec} ${output} pipe:1 | node server/stream/3las.server.js -port ${serverConfig.webserver.webserverPort + 10} -samplerate 48000 -channels ${serverConfig.audio.audioChannels}`;
    } 

    consoleCmd.logInfo("Using audio device: " + serverConfig.audio.audioDevice);
    consoleCmd.logInfo(`Launching audio stream on internal port ${serverConfig.webserver.webserverPort + 10}.`);
    // Spawn the child process

    if(serverConfig.audio.audioDevice.length > 2) {
        const childProcess = spawn(command, [ffmpegCommand], { shell: true });

        // Handle the output of the child process (optional)
        childProcess.stdout.on('data', (data) => {
            consoleCmd.logFfmpeg(`stdout: ${data}`);
        });

        childProcess.stderr.on('data', (data) => {
            consoleCmd.logFfmpeg(`stderr: ${data}`);
        });
    
        // Handle the child process exit event
        childProcess.on('close', (code) => {
            consoleCmd.logFfmpeg(`Child process exited with code ${code}`);
        });
    
        // You can also listen for the 'error' event in case the process fails to start
        childProcess.on('error', (err) => {
            consoleCmd.logFfmpeg(`Error starting child process: ${err}`);
        });
    }
}