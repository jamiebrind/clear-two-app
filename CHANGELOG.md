# Changelog

## v0.5.0

- Added experimental room tuning with three browser microphone measurements and conservative EQ suggestions.
- Added an Original and Tuned comparison with amplifier readback and optional HTTPS for phone microphone access.

## v0.4.0

- Added a per-room input selector with amplifier readback. Optional digital and secondary analog inputs come from the speaker’s capability report.
- Group guests show that they follow their host’s input. Input changes are sent once and verified even when the acknowledgement is lost.
- Verified that changing or ungrouping one of two simulated groups leaves the other group intact.

## v0.3.0

- Added a responsive Rooms view, speaker discovery, and saved room selection by hardware ID.
- Added grouped playback controls, including room join and removal, group and guest volume, guest mute, and ungrouping.
- Added group readback after changes, recovery from lost join acknowledgements, and handling for partial group volume changes. Documented the remaining work in the [replacement review](REVIEW.md).

## v0.2.0

- Added a desktop setup flow for the A31 Up2Stream Amp V4. It walks through joining the speaker hotspot, selecting a home Wi-Fi network, and verifying the speaker before saving its address.
- Added local network discovery after Wi-Fi setup, with manual IP entry for discovery failures and speakers already connected by Ethernet.
- Added tests for Wi-Fi network decoding, pairing commands, and device identity checks. The complete flow was exercised with a simulated speaker. Physical pairing and direct phone setup still need verification.

## v0.1.0

- Initial public version of the web controller with Now Playing, volume, mute, and bass, mid, and treble controls.
- Verified volume and tone command readback on an Up2Stream Amp V4. Verified mute and tone changes acoustically on USB DAC.
