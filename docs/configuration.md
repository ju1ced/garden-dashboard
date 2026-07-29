# Configuration reference

All examples use generic, fictional entity IDs. Replace them with your own.

## Card options

| Option                | Type    | Default                  | Description                                                       |
| --------------------- | ------- | ------------------------ | ----------------------------------------------------------------- |
| `type`                | string  | —                        | Must be `custom:garden-dashboard-card`.                           |
| `title`               | string  | `Tuin`                   | Hero title.                                                       |
| `subtitle`            | string  | `Bodem en bewatering`    | Hero subtitle.                                                    |
| `confirm_actions`     | boolean | `true`                   | Ask for confirmation before any watering start/stop.              |
| `battery_warning`     | number  | `20`                     | Battery percentage at/below which a diagnostic warning is raised. |
| `linkquality_warning` | number  | `20`                     | Zigbee LQI (0–255) at/below which a link warning is raised.       |
| `zones`               | list    | `[]`                     | Soil sensor zones (see below).                                    |
| `irrigation`          | list    | `[]`                     | Watering devices (see below).                                     |
| `layout_options`      | object  | `{ grid_columns: full }` | Sections dashboard sizing (`grid_columns`, `grid_rows`).          |

## Zones

Each entry in `zones` describes one soil-sensor panel. Only `name` and a
moisture entity are needed for a useful panel; every other entity is optional
and simply omitted from the panel when absent.

```yaml
zones:
  - name: Voortuin
    icon: mdi:flower
    moisture:
      entity: sensor.example_soil_moisture
      dry_below: 25 # below this % → "Droog" (red)
      wet_above: 70 # above this % → "Nat" (blue); in between → "Goed" (green)
    entities:
      temperature: sensor.example_soil_temperature
      humidity: sensor.example_air_humidity
      illuminance: sensor.example_illuminance
      conductivity: sensor.example_soil_conductivity
      battery: sensor.example_sensor_battery
      linkquality: sensor.example_sensor_linkquality
```

### Zone fields

| Field                   | Required | Description                                            |
| ----------------------- | -------- | ------------------------------------------------------ |
| `name`                  | no       | Panel heading (falls back to `Zone N`).                |
| `icon`                  | no       | MDI icon for the panel (default `mdi:flower`).         |
| `moisture.entity`       | no\*     | Soil-moisture sensor. Primary value + gauge.           |
| `moisture.dry_below`    | no       | Dry threshold %, default `25`.                         |
| `moisture.wet_above`    | no       | Wet threshold %, default `70`.                         |
| `entities.temperature`  | no       | Soil / air temperature sensor.                         |
| `entities.humidity`     | no       | Air humidity sensor.                                   |
| `entities.illuminance`  | no       | Illuminance sensor.                                    |
| `entities.conductivity` | no       | Conductivity / fertility sensor.                       |
| `entities.battery`      | no       | Battery % sensor (feeds the "lowest battery" summary). |
| `entities.linkquality`  | no       | Zigbee link quality sensor.                            |

\* A zone with no moisture entity still renders, but is flagged in
diagnostics as missing a sensor.

### Multiple zones

```yaml
zones:
  - name: Voortuin
    icon: mdi:flower
    moisture:
      { entity: sensor.front_soil_moisture, dry_below: 25, wet_above: 70 }
    entities:
      {
        temperature: sensor.front_soil_temperature,
        battery: sensor.front_battery,
      }
  - name: Moestuin
    icon: mdi:sprout
    moisture: { entity: sensor.veg_soil_moisture, dry_below: 30, wet_above: 75 }
    entities:
      temperature: sensor.veg_soil_temperature
      conductivity: sensor.veg_soil_conductivity
      battery: sensor.veg_battery
  - name: Plantenbak
    icon: mdi:flower-pot-outline
    moisture: { entity: sensor.planter_soil_moisture }
```

## Irrigation

Each entry in `irrigation` describes one watering device.

```yaml
irrigation:
  - name: Moestuin
    icon: mdi:water
    entities:
      valve: switch.example_watering # required for start/stop controls
      duration: number.example_watering_duration # optional; shows a slider
      remaining: sensor.example_watering_remaining
      last_run: sensor.example_watering_last_run
      status: sensor.example_watering_schedule_status
      error: sensor.example_watering_valve_state
      volume: sensor.example_watering_daily_volume
      battery: sensor.example_watering_battery
      linkquality: sensor.example_watering_linkquality
```

### Irrigation fields

| Field                  | Required | Description                                                            |
| ---------------------- | -------- | ---------------------------------------------------------------------- |
| `name`                 | no       | Card heading.                                                          |
| `icon`                 | no       | MDI icon (default `mdi:water`).                                        |
| `entities.valve`       | no\*     | On/off entity that runs the water. Drives Start/Stop + active state.   |
| `entities.duration`    | no       | A `number.*` entity — shown as a slider that calls `number.set_value`. |
| `entities.remaining`   | no       | Live / remaining irrigation duration sensor.                           |
| `entities.last_run`    | no       | Last watering timestamp/sensor.                                        |
| `entities.status`      | no       | Programme / schedule status sensor.                                    |
| `entities.error`       | no       | Fault / valve-abnormal state sensor.                                   |
| `entities.volume`      | no       | Water usage sensor.                                                    |
| `entities.battery`     | no       | Battery % sensor.                                                      |
| `entities.linkquality` | no       | Zigbee link quality sensor.                                            |

\* Without a `valve` entity the Start/Stop buttons are disabled and the
device is flagged in diagnostics.

### Which service is called

The card never guesses a domain — it reads the `valve` entity's real domain
and calls the matching service:

| Entity domain   | Start                   | Stop                     |
| --------------- | ----------------------- | ------------------------ |
| `switch`        | `switch.turn_on`        | `switch.turn_off`        |
| `valve`         | `valve.open_valve`      | `valve.close_valve`      |
| `input_boolean` | `input_boolean.turn_on` | `input_boolean.turn_off` |
| `button`        | `button.press`          | _(no stop)_              |

Any other domain is reported as unsupported instead of firing a wrong
service call.

### Multiple watering devices

```yaml
irrigation:
  - name: Voortuin
    icon: mdi:water
    entities:
      { valve: switch.front_watering, battery: sensor.front_watering_battery }
  - name: Moestuin
    icon: mdi:water-pump
    entities:
      valve: switch.veg_watering
      volume: sensor.veg_watering_daily_volume
      error: sensor.veg_watering_valve_state
      battery: sensor.veg_watering_battery
```

## Confirmation prompts

By default any action that lets water flow shows a browser confirm dialog. To
disable it (for example on a trusted wall tablet):

```yaml
type: custom:garden-dashboard-card
confirm_actions: false
irrigation:
  - name: Moestuin
    entities: { valve: switch.veg_watering }
```

## Missing and unavailable entities

- **Missing** (entity not in config): the corresponding row is simply not
  rendered. A missing moisture entity is flagged in diagnostics.
- **`unknown`**: shown as `Onbekend`; the moisture gauge status becomes
  "Onbekend".
- **`unavailable`**: shown as `Niet beschikbaar`; irrigation Start/Stop
  buttons are disabled and diagnostics list the device as offline.

The card never crashes on missing or invalid values — the whole point of the
optional-entity model.

## Full-width in a Sections dashboard

The card implements `getGridOptions()` and defaults to full width. To pin it
explicitly:

```yaml
type: custom:garden-dashboard-card
title: Tuin
zones: []
irrigation: []
layout_options:
  grid_columns: full
  grid_rows: auto
```
