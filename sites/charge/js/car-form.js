// The driver's half of the plan form: car, battery level, ready-by time, charger. It only
// fills the page's existing energy, charger and ready-by fields, so the planner, the
// assistant's tools and the network stay exactly as they are (kWh, kW, local time).

import { BODY_TYPES, CARS, TYPICAL_KWH, energyFromBattery } from "./cars.js";
import { fromHelsinkiLocal, helsinkiClock, toHelsinkiLocal, weekdayLabel } from "./time.js";

const STEP_MS = 15 * 60_000;

export class CarForm {
  /**
   * :param doc: The page document.
   * :param onDraft: Called with {energyKwh, chargerKw, readyBy} whenever the form changes,
   *   so the top of the page can preview tonight's plan as the driver types.
   * :param range: Returns {minMs, maxMs, nowMs} for the ready-by slider (prices known).
   */
  constructor(doc, onDraft = () => {}, range = () => null) {
    this.doc = doc;
    this.onDraft = onDraft;
    this.range = range;
    this.manual = false; // true once the driver types the energy themselves
  }

  el(id) {
    return this.doc.getElementById(id);
  }

  bind() {
    this.fillModels();
    this.el("car-model")?.addEventListener("change", () => this.fromModel());
    this.el("battery-adjust")?.addEventListener("click", () => {
      this.el("battery-size").hidden = false;
      this.el("battery").focus();
    });
    this.el("battery")?.addEventListener("input", () => this.fromBattery());
    this.el("soc-now")?.addEventListener("input", () => this.fromLevels("now"));
    this.el("soc-target")?.addEventListener("input", () => this.fromLevels("target"));
    this.el("ready-slider")?.addEventListener("input", () => this.fromReadySlider());
    for (const radio of this.el("charger-tiles")?.querySelectorAll("input") ?? []) {
      radio.addEventListener("change", () => this.fromChargerTile(radio.value));
    }
    this.el("charger-other-toggle")?.addEventListener("click", () => {
      for (const radio of this.el("charger-tiles").querySelectorAll("input")) radio.checked = false;
      this.el("charger-other").hidden = false;
      this.el("charger").focus();
    });
    this.el("charger")?.addEventListener("input", () => this.draft());
    this.el("energy")?.addEventListener("input", () => {
      this.manual = true;
      this.describe();
      this.draft();
    });
    this.setupReadySlider();
    this.drawBattery();
    this.fromBattery();
  }

  // ---- car ---------------------------------------------------------------------------

  /** One list, grouped by body type, then "Not listed". */
  fillModels() {
    const select = this.el("car-model");
    if (!select) return;
    const option = (value, text) => {
      const o = this.doc.createElement("option");
      o.value = value;
      o.textContent = text;
      return o;
    };
    const items = [option("", "Choose your car")];
    for (const type of BODY_TYPES) {
      const cars = CARS.filter((c) => c.body === type.id);
      if (!cars.length) continue;
      const group = this.doc.createElement("optgroup");
      group.label = type.label;
      group.append(...cars.map((c) => option(c.name, `${c.name} · ${c.kwh} kWh`)));
      items.push(group);
    }
    items.push(option("other", "Not listed: enter the battery size"));
    select.replaceChildren(...items);
  }

