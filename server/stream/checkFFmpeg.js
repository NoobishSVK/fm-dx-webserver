const { spawn } = require('child_process');

function checkFFmpeg() {
  return new Promise((resolve, reject) => {
    const checkFFmpegProcess = spawn('ffmpeg', ['-version'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });

    checkFFmpegProcess.on('error', () => {
      resolve(require('ffmpeg-static'));
    });

    checkFFmpegProcess.on('exit', (code) => {
      if (code === 0) {
        resolve('ffmpeg');
      } else {
        resolve(require('ffmpeg-static'));
      }
    });
  });
}

module.exports = checkFFmpeg;
