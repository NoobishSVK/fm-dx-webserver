const { spawn, execSync } = require('child_process');
const { configName, serverConfig, configUpdate, configSave, configExists } = require('../server_config');
const { logDebug, logError, logInfo, logWarn, logFfmpeg } = require('../console');
const checkFFmpeg = require('./checkFFmpeg');
const audioServer = require('./3las.server');

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
            execSync('which rec');
        } catch (error) {
            logError(`${consoleLogTitle} Error: SoX ("rec") not found. Please install SoX.`);
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

function buildCommand(ffmpegPath) {
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
        // macOS
        if (!serverConfig.audio.ffmpeg) {
            logInfo(`${consoleLogTitle} Platform: macOS (darwin) using "coreaudio" with the default audio device.`);
            return {
                // command not used if recArgs are used
                command: `rec -t coreaudio -b 32 -r 48000 -c ${audioChannels} -t raw -b 16 -r 48000 -c ${audioChannels}`,
                args: [],
                recArgs: [
                    '-t', 'coreaudio',
                    '-b', '32',
                    '-r', '48000',
                    '-c', `${audioChannels}`,
                    '-t', 'raw',
                    '-b', '16',
                    '-r', '48000',
                    '-c', `${audioChannels}`
                ]
            };
        } else {
            const device = serverConfig.audio.audioDevice;
            return {
                command: ffmpegPath,
                args: [
                    ...baseOptions.flags,
                    '-f', 'avfoundation',
                    '-i', `${device || ':0'}`,
                    ...baseOptions.codec,
                    ...baseOptions.output
                ]
            };
        }
    } else {
        // Linux
        if (!serverConfig.audio.ffmpeg) {
            const prefix = serverConfig.audio.softwareMode ? 'plug' : '';
            const device = `${prefix}${serverConfig.audio.audioDevice}`;
            logInfo(`${consoleLogTitle} Platform: Linux. Using "alsa" input.`);
            return {
                // command not used if arecordArgs are used
                command: `while true; do arecord -D "${device}" -f S16_LE -r 48000 -c ${audioChannels} -t raw; done`,
                args: [],
                arecordArgs: [
                    '-D', device,
                    '-f', 'S16_LE',
                    '-r', '48000',
                    '-c', audioChannels,
                    '-t', 'raw'
                ],
                ffmpegArgs: []
            };
        } else {
            const device = serverConfig.audio.audioDevice;
            return {
                command: ffmpegPath,
                args: [
                    ...baseOptions.flags,
                    '-f', 'alsa',
                    '-i', `${device}`,
                    ...baseOptions.codec,
                    ...baseOptions.output
                ],
                arecordArgs: [],
            };
        }
    }
}

