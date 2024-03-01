getInitialSettings();

function getInitialSettings() {
    $.ajax({
        url: './static_data',
        dataType: 'json',
        success: function (data) {
            // Use the received data (data.qthLatitude, data.qthLongitude) as needed
            localStorage.setItem('qthLatitude', data.qthLatitude);
            localStorage.setItem('qthLongitude', data.qthLongitude);
            localStorage.setItem('streamEnabled', data.streamEnabled);
            localStorage.setItem('preset1', data.presets[0]);
            localStorage.setItem('preset2', data.presets[1]);
            localStorage.setItem('preset3', data.presets[2]);
            localStorage.setItem('preset4', data.presets[3]);
        },
        error: function (error) {
            console.error('Error:', error);
        }
    });
}