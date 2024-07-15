const DefaultVolume = 0.5;
let Stream;

function Init(_ev) {
    try {
        const settings = new _3LAS_Settings();
        if (!Stream) {  // Ensure Stream is not re-initialized
            Stream = new _3LAS(null, settings);
        }
    } catch (error) {
        console.log(error);
        return;
    }

    Stream.ConnectivityCallback = OnConnectivityCallback;
    $(".playbutton").off('click').on('click', OnPlayButtonClick);  // Ensure only one event handler is attached
    $("#volumeSlider").off("input").on("input", updateVolume);  // Ensure only one event handler is attached
}

function OnConnectivityCallback(isConnected) {
    Stream.Volume = isConnected ? 1.0 : DefaultVolume;
}

function OnPlayButtonClick(_ev) {
    const $playbutton = $('.playbutton');
    $playbutton.find('.fa-solid').toggleClass('fa-play fa-stop');

    if (Stream.ConnectivityFlag) {
        Stream.Stop();
    } else {
        Stream.Start();
        $playbutton.addClass('bg-gray').prop('disabled', true);
        setTimeout(() => {
            $playbutton.removeClass('bg-gray').prop('disabled', false);
        }, 3000);
    }
}

function updateVolume() {
    Stream.Volume = $(this).val();
}

$(document).ready(Init); 