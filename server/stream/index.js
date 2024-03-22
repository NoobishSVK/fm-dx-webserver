const { spawn } = require('child_process');
const consoleCmd = require('../console.js');
const ffmpeg = require('ffmpeg-static');
const { configName, serverConfig, configUpdate, configSave } = require('../server_config');
const { logDebug, logError, logInfo, logWarn, logFfmpeg } = require('../console');
  
function enableAudioStream() {
    var ffmpegParams;
    var ffmpegCommand;
    serverConfig.webserver.webserverPort = Number(serverConfig.webserver.webserverPort);

    const flags = `-fflags +nobuffer+flush_packets -flags low_delay -rtbufsize 6192 -probesize 32`;
    const codec = `-acodec pcm_s16le -ar 48000 -ac ${serverConfig.audio.audioChannels}`;
    const output = `-f s16le -fflags +nobuffer+flush_packets -packetsize 384 -flush_packets 1 -bufsize 960`;

    if (process.platform === 'win32') {
        // Windows
        ffmpegCommand = ffmpeg.replace(/\\/g, '\\\\');
        ffmpegParams = `${flags} -f dshow -audio_buffer_size 50 -i audio="${serverConfig.audio.audioDevice}" ${codec} ${output} pipe:1 | node server/stream/3las.server.js -port ${serverConfig.webserver.webserverPort + 10} -samplerate 48000 -channels ${serverConfig.audio.audioChannels}`;
      } else {
        // Linux
        ffmpegCommand = 'ffmpeg';
        ffmpegParams = `${flags} -f alsa -i "${serverConfig.audio.softwareMode && serverConfig.audio.softwareMode == true ? 'plug' : ''}${serverConfig.audio.audioDevice}" ${codec} ${output} pipe:1 | node server/stream/3las.server.js -port ${serverConfig.webserver.webserverPort + 10} -samplerate 48000 -channels ${serverConfig.audio.audioChannels}`;
    } 

    consoleCmd.logInfo("Using audio device: " + serverConfig.audio.audioDevice);
    consoleCmd.logInfo(`Launching audio stream on internal port ${serverConfig.webserver.webserverPort + 10}.`);

    // If an audio device is configured, start the stream
    if(serverConfig.audio.audioDevice.length > 2) {
        const childProcess = spawn(ffmpegCommand, [ffmpegParams], { shell: true });

        childProcess.stdout.on('data', (data) => {
            logFfmpeg(`stdout: ${data}`);
        });

        childProcess.stderr.on('data', (data) => {
            logFfmpeg(`stderr: ${data}`);
        });
    
        childProcess.on('close', (code) => {
            logFfmpeg(`Child process exited with code ${code}`);
        });
    
        childProcess.on('error', (err) => {
            logFfmpeg(`Error starting child process: ${err}`);
        });
    }
}

enableAudioStream();