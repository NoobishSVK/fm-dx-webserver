const { spawn, execSync } = require('child_process');
const { configName, serverConfig, configUpdate, configSave, configExists } = require('../server_config');
const { logDebug, logError, logInfo, logWarn, logFfmpeg } = require('../console');
const checkFFmpeg = require('./checkFFmpeg');
const audioServer = require('./3las.server');
const {
    buildArecordArgs,
    containsAlsaSetupError,
    containsAlsaXrun,
    getAlsaFallbackProfile,
    resolveAlsaLatencyProfile
} = require('./linux_capture');

const consoleLogTitle = '[Audio Stream]';

let startupSuccess;

function connectMessage(message) {
    if (!startupSuccess) {
        logInfo(message);
        startupSuccess = true;
    }
}

function checkAudioUtilities() {
    if (process.platform === 'darwin') {
        try {
            execSync('which sox');
        } catch (error) {
            logError(`${consoleLogTitle} Error: SoX ("sox") not found, Please install sox.`);
            process.exit(1);
        }
    } else if (process.platform === 'linux') {
        try {
            execSync('which arecord');
        } catch (error) {
            logError(`${consoleLogTitle} Error: ALSA ("arecord") not found. Please install ALSA utils.`);
            process.exit(1);
        }
    }
}

function buildCommand(ffmpegPath, alsaLatencyProfile) {
    const inputDevice = serverConfig.audio.audioDevice || 'Stereo Mix';
    const audioChannels = serverConfig.audio.audioChannels || 2;
    const webPort = Number(serverConfig.webserver.webserverPort);

    // Common audio options for FFmpeg
    const baseOptions = {
        flags: ['-fflags', '+nobuffer+flush_packets', '-flags', 'low_delay', '-rtbufsize', '6192', '-probesize', '32'],
        codec: ['-acodec', 'pcm_s16le', '-ar', '48000', '-ac', `${audioChannels}`],
        output: ['-f', 's16le', '-fflags', '+nobuffer+flush_packets', '-packetsize', '384', '-flush_packets', '1', '-bufsize', '960', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '10', 'pipe:1']
    };

    // Windows
    if (process.platform === 'win32') {
        logInfo(`${consoleLogTitle} Platform: Windows (win32). Using "dshow" input.`);
        return {
            command: ffmpegPath,
            args: [
                ...baseOptions.flags,
                '-f', 'dshow',
                '-audio_buffer_size', '200',
                '-i', `audio=${inputDevice}`,
                ...baseOptions.codec,
                ...baseOptions.output
            ]
        };
    } else if (process.platform === 'darwin') {
        logInfo(`${consoleLogTitle} Platform: macOS (darwin) using "coreaudio"`);
        return {
            soxArgs: [
                '-t', 'coreaudio', `${inputDevice}`,
                '-b', '32',
                '-r', '48000',
                '-c', `${audioChannels}`,
                '-t', 'raw',
                '-b', '16',
                '-r', '48000',
                '-c', `${audioChannels}`,
                '-'
            ]
        };
    } else {
        // Linux
        const prefix = serverConfig.audio.softwareMode ? 'plug' : '';
        const device = `${prefix}${serverConfig.audio.audioDevice}`;
        const arecord = buildArecordArgs(
            device,
            audioChannels,
            alsaLatencyProfile || serverConfig.audio.alsaLatencyProfile
        );
        logInfo(`${consoleLogTitle} Platform: Linux. Using "alsa" input.`);
        return {
            arecordArgs: arecord.args,
            alsaLatencyProfile: arecord.profile
        };
    }
}

