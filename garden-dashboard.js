/**
 * Garden Dashboard Card
 * A self-contained Home Assistant Lovelace custom card for soil sensors and
 * automatic irrigation. No external custom cards, themes or helpers required.
 *
 * Lovelace type: custom:garden-dashboard-card
 *
 * The pure helper functions at the top of this file carry no DOM or `window`
 * dependency so they can be unit-tested directly under Node (see test/).
 */

/* ------------------------------------------------------------------ *
 * Pure helpers (no DOM / no window) — unit tested
 * ------------------------------------------------------------------ */

const UNAVAILABLE_STATES = [
  "unavailable",
  "unknown",
  "none",
  "",
  "null",
  "undefined",
];

/** Escape a value for safe interpolation into innerHTML. */
function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}

/** True when a raw HA state carries no usable value. */
function isUnavailable(state) {
  if (state === null || state === undefined) return true;
  return UNAVAILABLE_STATES.includes(String(state).trim().toLowerCase());
}

/** Parse a numeric state; returns a finite Number or null. */
function parseNumeric(state) {
  if (isUnavailable(state)) return null;
  const value = Number.parseFloat(state);
  return Number.isFinite(value) ? value : null;
}

/**
 * Classify a soil-moisture reading against configured thresholds.
 * Returns one of: dry | good | wet | unknown.
 */
function moistureStatus(value, dryBelow = 25, wetAbove = 70) {
  const numeric = parseNumeric(value);
  if (numeric === null) return { key: "unknown", label: "Onbekend" };
  if (numeric < dryBelow) return { key: "dry", label: "Droog" };
  if (numeric > wetAbove) return { key: "wet", label: "Nat" };
  return { key: "good", label: "Goed" };
}

/** True when a battery percentage sits at or below the warning threshold. */
function batteryLow(value, threshold = 20) {
  const numeric = parseNumeric(value);
  if (numeric === null) return false;
  return numeric <= threshold;
}

/** True when a Zigbee link-quality (LQI 0-255) sits at or below threshold. */
function linkLow(value, threshold = 20) {
  const numeric = parseNumeric(value);
  if (numeric === null) return false;
  return numeric <= threshold;
}

/**
 * Parse a dict/JSON-like state string into a plain flat object, or null.
 * Accepts both JSON and Python-repr style (single quotes, True/False/None),
 * e.g. `{'irrigation_mode': 'duration', 'fail_safe': 0}`.
 */
