# Garden Dashboard Card

Test line added by the AI-Hub Software Factory on 2026-10-28.

A self-contained [Home Assistant](https://www.home-assistant.io/) Lovelace
custom card that shows your garden's soil sensors and automatic irrigation on
one clear page. It is designed to drop straight into an existing dashboard
view — no separate view, YAML includes, themes, Mushroom, card-mod or any
other custom cards required.

- One-page overview: hero summary, soil zones, irrigation control, diagnostics
- Soil moisture with a semantic gauge (**Droog / Goed / Nat**) and configurable
  thresholds
- Per-zone temperature, humidity, illuminance, conductivity, battery and link
  quality — each shown only when configured
- Sonoff / Zigbee watering control using the entity's real domain
  (`switch`, `valve`, `input_boolean`, `button`)
- Start/stop actions ask for confirmation by default
- Graceful handling of missing, `unknown` and `unavailable` entities
- Responsive from wide desktop dashboards down to ~360 px phones
- Dark-green garden identity built purely from CSS, gradients and MDI icons
- Works full-width in a Sections dashboard

> **Type:** `custom:garden-dashboard-card` · **Resource:** `garden-dashboard.js`

## Installation

### HACS (recommended)

1. In HACS, open the three-dot menu → **Custom repositories**.
2. Add `https://github.com/ju1ced/garden-dashboard` with category
   **Lovelace** (Dashboard / Plugin).
3. Install **Garden Dashboard Card**.
4. HACS registers the resource automatically. If you manage resources
   manually (or use YAML mode), add:

   ```yaml
   url: /hacsfiles/garden-dashboard/garden-dashboard.js
   type: module
   ```

5. Reload your browser (hard refresh) so the new resource is picked up.

### Manual

1. Copy `garden-dashboard.js` to `config/www/garden-dashboard.js`.
2. Add the resource under **Settings → Dashboards → ⋮ → Resources**:

   ```yaml
   url: /local/garden-dashboard.js
   type: module
   ```

3. Hard-refresh the browser.

## Quick start

Add the card to any existing view (via **Edit dashboard → Add card →
Manual**) with a minimal config:

```yaml
type: custom:garden-dashboard-card
title: Tuin
zones: []
irrigation: []
```

A more useful configuration with one soil zone and one watering device
(replace the example IDs with your own):

```yaml
type: custom:garden-dashboard-card
title: Tuin
subtitle: Bodem en bewatering
confirm_actions: true

zones:
  - name: Moestuin
    icon: mdi:sprout
    moisture:
      entity: sensor.example_soil_moisture
      dry_below: 30
      wet_above: 75
    entities:
      temperature: sensor.example_soil_temperature
      conductivity: sensor.example_soil_conductivity
      battery: sensor.example_sensor_battery
      linkquality: sensor.example_sensor_linkquality

irrigation:
  - name: Moestuin
    icon: mdi:water
    entities:
      valve: switch.example_watering
      remaining: sensor.example_watering_remaining
      volume: sensor.example_watering_daily_volume
      error: sensor.example_watering_valve_state
      battery: sensor.example_watering_battery
      linkquality: sensor.example_watering_linkquality
```

Full-width in a Sections dashboard:

```yaml
type: custom:garden-dashboard-card
title: Tuin
zones: []
irrigation: []
layout_options:
  grid_columns: full
  grid_rows: auto
```

See **[docs/configuration.md](docs/configuration.md)** for every option, and
**[docs/troubleshooting.md](docs/troubleshooting.md)** if something looks off.

## Documentation

- [Configuration reference](docs/configuration.md)
- [Home Assistant testing procedure](docs/home-assistant-testing.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Architecture](ARCHITECTURE.md)

## Development

```bash
npm install
npm run verify   # structure + syntax + markdown + prettier + unit tests
```

Pure helper logic (moisture status, safe parsing, domain selection, HTML
escaping, render-gating, summary) lives at the top of `garden-dashboard.js`
and is unit-tested with Node's built-in test runner.

## License

[MIT](LICENSE)
