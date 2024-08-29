var currentDate = new Date('Aug 28, 2024 22:00:00');
var day = currentDate.getDate();
var month = currentDate.getMonth() + 1; // Months are zero-indexed, so add 1
var year = currentDate.getFullYear();
var formattedDate = day + '/' + month + '/' + year;
var currentVersion = 'v1.2.7 [' + formattedDate + ']';

getInitialSettings();
removeUrlParameters(); // Call this function to remove URL parameters

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
            localStorage.setItem('rdsMode', data.rdsMode);
        },
        error: function (error) {
            console.error('Error:', error);
        }
    });
}

function removeUrlParameters() {
    // Get the current URL without the query parameters
    var urlWithoutParams = window.location.protocol + "//" + window.location.host + window.location.pathname;

    // Replace the current URL with the new one, without reloading the page
    window.history.replaceState({ path: urlWithoutParams }, '', urlWithoutParams);
}
