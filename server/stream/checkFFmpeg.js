const { spawn } = require('child_process');

function checkFFmpeg() {
  return new Promise((resolve, reject) => {
    const checkFFmpegProcess = spawn('ffmpeg', ['-version'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    let settled = false;
    const resolveOnce = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    checkFFmpegProcess.on('error', () => {
      resolveOnce(require('ffmpeg-static'));
    });

    checkFFmpegProcess.on('close', (code) => {
      if (code === 0) {
        resolveOnce('ffmpeg');
      } else {
        resolveOnce(require('ffmpeg-static'));
      }
    });
  });
}

module.exports = checkFFmpeg;
