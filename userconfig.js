const webServerHost = '0.0.0.0'; // IP of the web server
const webServerPort = 8080; // web server port
const webServerName = "Noobish's Server" // web server name (will be displayed in title, bookmarks...)

const xdrdServerHost = '192.168.1.15'; // xdrd server IP (if it's running on the same machine, use 127.0.0.1)
const xdrdServerPort = 7373; // xdrd server port
const xdrdPassword = 'password'; // xdrd password (optional)

const qthLatitude = ''; // your latitude, useful for maps.fmdx.pl integration
const qthLongitude = ''; // your longitude, useful for maps.fmdx.pl integration

const verboseMode = false; // if true, console will display extra messages

// DO NOT MODIFY ANYTHING BELOW THIS LINE
module.exports = {
    webServerHost, webServerPort, webServerName, xdrdServerHost, xdrdServerPort, xdrdPassword, qthLatitude, qthLongitude, verboseMode
};