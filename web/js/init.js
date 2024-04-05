var currentDate = new Date('April 6, 2024 01:00:00');
var day = currentDate.getDate();
var month = currentDate.getMonth() + 1; // Months are zero-indexed, so add 1
var year = currentDate.getFullYear();
var formattedDate = day + '/' + month + '/' + year;
var currentVersion = 'v1.1.9b [' + formattedDate + ']';

getInitialSettings();

function getInitialSettings() {
    $.ajax({
        url: './static_data',
        dataType: 'json',
        success: function (data) {
            localStorage.setItem('qthLatitude', data.qthLatitude);
            localStorage.setItem('qthLongitude', data.qthLongitude);
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