const webServerHost = '192.168.1.14'; // IP of the web server
const webServerPort = 8080; // web server port

const xdrdServerHost = '192.168.1.15'; // xdrd server iP
const xdrdServerPort = 7373; // xdrd server port
const xdrdPassword = 'changeme'; // xdrd password (optional)

const qthLatitude = '0.0'; // your latitude, useful for maps.fmdx.pl integration
const qthLongitude = '0.0'; // your longitude, useful for maps.fmdx.pl integration

const verboseMode = false; // if true, console will display extra messages

module.exports = {
    webServerHost, webServerPort, xdrdServerHost, xdrdServerPort, xdrdPassword, qthLatitude, qthLongitude, verboseMode
};