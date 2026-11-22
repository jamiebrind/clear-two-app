# Clear Two replacement review

This review targets the A31 Up2Stream Amp V4. The goal is a Clear Two app that can take a new speaker through setup and handle everyday listening, sound settings, and multiroom playback independently of GO CONTROL and 4STREAM.

## Product assessment, November 2026

**v0.7 update.** The native apps now bundle the controller, store rooms on the phone, and use local HTTP, SSDP and TCP. First-time setup and room tuning have direct mobile paths. The v0.6 assessment below records the earlier bridge dependency. The mobile release gate is now testing onboarding, network permissions, playback and tuning on physical phones and amps, with signed builds. Apple approval for multicast discovery is a separate distribution dependency; manual IP entry works independently.

**Release decision: continue as a developer preview.** An owner with a configured Amp V4 and a running bridge can select a room, control its input, and adjust its sound. A customer unpacking a speaker with only a phone still cannot go from first launch to music independently. Closing that gap would improve the product more than another DSP control.

Sonos gives the listener a selected room or group on launch and keeps the playback target visible. For Clear Two, the corresponding everyday tests are opening the last room, seeing what is playing, controlling it, and finding another room without losing track of the first. This build adds a compact phone room picker, remembers the room per browser, and gives explicit room links precedence. [Sonos room selection](https://support.sonos.com/en/article/sort-products-in-the-sonos-app) · [Sonos grouping](https://support.sonos.com/en-gb/article/group-and-ungroup-rooms)

| Priority | Customer impact | Acceptance criteria |
| --- | --- | --- |
| First release blocker | Installing the phone app and adding a new speaker still depend on a desktop bridge. | A new owner pairs the Amp V4 on a physical iPhone and Android phone, recovers from a wrong password, closes and reopens the app, and plays audio. Supply signed builds and reviewer access to a working demonstration. |
| First release blocker | Group changes and DHCP recovery have stronger simulator coverage than physical evidence. | Use real amps to verify join, room-level volume, synchronized playback, power-cycle recovery, and address reassignment. Record firmware versions and observed outcomes. |
| High | A listener can select USB or network audio but cannot browse a library, pick an album, or manage a queue inside Clear Two. | Start with USB browsing and saved presets. Verify empty media, removal mid-track, and next-track behavior before expanding to NAS or provider accounts. |
| High | A grouped guest identifies its role but gives no direct navigation to its host. The group picker can offer a room already occupied elsewhere. | Show membership across rooms, open the host from a guest, and explain conflicts before submitting a join. Recheck topology after an external group change. |
| High | The bridge accepts commands from clients on the trusted LAN. Microphone access on a phone adds certificate setup. | Choose the household access model for distribution, test network and microphone permission denial and recovery, and describe actual local data use in store disclosures. |
| Experimental | Phone microphone response, position, noise and playback level affect suggested EQ. The desktop tuning handover records a separate ACP startup profile and USB measurements. | Compare repeated phone captures with a reference microphone and verify the audible result and restoration on real hardware. Keep desktop ACP results separate from evidence for the phone feature. |

The review covers the app README, changelog, prior review, bridge and UI code, tests and configuration. Supporting material included the local controller and measurement-loop notes, both tuning handovers, measurement plans, ACP effects notes and the wide-EQ report. The vendor interface matrix identifies the different jobs of HTTP, UPnP, TCP and UART. GO CONTROL’s feature list provides a product benchmark. [Arylic interfaces](https://developer.arylic.com/docs/) · [GO CONTROL comparison](https://www.up2stream.net/pages/go-control-app) · [Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/)

| Workflow | v0.6 development build | Before v1.0 |
| --- | --- | --- |
| First-time setup | Desktop hotspot provisioning for visible WPA2 or open 2.4 GHz networks. Clear Two can also add an amp already connected by Ethernet. | Verify hotspot setup on physical hardware. Get the vendor BLE provisioning contract and test direct pairing on real iPhones and Android phones. Cover failed passwords, setup interruption, and changing routers. |
| Finding and identifying speakers | Saves discovered and manually added rooms by hardware ID. Retries discovery when a saved address no longer matches. | Test DHCP changes on a physical network, multiple access points or interfaces, and rediscovery after reboot. Confirm behavior on networks that filter multicast. |
| Playback and sources | Now Playing, pause and resume for supported device-managed playback, input selection with readback, speaker volume and mute. Optional inputs use the reported capability bits. USB DAC mute and tone controls were previously verified with a microphone on an Amp V4. | Verify transport on the physical board and add skip and seek where the source supports them. Verify switching across physical inputs and group changes. |
| Multiroom | Create or expand a router-mode group, remove a guest, ungroup, set a common absolute volume, and adjust guest volume and mute. The bridge reads the host after changes. Two groups were exercised with four simulated speakers. | Verify physical speaker groups, synchronization, firmware compatibility, reconnection after power loss, and groups edited from another controller. Stereo pairing requires its own capability and synchronization validation. |
| Music | Playback status for streams supported by the speaker. | Implement presets and supported USB/NAS queues and playlists. Evaluate each music provider's supported integration before advertising in-app search, accounts or playback. |
| Sound and device settings | Bass, mid and treble with device readback. Experimental room tuning measures three positions with the browser microphone and suggests small bass or treble cuts. | Verify repeatability on physical phone microphones and speakers, expand verified EQ controls, and confirm how ACPWorkbench profiles can be recalled. |
| Mobile and browser delivery | Responsive browser app and Windows bridge. Android emulator preview exercises the browser interface. | Ship signed native builds with direct LAN transport and permission handling. Verify real-device sleep/resume and repeat pairing. Keep the web bridge as the browser transport. |

## Failure handling covered in this build

The v0.6 review exercised the production UI at widths of 320, 390, 768 and 1280 pixels. A real bridge connected to simulated rooms handled pause, resume, room switching, explicit room links and a discovery scan with no responding devices. A separate HTTPS test used distinct HTTP and HTTPS ports and verified the desktop setup handoff. The physical amplifier was unavailable during this review.

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
