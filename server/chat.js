const WebSocket = require('ws');
const { serverConfig } = require('./server_config');
const { logChat } = require('./console');
const helpers = require('./helpers');

function heartbeat() { // WebSocket heartbeat helper
    this.isAlive = true;
}

function createChatServer(storage) {
    if (!serverConfig.webserver.chatEnabled) {
        return null;
    }

    const chatWss = new WebSocket.Server({ noServer: true });
    let nextMessageId = 0;

    function broadcast(data) {
        const payload = JSON.stringify(data);
        chatWss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        });
    }

    chatWss.on('connection', (ws, request) => {
        ws.isAlive = true;
        ws.on('pong', heartbeat);

        const clientIp = helpers.getClientIp(request);

        ws.send(JSON.stringify({
            type: 'clientIp',
            ip: clientIp,
            admin: request.session?.isAdminAuthenticated
        }));

        storage.chatHistory.forEach((message) => {
            ws.send(JSON.stringify({ ...message, history: true }));
        });

        const antispam = helpers.createAntispam(ws, clientIp, 5, 'chat', 512);

        ws.on('message', (message) => {
            message = antispam(message);

            if (!message) return;

            let messageData;

            try {
                messageData = JSON.parse(message);
            } catch {
                ws.send(JSON.stringify({ error: "Invalid message format" }));
                return;
            }

            if (messageData.type === 'clear' || messageData.type === 'delete') {
                if (request.session?.isAdminAuthenticated !== true) return;

                if (messageData.type === 'clear') {
                    storage.chatHistory.length = 0; // in place: storage exports this array
                } else {
                    const index = storage.chatHistory.findIndex((m) => m.id === messageData.id);
                    if (index === -1) return;
                    storage.chatHistory.splice(index, 1);
                }

                broadcast({ type: messageData.type, id: messageData.id });
                return;
            }

            delete messageData.type;
            delete messageData.admin;
            delete messageData.ip;
            delete messageData.time;

            if (messageData.nickname != null) {
                messageData.nickname = helpers.escapeHtml(String(messageData.nickname));
            } else {
                return;
            }

            messageData.ip = clientIp;
            messageData.id = nextMessageId++;

            const now = new Date();
            messageData.time =
                now.getFullYear() + "-" +
                String(now.getMonth() + 1).padStart(2, '0') + "-" +
                String(now.getDate()).padStart(2, '0') + " " +
                String(now.getHours()).padStart(2, '0') +
                ":" +
                String(now.getMinutes()).padStart(2, '0');

            if (helpers.isBanned(request)) return;

            if (request.session?.isAdminAuthenticated === true) {
                messageData.admin = true;
            }

            if (messageData.nickname?.length > 32) {
                messageData.nickname = messageData.nickname.substring(0, 32);
            }

            if (messageData.message?.length > 255) {
                messageData.message = messageData.message.substring(0, 255);
            }

            storage.chatHistory.push(messageData);

            if (storage.chatHistory.length > 50) {
                storage.chatHistory.shift();
            }

            logChat(messageData);

            broadcast(messageData);
        });

        ws.on('close', () => {
            ws.isAlive = false;
        });
    });

    /**
     * We will not always be receiving data, so some proxies may terminate the connection, this prevents it.
     */
    const interval = setInterval(() => {
        chatWss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                return ws.terminate();
            }

            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    chatWss.on('close', () => {
        clearInterval(interval);
    });

    return chatWss;
}

module.exports = { createChatServer };