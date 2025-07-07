if (!window.socket || window.socket.readyState === WebSocket.CLOSED || window.socket.readyState === WebSocket.CLOSING) {
    var url = new URL('text', window.location.href);
    url.protocol = url.protocol.replace('http', 'ws');
    var socketAddress = url.href;
    var socket = new WebSocket(socketAddress);

    window.socket = socket;

    const socketPromise = new Promise((resolve, reject) => {
        socket.addEventListener('open', () => {
            console.log('WebSocket connection open');
            resolve(socket);
        });

        socket.addEventListener('error', (error) => {
            console.error('WebSocket error', error);
            reject(error);
        });

        socket.addEventListener('close', () => {
            setTimeout(() => {
                console.warn('WebSocket connection closed');
            }, 100);
            reject(new Error('WebSocket connection closed'));
        });
    });

    window.socketPromise = socketPromise;
}
