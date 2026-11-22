# Clear Two speaker app

Clear Two is a React and TypeScript controller for Up2Stream Amp V4 speakers. The Node bridge serves the web UI and sends commands over the local network. See the [replacement review](REVIEW.md) for verified features and the work left before v1.0.

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

The bridge accepts setup requests on loopback. Wi-Fi credentials are used for the setup request and never saved in the app’s configuration. A local room record stores the speaker’s name, hardware ID and verified address. Firmware-specific Wi-Fi onboarding still needs a pairing-mode hardware test. The desktop bridge uses the computer’s Wi-Fi settings to switch networks. Direct phone onboarding is part of native packaging.

## Current scope

- Now Playing shows source, playback state and available track metadata. For active device-managed network tracks, URL streams and USB-drive playback, use **Pause** or **Resume**. A grouped guest follows its host. External audio inputs retain their source display and volume controls.
- The **Input** panel shows the amplifier’s active input and lets you switch between Wi-Fi / Network, Aux, Bluetooth, USB Drive and USB DAC on an Amp V4. Optical, coaxial and Aux 2 appear when the firmware advertises them. A guest follows its host’s input. The bridge checks the reported input after sending a change.
- **Rooms** lists the saved speakers and remembers the last selection in this browser. On a phone, use **Choose room** to switch. **Scan network** reports how many compatible amps responded and saves newly discovered rooms. For speakers missed by the scan, use the address option under **Add speaker** on the bridge computer.
- To start a group, open the room you want as host, then use **Group playback → Add room** to add a speaker. To start a second group, open a different standalone room and add another standalone speaker. A speaker can belong to one group at a time. From the host room you can remove guests, ungroup, set all volumes, and adjust guest volume or mute. Two separate groups have been exercised with four simulated speakers. Physical multiroom playback still needs verification.
- Volume and mute use explicit HTTP commands. The bridge reads the speaker back after each change. Volume changes require pressing **Set volume**.
- Opening **Tone controls** reads the amplifier’s bass, mid and treble over TCP. Each slider sends its setting only after **Apply** and checks the setting again over TCP. These are the amplifier’s tone controls.
- The UI polls HTTP while visible. The Amp V4's dedicated TCP mute query disagreed with HTTP and UART passthrough during hardware checks.
- Browser delivery is implemented. Native iOS and Android packaging will use Capacitor and a direct LAN transport. UPnP queue access, stereo pairing, and ACPWorkbench profile recall are future increments.

[Arylic HTTP playback reference](https://developer.arylic.com/httpapi/#playback-control)

## Experimental room tuning

Open **Room tuning** on a standalone speaker. Pause or stop playback, select **Wi-Fi / Network**, and unmute the speaker at 1–25% volume. The bridge must listen on its LAN IP so the amplifier can fetch the test sweep. Playing the sweep can replace the current queue.

Take three measurements at ear height around your listening position. The browser asks for microphone permission and analyses the samples locally. If the capture is too noisy, clips, or disagrees with the other positions, repeat the measurement as prompted. The experiment measures bass, mid and treble ranges and can reduce excessive bass or treble by up to 3 dB. It uses midrange as a reference and has no phone-specific calibration. Applying a suggested EQ saves the original values in the browser for **Restore original** after reloading.

On the bridge computer, open the local `http://127.0.0.1:4273` page. On a phone, open the bridge over trusted HTTPS on the LAN. Set `CLEAR_TWO_TLS_KEY` and `CLEAR_TWO_TLS_CERT` to PEM files for a certificate valid for the bridge IP, ensure the phone trusts its issuing CA, and restart the bridge. Use `https://<bridge-ip>:4274`, or the port set by `CLEAR_TWO_HTTPS_PORT`. Keep the HTTP LAN listener running for the amplifier to fetch the test sweep. No microphone recordings are uploaded or saved.