checkFFmpeg().then((ffmpegPath) => {
    if (!serverConfig.audio.ffmpeg) checkAudioUtilities();
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
            let ffmpegArgs = commandDef.args;

            // Apply audio boost if enabled
            if (serverConfig.audio.audioBoost) {
                ffmpegArgs.splice(ffmpegArgs.indexOf('pipe:1'), 0, '-af', 'volume=3.5');
            }

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
        // macOS (rec --> 3las.server.js --> FFmpeg)
        const commandDef = buildCommand(ffmpegPath);

        // Apply audio boost if enabled and FFmpeg is used
        if (serverConfig.audio.audioBoost && serverConfig.audio.ffmpeg) {
            commandDef.args.splice(commandDef.recArgs.indexOf('pipe:1'), 0, '-af', 'volume=3.5');
        }

        function startRec() {
            if (!serverConfig.audio.ffmpeg) {
                // Spawn rec
                logDebug(`${consoleLogTitle} Launching rec with args: ${commandDef.recArgs.join(' ')}`);

                //const rec = spawn(commandDef.command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
                const rec = spawn('rec', commandDef.recArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

                audioServer.waitUntilReady.then(() => {
                    audioServer.Server.StdIn = rec.stdout;
                    audioServer.Server.Run();
                    connectMessage(`${consoleLogTitle} Connected rec \u2192 FFmpeg \u2192 Server.StdIn${serverConfig.audio.audioBoost && serverConfig.audio.ffmpeg ? ' (audio boost)' : ''}`);
                });

                process.on('exit', () => {
                    rec.kill('SIGINT');
                });

                process.on('SIGINT', () => {
                    rec.kill('SIGINT');
                    process.exit();
                });

                rec.stderr.on('data', (data) => {
                    logFfmpeg(`[rec stderr]: ${data}`);
                });

                rec.on('exit', (code) => {
                    logFfmpeg(`[rec exited] with code ${code}`);
                    if (code !== 0) {
                        setTimeout(startRec, 2000);
                    }
                });
            }
        }

        startRec();

        if (serverConfig.audio.ffmpeg) {
            logDebug(`${consoleLogTitle} Launching FFmpeg with args: ${commandDef.args.join(' ')}`);
            const ffmpeg = spawn(ffmpegPath, commandDef.args, { stdio: ['ignore', 'pipe', 'pipe'] });

            // Pipe FFmpeg output to 3las.server.js
            audioServer.waitUntilReady.then(() => {
                audioServer.Server.StdIn = ffmpeg.stdout;
                audioServer.Server.Run();
                connectMessage(`${consoleLogTitle} Connected FFmpeg stdout \u2192 Server.StdIn${serverConfig.audio.audioBoost ? ' (audio boost)' : ''}`);
            });

            process.on('SIGINT', () => {
                ffmpeg.kill('SIGINT');
                process.exit();
            });

            process.on('exit', () => {
                ffmpeg.kill('SIGINT');
            });

            // FFmpeg stderr handling
            ffmpeg.stderr.on('data', (data) => {
                logFfmpeg(`[FFmpeg stderr]: ${data}`);
            });

            // FFmpeg exit handling
            ffmpeg.on('exit', (code) => {
                logFfmpeg(`[FFmpeg exited] with code ${code}`);
                if (code !== 0) {
                    logWarn(`${consoleLogTitle} FFmpeg exited unexpectedly with code ${code}`);
                }
            });
        }
    } else {
        // Linux (arecord --> 3las.server.js --> FFmpeg)
        const commandDef = buildCommand(ffmpegPath);

        // Apply audio boost if enabled and FFmpeg is used
        if (serverConfig.audio.audioBoost && serverConfig.audio.ffmpeg) {
            commandDef.args.splice(commandDef.args.indexOf('pipe:1'), 0, '-af', 'volume=3.5');
        }

        function startArecord() {
            if (!serverConfig.audio.ffmpeg) {
                // Spawn the arecord loop
                logDebug(`${consoleLogTitle} Launching arecord with args: ${commandDef.arecordArgs.join(' ')}`);

                //const arecord = spawn(commandDef.command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
                const arecord = spawn('arecord', commandDef.arecordArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

                audioServer.waitUntilReady.then(() => {
                    audioServer.Server.StdIn = arecord.stdout;
                    audioServer.Server.Run();
                    connectMessage(`${consoleLogTitle} Connected arecord \u2192 FFmpeg \u2192 Server.StdIn${serverConfig.audio.audioBoost && serverConfig.audio.ffmpeg ? ' (audio boost)' : ''}`);
                });

                process.on('exit', () => {
                    arecord.kill('SIGINT');
                });

                process.on('SIGINT', () => {
                    arecord.kill('SIGINT');
                    process.exit();
                });

                arecord.stderr.on('data', (data) => {
                    logFfmpeg(`[arecord stderr]: ${data}`);
                });

                arecord.on('exit', (code) => {
                    logFfmpeg(`[arecord exited] with code ${code}`);
                    if (code !== 0) {
                        setTimeout(startArecord, 2000);
                    }
                });
            }
        }

        startArecord();

        if (serverConfig.audio.ffmpeg) {
            logDebug(`${consoleLogTitle} Launching FFmpeg with args: ${commandDef.args.join(' ')}`);
            const ffmpeg = spawn(ffmpegPath, commandDef.args, { stdio: ['ignore', 'pipe', 'pipe'] });

            // Pipe FFmpeg output to 3las.server.js
            audioServer.waitUntilReady.then(() => {
                audioServer.Server.StdIn = ffmpeg.stdout;
                audioServer.Server.Run();
                connectMessage(`${consoleLogTitle} Connected FFmpeg stdout \u2192 Server.StdIn${serverConfig.audio.audioBoost ? ' (audio boost)' : ''}`);
            });

            process.on('SIGINT', () => {
                ffmpeg.kill('SIGINT');
                process.exit();
            });

            process.on('exit', () => {
                ffmpeg.kill('SIGINT');
            });

            // FFmpeg stderr handling
            ffmpeg.stderr.on('data', (data) => {
                logFfmpeg(`[FFmpeg stderr]: ${data}`);
            });

            // FFmpeg exit handling
            ffmpeg.on('exit', (code) => {
                logFfmpeg(`[FFmpeg exited] with code ${code}`);
                if (code !== 0) {
                    logWarn(`${consoleLogTitle} FFmpeg exited unexpectedly with code ${code}`);
                }
            });
        }
    }
}).catch((err) => {
    logError(`${consoleLogTitle} Error: ${err.message}`);
});
