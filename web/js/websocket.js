var url = new URL('text', window.location.href);
url.protocol = url.protocol.replace('http', 'ws');
var socketAddress = url.href;
var socket = new WebSocket(socketAddress);

const socketPromise = new Promise((resolve, reject) => {
    // Event listener for when the WebSocket connection is open
    socket.addEventListener('open', () => {
        console.log('WebSocket connection open');
        resolve(socket); // Resolve the promise with the WebSocket instance
    });

    // Event listener for WebSocket errors
    socket.addEventListener('error', (error) => {
        console.error('WebSocket error', error);
        reject(error); // Reject the promise on error
    });

    // Event listener for WebSocket connection closure
    socket.addEventListener('close', () => {
        console.warn('WebSocket connection closed');
        reject(new Error('WebSocket connection closed')); // Reject with closure warning
    });
});

// Assign the socketPromise to window.socketPromise for global access
window.socketPromise = socketPromise;

// Assign the socket instance to window.socket for global access
window.socket = socket;
