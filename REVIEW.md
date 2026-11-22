# Clear Two replacement review

This review targets the A31 Up2Stream Amp V4. The goal is a Clear Two app that can take a new speaker through setup and handle everyday listening, sound settings, and multiroom playback independently of GO CONTROL and 4STREAM.

| Workflow | v0.3 development build | Before v1.0 |
| --- | --- | --- |
| First-time setup | Desktop hotspot provisioning for visible WPA2 or open 2.4 GHz networks. Clear Two can also add an amp already connected by Ethernet. | Verify hotspot setup on physical hardware. Get the vendor BLE provisioning contract and test direct pairing on real iPhones and Android phones. Cover failed passwords, setup interruption, and changing routers. |
| Finding and identifying speakers | Saves discovered and manually added rooms by hardware ID. Retries discovery when a saved address no longer matches. | Test DHCP changes on a physical network, multiple access points or interfaces, and rediscovery after reboot. Confirm behavior on networks that filter multicast. |
| Playback and sources | Now Playing, source display, speaker volume and mute. USB DAC mute and tone controls were previously verified with a microphone on an Amp V4. | Add source selection and source-aware play, pause, skip, and seek. Verify AirPlay, Spotify Connect, USB DAC, Line In and Bluetooth individually. |
| Multiroom | Create or expand a router-mode group, remove a guest, ungroup, set a common absolute volume, and adjust guest volume and mute. The bridge reads the host after changes. | Verify two physical speakers, synchronization, firmware compatibility, reconnection after power loss, and groups edited from another controller. Stereo pairing requires its own capability and synchronization validation. |
| Music | Playback status for streams supported by the speaker. | Implement presets and supported USB/NAS queues and playlists. Evaluate each music provider's supported integration before advertising in-app search, accounts or playback. |
| Sound and device settings | Bass, mid and treble with device readback. | Close the gap on GO CONTROL custom EQ, balance, maximum volume, device naming, and supported firmware updates. Confirm how ACPWorkbench profiles can be recalled. |
| Mobile and browser delivery | Responsive browser app and Windows bridge. Android emulator preview exercises the browser interface. | Ship signed native builds with direct LAN transport and permission handling. Verify real-device sleep/resume and repeat pairing. Keep the web bridge as the browser transport. |

## Failure handling covered in this build

- Each command addresses a saved room. Known speaker IDs are checked at the current address before writes, so a DHCP address reassigned to a different speaker cannot silently receive that room’s commands.
- Group membership is read from the amplifier. Clear Two sends each group command once and verifies actual state, including when the join acknowledgement drops. If group volume applies only to some rooms, the app reports an unconfirmed result and refreshes the group.
- Room settings are written using a temporary file and atomic rename. The published repo excludes the local room list. Wi-Fi setup requests stay on the bridge computer’s loopback interface. The speaker’s hotspot protocol carries credentials in reversible hex, so the app does not record them or log the vendor request URL.
- Clearing v1.0 requires repeatable hardware results on the supported speaker and phone versions. Simulated tests exercise failure handling and do not establish physical sync, acoustic behavior on other inputs, or BLE compatibility.

## Vendor references

- [GO CONTROL and 4STREAM feature comparison](https://www.up2stream.net/pages/go-control-app)
- [Arylic documentation by interface](https://developer.arylic.com/docs/)
- [Arylic multiroom HTTP commands](https://developer.arylic.com/httpapi/#multiroom-multizone)
- [Amp V4 BLE setup in the board manual](https://solen.ca/storage/media/DWLLbMlg4USJodYa69NewSQVpYqToxaYqxq3BSnf.pdf)
- [Arylic’s separate BLE remote and network setup services](https://forum.arylic.com/t/searching-for-volume-control-button-that-connects-with-arylic-up2stream/1223?page=6)
