const WebSocket = require('ws');
const { serverConfig } = require('./server_config');
const { logChat } = require('./console');
const helpers = require('./helpers');

function createChatServer(storage) {
    if (!serverConfig.webserver.chatEnabled) {
        return null;
    }

    const chatWss = new WebSocket.Server({ noServer: true });

    chatWss.on('connection', (ws, request) => {
        const clientIp = request.headers['x-forwarded-for'] || request.connection.remoteAddress;
        const userCommandHistory = {};

        if (serverConfig.webserver.banlist?.includes(clientIp)) {
            ws.close(1008, 'Banned IP');
            return;
        }

        // Send chat history safely
        storage.chatHistory.forEach((message) => {
            const historyMessage = { ...message, history: true };

            if (!request.session?.isAdminAuthenticated) {
                delete historyMessage.ip;
            }

            ws.send(JSON.stringify(historyMessage));
        });

        const ipMessage = {
            type: 'clientIp',
            ip: clientIp,
            admin: request.session?.isAdminAuthenticated
        };

        ws.send(JSON.stringify(ipMessage));

        const userCommands = {};
        let lastWarn = { time: 0 };

        ws.on('message', (message) => {
            message = helpers.antispamProtection(
                message,
                clientIp,
                ws,
                userCommands,
                lastWarn,
                userCommandHistory,
                '5',
                'chat',
                512
            );

            if (!message) return;

            let messageData;

            try {
                messageData = JSON.parse(message);
            } catch {
                ws.send(JSON.stringify({ error: "Invalid message format" }));
                return;
            }

            delete messageData.admin;
            delete messageData.ip;
            delete messageData.time;

            if (messageData.nickname != null) {
                messageData.nickname = helpers.escapeHtml(String(messageData.nickname));
            } else {
                return;
            }

            console.log("Chat message:", messageData);

            messageData.ip = clientIp;

            const now = new Date();
            messageData.time =
                String(now.getHours()).padStart(2, '0') +
                ":" +
                String(now.getMinutes()).padStart(2, '0');

            if (serverConfig.webserver.banlist?.includes(clientIp)) return;

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

            chatWss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    const responseMessage = { ...messageData };

                    if (!request.session?.isAdminAuthenticated) {
                        delete responseMessage.ip;
                    }

                    client.send(JSON.stringify(responseMessage));
                }
            });
        });
    });

    return chatWss;
}

module.exports = { createChatServer };
