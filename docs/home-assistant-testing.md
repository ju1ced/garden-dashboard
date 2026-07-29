# Home Assistant testing procedure

This is a manual smoke test to run the card against a real Home Assistant
instance after installing or upgrading it. It deliberately avoids starting or
stopping real irrigation unless you explicitly choose to.

## 1. Prepare a local, private mapping

Create a **local, gitignored** config file mapping the card to your real
entities. Any file ending in `.local.yaml` is ignored by git (see
`.gitignore`), so your real entity IDs never leave your machine.

Suggested location: `home-assistant.local.yaml` in the repo root, or straight
into the dashboard's YAML if you edit dashboards as YAML.

```yaml
# home-assistant.local.yaml — LOCAL ONLY, never commit.
type: custom:garden-dashboard-card
title: Tuin
subtitle: Bodem en bewatering
confirm_actions: true
zones:
  - name: <your zone>
    icon: mdi:sprout
    moisture:
      entity: sensor.<your_soil_moisture>
      dry_below: 30
      wet_above: 75
    entities:
      temperature: sensor.<your_soil_temperature>
      conductivity: sensor.<your_soil_conductivity>
      battery: sensor.<your_sensor_battery>
      linkquality: sensor.<your_sensor_linkquality>
irrigation:
  - name: <your device>
    icon: mdi:water
    entities:
      valve: switch.<your_watering>
      remaining: sensor.<your_watering_remaining>
      volume: sensor.<your_watering_daily_volume>
      error: sensor.<your_watering_valve_state>
      battery: sensor.<your_watering_battery>
```

## 2. Install the resource

Use the HACS or manual install from the [README](../README.md). Confirm the
resource is registered under **Settings → Dashboards → ⋮ → Resources**.

## 3. Add the card

Edit any dashboard view → **Add card → Manual** → paste your local config →
**Save**. Hard-refresh the browser.

## 4. What to verify

### Rendering

- [ ] Hero shows title, subtitle, zone count, dry count, unavailable count,
      watering state, lowest battery and last update.
- [ ] Each zone shows a moisture gauge with the correct **Droog / Goed / Nat**
      status and colour for its current value.
- [ ] Optional metrics (temperature, humidity, illuminance, conductivity,
      battery, link quality) appear only when configured, with the correct
      units.
- [ ] A zone configured with **only** a moisture entity still renders cleanly.

### Safe states

- [ ] Temporarily point a metric at a non-existent entity → the row is hidden
      / the moisture gauge reads `Onbekend`, and the card does not crash.
- [ ] An `unavailable` device shows `Niet beschikbaar` and its Start/Stop
      buttons are disabled.

### Interaction

- [ ] Click a zone header or a metric row → the Home Assistant **more-info**
      dialog opens for that entity.
- [ ] With `confirm_actions: true`, pressing **Start** shows a confirm dialog;
      cancelling it shows "Actie geannuleerd" and calls no service.
- [ ] **Only if you want to physically test watering:** confirm a **Start**,
      verify water runs, then press **Stop**. Skip this if you do not want to
      run water.
- [ ] If a `number.*` duration entity is configured, dragging the slider and
      releasing sets the value (watch the entity in Developer Tools).

### Diagnostics

- [ ] The diagnostics section lists missing mappings, unavailable entities,
      low batteries, weak link quality and fault states in plain language.

### Responsiveness

- [ ] Resize from a wide desktop down to ~360 px width — no horizontal
      scrolling; the layout collapses to a single column on narrow phones.
- [ ] In a Sections dashboard, the card spans the full width.

## 5. Cross-check services (read-only)

In **Developer Tools → States**, confirm your `valve` entity's domain matches
what you expect (`switch`, `valve`, `input_boolean` or `button`). The card
calls the service for that domain — see the table in
[configuration.md](configuration.md#which-service-is-called).
