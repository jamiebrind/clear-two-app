# Clear Two speaker app

The first build is a React and TypeScript controller for one Up2Stream speaker. The Node bridge serves the web UI and sends commands to the amplifier on the local network. It has been tested with the Up2Stream Amp V4.

Development updates are committed and pushed to `main`. Notable builds get a `v0.x.y` Git tag and an entry in the [changelog](CHANGELOG.md). Smaller fixes bump the patch version. `v1.0.0` is reserved for the first public release.

## Run on Windows

From this directory with Node.js 24 or newer, run:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd start
```

Open `http://127.0.0.1:4273`. Use `npm.cmd run dev` during development. To access the app from a phone on the same network, set `CLEAR_TWO_HOST` in `.env` to this PC’s LAN IPv4 address and open that address on port `4273` from the phone. LAN mode is intended for a trusted private network. The bridge accepts controls from browsers that can open that local address. You can optionally set a starting speaker’s IP with `CLEAR_TWO_SPEAKER_IP`.

## Set up an Amp V4

Open **Add a speaker** on the computer running Clear Two. When the amp is in Wi-Fi pairing mode, use the computer’s Wi-Fi settings to join the amp’s temporary hotspot. Clear Two reads the amp’s network list and sends the selected 2.4 GHz WPA2 or open network settings. Rejoin your home network when prompted and let Clear Two find the amp, or enter its new IP if discovery misses it. Clear Two verifies the same hardware ID before saving the speaker. An amp already on Ethernet can be added by its local IP.

The bridge accepts setup requests on loopback. Wi-Fi credentials are used for the setup request and never saved in the app’s configuration. The only saved setup value is the verified local speaker address. Firmware-specific Wi-Fi onboarding still needs a pairing-mode hardware test. The desktop bridge uses the computer’s Wi-Fi settings to switch networks. Direct phone onboarding is part of native packaging.

## Current scope

- Now Playing shows source, playback state and available track metadata. It falls back to the source for inputs like USB DAC.
- Volume and mute use explicit HTTP commands. The bridge reads the speaker back after each change. Volume changes require pressing **Set volume**.
- Opening **Tone controls** reads the amplifier’s bass, mid and treble over TCP. Each slider sends its setting only after **Apply** and checks the setting again over TCP. These are the amplifier’s tone controls.
- The UI polls HTTP while visible. The Amp V4's dedicated TCP mute query disagreed with HTTP and UART passthrough during hardware checks.
- Browser delivery is implemented. Native iOS and Android packaging will use Capacitor and a direct LAN transport. Source switching, UPnP queue access, grouping, and ACPWorkbench profile recall are future increments.

[Arylic HTTP playback reference](https://developer.arylic.com/httpapi/#playback-control)