function parseObjectState(state) {
  if (isUnavailable(state)) return null;
  const text = String(state).trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return null;
  const jsonish = text
    .replace(/'/g, '"')
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null");
  try {
    const parsed = JSON.parse(jsonish);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * The domain that can be written with `<domain>.set_value` for a duration
 * control, or null when the entity is not a settable numeric entity.
 */
function durationControlDomain(entityId) {
  if (typeof entityId !== "string") return null;
  const domain = entityId.split(".")[0];
  return domain === "number" || domain === "input_number" ? domain : null;
}

/** Turn a snake_case key into a readable label ("irrigation_mode" → "Irrigation mode"). */
function humanizeKey(key) {
  const spaced = String(key).replace(/_/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : spaced;
}

/**
 * Resolve the correct service for a watering action based on the entity's
 * real domain. Returns { domain, service } or null when unsupported.
 * `action` is "start" or "stop".
 */
function actionServiceFor(entityId, action) {
  if (!entityId || typeof entityId !== "string" || !entityId.includes("."))
    return null;
  const domain = entityId.split(".")[0];
  const start = action === "start";
  switch (domain) {
    case "switch":
    case "input_boolean":
      return { domain, service: start ? "turn_on" : "turn_off" };
    case "valve":
      return { domain, service: start ? "open_valve" : "close_valve" };
    case "button":
      // A button only supports a single press; used for a start trigger.
      return start ? { domain, service: "press" } : null;
    default:
      return null;
  }
}

/** Confirmation is on by default; only an explicit `false` disables it. */
function shouldConfirm(config) {
  return config?.confirm_actions !== false;
}

/** Collect every entity id referenced by a card config (deduplicated). */
function collectEntityIds(config) {
  const ids = new Set();
  const add = (value) => {
    if (typeof value === "string" && value.includes(".")) ids.add(value);
  };
  (config?.zones || []).forEach((zone) => {
    add(zone?.moisture?.entity);
    Object.values(zone?.entities || {}).forEach(add);
  });
  (config?.irrigation || []).forEach((device) => {
    Object.values(device?.entities || {}).forEach(add);
  });
  return [...ids];
}

/**
 * True when any tracked entity changed state / relevant attribute between two
 * hass objects. Used to skip needless full re-renders (sliders, focus, dialogs).
 */
function hasRelevantChange(prevHass, nextHass, entityIds) {
  if (!prevHass || !nextHass) return true;
  const prev = prevHass.states || {};
  const next = nextHass.states || {};
  for (const id of entityIds) {
    const a = prev[id];
    const b = next[id];
    if (!a || !b) {
      if (a !== b) return true;
      continue;
    }
    if (a.state !== b.state) return true;
    if (a.last_updated !== b.last_updated) return true;
  }
  return false;
}

/**
 * Aggregate the overall garden condition from a config + hass snapshot.
 * Pure: reads only `hass.states`. Safe with missing entities.
 */
function summarizeGarden(config, hass) {
  const states = hass?.states || {};
  const zones = config?.zones || [];
  const irrigation = config?.irrigation || [];
  const batteryWarn = Number.isFinite(config?.battery_warning)
    ? config.battery_warning
    : 20;

  let dry = 0;
  let unavailable = 0;
  let lowestBattery = null;
  let lastUpdate = null;

  const trackUpdate = (obj) => {
    if (obj?.last_updated) {
      const t = Date.parse(obj.last_updated);
      if (Number.isFinite(t) && (lastUpdate === null || t > lastUpdate))
        lastUpdate = t;
    }
  };

  zones.forEach((zone) => {
    const moistureObj = states[zone?.moisture?.entity];
    trackUpdate(moistureObj);
    const status = moistureStatus(
      moistureObj?.state,
      zone?.moisture?.dry_below,
      zone?.moisture?.wet_above,
    );
    if (status.key === "dry") dry += 1;
    if (!moistureObj || isUnavailable(moistureObj.state)) unavailable += 1;

    const batteryObj = states[zone?.entities?.battery];
    const battery = parseNumeric(batteryObj?.state);
    if (
      battery !== null &&
      (lowestBattery === null || battery < lowestBattery)
    ) {
      lowestBattery = battery;
    }
  });

  irrigation.forEach((device) => {
    const batteryObj = states[device?.entities?.battery];
    trackUpdate(states[device?.entities?.valve]);
    const battery = parseNumeric(batteryObj?.state);
    if (
      battery !== null &&
      (lowestBattery === null || battery < lowestBattery)
    ) {
      lowestBattery = battery;
    }
  });

  const wateringActive = irrigation.some((device) => {
    const obj = states[device?.entities?.valve];
    if (!obj) return false;
    return ["on", "open", "opening", "running"].includes(
      String(obj.state).toLowerCase(),
    );
  });

  return {
    zoneCount: zones.length,
    irrigationCount: irrigation.length,
    dryCount: dry,
    unavailableCount: unavailable,
    wateringActive,
    lowestBattery,
    lowBattery: lowestBattery !== null && lowestBattery <= batteryWarn,
    lastUpdate,
  };
}

/* ------------------------------------------------------------------ *
 * The custom element
 * ------------------------------------------------------------------ */

// In the browser this is the real HTMLElement; under Node (unit tests) the
// class body is never instantiated, so a plain base keeps `require` working.
const CardBase = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

class GardenDashboardCard extends CardBase {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._entityIds = [];
    this._notice = "";
    this._built = false;
  }

  static getConfigElement() {
    return document.createElement("garden-dashboard-card-editor");
  }

  static getStubConfig() {
    return {
      title: "Tuin",
      subtitle: "Bodem en bewatering",
      confirm_actions: true,
      zones: [],
      irrigation: [],
    };
  }

  setConfig(config) {
    if (!config || typeof config !== "object") {
      throw new Error("garden-dashboard-card: invalid configuration.");
    }
    if (config.zones && !Array.isArray(config.zones)) {
      throw new Error("garden-dashboard-card: `zones` must be a list.");
    }
    if (config.irrigation && !Array.isArray(config.irrigation)) {
      throw new Error("garden-dashboard-card: `irrigation` must be a list.");
    }
    this._config = config;
    this._entityIds = collectEntityIds(config);
    this._render();
  }

  set hass(hass) {
    const prev = this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (this._built && prev && !hasRelevantChange(prev, hass, this._entityIds))
      return;
    if (this._isInteracting()) {
      this._pendingRender = true;
      return;
    }
    this._render();
  }

  getCardSize() {
    const zones = this._config?.zones?.length || 0;
    const irrigation = this._config?.irrigation?.length || 0;
    return 6 + Math.ceil(zones / 2) * 3 + irrigation * 2;
  }

  getGridOptions() {
    const layout = this._config?.layout_options || {};
    return {
      columns:
        layout.grid_columns === "full" || layout.grid_columns === undefined
          ? "full"
          : layout.grid_columns,
      rows: layout.grid_rows || "auto",
      min_columns: 6,
    };
  }

  /* --- small state accessors ------------------------------------- */

  _obj(entityId) {
    return entityId && this._hass ? this._hass.states[entityId] : undefined;
  }

  _isInteracting() {
    const active = this.shadowRoot?.activeElement;
    return !!active && active.tagName === "INPUT" && active.type === "range";
  }

  _localeLang() {
    return this._hass?.locale?.language || navigator.language || "nl-BE";
  }

  _formatDateTime(value) {
    if (!value) return "--";
    const date =
      typeof value === "number" ? new Date(value) : new Date(String(value));
    if (Number.isNaN(date.getTime())) return "--";
    return new Intl.DateTimeFormat(this._localeLang(), {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  /** Format a measurement with its unit, safely handling missing/unknown. */
  _measure(entityId, { fallback = "--", digits = 1, unitOverride } = {}) {
    const obj = this._obj(entityId);
    if (!obj)
      return {
        value: fallback,
        unit: "",
        available: false,
        missing: !entityId,
      };
    if (isUnavailable(obj.state)) {
      return {
        value: obj.state === "unavailable" ? "Niet beschikbaar" : "Onbekend",
        unit: "",
        available: false,
      };
    }
    const numeric = parseNumeric(obj.state);
    const unit = unitOverride ?? obj.attributes?.unit_of_measurement ?? "";
    if (numeric === null) {
      // Non-numeric text state (e.g. a schedule dict). Truncate so a long blob
      // cannot blow out the card. Escaping happens once, at the render site.
      const text = String(obj.state);
      const value = text.length > 32 ? `${text.slice(0, 32)}…` : text;
      return { value, unit, available: true };
    }
    const rounded = Math.round(numeric * 10 ** digits) / 10 ** digits;
    return { value: String(rounded), unit, available: true };
  }

  _moreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        bubbles: true,
        composed: true,
        detail: { entityId },
      }),
    );
  }

  _confirm(message) {
    if (!shouldConfirm(this._config)) return true;
    return window.confirm(message);
  }

  _notify(message) {
    this._notice = message;
    this._render();
    window.clearTimeout(this._noticeTimer);
    this._noticeTimer = window.setTimeout(() => {
      if (this._notice === message) {
        this._notice = "";
        this._render();
      }
    }, 6000);
  }

  /* --- actions --------------------------------------------------- */

  async _wateringAction(deviceIndex, action) {
    const device = this._config?.irrigation?.[deviceIndex];
    const entityId = device?.entities?.valve;
    if (!entityId) {
      this._notify("Geen valve-entity ingesteld voor dit apparaat.");
      return;
    }
    const obj = this._obj(entityId);
    if (!obj || obj.state === "unavailable") {
      this._notify(`Apparaat niet beschikbaar: ${entityId}`);
      this._moreInfo(entityId);
      return;
    }
    const call = actionServiceFor(entityId, action);
    if (!call) {
      this._notify(
        `Niet-ondersteund domein voor bewatering: ${entityId.split(".")[0]}`,
      );
      this._moreInfo(entityId);
      return;
    }
    const label =
      action === "start" ? "Bewatering starten" : "Bewatering stoppen";
    if (!this._confirm(`${label} voor ${device?.name || entityId}?`)) {
      this._notify("Actie geannuleerd.");
      return;
    }
    try {
      await this._hass.callService(call.domain, call.service, {
        entity_id: entityId,
      });
      this._notify(
        `Verzonden: ${call.domain}.${call.service} → ${device?.name || entityId}`,
      );
    } catch (error) {
      this._notify(`Fout bij actie: ${error?.message || "onbekende fout"}`);
    }
  }

  async _setDuration(deviceIndex, value) {
    const device = this._config?.irrigation?.[deviceIndex];
    const entityId = device?.entities?.duration;
    const domain = durationControlDomain(entityId);
    if (!domain) {
      this._notify(
        "Duur kan niet worden ingesteld (geen number/input_number-entity).",
      );
      return;
    }
    try {
      await this._hass.callService(domain, "set_value", {
        entity_id: entityId,
        value: Number(value),
      });
      this._notify(`Duur ingesteld: ${value}`);
    } catch (error) {
      this._notify(
        `Fout bij instellen duur: ${error?.message || "onbekende fout"}`,
      );
    }
  }

  /* --- rendering ------------------------------------------------- */

  _render() {
    if (!this.shadowRoot || !this._config) return;
    const summary = summarizeGarden(this._config, this._hass || { states: {} });

    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <ha-card class="garden-shell">
        ${this._renderHero(summary)}
        ${this._renderZones()}
        ${this._renderIrrigation()}
        ${this._renderDiagnostics(summary)}
        ${this._notice ? `<div class="notice" role="status">${escapeHtml(this._notice)}</div>` : ""}
        <footer class="footer">
          <span><ha-icon icon="mdi:sprout-outline"></ha-icon> Garden Dashboard</span>
          <span>Laatste update ${summary.lastUpdate ? escapeHtml(this._formatDateTime(summary.lastUpdate)) : "--"}</span>
        </footer>
      </ha-card>`;

    this._built = true;
    this._bindEvents();
    if (this._pendingRender && !this._isInteracting()) {
      this._pendingRender = false;
    }
  }

  _bindEvents() {
    const root = this.shadowRoot;
    root
      .querySelectorAll("[data-info]")
      .forEach((el) =>
        el.addEventListener("click", () => this._moreInfo(el.dataset.info)),
      );
    root
      .querySelectorAll("[data-water-start]")
      .forEach((el) =>
        el.addEventListener("click", () =>
          this._wateringAction(Number(el.dataset.waterStart), "start"),
        ),
      );
    root
      .querySelectorAll("[data-water-stop]")
      .forEach((el) =>
        el.addEventListener("click", () =>
          this._wateringAction(Number(el.dataset.waterStop), "stop"),
        ),
      );
    root.querySelectorAll("[data-duration]").forEach((el) =>
      el.addEventListener("change", () => {
        this._setDuration(Number(el.dataset.duration), el.value);
        if (this._pendingRender) this._render();
      }),
    );
  }

  _renderHero(summary) {
    const title = escapeHtml(this._config.title || "Tuin");
    const subtitle = escapeHtml(this._config.subtitle || "Bodem en bewatering");
    const battery =
      summary.lowestBattery === null
        ? "--"
        : `${Math.round(summary.lowestBattery)}%`;
    const condition = this._overallCondition(summary);

    return `
      <section class="hero">
        <div class="hero-glow"></div>
        <div class="hero-head">
          <div class="hero-badge condition-${condition.key}">
            <ha-icon icon="${condition.icon}"></ha-icon>
          </div>
          <div class="hero-title">
            <h1>${title}</h1>
            <p>${subtitle}</p>
            <span class="condition-text condition-${condition.key}">${condition.label}</span>
          </div>
        </div>
        <div class="hero-stats">
          ${this._stat("mdi:grid", "Zones", summary.zoneCount)}
          ${this._stat("mdi:water-alert-outline", "Droog", summary.dryCount, summary.dryCount > 0 ? "warn" : "")}
          ${this._stat("mdi:help-circle-outline", "Niet beschikbaar", summary.unavailableCount, summary.unavailableCount > 0 ? "warn" : "")}
          ${this._stat("mdi:watering-can-outline", "Bewatering", summary.wateringActive ? "Actief" : "Uit", summary.wateringActive ? "active" : "")}
          ${this._stat("mdi:battery-low", "Laagste accu", battery, summary.lowBattery ? "warn" : "")}
        </div>
      </section>`;
  }

  _overallCondition(summary) {
    if (summary.unavailableCount > 0) {
      return {
        key: "unknown",
        label: "Aandacht nodig — sensoren niet beschikbaar",
        icon: "mdi:leaf-off",
      };
    }
    if (summary.dryCount > 0) {
      return {
        key: "dry",
        label: `${summary.dryCount} zone(s) droog`,
        icon: "mdi:water-alert",
      };
    }
    if (summary.zoneCount === 0) {
      return {
        key: "unknown",
        label: "Nog geen zones geconfigureerd",
        icon: "mdi:leaf",
      };
    }
    return { key: "good", label: "Alles in orde", icon: "mdi:leaf" };
  }

  _stat(icon, label, value, extra = "") {
    return `
      <div class="stat ${extra}">
        <ha-icon icon="${icon}"></ha-icon>
        <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
      </div>`;
  }

  _renderZones() {
    const zones = this._config.zones || [];
    if (!zones.length) {
      return `<section class="empty"><ha-icon icon="mdi:flower-outline"></ha-icon><p>Geen zones geconfigureerd. Voeg <code>zones:</code> toe aan de kaartconfiguratie.</p></section>`;
    }
    return `<section class="zone-grid">${zones.map((zone, i) => this._renderZone(zone, i)).join("")}</section>`;
  }

  _renderZone(zone, index) {
    const name = escapeHtml(zone.name || `Zone ${index + 1}`);
    const icon = zone.icon || "mdi:flower";
    const moistureEntity = zone.moisture?.entity;
    const moistureObj = this._obj(moistureEntity);
    const dryBelow = zone.moisture?.dry_below ?? 25;
    const wetAbove = zone.moisture?.wet_above ?? 70;
    const status = moistureStatus(moistureObj?.state, dryBelow, wetAbove);
    const numeric = parseNumeric(moistureObj?.state);
    const pct = numeric === null ? 0 : Math.max(0, Math.min(100, numeric));
    const moistureText = !moistureEntity
      ? "Niet ingesteld"
      : isUnavailable(moistureObj?.state)
        ? moistureObj?.state === "unavailable"
          ? "Niet beschikbaar"
          : "Onbekend"
        : `${Math.round(numeric)}%`;

    const rows = [
      this._metricRow(
        zone.entities?.temperature,
        "mdi:thermometer",
        "Bodemtemp.",
      ),
      this._metricRow(
        zone.entities?.humidity,
        "mdi:water-percent",
        "Luchtvocht.",
      ),
      this._metricRow(
        zone.entities?.illuminance,
        "mdi:white-balance-sunny",
        "Licht",
      ),
      this._metricRow(
        zone.entities?.conductivity,
        "mdi:flask-outline",
        "Geleidbaarheid",
      ),
      this._metricRow(zone.entities?.battery, "mdi:battery", "Accu"),
      this._metricRow(zone.entities?.linkquality, "mdi:wifi", "Verbinding"),
    ]
      .filter(Boolean)
      .join("");

    return `
      <article class="zone-card status-${status.key}">
        <header class="zone-head" data-info="${escapeHtml(moistureEntity || "")}">
          <ha-icon icon="${escapeHtml(icon)}"></ha-icon>
          <h2>${name}</h2>
          <span class="pill status-${status.key}">${escapeHtml(status.label)}</span>
        </header>
        <div class="moisture" data-info="${escapeHtml(moistureEntity || "")}">
          <div class="moisture-top"><span>Bodemvochtigheid</span><strong>${escapeHtml(moistureText)}</strong></div>
          <div class="gauge"><span class="gauge-fill status-${status.key}" style="width:${pct}%"></span>
            <i class="gauge-mark" style="left:${Math.max(0, Math.min(100, dryBelow))}%"></i>
            <i class="gauge-mark" style="left:${Math.max(0, Math.min(100, wetAbove))}%"></i>
          </div>
          <div class="gauge-legend"><span>Droog &lt;${escapeHtml(dryBelow)}%</span><span>Nat &gt;${escapeHtml(wetAbove)}%</span></div>
        </div>
        ${rows ? `<div class="metric-list">${rows}</div>` : ""}
      </article>`;
  }

  _metricRow(entityId, icon, label) {
    if (!entityId) return "";
    const m = this._measure(entityId);
    const cls = !m.available ? "muted" : "";
    return `
      <div class="metric-row ${cls}" data-info="${escapeHtml(entityId)}">
        <ha-icon icon="${icon}"></ha-icon>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(m.value)}${m.unit ? ` ${escapeHtml(m.unit)}` : ""}</strong>
      </div>`;
  }

  _renderIrrigation() {
    const devices = this._config.irrigation || [];
    if (!devices.length) return "";
    return `
      <section class="section-title"><ha-icon icon="mdi:water-pump"></ha-icon><h2>Automatische bewatering</h2></section>
      <section class="irrigation-grid">${devices.map((d, i) => this._renderDevice(d, i)).join("")}</section>`;
  }

  _renderDevice(device, index) {
    const name = escapeHtml(device.name || `Bewatering ${index + 1}`);
    const icon = device.icon || "mdi:water";
    const e = device.entities || {};
    const valveObj = this._obj(e.valve);
    const active = valveObj
      ? ["on", "open", "opening", "running"].includes(
          String(valveObj.state).toLowerCase(),
        )
      : false;
    const unavailable = !valveObj || valveObj.state === "unavailable";
    const statusLabel = unavailable
      ? "Niet beschikbaar"
      : active
        ? "Actief"
        : "Inactief";
    const statusKey = unavailable ? "unknown" : active ? "active" : "idle";

    const errorObj = this._obj(e.error);
    const hasError =
      errorObj &&
      !isUnavailable(errorObj.state) &&
      !["normal", "ok", "off"].includes(String(errorObj.state).toLowerCase());

    const rows = [
      this._metricRow(e.remaining, "mdi:timer-sand", "Lopende duur"),
      this._metricRow(e.duration, "mdi:timer-cog-outline", "Ingestelde duur"),
      this._metricRow(e.volume, "mdi:water", "Waterverbruik"),
      this._metricRow(e.last_run, "mdi:history", "Laatste beurt"),
      this._metricRow(e.status, "mdi:calendar-clock", "Programma"),
      this._metricRow(e.battery, "mdi:battery", "Accu"),
      this._metricRow(e.linkquality, "mdi:wifi", "Verbinding"),
    ]
      .filter(Boolean)
      .join("");

    const durationObj = this._obj(e.duration);
    const durationValue = parseNumeric(durationObj?.state);
    const durationUnit = durationObj?.attributes?.unit_of_measurement || "";
    const durationControl = durationControlDomain(e.duration)
      ? `<div class="duration"><label>Duur instellen${durationValue !== null ? ` — ${durationValue}${durationUnit ? ` ${escapeHtml(durationUnit)}` : ""}` : ""}</label>
             <input type="range" data-duration="${index}"
               min="${durationObj?.attributes?.min ?? 0}"
               max="${durationObj?.attributes?.max ?? 60}"
               step="${durationObj?.attributes?.step ?? 1}"
               value="${durationValue ?? 0}"></div>`
      : "";

    const settingsBlock = this._renderSettings(e.settings, "Instellingen");

    return `
      <article class="device-card status-${statusKey}">
        <header class="device-head" data-info="${escapeHtml(e.valve || "")}">
          <ha-icon icon="${escapeHtml(icon)}"></ha-icon>
          <h3>${name}</h3>
          <span class="pill status-${statusKey}">${escapeHtml(statusLabel)}</span>
        </header>
        ${hasError ? `<div class="device-error"><ha-icon icon="mdi:alert"></ha-icon> Foutstatus: ${escapeHtml(errorObj.state)}</div>` : ""}
        ${rows ? `<div class="metric-list">${rows}</div>` : ""}
        ${settingsBlock}
        ${durationControl}
        <div class="device-actions">
          <button class="btn start" data-water-start="${index}" ${unavailable ? "disabled" : ""}>
            <ha-icon icon="mdi:play"></ha-icon><span>Start</span>
          </button>
          <button class="btn stop" data-water-stop="${index}" ${unavailable ? "disabled" : ""}>
            <ha-icon icon="mdi:stop"></ha-icon><span>Stop</span>
          </button>
        </div>
      </article>`;
  }

  /**
   * Render a dict/JSON-valued entity (e.g. "manual default settings") as a
   * readable key/value block. Falls back to the raw wrapped text when the
   * state is not object-like; renders nothing when missing/unavailable.
   */
  _renderSettings(entityId, title) {
    if (!entityId) return "";
    const obj = this._obj(entityId);
    if (!obj || isUnavailable(obj.state)) return "";
    const info = `data-info="${escapeHtml(entityId)}"`;
    const parsed = parseObjectState(obj.state);
    if (!parsed) {
      return `<div class="settings" ${info}><div class="settings-title">${escapeHtml(title)}</div><div class="settings-raw">${escapeHtml(obj.state)}</div></div>`;
    }
    const rows = Object.entries(parsed)
      .map(
        ([key, value]) =>
          `<div class="settings-row"><span>${escapeHtml(humanizeKey(key))}</span><strong>${escapeHtml(value)}</strong></div>`,
      )
      .join("");
    return `<div class="settings" ${info}><div class="settings-title">${escapeHtml(title)}</div>${rows}</div>`;
  }

  _renderDiagnostics(summary) {
    const items = [];
    const zones = this._config.zones || [];
    const devices = this._config.irrigation || [];
    const batteryWarn = Number.isFinite(this._config.battery_warning)
      ? this._config.battery_warning
      : 20;
    const linkWarn = Number.isFinite(this._config.linkquality_warning)
      ? this._config.linkquality_warning
      : 20;

    const checkEntity = (entityId, label) => {
      if (!entityId) return;
      const obj = this._obj(entityId);
      if (!obj) {
        items.push({
          level: "warn",
          icon: "mdi:link-off",
          text: `${label}: entity ontbreekt (${entityId})`,
        });
      } else if (obj.state === "unavailable") {
        items.push({
          level: "warn",
          icon: "mdi:cloud-off-outline",
          text: `${label}: niet beschikbaar`,
        });
      }
    };

    zones.forEach((zone) => {
      const z = zone.name || "Zone";
      if (!zone.moisture?.entity) {
        items.push({
          level: "warn",
          icon: "mdi:water-off-outline",
          text: `${z}: geen bodemvocht-sensor ingesteld`,
        });
      }
      checkEntity(zone.moisture?.entity, `${z} bodemvocht`);
      const bat = parseNumeric(this._obj(zone.entities?.battery)?.state);
      if (bat !== null && bat <= batteryWarn) {
        items.push({
          level: "warn",
          icon: "mdi:battery-alert",
          text: `${z}: lage accu (${Math.round(bat)}%)`,
        });
      }
      const lqi = parseNumeric(this._obj(zone.entities?.linkquality)?.state);
      if (lqi !== null && lqi <= linkWarn) {
        items.push({
          level: "warn",
          icon: "mdi:wifi-strength-1-alert",
          text: `${z}: zwakke verbinding (${Math.round(lqi)})`,
        });
      }
    });

    devices.forEach((device) => {
      const d = device.name || "Bewatering";
      const valveObj = this._obj(device.entities?.valve);
      if (!device.entities?.valve) {
        items.push({
          level: "warn",
          icon: "mdi:valve",
          text: `${d}: geen valve-entity ingesteld`,
        });
      } else if (!valveObj || valveObj.state === "unavailable") {
        items.push({
          level: "warn",
          icon: "mdi:cloud-off-outline",
          text: `${d}: apparaat offline`,
        });
      }
      const bat = parseNumeric(this._obj(device.entities?.battery)?.state);
      if (bat !== null && bat <= batteryWarn) {
        items.push({
          level: "warn",
          icon: "mdi:battery-alert",
          text: `${d}: lage accu (${Math.round(bat)}%)`,
        });
      }
      const errObj = this._obj(device.entities?.error);
      if (
        errObj &&
        !isUnavailable(errObj.state) &&
        !["normal", "ok", "off"].includes(String(errObj.state).toLowerCase())
      ) {
        items.push({
          level: "warn",
          icon: "mdi:alert",
          text: `${d}: foutstatus ${errObj.state}`,
        });
      }
    });

    const body = items.length
      ? items
          .map(
            (item) =>
              `<div class="diag-row ${item.level}"><ha-icon icon="${item.icon}"></ha-icon><span>${escapeHtml(item.text)}</span></div>`,
          )
          .join("")
      : `<div class="diag-row ok"><ha-icon icon="mdi:check-circle-outline"></ha-icon><span>Geen problemen gevonden.</span></div>`;

    return `
      <section class="section-title"><ha-icon icon="mdi:stethoscope"></ha-icon><h2>Diagnostiek</h2></section>
      <section class="diagnostics">${body}</section>`;
  }

  _styles() {
    return `
      :host {
        display:block;
        --g-bg:var(--card-background-color, #12211a);
        --g-panel:color-mix(in srgb, var(--g-bg) 92%, #000 8%);
        --g-elevated:color-mix(in srgb, var(--g-bg) 86%, var(--g-accent) 5%);
        --g-line:var(--divider-color, #2a4034);
        --g-text:var(--primary-text-color, #eef4ef);
        --g-muted:var(--secondary-text-color, #9db4a6);
        --g-accent:var(--garden-accent-color, #2e9e5b);
        --g-accent-deep:#1f7a45;
        --g-dry:var(--warning-color, #e9a23b);
        --g-wet:var(--info-color, #3d9bd6);
        --g-good:var(--success-color, #34c26a);
        --g-warn:var(--error-color, #e05a4d);
        font-family:var(--primary-font-family, Inter, system-ui, sans-serif);
      }
      ha-card.garden-shell {
        border:1px solid var(--g-line);
        border-radius:16px;
        background:linear-gradient(160deg, color-mix(in srgb,var(--g-accent) 10%, var(--g-bg)) 0%, var(--g-bg) 42%);
        color:var(--g-text);
        padding:clamp(12px, 1.6vw, 22px);
        display:flex; flex-direction:column; gap:16px;
        overflow:hidden;
      }
      h1,h2,h3,p { margin:0; }
      button { font:inherit; color:inherit; cursor:pointer; }
      ha-icon { --mdc-icon-size:22px; }

      /* Hero */
      .hero { position:relative; border-radius:14px; padding:clamp(16px,2vw,26px);
        background:linear-gradient(135deg, var(--g-accent-deep), var(--g-accent));
        color:#fff; overflow:hidden; }
      .hero-glow { position:absolute; inset:auto -60px -80px auto; width:240px; height:240px; border-radius:50%;
        background:radial-gradient(circle, rgba(255,255,255,.25), transparent 70%); pointer-events:none; }
      .hero-head { display:flex; align-items:center; gap:16px; position:relative; z-index:1; }
      .hero-badge { width:56px; height:56px; border-radius:16px; display:grid; place-items:center;
        background:rgba(255,255,255,.16); border:1px solid rgba(255,255,255,.28); }
      .hero-badge ha-icon { --mdc-icon-size:34px; color:#fff; }
      .hero-title h1 { font-size:clamp(20px,2vw,28px); line-height:1.1; }
      .hero-title p { opacity:.86; font-size:14px; margin-top:2px; }
      .condition-text { display:inline-block; margin-top:6px; font-size:13px; font-weight:700;
        padding:3px 10px; border-radius:999px; background:rgba(255,255,255,.18); }
      .hero-stats { position:relative; z-index:1; margin-top:16px; display:grid;
        grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:10px; }
      .stat { display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:12px;
        background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.16); }
      .stat ha-icon { color:#fff; }
      .stat span { display:block; font-size:12px; opacity:.85; }
      .stat strong { display:block; font-size:16px; line-height:1.2; }
      .stat.warn { background:color-mix(in srgb, var(--g-warn) 55%, transparent); }
      .stat.active { background:color-mix(in srgb, #ffffff 24%, transparent); }

      /* Zones */
      .zone-grid, .irrigation-grid { display:grid; gap:12px;
        grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); }
      .zone-card, .device-card { border:1px solid var(--g-line); border-radius:14px; padding:14px;
        background:linear-gradient(150deg, var(--g-elevated), var(--g-panel)); display:flex; flex-direction:column; gap:12px; }
      .zone-head, .device-head { display:flex; align-items:center; gap:10px; cursor:pointer; }
      .zone-head ha-icon, .device-head ha-icon { color:var(--g-accent); --mdc-icon-size:24px; }
      .zone-head h2, .device-head h3 { flex:1; font-size:17px; }
      .pill { font-size:12px; font-weight:700; padding:3px 10px; border-radius:999px;
        background:color-mix(in srgb, var(--g-good) 22%, transparent); color:var(--g-good); }
      .pill.status-dry { background:color-mix(in srgb, var(--g-dry) 22%, transparent); color:var(--g-dry); }
      .pill.status-wet { background:color-mix(in srgb, var(--g-wet) 22%, transparent); color:var(--g-wet); }
      .pill.status-unknown { background:color-mix(in srgb, var(--g-muted) 28%, transparent); color:var(--g-muted); }
      .pill.status-active { background:color-mix(in srgb, var(--g-wet) 26%, transparent); color:var(--g-wet); }
      .pill.status-idle { background:color-mix(in srgb, var(--g-muted) 22%, transparent); color:var(--g-muted); }

      .moisture { cursor:pointer; display:flex; flex-direction:column; gap:6px; }
      .moisture-top { display:flex; justify-content:space-between; align-items:baseline; }
      .moisture-top span { font-size:13px; color:var(--g-muted); }
      .moisture-top strong { font-size:22px; }
      .gauge { position:relative; height:12px; border-radius:8px; background:color-mix(in srgb, var(--g-bg) 60%, #000 12%);
        border:1px solid var(--g-line); overflow:hidden; }
      .gauge-fill { position:absolute; left:0; top:0; height:100%; border-radius:8px; transition:width .35s ease;
        background:var(--g-good); }
      .gauge-fill.status-dry { background:var(--g-dry); }
      .gauge-fill.status-wet { background:var(--g-wet); }
      .gauge-fill.status-unknown { background:var(--g-muted); }
      .gauge-mark { position:absolute; top:-2px; width:2px; height:16px; background:rgba(255,255,255,.5); }
      .gauge-legend { display:flex; justify-content:space-between; font-size:11px; color:var(--g-muted); }

      .metric-list { display:flex; flex-direction:column; gap:2px; }
      .metric-row { display:grid; grid-template-columns:24px 1fr auto; align-items:center; gap:10px;
        padding:6px 4px; border-top:1px solid color-mix(in srgb, var(--g-line) 60%, transparent); cursor:pointer; }
      .metric-row:first-child { border-top:0; }
      .metric-row ha-icon { color:var(--g-muted); --mdc-icon-size:20px; }
      .metric-row span { font-size:13px; color:var(--g-muted); }
      .metric-row strong { font-size:14px; }
      .metric-row.muted strong { color:var(--g-muted); font-weight:500; }

      .section-title { display:flex; align-items:center; gap:10px; margin-top:4px; }
      .section-title ha-icon { color:var(--g-accent); }
      .section-title h2 { font-size:16px; text-transform:uppercase; letter-spacing:.05em; color:var(--g-muted); }

      /* Irrigation */
      .device-error { display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:10px;
        background:color-mix(in srgb, var(--g-warn) 18%, transparent); color:var(--g-warn); font-size:13px; font-weight:600; }
      .device-error ha-icon { color:var(--g-warn); }
      .settings { border:1px solid var(--g-line); border-radius:10px; padding:8px 10px;
        background:color-mix(in srgb, var(--g-bg) 55%, transparent); cursor:pointer; }
      .settings-title { font-size:12px; text-transform:uppercase; letter-spacing:.04em;
        color:var(--g-muted); margin-bottom:4px; }
      .settings-row { display:flex; justify-content:space-between; gap:12px; padding:3px 0;
        font-size:13px; border-top:1px solid color-mix(in srgb, var(--g-line) 55%, transparent); }
      .settings-row:first-of-type { border-top:0; }
      .settings-row span { color:var(--g-muted); }
      .settings-raw { font-size:12px; color:var(--g-muted); word-break:break-word; line-height:1.4; }
      .duration { display:flex; flex-direction:column; gap:4px; }
      .duration label { font-size:12px; color:var(--g-muted); }
      .duration input { width:100%; accent-color:var(--g-accent); }
      .device-actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      .btn { display:flex; align-items:center; justify-content:center; gap:6px; min-height:40px;
        border-radius:10px; border:1px solid var(--g-line); background:var(--g-elevated); font-weight:700; font-size:14px; }
      .btn ha-icon { --mdc-icon-size:20px; }
      .btn.start { background:color-mix(in srgb, var(--g-good) 20%, var(--g-panel)); color:var(--g-good); }
      .btn.stop { background:color-mix(in srgb, var(--g-warn) 16%, var(--g-panel)); color:var(--g-warn); }
      .btn:disabled { opacity:.45; cursor:not-allowed; }

      /* Diagnostics */
      .diagnostics { display:flex; flex-direction:column; gap:6px; border:1px solid var(--g-line);
        border-radius:12px; padding:10px; background:var(--g-panel); }
      .diag-row { display:flex; align-items:center; gap:10px; font-size:13px; }
      .diag-row ha-icon { --mdc-icon-size:20px; }
      .diag-row.ok ha-icon { color:var(--g-good); }
      .diag-row.warn ha-icon { color:var(--g-dry); }

      .empty { display:flex; flex-direction:column; align-items:center; gap:8px; padding:24px; text-align:center;
        color:var(--g-muted); border:1px dashed var(--g-line); border-radius:14px; }
      .empty ha-icon { --mdc-icon-size:40px; color:var(--g-accent); }
      .empty code { background:var(--g-panel); padding:2px 6px; border-radius:6px; }

      .notice { padding:10px 14px; border-radius:10px; font-size:13px;
        background:color-mix(in srgb, var(--g-accent) 16%, var(--g-panel)); border:1px solid var(--g-line); }
      .footer { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;
        font-size:12px; color:var(--g-muted); padding-top:4px; }
      .footer span { display:flex; align-items:center; gap:6px; }

      @media (max-width:500px) {
        .hero-stats { grid-template-columns:repeat(2, 1fr); }
        .device-actions { grid-template-columns:1fr; }
        .zone-grid, .irrigation-grid { grid-template-columns:1fr; }
      }
    `;
  }
}

/* ------------------------------------------------------------------ *
 * Minimal visual editor (optional; full config is YAML)
 * ------------------------------------------------------------------ */

class GardenDashboardCardEditor extends CardBase {
  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
  }

  _emit(patch) {
    this._config = { ...this._config, ...patch };
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        bubbles: true,
        composed: true,
        detail: { config: this._config },
      }),
    );
  }

  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const c = this._config || {};
    this.shadowRoot.innerHTML = `
      <style>
        .ed { display:flex; flex-direction:column; gap:12px; padding:8px 4px; font-family:inherit; }
        label { display:flex; flex-direction:column; gap:4px; font-size:13px; color:var(--secondary-text-color,#888); }
        input[type=text] { padding:8px 10px; border-radius:8px; border:1px solid var(--divider-color,#ccc);
          background:var(--card-background-color,#fff); color:var(--primary-text-color,#222); }
        .row { display:flex; align-items:center; gap:8px; font-size:14px; color:var(--primary-text-color,#222); }
        .hint { font-size:12px; color:var(--secondary-text-color,#888); line-height:1.4; }
        code { background:var(--secondary-background-color,#eee); padding:1px 5px; border-radius:5px; }
      </style>
      <div class="ed">
        <label>Titel
          <input type="text" id="title" value="${escapeHtml(c.title || "")}" placeholder="Tuin">
        </label>
        <label>Subtitel
          <input type="text" id="subtitle" value="${escapeHtml(c.subtitle || "")}" placeholder="Bodem en bewatering">
        </label>
        <div class="row">
          <input type="checkbox" id="confirm" ${c.confirm_actions !== false ? "checked" : ""}>
          <span>Bevestiging vragen voor wateracties</span>
        </div>
        <p class="hint">Zones en bewatering worden geconfigureerd via YAML. Zie de documentatie
          (<code>docs/configuration.md</code>) voor alle opties, of gebruik de code-editor.</p>
      </div>`;

    this.shadowRoot
      .getElementById("title")
      .addEventListener("input", (e) => this._emit({ title: e.target.value }));
    this.shadowRoot
      .getElementById("subtitle")
      .addEventListener("input", (e) =>
        this._emit({ subtitle: e.target.value }),
      );
    this.shadowRoot
      .getElementById("confirm")
      .addEventListener("change", (e) =>
        this._emit({ confirm_actions: e.target.checked }),
      );
  }
}

/* ------------------------------------------------------------------ *
 * Registration (guarded against double definition)
 * ------------------------------------------------------------------ */

if (typeof customElements !== "undefined") {
  if (!customElements.get("garden-dashboard-card")) {
    customElements.define("garden-dashboard-card", GardenDashboardCard);
  }
  if (!customElements.get("garden-dashboard-card-editor")) {
    customElements.define(
      "garden-dashboard-card-editor",
      GardenDashboardCardEditor,
    );
  }
}

if (typeof window !== "undefined") {
  window.customCards = window.customCards || [];
  if (
    !window.customCards.some((card) => card.type === "garden-dashboard-card")
  ) {
    window.customCards.push({
      type: "garden-dashboard-card",
      name: "Garden Dashboard Card",
      description:
        "Bodemsensoren en automatische bewatering in één overzichtelijke tuinkaart.",
      preview: false,
      documentationURL: "https://github.com/ju1ced/garden-dashboard",
    });
  }
}

/* Export pure helpers for Node-based unit tests. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    GardenDashboardCard,
    escapeHtml,
    isUnavailable,
    parseNumeric,
    moistureStatus,
    batteryLow,
    linkLow,
    actionServiceFor,
    durationControlDomain,
    parseObjectState,
    humanizeKey,
    shouldConfirm,
    collectEntityIds,
    hasRelevantChange,
    summarizeGarden,
  };
}
