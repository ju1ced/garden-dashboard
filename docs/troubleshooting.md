# Troubleshooting

## The card shows "Custom element doesn't exist: garden-dashboard-card"

- The resource is not loaded. Verify it under **Settings → Dashboards → ⋮ →
  Resources** points to `/hacsfiles/garden-dashboard/garden-dashboard.js`
  (HACS) or `/local/garden-dashboard.js` (manual) with `type: module`.
- Hard-refresh the browser (cache). On mobile, fully close and reopen the app.
- After an upgrade, bump the cache by reloading resources or appending
  `?v=2` to the resource URL.

## A metric or zone is missing

That is by design: rows are only rendered for entities you configured. Check
that the entity key is under the right place — soil metrics go under a zone's
`entities:`, watering metrics under an irrigation device's `entities:`.

## A value shows "Onbekend" or "Niet beschikbaar"

- **Onbekend** = the entity's state is `unknown`.
- **Niet beschikbaar** = the entity's state is `unavailable` (device offline,
  integration down, or a wrong entity ID).

Open **Developer Tools → States** and search the entity ID to see its live
state. The Diagnostics section of the card lists these too.

## The moisture status colour looks wrong

Status is driven by your thresholds:

- value `< dry_below` → **Droog** (amber)
- value `> wet_above` → **Nat** (blue)
- anything in between → **Goed** (green)

Adjust `dry_below` / `wet_above` under the zone's `moisture:` block.

## Start / Stop does nothing, or says "Niet-ondersteund domein"

The card calls the service that matches your `valve` entity's domain. If the
entity is not a `switch`, `valve`, `input_boolean` or `button`, the action is
refused rather than firing a wrong service. Confirm the domain in Developer
Tools and map the correct entity. See
[configuration.md](configuration.md#which-service-is-called).

## The Start/Stop buttons are greyed out

The `valve` entity is missing or `unavailable`. Check the mapping and the
device's connectivity.

## Confirmation dialog appears every time

That is the default safety behaviour for actions that let water flow. Set
`confirm_actions: false` on the card to disable it (recommended only on a
trusted device).

## The duration slider does not appear

A slider is only shown when `entities.duration` points to a `number.*` entity.
Many Sonoff/Zigbee valves expose duration through an irrigation-plan payload
rather than a plain `number` entity — in that case there is nothing to bind a
simple slider to, and you control duration through the device's own schedule.

## Editing a slider jumps back / feels laggy

The card intentionally skips re-rendering while you are dragging a slider and
only commits on release (`change`). If Home Assistant pushes an update mid-drag
it is deferred, not applied on top of your interaction.

## Layout is too narrow / not full width

Add `layout_options: { grid_columns: full }`. In a Sections dashboard the card
already reports full width via `getGridOptions()`.

## Reporting a problem

Include your card YAML with entity IDs redacted, a screenshot, and the browser
console output (F12 → Console). Never paste real long-lived tokens or secrets.
