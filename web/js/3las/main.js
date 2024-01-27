var Stream;
var DefaultVolume = 0.5;
function Init(_ev) {
    // Load default settings
    var settings = new _3LAS_Settings();
    if (typeof RtcConfig == 'undefined')
        RtcConfig = {};
    settings.WebRTC.RtcConfig = RtcConfig;
    if (typeof SocketPort != 'undefined')
        settings.SocketPort = SocketPort;
    if (typeof SocketPath != 'undefined')
        settings.SocketPath = SocketPath;
    if (typeof AudioTagId == 'undefined')
        settings.WebRTC.AudioTag = null;
    else
        settings.WebRTC.AudioTag = document.getElementById(AudioTagId);
    try {
        Stream = new _3LAS(null, settings);
    }
    catch (_ex) {
        console.log(_ex);
        return;
    }
    Stream.ConnectivityCallback = OnConnectivityCallback;
    document.getElementById("playbutton").onclick = OnPlayButtonClick;
    $("#volumeSlider").on("change", updateVolume);
}

function OnConnectivityCallback(isConnected) {
    if (isConnected) {
        Stream.Volume = 1.0;
    }
}

function OnPlayButtonClick(_ev) {
    try {
        Stream.Start();
        $('#playbutton').prop('disabled', true);
        $('#playbutton').find('.fa-solid').removeClass('fa-play').addClass('fa-pause');
    }
    catch (_ex) {
    }
}

function updateVolume() {
    Stream.Volume = $(this).val();
}

var lastTapTime = -1;