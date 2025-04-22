const { spawn, execSync } = require('child_process');
const { configName, serverConfig, configUpdate, configSave, configExists } = require('../server_config');
const { logDebug, logError, logInfo, logWarn, logFfmpeg } = require('../console');
const checkFFmpeg = require('./checkFFmpeg');

let ffmpeg, ffmpegCommand, ffmpegParams;

function checkAudioUtilities() {
    if (process.platform === 'darwin') {
        try {
            execSync('which rec');
            //console.log('[Audio Utility Check] SoX ("rec") found.');
        } catch (error) {
            logError('[Audio Utility Check] Error: SoX ("rec") not found. Please install SoX (e.g., using `brew install sox`).');
            process.exit(1); // Exit the process with an error code
        }
    } else if (process.platform === 'linux') {
        try {
            execSync('which arecord');
            //console.log('[Audio Utility Check] ALSA ("arecord") found.');
        } catch (error) {
            logError('[Audio Utility Check] Error: ALSA ("arecord") not found. Please ensure ALSA utilities are installed (e.g., using `sudo apt-get install alsa-utils` or `sudo yum install alsa-utils`).');
            process.exit(1); // Exit the process with an error code
        }
    } else {
        //console.log(`[Audio Utility Check] Platform "${process.platform}" does not require explicit checks for rec or arecord.`);
    }
}

function buildCommand() {
    // Common audio options for FFmpeg
    const baseOptions = {
        flags: '-fflags +nobuffer+flush_packets -flags low_delay -rtbufsize 6192 -probesize 32',
        codec: `-acodec pcm_s16le -ar 48000 -ac ${serverConfig.audio.audioChannels}`,
        output: `${serverConfig.audio.audioBoost == true && serverConfig.audio.ffmpeg == true ? '-af "volume=3.5"' : ''} -f s16le -fflags +nobuffer+flush_packets -packetsize 384 -flush_packets 1 -bufsize 960`
    };

    if (process.platform === 'win32') {
        // Windows: ffmpeg using dshow
        logInfo('[Audio Stream] Platform: Windows (win32). Using "dshow" input.');
        ffmpegCommand = `"${ffmpeg.replace(/\\/g, '\\\\')}"`;
        return `${ffmpegCommand} ${baseOptions.flags} -f dshow -audio_buffer_size 200 -i audio="${serverConfig.audio.audioDevice}" ` +
            `${baseOptions.codec} ${baseOptions.output} pipe:1 | node server/stream/3las.server.js -port ` +
            `${serverConfig.webserver.webserverPort + 10} -samplerate 48000 -channels ${serverConfig.audio.audioChannels}`;
    } else if (process.platform === 'darwin') {
        // macOS: using SoX's rec with coreaudio
        if (!serverConfig.audio.ffmpeg) {
            logInfo('[Audio Stream] Platform: macOS (darwin) using "coreaudio" with the default audio device.');
            const recCommand = `rec -t coreaudio -b 32 -r 48000 -c ${serverConfig.audio.audioChannels} -t raw -b 16 -r 48000 -c ${serverConfig.audio.audioChannels} -`;
            return `${recCommand} | node server/stream/3las.server.js -port ${serverConfig.webserver.webserverPort + 10}` + 
            ` -samplerate 48000 -channels ${serverConfig.audio.audioChannels}`;
        } else {
            ffmpegCommand = ffmpeg;
            ffmpegParams = `${baseOptions.flags} -f alsa -i "${serverConfig.audio.softwareMode && serverConfig.audio.softwareMode == true ? 'plug' : ''}${serverConfig.audio.audioDevice}" ${baseOptions.codec}`;
            ffmpegParams += ` ${baseOptions.output} -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 10 pipe:1 | node server/stream/3las.server.js -port ${serverConfig.webserver.webserverPort + 10} -samplerate 48000 -channels ${serverConfig.audio.audioChannels}`;
            return `${ffmpegCommand} ${ffmpegParams}`;
        }
    } else {
        // Linux: use alsa with arecord
        // If softwareMode is enabled, prefix the device with 'plug'
        if (!serverConfig.audio.ffmpeg) {
            const audioDevicePrefix = (serverConfig.audio.softwareMode && serverConfig.audio.softwareMode === true) ? 'plug' : '';
            logInfo('[Audio Stream] Platform: Linux. Using "alsa" input.');
            const recCommand = `while true; do arecord -D "${audioDevicePrefix}${serverConfig.audio.audioDevice}" -f S16_LE -r 48000 -c ${serverConfig.audio.audioChannels} -t raw -; done`;
            return `${recCommand} | node server/stream/3las.server.js -port ${serverConfig.webserver.webserverPort + 10}` + 
            ` -samplerate 48000 -channels ${serverConfig.audio.audioChannels}`;
        } else {
            ffmpegCommand = ffmpeg;
            ffmpegParams = `${baseOptions.flags} -f alsa -i "${serverConfig.audio.softwareMode && serverConfig.audio.softwareMode == true ? 'plug' : ''}${serverConfig.audio.audioDevice}" ${baseOptions.codec}`;
            ffmpegParams += ` ${baseOptions.output} -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 10 pipe:1 | node server/stream/3las.server.js -port ${serverConfig.webserver.webserverPort + 10} -samplerate 48000 -channels ${serverConfig.audio.audioChannels}`;
            return `${ffmpegCommand} ${ffmpegParams}`;
        }
    }
}

