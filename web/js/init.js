var currentDate = new Date('May 2, 2025 16:00:00');
var day = currentDate.getDate();
var month = currentDate.getMonth() + 1; // Months are zero-indexed, so add 1
var year = currentDate.getFullYear();
var formattedDate = day + '/' + month + '/' + year; 
var currentVersion = 'v1.3.8 [' + formattedDate + ']';

removeUrlParameters();

function removeUrlParameters() {
    if (window.location.pathname === "/") {
        var urlWithoutParams = window.location.protocol + "//" + window.location.host + window.location.pathname;
        window.history.replaceState({ path: urlWithoutParams }, '', urlWithoutParams);
    }
}
