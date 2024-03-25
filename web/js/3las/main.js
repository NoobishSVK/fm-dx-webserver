const DefaultVolume = 0.5;
let Stream;

function Init(_ev) {
    try {
        const settings = new _3LAS_Settings();
        Stream = new _3LAS(null, settings);
    } catch (error) {
        console.log(error);
        return;
    }

    Stream.ConnectivityCallback = OnConnectivityCallback;
    $(".playbutton").on('click', OnPlayButtonClick);
    $("#volumeSlider").on("input", updateVolume);
}

function OnConnectivityCallback(isConnected) {
    Stream.Volume = isConnected ? 1.0 : DefaultVolume;
}

function OnPlayButtonClick(_ev) {
    try {
        if (Stream.ConnectivityFlag) {
            Stream.Stop();
        } else {
            Stream.Start();
            const $playbutton = $('.playbutton');
            $playbutton.find('.fa-solid').toggleClass('fa-play fa-stop');
            $playbutton.addClass('bg-gray').prop('disabled', true);
            setTimeout(() => {
                $playbutton.removeClass('bg-gray').prop('disabled', false);
            }, 3000);
        }
    } catch (error) {
        console.error(error);
    }
}

function updateVolume() {
    Stream.Volume = $(this).val();
}
