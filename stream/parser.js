'use strict';

const exec = require('child_process').exec;
const fs = require('fs');
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
    const ffmpegPath = options.ffmpegPath || 'ffmpeg';
    const callbackExists = typeof callback === 'function';
    
    let inputDevice, prefix, audioSeparator, alternativeName, deviceParams;
    switch (platform) {
        case 'win32':
        inputDevice = 'dshow';
        prefix = /\[dshow/;
        audioSeparator = /DirectShow\saudio\sdevices/;
        alternativeName = /Alternative\sname\s*?\"(.*?)\"/;
        deviceParams = /\"(.*?)\"/;
        break;
        case 'darwin':
        inputDevice = 'avfoundation';
        prefix = /^\[AVFoundation/;
        audioSeparator = /AVFoundation\saudio\sdevices/;
        deviceParams = /^\[AVFoundation.*?\]\s\[(\d*?)\]\s(.*)$/;
        break;
        case 'linux':
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                console.error(`Error reading file: ${err.message}`);
                return;
            }
            
            // Extract values between square brackets, trim whitespace, and prefix with 'hw:'
            const regex = /\[([^\]]+)\]/g;
            const matches = (data.match(regex) || []).map(match => 'hw:' + match.replace(/\s+/g, '').slice(1, -1));
            
            if (matches.length > 0) {
                // Process the extracted values
                matches.forEach(function(match) {
                    if (typeof match === 'string') {
                        audioDevices.push({ name: match });
                    } else if (typeof match === 'object' && match.name) {
                        audioDevices.push(match);
                    }
                });
            } else {
                console.log('No matches found.');
            }
        });
        break;
    }
        
    
    const searchPrefix = (line) => (line.search(prefix) > -1);
    const searchAudioSeparator = (line) => isVideo && (line.search(audioSeparator) > -1);
    const searchAlternativeName = (line) => (platform === 'win32') && (line.search(/Alternative\sname/) > -1);

    
    const execute = (fulfill, reject) => {
        exec(`${ffmpegPath} -f ${inputDevice} -list_devices true -i ""`, (err, stdout, stderr) => {
            stderr.split("\n")
            .filter(searchPrefix)
            .forEach((line) => {
                const deviceList = isVideo ? videoDevices : audioDevices;
                if (searchAudioSeparator(line)) {
                    isVideo = false;
                    return;
                }
                if (searchAlternativeName(line)) {
                    const lastDevice = deviceList[deviceList.length - 1];
                    lastDevice.alternativeName = line.match(alternativeName)[1];
                    return;
                }
                const params = line.match(deviceParams);
                if (params) {
                    let device;
                    switch (platform) {
                        case 'win32':
                        device = {
                            name: params[1]
                        };
                        break;
                        case 'darwin':
                        device = {
                            id: parseInt(params[1]),
                            name: params[2]
                        };
                        break;
                        case 'linux':
                        device = {
                            name: params[1]
                        };
                        break;
                    }
                    deviceList.push(device);
                }
            });
            audioDevices = audioDevices.filter(device => device.name !== undefined);
            const result = { videoDevices, audioDevices };
            if (callbackExists) {
                callback(result);
            } else {
                fulfill(result);
            }
        });
    };
    
    if (callbackExists) {
        execute();
    } else {
        return new Promise(execute);
    }
}

module.exports = { parseAudioDevice };