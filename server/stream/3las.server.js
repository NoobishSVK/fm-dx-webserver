"use strict";
const fs = require('fs');
const ws = require('ws');
const { serverConfig } = require('../server_config');

// Load settings from config
const Settings = JSON.parse(fs.readFileSync('server/stream/settings.json', 'utf-8'));

class StreamClient {
    constructor(server, socket) {
        this.Server = server;
        this.Socket = socket;
        this.BinaryOptions = {
            compress: false,
            binary: true
        };
        this.Socket.on('error', this.OnError.bind(this));
        this.Socket.on('message', this.OnMessage.bind(this));
        this.Socket.on('close', this.OnClose.bind(this));
    }

    OnMessage(message) {
        try {
            let request = JSON.parse(message.toString());
            if (request.type === "answer") {
                // Handle answer type messages if needed
            } else if (request.type === "fallback") {
                // Assuming SetFallback is not needed or replace with the correct method
                console.warn('SetFallback method not defined. Fallback request ignored.');
            } else if (request.type === "stats") {
                if (Settings.AdminKey && request.data === Settings.AdminKey) {
                    this.SendText(JSON.stringify({
                        "type": "stats",
                        "data": this.Server.GetStats(),
                    }));
                }
            } else {
                this.OnError(new Error("Invalid message type"));
            }
        } catch (error) {
            this.OnError(error);
        }
    }

    OnError(error) {
        console.error('WebSocket error:', error);
        this.Server.DestroyClient(this);
    }

    OnClose() {
        console.log('WebSocket connection closed');
        this.Server.DestroyClient(this);
    }

    Destroy() {
        if (this.Socket.readyState === ws.OPEN) {
            try {
                this.Socket.close();
            } catch (ex) {
                console.error('Error while closing socket:', ex);
            }
        }
    }

    SendBinary(buffer) {
        if (this.Socket.readyState !== ws.OPEN) {
            this.OnError(new Error('Socket is not open'));
            return;
        }
        this.Socket.send(buffer, this.BinaryOptions);
    }

    SendText(text) {
        if (this.Socket.readyState !== ws.OPEN) {
            this.OnError(new Error('Socket is not open'));
            return;
        }
        this.Socket.send(text);
    }
}

class StreamServer {
    constructor(port, channels, sampleRate) {
        this.Port = port;
        this.Channels = channels;
        this.SampleRate = sampleRate;
        this.Clients = new Set();
        this.StdIn = process.stdin;
        this.Buffer = Buffer.alloc(0);
    }

    Run() {
        this.Server = new ws.Server({
            host: ["127.0.0.1", "::1"],
            port: this.Port,
            clientTracking: true,
            perMessageDeflate: false
        });
        this.Server.on('connection', this.OnServerConnection.bind(this));
        this.StdIn.on('data', this.OnStdInData.bind(this));
        this.StdIn.resume();
    }

    OnStdInData(buffer) {
        this.Buffer = Buffer.concat([this.Buffer, buffer]);
        if (this.Buffer.length >= 1) { // Adjust the buffer size as needed
            this.SendAudioData(this.Buffer);
            this.Buffer = Buffer.alloc(0);
        }
    }

    SendAudioData(buffer) {
        this.Clients.forEach(client => {
            try {
                client.SendBinary(buffer);
            } catch (error) {
                console.error('Error sending data to client:', error);
            }
        });
    }

    OnServerConnection(socket) {
        const client = new StreamClient(this, socket);
        this.Clients.add(client);
        console.log('New client connected');
    }

    DestroyClient(client) {
        this.Clients.delete(client);
        client.Destroy();
        console.log('Client connection destroyed');
    }

    GetStats() {
        return {
            "Total": this.Clients.size,
        };
    }

    static Create(options) {
        if (!options["-port"])
            throw new Error("Port undefined. Please use -port to define the port.");
        if (typeof options["-port"] !== "number" || options["-port"] !== Math.floor(options["-port"]) || options["-port"] < 1 || options["-port"] > 65535)
            throw new Error("Invalid port. Must be natural number between 1 and 65535.");
        if (!options["-channels"])
            throw new Error("Channels undefined. Please use -channels to define the number of channels.");
        if (typeof options["-channels"] !== "number" || options["-channels"] !== Math.floor(options["-channels"]) ||
            !(options["-channels"] === 1 || options["-channels"] === 2))
            throw new Error("Invalid channels. Must be either 1 or 2.");
        if (!options["-samplerate"])
            throw new Error("Sample rate undefined. Please use -samplerate to define the sample rate.");
        if (typeof options["-samplerate"] !== "number" || options["-samplerate"] !== Math.floor(options["-samplerate"]) || options["-samplerate"] < 1)
            throw new Error("Invalid sample rate. Must be natural number greater than 0.");
        return new StreamServer(options["-port"], options["-channels"], options["-samplerate"]);
    }
}

const OptionParser = {
    "-port": txt => parseInt(txt, 10),
    "-channels": txt => parseInt(txt, 10),
    "-samplerate": txt => parseInt(txt, 10)
};

const Options = {};
for (let i = 2; i < process.argv.length; i += 2) {
    if (!OptionParser[process.argv[i]])
        throw new Error("Invalid argument: '" + process.argv[i] + "'.");
    if (Options[process.argv[i]])
        throw new Error("Redefined argument: '" + process.argv[i] + "'. Please use '" + process.argv[i] + "' only ONCE");
    Options[process.argv[i]] = OptionParser[process.argv[i]](process.argv[i + 1]);
}

const Server = StreamServer.Create(Options);
Server.Run();
