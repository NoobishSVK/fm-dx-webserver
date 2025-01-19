# FM-DX Webserver 📻🌐

FM-DX Webserver is a cross-platform web server designed for FM DXers who want to control their radio receiver through a web interface.

# Officially supported devices
- **TEF668x:** Supported with PE5PVB's and Konrad's FM-DX Tuner firmware, although Arduino versions with other firmwares will work too 
- **XDR F1HD:** Officially supported, works best with Konrad's FM-DX Tuner firmware
- **SDR (AirSpy / RTL-SDR):** Supported unofficially via SDRSharp and the XDR-GTK plugin

## Features
- **Web-Based Control:** Access and control your TEF6686 / F1HD receiver from any device with a web browser.
- **FM DXing:** Enhance your FM/AM DXing experience with a user-friendly web interface.
- **Cross-Platform:** You can run this on both Windows and Linux servers along with xdrd.
- **Low-latency streaming**: Built in directly into the webserver, no external apps needed for users

## Features to be added
Check [here](https://trello.com/b/OAKo7n0Q/fm-dx-webserver) for an up to date task list

## Community
Join our **Discord community** to get the latest development update info, share feedback and receive support.
[<img alt="Join the OpenRadio Discord community!" src="https://i.imgur.com/lI9Tuxf.png" height="120">](https://discord.gg/ZAVNdS74mC)  

## Getting Started (Windows)

1. Install node.js from here: 
    ```bash
    https://nodejs.org/en
    ```

2. Clone the repository (or alternatively download it manually):

    ```bash
    git clone https://github.com/NoobishSVK/FM-DX-Webserver.git
    ```

3. Navigate to the fm-dx-webserver folder in your terminal/command prompt and run this command:
    ```bash
    npm install
    ```

4. Start the server:

    ```bash
    npm run webserver
    ```

5. Open your web browser and navigate to `http:/localhost:8080` to access the web interface.

## Getting Started (Linux)
[Click here for the Linux installation tutorial.](https://gist.github.com/jhd6689/b1cf0e8e898af3f5c0b413f58d2eba95)

## Utilized projects

This project utilizes these libraries:
- [librdsparser](https://github.com/kkonradpl/librdsparser) library by Konrad Kosmatka for RDS parsing
- [3LAS](https://github.com/jojobond/3LAS) library by JoJoBond for Low Latency Audio Streaming
- [flat-flags](https://github.com/luishdez/flat-flags) library by luishdez for RDS country flags

All of these libraries are already bundled with the webserver.

## Contributing

Feel free to contribute to the project by opening issues or submitting pull requests. Your input is valuable!

## License

This project is licensed under the [GNU-GPL v3 License](LICENSE.md).
Always check with your country's laws before hosting a webserver.

Happy DXing! 🎶📡
