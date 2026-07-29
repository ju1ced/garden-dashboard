# Project instructions — garden-dashboard

Project-specific working notes for this repository. These take precedence over
the general `/projects/ai-projects/CLAUDE.md` and the project brief when they
conflict.

## What this is

A HACS-installable Home Assistant Lovelace custom card (`garden-dashboard.js`,
element `custom:garden-dashboard-card`) showing soil sensors and automatic
irrigation on one page. Single dependency-free ES module, Shadow DOM,
dark-green identity. Technical shape is inspired by
`/projects/ha-kia-connect-dashboard` — a reference, not a base to copy.

## Hard rules

- **Never commit real entity IDs or secrets.** Public files (JS, README, docs,
  tests, examples, defaults) use fictional IDs only. Real mappings live only in
  gitignored `*.local.*` files. Before declaring done, grep the trackable files
  for your real device/entity name fragments and Zigbee IEEE prefixes (the ones
  in your `*.local.yaml`) and confirm zero hits.
- **No commit / push / branch / PR without the user's explicit permission.**
- Do not modify the Kia repo or the central files
  (`/projects/ai-projects/CLAUDE.md`, `/projects/ai-projects/prompts/…`).
- Never fire Home Assistant service calls from tests or during development that
  could start/stop real watering. MCP inventory is read-only.
- Keep pure logic (status, parsing, domain selection, escaping, render-gating,
  summary) free of DOM/`window` so it stays unit-testable under Node.

## Local checks

```bash
npm install
npm run verify   # structure + syntax + markdownlint + prettier + tests
```

## Design decisions

- Config is list-driven (`zones[]`, `irrigation[]`); no hard-coded entities.
- Watering service is chosen from the `valve` entity's real domain
  (`switch`/`valve`/`input_boolean`/`button`); unsupported domains are refused.
- `set hass` gates rendering via `hasRelevantChange` and defers while a slider
  is focused, to protect sliders/focus/dialogs.
- Discovered hardware (via HA MCP): four Zigbee2MQTT soil sensors and one
  Sonoff Zigbee water valve exposed as a `switch` (no plain `number` duration
  entity — the duration slider is therefore optional and degrades silently).

## Change log

- Initial implementation: card, minimal editor, tests, HACS files, docs, CI.
