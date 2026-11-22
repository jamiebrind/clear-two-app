# Changelog

## v0.2.0

- Added a desktop setup flow for the A31 Up2Stream Amp V4. It walks through joining the speaker hotspot, selecting a home Wi-Fi network, and verifying the speaker before saving its address.
- Added local network discovery after Wi-Fi setup, with manual IP entry for discovery failures and speakers already connected by Ethernet.
- Added tests for Wi-Fi network decoding, pairing commands, and device identity checks. The complete flow was exercised with a simulated speaker. Physical pairing and direct phone setup still need verification.

## v0.1.0

- Initial public version of the web controller with Now Playing, volume, mute, and bass, mid, and treble controls.
- Verified volume and tone command readback on an Up2Stream Amp V4. Verified mute and tone changes acoustically on USB DAC.