function enableAudioStream() {
    // Ensure the webserver port is a number.
    serverConfig.webserver.webserverPort = Number(serverConfig.webserver.webserverPort);
    let startupSuccess = false;
    const command = buildCommand();

    // Only log audio device details if the platform is not macOS.
    if (process.platform !== 'darwin') {
        logInfo(`Trying to start audio stream on device: \x1b[35m${serverConfig.audio.audioDevice}\x1b[0m`);
    }
    else {
        // For macOS, log the default audio device.
        logInfo(`Trying to start audio stream on default input device.`);
    }

    logInfo(`Using internal audio network port: ${serverConfig.webserver.webserverPort + 10}`);
    logInfo('Using', ffmpeg === 'ffmpeg' ? 'system-installed FFmpeg' : 'ffmpeg-static');
    logDebug(`[Audio Stream] Full command:\n${command}`);

    // Start the stream only if a valid audio device is configured.
    if (serverConfig.audio.audioDevice && serverConfig.audio.audioDevice.length > 2) {
        const childProcess = spawn(command, { shell: true });

        childProcess.stdout.on('data', (data) => {
            logFfmpeg(`[stream:stdout] ${data}`);
        });

        childProcess.stderr.on('data', (data) => {
            logFfmpeg(`[stream:stderr] ${data}`);

            if (data.includes('I/O error')) {
                logError(`[Audio Stream] Audio device "${serverConfig.audio.audioDevice}" failed to start.`);
                logError('Please start the server with: node . --ffmpegdebug for more info.');
            }
            if (data.includes('size=') && !startupSuccess) {
                logInfo('[Audio Stream] Audio stream started up successfully.');
                startupSuccess = true;
            }
        });

        childProcess.on('close', (code) => {
            logFfmpeg(`[Audio Stream] Child process exited with code: ${code}`);
        });

        childProcess.on('error', (err) => {
            logFfmpeg(`[Audio Stream] Error starting child process: ${err}`);
        });
    } else {
        logWarn('[Audio Stream] No valid audio device configured. Skipping audio stream initialization.');
    }
}

if(configExists()) {
    checkFFmpeg().then((ffmpegResult) => {
        ffmpeg = ffmpegResult;
        if (!serverConfig.audio.ffmpeg) checkAudioUtilities();
        enableAudioStream();
    });
}