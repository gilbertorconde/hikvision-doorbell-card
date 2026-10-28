# Hikvision Doorbell Card

A Fermax-style doorbell card for [Home Assistant](https://www.home-assistant.io/) with
**Hikvision** video intercoms (e.g. DS-KV6114-WBE1 outdoor station, DS-KH6350 indoor monitor),
fully local — no Hik-Connect.

![Badge: HACS custom card](https://img.shields.io/badge/HACS-Default-orange.svg)

## What it does

- **Live video** from your Hikvision camera restreamed via **Frigate / go2rtc** (WebRTC, two-way audio).
- **Big centered buttons** (video call + unlock), kept visible during a call — tap the lock mid-call to pulse the door relay.
- **Ring controls**: while the doorbell rings, the talk button becomes **Answer** (green) next to **Reject** (red) and the lock. Answering starts two-way audio; reject and unlock end the ring so the indoor stations stop ringing.
- **Call History** with per-ring **snapshot thumbnails** (click a thumbnail to zoom), answer/missed icons, relative timestamps.

## Prerequisites

| Component | Purpose |
|---|---|
| [`hikvision-doorbell` add-on (pergolafabio)](https://github.com/pergolafabio/Hikvision-Addons) | SDK integration (port 8000) exposing `sensor.*_call_state`, relays, etc. |
| [Frigate](https://frigate.video/) with go2rtc restream of the outdoor stream | live video + two-way audio |
| [Advanced Camera Card v8+](https://github.com/dermotduffy/advanced-camera-card) (HACS) | embedded live video / call UI |
| An automation that saves a snapshot on every ring into a media folder | fills the thumbnails |

### Ring snapshot automation (thumbnails)

On `state` of `sensor.*_call_state` → `ring`, snapshot the camera to a file named
`<prefix>YYYYMMDD_HHMM.jpg` inside `/media/<media_dir>`:

```yaml
automation:
  - alias: "Hikvision doorbell: ring snapshot"
    triggers:
      - trigger: state
        entity_id: sensor.outdoor_call_state
        to: "ring"
    actions:
      - action: camera.snapshot
        data:
          entity_id: camera.hikvision_outdoor
          filename: "/media/outdoor/porteiro_{{ '%Y%m%d_%H%M' | strftime }}.jpg"
```

## Installation

### HACS (custom repository)

1. HACS → ⋮ → *Custom repositories* → add
   `https://github.com/gilbertorconde/hikvision-doorbell-card` (category: **Lovelace**).
2. Install **Hikvision Doorbell Card**.
3. Hard refresh your browser.

### Manual

Copy `hikvision-doorbell-card.js` to `<config>/www/` and add as a resource:

```yaml
lovelace:
  resources:
    - url: /local/hikvision-doorbell-card.js
      type: module
```

## Usage

This card relies on [Advanced Camera Card](https://github.com/dermotduffy/advanced-camera-card)
being installed (it embeds it for the live view / call UI).

```yaml
type: custom:hikvision-doorbell-card
title: Front Door
camera_entity: camera.hikvision_outdoor
stream_name: hik_outdoor          # go2rtc stream name in Frigate
call_entity: sensor.outdoor_call_state
ringing_entity: input_boolean.hikvision_ringing
reject_entity: button.outdoor_reject_call
door_entity: script.hikvision_pulse_door_1
answer_script: script.hikvision_answer_and_stop_ringing
relays:
  - switch.outdoor_door_1_relay
  - switch.outdoor_door_2_relay
media_dir: outdoor                # folder under /media where ring snapshots are saved
snapshot_prefix: "porteiro_"
depth: 12
button_size: 48
max_width: 470
```

### Options

| Option | Required | Default | Description |
|---|---|---|---|
| `title` | no | `Front Door` | Caption + history row names |
| `camera_entity` | **yes** | — | Camera entity (Frigate camera) |
| `stream_name` | no | — | go2rtc stream name in Frigate (uses WebRTC/MSE) |
| `call_entity` | **yes** | — | `sensor.*_call_state` from the add-on (`idle`/`ring`/`onCall`) |
| `ringing_entity` | no | — | `on` while ringing (helper kept in sync with the `ring` state). Enables the ring controls |
| `reject_entity` | no | — | Button pressed by **Reject** (e.g. `button.outdoor_reject_call`) |
| `door_entity` | no | — | Script that pulses the door relay (magenta lock button) |
| `answer_script` | no | — | Script run when the call is answered, or the door is opened while ringing (silences other monitors) |
| `relays` | no | `[]` | Relay switches used to mark a call as answered in history |
| `media_dir` | no | `outdoor` | Folder under `/media` holding the ring snapshots |
| `snapshot_prefix` | no | `porteiro_` | Snapshot filename prefix |
| `depth` | no | `12` | Max rows in Call History (7-day window) |
| `button_size` | no | `48` | Menu button size (px) |
| `max_width` | no | `470` | Card max width (px) |

## Notes

- Thumbnails are read with authenticated fetches (`fetchWithAuth`) and embedded as
  data-URLs so they work in desktop browsers and mobile WebViews alike.
- Firmware 3.9.x does not emit a `RING` event on SDK 3.7+; the add-on needs
  `call_state_poll: 5` in its config for reliable call-state transitions.

## License

MIT — see [LICENSE](LICENSE).
