# smart-pet-simulator

A **virtual kennel** — simulated Smart Pet devices that speak the real MQTT
contract (`kennel/{kennelId}/{deviceType}/{deviceId}/{leaf}`), plus scripted
failure scenarios. Point it at any broker to exercise `smart-pet-backend`, the
Pet Hub, or the kennel microservices end-to-end without hardware.

## Why

You cannot hand-test a 40-run kennel. Regressions in the command loop, the rules
engine, offline detection or the care inbox need to be caught automatically. This
gives you N devices publishing realistic traffic and a timeline of faults.

## Run

```bash
npm install
npm run sim -- --scenario feeder-jam --broker mqtt://localhost:1883
npm run sim -- --list
```

Or the whole thing in Docker (Mosquitto + sim):

```bash
docker compose run --rm sim --scenario temp-spike
```

Options: `--scenario <name>` · `--broker <url>` (or `$MQTT_URL`) · `--kennel <id>`
· `--tick <ms>` · `--duration <ms>`.

## Devices

Each is a deterministic state machine (`src/device.ts`, `src/devices/`):

| type | responds to | publishes | faults |
|---|---|---|---|
| `feeder` | `feed`, `schedule_set` | `status` (foodLevel), `event` fed/jam | `jam` |
| `water` | `dispense` | `status` (waterLevel), `level` metric, `event` dispensed/no_flow | `no_flow` |
| `door` | `door` (lock/unlock/open/close) | `status` (locked/open), `event` door_open/closed | `stuck_door` |
| `sensor` | — | `temperature`/`humidity`/`airquality` metrics | `drift_high` |
| `gps` | `set_interval` | `location`, `status` (battery), `event` low_battery | `battery_drain` |
| `scale` | `tare`, `mark_meal`, `measure_consumed` | `event` consumed | — |

All devices support `offline` (LWT fires, commands ignored, retained status → `{status:"offline"}`).

Every command gets an `ack` on `…/ack` with the matching `ackId`.

## Scenarios (`src/scenarios.ts`)

| name | what it does | what a healthy stack should do |
|---|---|---|
| `happy-path` | 6 devices, steady telemetry | backend shows 6 online, feed/dispense round-trip clean |
| `feeder-jam` | jam `feeder-01` at +5s | `feed` → `ack:error` + `event:jam` → care-inbox exception |
| `offline-device` | `water-01` drops at +8s, back at +38s | retained `status:offline` → `device-offline` exception, then clears |
| `temp-spike` | whelping sensor drifts > 30 °C | rule fires → `relay:fan on` + critical exception |
| `low-battery` | `gps-collar-01` drains fast | `location.battery < 15` → `low_battery` → `low-battery` exception |
| `wrong-dog` | wrong collar tag at `feeder-01` | `presence {tagId:"tag-09"}` → `wrong-pen` critical exception |

## Test

```bash
npm test     # vitest — device state machines + scenario integrity (no broker needed)
```

## Layout

```
src/
  protocol.ts        vendored subset of smart-pet-mqtt (topics + envelopes)
  device.ts          VirtualDevice base + fault model
  devices/index.ts   feeder / water / door / sensor / gps / scale + factory
  scenarios.ts       scenario + timeline definitions
  runner.ts          plays a scenario against a real broker
  cli.ts             entrypoint
```
