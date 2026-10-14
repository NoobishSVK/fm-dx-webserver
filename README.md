# FM-DX Webserver 📻🌐

FM-DX Webserver is a cross-platform web server designed for FM DXers who want to control their radio receiver through a web interface.

## Supported devices

- **TEF668x:** Supported with PE5PVB's and Konrad's FM-DX Tuner firmware, Arduino versions with other firmwares should work too.
- **XDR F1HD:** Officially supported, works best with Konrad's FM-DX Tuner firmware.
- **SDR (AirSpy / RTL-SDR):** Supported via SDRSharp and the XDR-GTK plugin. An experimental direct `rtl_tcp` backend is also available.

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

## Docker with RTL-SDR

The included Compose stack runs on both `linux/amd64` and `linux/arm64`. It has two services:

- `rtl_tcp` owns the USB receiver.
- `fm-dx-webserver` tunes it over the Docker network and performs the FM, stereo, and optional RDS DSP directly in JavaScript.

Make sure no host process is already using the dongle, then run:

```bash
docker compose up --build -d
docker compose logs -f
```

Open `http://<docker-host>:8080`. The configuration is persisted in the `fmdx_config` Docker volume.

The most useful optional settings can be placed in a `.env` file:

```dotenv
FMDX_PORT=8080
FMDX_ADMIN_PASSWORD=replace-with-a-strong-password
# Optional deployment overrides:
# FMDX_AUDIO_BITRATE=320k
# RTL_TCP_GAIN=auto
# RTL_TCP_PPM=0
# RTL_TCP_BIAS_TEE=false
# RTL_TCP_DEEMPHASIS_US=50
# RTL_TCP_DEVIATION_HZ=75000
# RTL_TCP_BANDWIDTH_HZ=200000
# RTL_TCP_STEREO_MINIMUM_SNR_DB=3
# RTL_TCP_RDS_ENABLED=true
```

Set `FMDX_ADMIN_PASSWORD` before the first start. If it is omitted, the container generates a random administrator password and prints it once in `docker compose logs`. Empty administrator and tuning passwords are never accepted.

`RTL_TCP_GAIN` is either `auto` or a tuner gain in dB. The Docker RTL-SDR stack defaults to 320 kb/s MP3 audio; `FMDX_AUDIO_BITRATE` accepts `64k`, `96k`, `128k`, `192k`, `256k`, or `320k`. Only enable the bias tee when the connected RF hardware requires DC power. Use `50` microseconds de-emphasis in most of the world, including Europe and Australia; use `75` in the Americas and South Korea. The default 240 kHz IQ rate is intentional; broadcast FM requires at least 192 kHz in this backend.

Empty or omitted Docker variables preserve the values saved through the
administrator panel. Set an optional variable only when it should be an
explicit deployment override. The administrator password and the container's
internal web port are normally deployment-managed; `FMDX_PORT` changes only
the published host port.

On Linux, a kernel DVB driver or another `rtl_tcp`/SDR application can claim the USB device first. Stop the conflicting process and unload or blacklist `dvb_usb_rtl28xxu` if the `rtl_tcp` service reports that it cannot open the receiver.

The JavaScript backend provides stereo audio with automatic mono fallback, tuning, a signal estimate, and optional raw-group RDS through the webserver's existing RDS parser. It does not build or launch separate native DSP helpers. Existing SDRSharp/XDR-GTK support remains available.

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
