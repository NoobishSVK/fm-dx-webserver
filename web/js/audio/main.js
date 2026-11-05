'use strict';

let Stream;
let shouldReconnect = true;
let audioStreamRestartInterval;

function Init() {
    $('.playbutton').off('click').on('click', OnPlayButtonClick);
    $('#volumeSlider').off('input').on('input', updateVolume);
}

function createStream() {
    try {
        Stream = new AudioWsMp3Player();
        Stream.Volume = $('#volumeSlider').val();
    } catch (e) {
        console.error('Audio init error:', e);
    }
}

function destroyStream() {
    if (Stream) {
        Stream.Reset();
        Stream = null;
    }
    if (audioStreamRestartInterval) {
        clearInterval(audioStreamRestartInterval);
        audioStreamRestartInterval = null;
    }
}

function OnPlayButtonClick() {
    const $btn = $('.playbutton');
    const isAppleiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

    if (Stream) {
        shouldReconnect = false;
        destroyStream();
        $btn.find('.fa-solid').toggleClass('fa-stop fa-play');
        if (isAppleiOS && 'audioSession' in navigator) {
            navigator.audioSession.type = 'none';
        }
    } else {
        shouldReconnect = true;
        createStream();
        Stream.Start();
        $btn.find('.fa-solid').toggleClass('fa-play fa-stop');
        if (isAppleiOS && 'audioSession' in navigator) {
            navigator.audioSession.type = 'playback';
        }
        if (audioStreamRestartInterval) clearInterval(audioStreamRestartInterval);
        audioStreamRestartInterval = setInterval(() => {
            if (typeof requiresAudioStreamRestart !== 'undefined' && requiresAudioStreamRestart && Stream) {
                requiresAudioStreamRestart = false;
                Stream.Reset();
                Stream.Start();
                console.log('Audio stream restarted after radio data loss.');
            }
        }, 3000);
    }

    $btn.addClass('bg-gray').prop('disabled', true);
    setTimeout(() => $btn.removeClass('bg-gray').prop('disabled', false), 3000);
}

function updateVolume() {
    if (Stream) {
        Stream.Volume = $(this).val();
    }
}

$(document).ready(Init);
