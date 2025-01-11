var currentDate = new Date('Jan 11, 2025 21:00:00');
var day = currentDate.getDate();
var month = currentDate.getMonth() + 1; // Months are zero-indexed, so add 1
var year = currentDate.getFullYear();
var formattedDate = day + '/' + month + '/' + year; 
var currentVersion = 'v1.3.3 [' + formattedDate + ']';

getInitialSettings();
removeUrlParameters();

function getInitialSettings() {
    $.ajax({
        url: './static_data',
        dataType: 'json',
        success: function (data) {

            ['qthLatitude', 'qthLongitude', 'defaultTheme', 'bgImage', 'rdsMode'].forEach(key => {
                if (data[key] !== undefined) {
                    localStorage.setItem(key, data[key]);
                }
            });
            
            data.presets.forEach((preset, index) => {
                localStorage.setItem(`preset${index + 1}`, preset);
            });
        },
        error: function (error) {
            console.error('Error:', error);
        }
    });
}

function removeUrlParameters() {
    if (window.location.pathname === "/") {
        var urlWithoutParams = window.location.protocol + "//" + window.location.host + window.location.pathname;
        window.history.replaceState({ path: urlWithoutParams }, '', urlWithoutParams);
    }
}
