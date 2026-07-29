"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  escapeHtml,
  isUnavailable,
  parseNumeric,
  moistureStatus,
  batteryLow,
  linkLow,
  actionServiceFor,
  parseObjectState,
  humanizeKey,
  shouldConfirm,
  collectEntityIds,
  hasRelevantChange,
  summarizeGarden,
} = require("../garden-dashboard.js");

test("moistureStatus below dry threshold -> dry", () => {
  assert.equal(moistureStatus(15, 25, 70).key, "dry");
});

test("moistureStatus between thresholds -> good", () => {
  assert.equal(moistureStatus(45, 25, 70).key, "good");
});

test("moistureStatus above wet threshold -> wet", () => {
  assert.equal(moistureStatus(85, 25, 70).key, "wet");
});

test("moistureStatus uses default thresholds", () => {
  assert.equal(moistureStatus(10).key, "dry");
  assert.equal(moistureStatus(50).key, "good");
  assert.equal(moistureStatus(90).key, "wet");
});

test("moistureStatus unknown / unavailable / invalid -> unknown", () => {
  assert.equal(moistureStatus("unknown").key, "unknown");
  assert.equal(moistureStatus("unavailable").key, "unknown");
  assert.equal(moistureStatus("not-a-number").key, "unknown");
  assert.equal(moistureStatus(undefined).key, "unknown");
  assert.equal(moistureStatus(null).key, "unknown");
});

test("boundary values are inclusive of good band", () => {
  // exactly at dry_below is NOT dry (only strictly below)
  assert.equal(moistureStatus(25, 25, 70).key, "good");
  // exactly at wet_above is NOT wet (only strictly above)
  assert.equal(moistureStatus(70, 25, 70).key, "good");
});

test("isUnavailable detects the empty states", () => {
  ["unavailable", "unknown", "none", "", null, undefined].forEach((s) =>
    assert.equal(isUnavailable(s), true, `expected ${s} unavailable`),
  );
  assert.equal(isUnavailable("42"), false);
  assert.equal(isUnavailable("on"), false);
});

test("parseNumeric handles invalid numeric values", () => {
  assert.equal(parseNumeric("54"), 54);
  assert.equal(parseNumeric("35.2"), 35.2);
  assert.equal(parseNumeric("abc"), null);
  assert.equal(parseNumeric("unavailable"), null);
  assert.equal(parseNumeric(""), null);
});

test("batteryLow triggers a warning at or below threshold", () => {
  assert.equal(batteryLow(15, 20), true);
  assert.equal(batteryLow(20, 20), true);
  assert.equal(batteryLow(56, 20), false);
  assert.equal(batteryLow("unknown", 20), false);
  assert.equal(batteryLow(10), true); // default threshold 20
});

test("linkLow warns on weak LQI", () => {
  assert.equal(linkLow(5, 20), true);
  assert.equal(linkLow(200, 20), false);
});

test("actionServiceFor picks the domain-correct service", () => {
  assert.deepEqual(actionServiceFor("switch.valve", "start"), {
    domain: "switch",
    service: "turn_on",
  });
  assert.deepEqual(actionServiceFor("switch.valve", "stop"), {
    domain: "switch",
    service: "turn_off",
  });
  assert.deepEqual(actionServiceFor("valve.garden", "start"), {
    domain: "valve",
    service: "open_valve",
  });
  assert.deepEqual(actionServiceFor("valve.garden", "stop"), {
    domain: "valve",
    service: "close_valve",
  });
  assert.deepEqual(actionServiceFor("input_boolean.x", "start"), {
    domain: "input_boolean",
    service: "turn_on",
  });
  assert.deepEqual(actionServiceFor("button.x", "start"), {
    domain: "button",
    service: "press",
  });
});

test("actionServiceFor rejects unsupported / missing entities", () => {
  assert.equal(actionServiceFor("sensor.temperature", "start"), null);
  assert.equal(actionServiceFor("button.x", "stop"), null);
  assert.equal(actionServiceFor(undefined, "start"), null);
  assert.equal(actionServiceFor("notanentity", "start"), null);
});

test("parseObjectState parses Python-repr and JSON dict states", () => {
  const py =
    "{'fail_safe': 0, 'irrigation_amount_unit': 'liter', 'irrigation_mode': 'duration_with_interval', 'irrigation_total_duration': 2}";
  assert.deepEqual(parseObjectState(py), {
    fail_safe: 0,
    irrigation_amount_unit: "liter",
    irrigation_mode: "duration_with_interval",
    irrigation_total_duration: 2,
  });
  assert.deepEqual(parseObjectState('{"a": 1, "b": true, "c": null}'), {
    a: 1,
    b: true,
    c: null,
  });
});

