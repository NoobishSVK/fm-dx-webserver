var currentDate = new Date('March 28, 2024 22:00:00');
var day = currentDate.getDate();
var month = currentDate.getMonth() + 1; // Months are zero-indexed, so add 1
var year = currentDate.getFullYear();
var formattedDate = day + '/' + month + '/' + year;
var currentVersion = 'v1.1.9a [' + formattedDate + ']';

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
            localStorage.setItem('defaultTheme', data.defaultTheme);
            localStorage.setItem('preset1', data.presets[0]);
            localStorage.setItem('preset2', data.presets[1]);
            localStorage.setItem('preset3', data.presets[2]);
            localStorage.setItem('preset4', data.presets[3]);
            localStorage.setItem('bgImage', data.bgImage);
        },
        error: function (error) {
            console.error('Error:', error);
        }
    });
}