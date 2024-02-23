# FM-DX Webserver 📻🌐

FM-DX Webserver is a cross-platform web server designed for FM DXers who want to control their TEF6686 / F1HD receiver through a web interface.

## Features

- 🌐 **Web-Based Control:** Access and control your TEF6686 / F1HD receiver from any device with a web browser.
- 📻 **FM DXing:** Enhance your FM/AM DXing experience with a user-friendly web interface.
- **Cross-Platform:** You can run this on both Windows and Linux servers along with xdrd.
- **Tuner control:** Control your FM tuner on the go. Phone? Tablet? No problem.
- **Low-latency streaming**: Built in directly into the webserver, no external apps needed for users

##  Features to be added
Check [here](https://trello.com/b/OAKo7n0Q/fm-dx-webserver) for an up to date task list

## Community
Join our **Discord community** to get the latest development update info, share feedback and receive support.
[<img alt="Join the TEF6686 Discord community!" src="https://i.imgur.com/lI9Tuxf.png" height="120">](https://discord.gg/ZAVNdS74mC)  

## Getting Started

1. Install node.js from here: 
    ```bash
    https://nodejs.org/en
    ```

1. Clone the repository (or alternatively download it manually):

    ```bash
    git clone https://github.com/NoobishSVK/FM-DX-Webserver.git
    ```

2. Download or install ffmpeg (optional, but needed if you want the audio stream to work)

    ```bash
    Linux (Ubuntu/Debian): 
    sudo apt install ffmpeg

    Windows: 
    Download this file: https://www.gyan.dev/ffmpeg/builds/ffmpeg-git-essentials.7z
    Extract the file bin/ffmpeg.exe into the fm-dx-webserver folder
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

Happy DXing! 🎶📡