  fromModel() {
    const value = this.el("car-model").value;
    const car = CARS.find((c) => c.name === value);
    const sil = this.el("car-silhouette");
    const use = this.el("car-silhouette-use");
    const text = this.el("car-battery-text");
    if (car) {
      this.el("battery").value = String(car.kwh);
      this.el("battery-size").hidden = true;
      use?.setAttribute("href", `#body-${car.body}`);
      if (sil) sil.dataset.body = car.body;
      if (text) text.textContent = `≈ ${car.kwh} kWh battery`;
      // The silhouette drives in once per change of car (skipped for reduced motion).
      if (!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        sil?.animate?.([{ opacity: 0, transform: "translateX(-14px)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: "cubic-bezier(.16, 1, .3, 1)" });
      }
    } else {
      use?.setAttribute("href", "#body-sedan");
      if (sil) sil.dataset.body = "";
      this.el("battery-size").hidden = value !== "other";
      if (text) text.textContent = value === "other" ? "Enter your battery size" : `≈ ${this.el("battery").value} kWh battery, a typical size`;
      if (value === "other") this.el("battery").focus();
    }
    this.fromBattery();
  }

  // ---- battery level -------------------------------------------------------------------

  /** Keep "now" below "charge to": the handle being dragged pushes the other one. */
  fromLevels(moved) {
    const now = this.el("soc-now"), target = this.el("soc-target");
    let a = Number(now.value), b = Number(target.value);
    if (a >= b) {
      if (moved === "now") b = Math.min(100, a + 1);
      else a = Math.max(0, b - 1);
      if (a >= b) a = b - 1;
      now.value = String(a);
      target.value = String(b);
    }
    this.drawBattery();
    this.fromBattery();
  }

  drawBattery() {
    const a = Number(this.el("soc-now")?.value ?? 0), b = Number(this.el("soc-target")?.value ?? 0);
    const nowFill = this.el("battery-now-fill"), addFill = this.el("battery-add-fill");
    if (nowFill?.style) nowFill.style.width = `${a}%`;
    if (addFill?.style) { addFill.style.left = `${a}%`; addFill.style.width = `${Math.max(0, b - a)}%`; }
    const value = this.el("battery-value");
    if (value) value.textContent = `${a}% → ${b}%`;
    this.el("soc-now")?.setAttribute("aria-valuetext", `Battery now ${a}%`);
    this.el("soc-target")?.setAttribute("aria-valuetext", `Charge to ${b}%`);
  }

  /** Battery size and charge levels → the energy field, unless typed by hand. */
  fromBattery() {
    this.manual = false;
    const r = this.energy();
    if (r.ok) this.el("energy").value = String(r.gridKwh);
    if (!this.el("car-model")?.value) {
      const text = this.el("car-battery-text");
      if (text) text.textContent = `≈ ${this.el("battery").value} kWh battery, a typical size`;
    }
    this.describe();
    this.draft();
  }

  energy() {
    return energyFromBattery({
      batteryKwh: this.el("battery")?.value || TYPICAL_KWH,
      fromPercent: this.el("soc-now")?.value,
      toPercent: this.el("soc-target")?.value,
    });
  }

  // ---- ready by --------------------------------------------------------------------------

  /** The slider counts 15-minute steps from the first sensible time to the last price. */
  setupReadySlider() {
    const slider = this.el("ready-slider");
    const r = this.range();
    if (!slider || !r) return;
    this.minMs = r.minMs;
    slider.max = String(Math.max(1, Math.floor((r.maxMs - r.minMs) / STEP_MS)));
    const label = (ms) => `${weekdayLabel(ms).split(" ")[0]} ${helsinkiClock(ms)}`;
    this.el("ready-min").textContent = label(r.minMs);
    this.el("ready-max").textContent = label(r.minMs + Number(slider.max) * STEP_MS);
    this.syncReadySlider();
  }

  syncReadySlider() {
    const slider = this.el("ready-slider");
    const ms = fromHelsinkiLocal(this.el("ready-by")?.value || "");
    if (!slider || this.minMs === undefined || ms === null) return;
    slider.value = String(Math.round((ms - this.minMs) / STEP_MS));
    this.describeReady(ms);
  }

  fromReadySlider() {
    const ms = this.minMs + Number(this.el("ready-slider").value) * STEP_MS;
    this.el("ready-by").value = toHelsinkiLocal(ms);
    this.describeReady(ms);
    this.draft();
  }

  describeReady(ms) {
    const r = this.range();
    const mins = r ? Math.round((ms - r.nowMs) / 60_000) : null;
    const away = mins === null ? "" : ` · in ${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ""}`;
    const text = `${weekdayLabel(ms).split(" ")[0]} ${helsinkiClock(ms)}${away}`;
    this.el("ready-value").textContent = text;
    this.el("ready-slider")?.setAttribute("aria-valuetext", text);
  }

  // ---- charger -------------------------------------------------------------------------

  fromChargerTile(kw) {
    this.el("charger").value = kw;
    this.el("charger-other").hidden = true;
    this.draft();
  }

  // ---- shared --------------------------------------------------------------------------

  /** The line under the fields: what the driver's choices mean in kWh. */
  describe() {
    const line = this.el("energy-line");
    if (!line) return;
    const typed = Number(this.el("energy").value);
    const r = this.energy();
    if (this.manual || !r.ok || r.gridKwh !== typed) {
      line.textContent = r.ok || this.manual ? `Planning for ${typed} kWh from the grid, as entered below.` : r.reason;
      if (r.ok && !this.manual && r.gridKwh !== typed) this.el("energy-exact").open = true;
      return;
    }
    // Each "≈ N kWh" stays on one line.
    const figure = (text) => { const b = this.doc.createElement("span"); b.className = "nowrap"; b.textContent = text; return b; };
    line.replaceChildren("Adds ", figure(`≈ ${r.batteryKwh} kWh`), " to the battery: ", figure(`≈ ${r.gridKwh} kWh`), " from the grid, including about 10% charging losses.");
  }

  draft() {
    this.onDraft({
      energyKwh: Number(this.el("energy").value),
      chargerKw: Number(this.el("charger").value),
      readyBy: this.el("ready-by").value,
    });
  }

  /** After the page sets the fields itself (the assistant's show_plan): match the controls. */
  sync() {
    const kw = this.el("charger")?.value;
    let matched = false;
    for (const radio of this.el("charger-tiles")?.querySelectorAll("input") ?? []) {
      radio.checked = radio.value === kw;
      matched ||= radio.checked;
    }
    const other = this.el("charger-other");
    if (other) other.hidden = matched;
    this.syncReadySlider();
    this.describe();
  }
}
