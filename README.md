# Clear Two speaker app

The first build is a React and TypeScript controller for one Up2Stream speaker. The Node bridge serves the web UI and sends commands to the amplifier on the local network. It has been tested with the Up2Stream Amp V4.

## Run on Windows

From this directory with Node.js 24 or newer, copy `.env.example` to `.env` and replace the example IP address with your amplifier’s IPv4 address. Then run:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd start
```

Open `http://127.0.0.1:4273`. Use `npm.cmd run dev` during development. To access the app from a phone on the same network, set `CLEAR_TWO_HOST` in `.env` to this PC’s LAN IPv4 address and open that address on port `4273` from the phone. LAN mode is intended for a trusted private network. The bridge accepts controls from browsers that can open that local address.

## Current scope

- Now Playing shows source, playback state and available track metadata. It falls back to the source for inputs like USB DAC.
- Volume and mute use explicit HTTP commands. The bridge reads the speaker back after each change. Volume changes require pressing **Set volume**.
- Opening **Tone controls** reads the amplifier’s bass, mid and treble over TCP. Each slider sends its setting only after **Apply** and checks the setting again over TCP. These are the amplifier’s tone controls.
- The UI polls HTTP while visible. The Amp V4's dedicated TCP mute query disagreed with HTTP and UART passthrough during hardware checks.
- Browser delivery is implemented. Native iOS and Android packaging will use Capacitor and a direct LAN transport. Source switching, UPnP queue access, grouping, and ACPWorkbench profile recall are future increments.

[Arylic HTTP playback reference](https://developer.arylic.com/httpapi/#playback-control)
