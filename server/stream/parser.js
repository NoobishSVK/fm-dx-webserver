'use strict';

const exec = require('child_process').exec;
const fs = require('fs').promises; // Use the Promise-based fs API
const ffmpeg = require('ffmpeg-static');
const filePath = '/proc/asound/cards';
const platform = process.platform;

function parseAudioDevice(options, callback) {
    let videoDevices = [];
    let audioDevices = [];
    let isVideo = true;

    if (typeof options === 'function') {
        callback = options;
        options = null;
    }
    options = options || {};
    const ffmpegPath = `"${ffmpeg.replace(/\\/g, '\\\\')}"`;
    const callbackExists = typeof callback === 'function';

    const execute = async (fulfill, reject) => {
        try {
            if (platform === 'linux') {
                try {
                    const data = await fs.readFile(filePath, 'utf8');
                    const regex = /\[([^\]]+)\]/g;
                    const matches = (data.match(regex) || []).map(match => 'hw:' + match.replace(/\s+/g, '').slice(1, -1));

                    matches.forEach(match => {
                        if (typeof match === 'string') {
                            audioDevices.push({ name: match });
                        }
                    });
                } catch (err) {
                    console.error(`Error reading file: ${err.message}`);
                }

                // Linux doesn't support the `-list_devices` ffmpeg command like macOS/Windows,
                // so skip the ffmpeg exec for Linux
                const result = { videoDevices: [], audioDevices };
                if (callbackExists) return callback(result);
                return fulfill(result);
            }

            let inputDevice, prefix, audioSeparator, alternativeName, deviceParams;

            switch (platform) {
                case 'win32':
                    inputDevice = 'dshow';
                    prefix = /\[dshow/;
                    audioSeparator = /DirectShow\saudio\sdevices/;
                    alternativeName = /Alternative\sname\s*?"(.*?)"/;
                    deviceParams = /"(.*?)"/;
                    break;
                case 'darwin':
                    inputDevice = 'avfoundation';
                    prefix = /^\[AVFoundation/;
                    audioSeparator = /AVFoundation\saudio\sdevices/;
                    deviceParams = /^\[AVFoundation.*?]\s\[(\d+)]\s(.*)$/;
                    break;
            }

            exec(`${ffmpegPath} -f ${inputDevice} -list_devices true -i ""`, (err, stdout, stderr) => {
                stderr.split("\n")
                    .filter(line => line.search(prefix) > -1)
                    .forEach(line => {
                        const deviceList = isVideo ? videoDevices : audioDevices;
                        if (line.search(audioSeparator) > -1) {
                            isVideo = false;
                            return;
                        }

                        if (platform === 'win32' && line.search(/Alternative\sname/) > -1) {
                            const lastDevice = deviceList[deviceList.length - 1];
                            const alt = line.match(alternativeName);
                            if (lastDevice && alt) {
                                lastDevice.alternativeName = alt[1];
                            }
                            return;
                        }

                        const params = line.match(deviceParams);
                        if (params) {
                            let device;
                            switch (platform) {
                                case 'win32':
                                    device = { name: params[1] };
                                    break;
                                case 'darwin':
                                    device = { id: parseInt(params[1]), name: params[2] };
                                    break;
                            }
                            deviceList.push(device);
                        }
                    });

                audioDevices = audioDevices.filter(device => device.name !== undefined);
                const result = { videoDevices, audioDevices };
                if (callbackExists) return callback(result);
                return fulfill(result);
            });
        } catch (err) {
            console.error('Unexpected error:', err);
            if (callbackExists) callback({ videoDevices: [], audioDevices: [] });
            else reject(err);
        }
    };

    if (callbackExists) {
        execute();
    } else {
        return new Promise(execute);
    }
}

module.exports = { parseAudioDevice };