test("parseObjectState returns null for non-object / unusable states", () => {
  assert.equal(parseObjectState("5"), null);
  assert.equal(parseObjectState("normal"), null);
  assert.equal(parseObjectState("unavailable"), null);
  assert.equal(parseObjectState(""), null);
  assert.equal(parseObjectState("[1, 2, 3]"), null);
  assert.equal(parseObjectState("{not valid"), null);
});

test("humanizeKey formats snake_case labels", () => {
  assert.equal(humanizeKey("irrigation_mode"), "Irrigation mode");
  assert.equal(humanizeKey("fail_safe"), "Fail safe");
  assert.equal(humanizeKey(""), "");
});

test("shouldConfirm defaults to true, disabled only by explicit false", () => {
  assert.equal(shouldConfirm({}), true);
  assert.equal(shouldConfirm({ confirm_actions: true }), true);
  assert.equal(shouldConfirm({ confirm_actions: false }), false);
  assert.equal(shouldConfirm(undefined), true);
});

test("escapeHtml neutralises HTML injection", () => {
  assert.equal(
    escapeHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
  );
  assert.equal(escapeHtml("a & b"), "a &amp; b");
  assert.equal(escapeHtml("it's"), "it&#39;s");
  assert.equal(escapeHtml(null), "");
});

test("collectEntityIds gathers zone and irrigation entities", () => {
  const config = {
    zones: [
      {
        moisture: { entity: "sensor.m" },
        entities: { battery: "sensor.b", temperature: "sensor.t" },
      },
    ],
    irrigation: [{ entities: { valve: "switch.v", battery: "sensor.wb" } }],
  };
  const ids = collectEntityIds(config);
  assert.deepEqual(
    ids.sort(),
    ["sensor.b", "sensor.m", "sensor.t", "sensor.wb", "switch.v"].sort(),
  );
});

test("hasRelevantChange skips renders when tracked entities are unchanged", () => {
  const prev = { states: { "sensor.m": { state: "40", last_updated: "t1" } } };
  const same = { states: { "sensor.m": { state: "40", last_updated: "t1" } } };
  const changed = {
    states: { "sensor.m": { state: "41", last_updated: "t2" } },
  };
  assert.equal(hasRelevantChange(prev, same, ["sensor.m"]), false);
  assert.equal(hasRelevantChange(prev, changed, ["sensor.m"]), true);
  // an untracked entity changing does not force a render
  const other = {
    states: {
      "sensor.m": { state: "40", last_updated: "t1" },
      "sensor.x": { state: "9" },
    },
  };
  assert.equal(hasRelevantChange(prev, other, ["sensor.m"]), false);
});

test("summarizeGarden aggregates the overall condition", () => {
  const config = {
    battery_warning: 20,
    zones: [
      {
        name: "A",
        moisture: { entity: "sensor.a", dry_below: 25, wet_above: 70 },
        entities: { battery: "sensor.ab" },
      },
      {
        name: "B",
        moisture: { entity: "sensor.b", dry_below: 25, wet_above: 70 },
        entities: { battery: "sensor.bb" },
      },
      { name: "C", moisture: { entity: "sensor.c" }, entities: {} },
    ],
    irrigation: [
      { name: "V", entities: { valve: "switch.v", battery: "sensor.vb" } },
    ],
  };
  const hass = {
    states: {
      "sensor.a": { state: "10", last_updated: "2026-07-29T10:00:00+02:00" }, // dry
      "sensor.b": { state: "50" }, // good
      "sensor.c": { state: "unavailable" }, // unavailable
      "sensor.ab": { state: "15" }, // low battery
      "sensor.bb": { state: "80" },
      "switch.v": { state: "on" }, // watering active
      "sensor.vb": { state: "100" },
    },
  };
  const s = summarizeGarden(config, hass);
  assert.equal(s.zoneCount, 3);
  assert.equal(s.dryCount, 1);
  assert.equal(s.unavailableCount, 1);
  assert.equal(s.wateringActive, true);
  assert.equal(s.lowestBattery, 15);
  assert.equal(s.lowBattery, true);
});

test("summarizeGarden is safe with missing entities and empty config", () => {
  const s = summarizeGarden(
    { zones: [{ moisture: { entity: "sensor.missing" } }] },
    { states: {} },
  );
  assert.equal(s.zoneCount, 1);
  assert.equal(s.unavailableCount, 1);
  assert.equal(s.lowestBattery, null);
  const empty = summarizeGarden({}, { states: {} });
  assert.equal(empty.zoneCount, 0);
  assert.equal(empty.wateringActive, false);
});
