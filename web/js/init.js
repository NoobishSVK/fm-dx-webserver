getInitialSettings();

function getInitialSettings() {
    $.ajax({
        url: './static_data',
        dataType: 'json',
        success: function (data) {
            // Use the received data (data.qthLatitude, data.qthLongitude) as needed
            localStorage.setItem('qthLatitude', data.qthLatitude);
            localStorage.setItem('qthLongitude', data.qthLongitude);
            localStorage.setItem('audioPort', data.audioPort);
            localStorage.setItem('streamEnabled', data.streamEnabled);
        },
        error: function (error) {
            console.error('Error:', error);
        }
    });
}