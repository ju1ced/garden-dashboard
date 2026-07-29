# Architecture

## Overview

Garden Dashboard Card is a single, dependency-free JavaScript module that
defines a Home Assistant Lovelace custom element. It follows the same
technical shape as the Kia Connect dashboard card (a standalone module, Shadow
DOM, `ha-card` shell, theme variables with fallbacks) but is otherwise its own
implementation with a garden-specific data model and a dark-green identity.

```text
garden-dashboard.js
├── Pure helpers (no DOM / no window)      ← unit-tested in test/
│   ├── escapeHtml / isUnavailable / parseNumeric
│   ├── moistureStatus / batteryLow / linkLow
│   ├── actionServiceFor / shouldConfirm
│   ├── collectEntityIds / hasRelevantChange
│   └── summarizeGarden
├── GardenDashboardCard (custom element)
│   ├── setConfig / set hass / getCardSize / getGridOptions
│   ├── render pipeline (hero → zones → irrigation → diagnostics)
│   └── actions (watering start/stop, set duration)
├── GardenDashboardCardEditor (minimal visual editor)
└── Registration (guarded define + window.customCards)
```

## Why a single module

The card must be usable without Mushroom, card-mod, layout-card,
decluttering-card or any other custom card, and installable as a HACS Lovelace
plugin that ships one JS file. A single ES module with Shadow DOM is the
simplest thing that satisfies all of that, matches the reference project, and
keeps the review surface small. No build step or framework is used.

## Data model

Configuration is entirely list-driven — no entity IDs are hard-coded. Two
repeatable lists carry the domain data:

- `zones[]` — one soil-sensor panel each. `moisture` is the primary value with
  its own thresholds; every other measurement lives under `entities` and is
  optional.
- `irrigation[]` — one watering device each. `entities.valve` drives the live
  state and the Start/Stop controls; all status/telemetry entities are
  optional.

This mirrors the real hardware discovered during design: Zigbee2MQTT soil
sensors (moisture, fertility/conductivity, temperature, humidity, illuminance,
battery, link quality) and a Sonoff Zigbee water valve exposed as a `switch`
with irrigation telemetry sensors. Because every non-primary entity is
optional, a zone with only a moisture sensor renders correctly and nothing
crashes when an entity is absent.

## Rendering and update gating

`set hass` fires on every Home Assistant state push (potentially many times per
second). Rebuilding the entire Shadow DOM on every push — as a naive port of
the reference card would — breaks sliders, focus, open more-info dialogs and
wastes work. The card therefore gates rendering:

1. `hasRelevantChange(prevHass, nextHass, entityIds)` (pure, tested) compares
   only the configured entities' `state` and `last_updated`. If nothing
   relevant changed, the render is skipped entirely.
2. While a range slider inside the card holds focus, rendering is deferred so a
   background update cannot clobber an in-progress drag. Sliders commit on
   `change` (release), not `input`.

`setConfig` always performs the initial build.

## Actions and safety

- The correct service is chosen from the `valve` entity's **real domain**
  (`switch` / `valve` / `input_boolean` / `button`) via `actionServiceFor`.
  Unsupported domains are refused rather than firing a guessed service.
- Any action that lets water flow is confirmed by default (`confirm_actions`,
  on unless explicitly `false`). `shouldConfirm` is a pure function so the
  behaviour is unit-tested without invoking `window.confirm`.
- Every action reports back through an in-card notice: sent, cancelled, missing
  entity, unsupported domain, service error or unavailable device. Internal
  errors are surfaced as short messages — never raw stack traces.

## Safe value handling

- All interpolated text passes through `escapeHtml`.
- `isUnavailable` treats `unavailable`, `unknown`, `none`, empty and
  null/undefined as "no value"; `parseNumeric` returns `null` for anything
  non-finite. UI code renders `Niet beschikbaar` / `Onbekend` / hides rows
  accordingly.
- Units come from each entity's `unit_of_measurement` attribute.
- Dates/times are formatted with `Intl.DateTimeFormat` using the Home
  Assistant locale, falling back to the browser locale.

## Sections dashboard support

`getGridOptions()` returns `columns: "full"` by default (overridable via
`layout_options.grid_columns`) so the card can span a full-width Sections
dashboard. `getCardSize()` scales with the number of zones and devices.

## Testing and CI

Pure helpers are exported under Node via a `module.exports` guard and covered
by `node --test` in `test/helpers.test.js`. A base-class shim
(`typeof HTMLElement !== "undefined" ? HTMLElement : class {}`) lets the module
`require` cleanly in Node without a browser shim. CI (GitHub Actions) runs
structure validation, `node --check`, markdownlint, Prettier `--check` and the
unit tests. Tests never perform real Home Assistant service calls.

## Privacy

No real entity IDs appear anywhere in the repository — the card is fully
generic and public docs/examples use fictional IDs only. Real mappings live in
a local, gitignored `*.local.*` file used solely for on-device testing.
