# FM-DX Webserver 📻🌐

FM-DX Webserver is a cross-platform web server designed for FM DXers who want to control their radio receiver through a web interface.

## Supported devices

- **TEF668x:** Supported with PE5PVB's and Konrad's FM-DX Tuner firmware, Arduino versions with other firmwares should work too.
- **XDR F1HD:** Officially supported, works best with Konrad's FM-DX Tuner firmware.
- **SDR (AirSpy / RTL-SDR):** Supported **unofficially** via SDRSharp and the XDR-GTK plugin.

## Features

- **Cross-platform support:**
  - Linux
  - macOS
  - Windows

- **Web-Based Control:** Access and control your receiver from any device with a web browser.
- **Low-latency streaming**: Built in directly into the webserver, no external apps needed for users.

- **Plugin-support**: See our wiki for summary of available [plugins](https://github.com/NoobishSVK/fm-dx-webserver/wiki/Plugin-List).
- **FM DXing:** Enhance your FM/AM DXing experience with a user-friendly web interface.

## Getting Started

- [Linux installation](https://github.com/NoobishSVK/fm-dx-webserver/wiki/Linux-Installation)
- [macOS installation](https://github.com/NoobishSVK/fm-dx-webserver/wiki/macOS-Installation)
- [Windows installation](https://github.com/NoobishSVK/fm-dx-webserver/wiki/Windows-Installation)

## Utilized projects

This project utilizes these libraries:

- [3LAS](https://github.com/jojobond/3LAS) library by JoJoBond for Low Latency Audio Streaming.
- [flat-flags](https://github.com/luishdez/flat-flags) library by luishdez for RDS country flags.
- [librdsparser](https://github.com/kkonradpl/librdsparser) library by Konrad Kosmatka for RDS parsing.

All of these libraries are already bundled with the webserver.

## Features to be added

Check [here](https://trello.com/b/OAKo7n0Q/fm-dx-webserver) for an up to date task list.

## Community

Join our **Discord community** to get the latest development update info, share feedback and receive support.
[<img alt="Join the OpenRadio Discord community!" src="https://i.imgur.com/lI9Tuxf.png" height="120">](https://discord.gg/ZAVNdS74mC)  

## Contributing

Feel free to contribute to the project by opening issues or submitting pull requests. Your input is valuable!

## License

This project is licensed under the [GNU-GPL v3 License](LICENSE.md).
Always check with your country's laws before hosting a webserver.

Happy DXing! 🎶📡
