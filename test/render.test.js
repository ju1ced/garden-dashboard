"use strict";

// Render-path smoke tests. Node cannot instantiate a real custom element, so
// we build an instance without running the constructor and inject a minimal
// fake shadow root. This exercises the actual _render() code path and asserts
// it never throws on missing / unknown / unavailable entities (acceptance
// criteria 9 and 10) — the class of bug the pure-helper tests cannot catch.

const test = require("node:test");
const assert = require("node:assert/strict");

const { GardenDashboardCard } = require("../garden-dashboard.js");

function makeCard() {
  const card = Object.create(GardenDashboardCard.prototype);
  card._config = null;
  card._hass = null;
  card._entityIds = [];
  card._notice = "";
  card._built = false;
  card.shadowRoot = {
    innerHTML: "",
    activeElement: null,
    querySelectorAll: () => [],
  };
  // dispatchEvent is used by more-info; render itself doesn't call it.
  card.dispatchEvent = () => true;
  return card;
}

const HASS = {
  locale: { language: "nl-BE" },
  states: {
    "sensor.ok_moisture": {
      state: "40",
      attributes: { unit_of_measurement: "%" },
      last_updated: "2026-07-29T10:00:00+02:00",
    },
    "sensor.unknown_temp": { state: "unknown", attributes: {} },
    "sensor.unavailable_batt": { state: "unavailable", attributes: {} },
    "switch.unavailable_valve": { state: "unavailable", attributes: {} },
    "sensor.dict_status": {
      state:
        "{'actual_end_time': '2026-07-28T08:51:05+02:00', 'actual_irrigation_amount': 4, 'irrigation_mode': 'duration'}",
      attributes: {},
    },
  },
};

test("render does not crash on missing / unknown / unavailable entities", () => {
  const card = makeCard();
  card.setConfig({
    title: "Tuin",
    zones: [
      // fully missing moisture entity
      { name: "Leeg", moisture: { entity: "sensor.does_not_exist" } },
      // mix of ok, unknown and unavailable metrics
      {
        name: "Gemengd",
        moisture: {
          entity: "sensor.ok_moisture",
          dry_below: 25,
          wet_above: 70,
        },
        entities: {
          temperature: "sensor.unknown_temp",
          battery: "sensor.unavailable_batt",
          conductivity: "sensor.missing_too",
        },
      },
    ],
    irrigation: [
      {
        name: "Systeem",
        entities: {
          valve: "switch.unavailable_valve",
          settings: "sensor.dict_status",
          battery: "sensor.unavailable_batt",
        },
      },
    ],
  });

  // setConfig already rendered once; render again with hass bound.
  assert.doesNotThrow(() => {
    card.hass = HASS;
  });
  assert.ok(card.shadowRoot.innerHTML.includes("garden-shell"));
  assert.ok(card.shadowRoot.innerHTML.includes("Gemengd"));
  // unavailable metric surfaces the friendly label, not a crash
  assert.ok(card.shadowRoot.innerHTML.includes("Niet beschikbaar"));
  // the dict-valued settings entity renders as a readable key/value block
  assert.ok(card.shadowRoot.innerHTML.includes("Instellingen"));
  assert.ok(card.shadowRoot.innerHTML.includes("Irrigation mode"));
});

test("render works with an empty config", () => {
  const card = makeCard();
  card.setConfig({ title: "Tuin", zones: [], irrigation: [] });
  assert.doesNotThrow(() => {
    card.hass = { locale: { language: "nl-BE" }, states: {} };
  });
  assert.ok(card.shadowRoot.innerHTML.includes("Geen zones geconfigureerd"));
});

test("setConfig rejects a non-list zones value", () => {
  const card = makeCard();
  assert.throws(() => card.setConfig({ zones: "nope" }), /zones/);
});