checkFFmpeg().then((ffmpegPath) => {
    checkAudioUtilities();
    let audioErrorLogged = false;

    logInfo(`${consoleLogTitle} Using`, ffmpegPath === 'ffmpeg' ? 'system-installed FFmpeg' : 'ffmpeg-static');

    if (process.platform !== 'darwin') {
        logInfo(`${consoleLogTitle} Starting audio stream on device: \x1b[35m${serverConfig.audio.audioDevice}\x1b[0m`);
    } else {
        logInfo(`${consoleLogTitle} Starting audio stream on default input device.`);
    }

    if (process.platform === 'win32') {
        // Windows (FFmpeg DirectShow Capture)
        let ffmpeg;
        let restartTimer = null;
        let lastTimestamp = null;
        let lastCheckTime = Date.now();
        let audioErrorLogged = false;
        let staleCount = 0;

        function launchFFmpeg() {
            const commandDef = buildCommand(ffmpegPath);
            const ffmpegArgs = commandDef.args;

            logDebug(`${consoleLogTitle} Launching FFmpeg with args: ${ffmpegArgs.join(' ')}`);
            ffmpeg = spawn(ffmpegPath, ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

            audioServer.waitUntilReady.then(() => {
                audioServer.Server.StdIn = ffmpeg.stdout;
                audioServer.Server.Run();
                connectMessage(`${consoleLogTitle} Connected FFmpeg (capture) \u2192 FFmpeg (process) \u2192 Server.StdIn${serverConfig.audio.audioBoost ? ' (audio boost)' : ''}`);
            });

            ffmpeg.stderr.on('data', (data) => {
                const msg = data.toString();
                logFfmpeg(`[FFmpeg stderr]: ${msg}`);

                if (msg.includes('I/O error') && !audioErrorLogged) {
                    audioErrorLogged = true;
                    logError(`${consoleLogTitle} Audio device "${serverConfig.audio.audioDevice}" failed to start.`);
                    logError('Please start the server with: node . --ffmpegdebug for more info.');
                }

                // Detect frozen timestamp
                const match = msg.match(/time=(\d\d):(\d\d):(\d\d\.\d+)/);
                if (match) {
                    const [_, hh, mm, ss] = match;
                    const totalSec = parseInt(hh) * 3600 + parseInt(mm) * 60 + parseFloat(ss);

                    if (lastTimestamp !== null && totalSec === lastTimestamp) {
                        const now = Date.now();
                        staleCount++;
                        if (staleCount >= 10 && now - lastCheckTime > 10000 && !restartTimer) {
                            restartTimer = setTimeout(() => {
                                restartTimer = null;
                                staleCount = 0;
                                try {
                                    ffmpeg.kill('SIGKILL');
                                } catch (e) {
                                    logWarn(`${consoleLogTitle} Failed to kill FFmpeg process: ${e.message}`);
                                }
                                launchFFmpeg(); // Restart FFmpeg
                            }, 0);
                            setTimeout(() => logWarn(`${consoleLogTitle} FFmpeg appears frozen. Restarting...`), 100);
                        }
                    } else {
                        lastTimestamp = totalSec;
                        lastCheckTime = Date.now();
                        staleCount = 0;
                    }
                }
            });

            ffmpeg.on('exit', (code, signal) => {
                if (signal) {
                    logFfmpeg(`[FFmpeg exited] with signal ${signal}`);
                    logWarn(`${consoleLogTitle} FFmpeg was killed with signal ${signal}`);
                } else {
                    logFfmpeg(`[FFmpeg exited] with code ${code}`);
                    if (code !== 0) {
                        logWarn(`${consoleLogTitle} FFmpeg exited unexpectedly with code ${code}`);
                    }
                }

                // Retry on device fail
                if (audioErrorLogged) {
                    logWarn(`${consoleLogTitle} Retrying in 10 seconds...`);
                    setTimeout(() => {
                        audioErrorLogged = false;
                        launchFFmpeg();
                    }, 10000);
                }
            });
        }
        launchFFmpeg(); // Initial launch
    } else if (process.platform === 'darwin') {
        // macOS (sox --> 3las.server.js --> FFmpeg)
        const commandDef = buildCommand(ffmpegPath);

        let currentSox = null;

        process.on('exit', () => {
            if (currentSox) currentSox.kill('SIGINT');
        });

        process.on('SIGINT', () => {
            if (currentSox) currentSox.kill('SIGINT');
            process.exit();
        });

        function startSox() {
            logDebug(`${consoleLogTitle} Launching sox with args: ${commandDef.soxArgs.join(' ')}`);

            const sox = spawn('sox', commandDef.soxArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
            currentSox = sox;

            audioServer.waitUntilReady.then(() => {
                audioServer.Server.StdIn = sox.stdout;
                audioServer.Server.Run();
                connectMessage(`${consoleLogTitle} Connected SoX \u2192 FFmpeg \u2192 Server.StdIn${serverConfig.audio.audioBoost ? ' (audio boost)' : ''}`);
            });

            sox.stderr.on('data', (data) => {
                logFfmpeg(`[sox stderr]: ${data}`);
            });

            sox.on('exit', (code) => {
                logFfmpeg(`[sox exited] with code ${code}`);
                if (code !== 0) {
                    setTimeout(startSox, 2000);
                }
            });
        }

        startSox();
    } else {
        // Linux (arecord --> 3las.server.js --> FFmpeg)
        let currentArecord = null;
        let arecordRestartTimer = null;
        let audioServerRunning = false;
        let shuttingDown = false;
        let xrunTimestamps = [];
        let activeAlsaProfile = resolveAlsaLatencyProfile(serverConfig.audio.alsaLatencyProfile);

        const XRUN_LIMIT = 3;
        const XRUN_WINDOW_MS = 30000;

        process.on('exit', () => {
            if (currentArecord) currentArecord.kill('SIGINT');
        });

        process.on('SIGINT', () => {
            shuttingDown = true;
            if (arecordRestartTimer) clearTimeout(arecordRestartTimer);
            if (currentArecord) currentArecord.kill('SIGINT');
            process.exit();
        });

        function scheduleArecordRestart(delay = 2000) {
            if (shuttingDown || arecordRestartTimer) return;

            arecordRestartTimer = setTimeout(() => {
                arecordRestartTimer = null;
                startArecord();
            }, delay);
        }

        function attachAudioInput(stream, processInstance) {
            audioServer.waitUntilReady.then(() => {
                if (processInstance !== currentArecord) return;

                if (audioServerRunning) {
                    audioServer.Server.SetInput(stream);
                } else {
                    audioServer.Server.StdIn = stream;
                    audioServer.Server.Run();
                    audioServerRunning = true;
                }
                connectMessage(`${consoleLogTitle} Connected arecord \u2192 FFmpeg \u2192 Server.StdIn${serverConfig.audio.audioBoost ? ' (audio boost)' : ''}`);
            });
        }

        function fallbackAlsaProfile(arecord, reason) {
            if (arecord.fallbackRequested) return;

            const fallbackName = getAlsaFallbackProfile(activeAlsaProfile.name);
            if (!fallbackName) {
                logWarn(`${consoleLogTitle} ${reason}; no safer ALSA latency profile is available.`);
                return;
            }

            const previousName = activeAlsaProfile.name;
            activeAlsaProfile = resolveAlsaLatencyProfile(fallbackName);
            arecord.fallbackRequested = true;
            logWarn(`${consoleLogTitle} ${reason} on the ${previousName} profile. Falling back to ${fallbackName}.`);
            arecord.kill('SIGINT');
        }

        function handleArecordXrun(arecord) {
            const now = Date.now();
            xrunTimestamps = xrunTimestamps.filter((timestamp) => now - timestamp <= XRUN_WINDOW_MS);
            xrunTimestamps.push(now);

            if (xrunTimestamps.length < XRUN_LIMIT) return;

            xrunTimestamps = [];
            fallbackAlsaProfile(arecord, 'Repeated ALSA overruns');
        }

        function startArecord() {
            const arecordCommand = buildCommand(ffmpegPath, activeAlsaProfile.name);
            activeAlsaProfile = arecordCommand.alsaLatencyProfile;
            const latencyDescription = activeAlsaProfile.bufferTime === null
                ? 'system defaults'
                : `${activeAlsaProfile.bufferTime / 1000} ms buffer, ${activeAlsaProfile.periodTime / 1000} ms period`;
            logInfo(`${consoleLogTitle} ALSA latency profile: ${activeAlsaProfile.name} (${latencyDescription}).`);
            logDebug(`${consoleLogTitle} Launching arecord with args: ${arecordCommand.arecordArgs.join(' ')}`);

            const arecord = spawn('arecord', arecordCommand.arecordArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
            currentArecord = arecord;

            attachAudioInput(arecord.stdout, arecord);

            arecord.stderr.on('data', (data) => {
                const message = data.toString();
                logFfmpeg(`[arecord stderr]: ${message}`);
                if (containsAlsaSetupError(message)) {
                    fallbackAlsaProfile(arecord, 'ALSA rejected the requested timing');
                } else if (containsAlsaXrun(message)) {
                    handleArecordXrun(arecord);
                }
            });

            arecord.on('error', (error) => {
                logError(`${consoleLogTitle} Failed to start arecord: ${error.message}`);
            });

            arecord.on('exit', (code, signal) => {
                if (currentArecord === arecord) currentArecord = null;
                logFfmpeg(`[arecord exited] with ${signal ? `signal ${signal}` : `code ${code}`}`);
                scheduleArecordRestart(signal === 'SIGINT' ? 250 : 2000);
            });
        }

        startArecord();
    }
}).catch((err) => {
    logError(`${consoleLogTitle} Error: ${err.message}`);
});
