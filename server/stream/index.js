const { spawn } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { configName, serverConfig, configUpdate, configSave, configExists } = require('../server_config');
const { logDebug, logError, logInfo, logWarn, logFfmpeg } = require('../console');
  
function enableAudioStream() {
    var ffmpegParams, ffmpegCommand;
    serverConfig.webserver.webserverPort = Number(serverConfig.webserver.webserverPort);

    const flags = `-fflags +nobuffer+flush_packets -flags low_delay -rtbufsize 6192 -probesize 32`;
    const codec = `-acodec pcm_s16le -ar 48000 -ac ${serverConfig.audio.audioChannels}`;
    const output = `${serverConfig.audio.audioBoost == true ? '$-af "volume=3.5"' : ''} -f s16le -fflags +nobuffer+flush_packets -packetsize 384 -flush_packets 1 -bufsize 960`;

    if (process.platform === 'win32') {
        // Windows
        ffmpegCommand = "\"" + ffmpeg.replace(/\\/g, '\\\\') + "\"";
        ffmpegParams = `${flags} -f dshow -audio_buffer_size 200 -i audio="${serverConfig.audio.audioDevice}" ${codec} ${output} pipe:1 | node server/stream/3las.server.js -port ${serverConfig.webserver.webserverPort + 10} -samplerate 48000 -channels ${serverConfig.audio.audioChannels}`;
      } else {
        // Linux
        ffmpegCommand = 'ffmpeg';
        ffmpegParams = `${flags} -f alsa -i "${serverConfig.audio.softwareMode && serverConfig.audio.softwareMode == true ? 'plug' : ''}${serverConfig.audio.audioDevice}" ${codec} ${output} pipe:1 | node server/stream/3las.server.js -port ${serverConfig.webserver.webserverPort + 10} -samplerate 48000 -channels ${serverConfig.audio.audioChannels}`;
    } 

    logInfo("Trying to start audio stream on device: \x1b[35m" + serverConfig.audio.audioDevice);
    logInfo(`Using internal audio network port ${serverConfig.webserver.webserverPort + 10}.`);

    // If an audio device is configured, start the stream
    if(serverConfig.audio.audioDevice.length > 2) {
        let startupSuccess = false;
        const childProcess = spawn(ffmpegCommand, [ffmpegParams], { shell: true });

        childProcess.stdout.on('data', (data) => {
            logFfmpeg(`stdout: ${data}`);
        });

        childProcess.stderr.on('data', (data) => {
            logFfmpeg(`stderr: ${data}`);
            if(data.includes('I/O error')) {
                logError('Audio device \x1b[35m' + serverConfig.audio.audioDevice + '\x1b[0m failed to start. Start server with the command \x1b[33mnode . --ffmpegdebug \x1b[0mfor more info.');
            }
            if(data.includes('size=') && startupSuccess === false) {
                logInfo('Audio stream started up successfully.');
                startupSuccess = true;
            }
        });
    
        childProcess.on('close', (code) => {
            logFfmpeg(`Child process exited with code ${code}`);
        });
    
        childProcess.on('error', (err) => {
            logFfmpeg(`Error starting child process: ${err}`);
        });
    }
}

if(configExists()) {
    enableAudioStream();
}