// "Request a night slot": the resident picks their car, the battery level now and the level
// they want, and a ready-by time; the page works out the energy (with ~10% charging losses,
// as Charge does) and sends one sealed request to this site's own arbiter (/mcp, same
// origin) after the resident confirms it in the site's own dialog. After 18:00 it reads the
// signed receipt. SIMULATED housing company. The resident code is sent only to this site
// and is never stored in the browser.

import { BODY_TYPES, CARS, TYPICAL_KWH, energyFromBattery } from "./cars.js";
import { addDays, dayLabel, helsinkiMs, tonight } from "./night.js";
import { RULES } from "./rules.js";

const SENT_KEY = "koivurinne.requests";
const OTHER = "other";
const MAX_KWH = 120;

export class RequestForm {
  static page = null;

  constructor({ doc = globalThis.document, fetchImpl = (...a) => globalThis.fetch(...a), local = safeLocal(), now = () => Date.now() } = {}) {
    this.doc = doc;
    this.fetchImpl = fetchImpl;
    this.local = local;
    this.now = now;
  }

  async call(name, args) {
    const resp = await this.fetchImpl("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const body = await resp.json().catch(() => null);
    if (!body || body.error) return { ok: false, text: body?.error?.message || `The scheduler could not be reached (HTTP ${resp.status}).` };
    const text = body.result?.content?.[0]?.text ?? "";
    return { ok: !body.result?.isError, text, data: body.result?.structuredContent ?? {} };
  }

  last() {
    try {
      return JSON.parse(this.local?.getItem(SENT_KEY) || "[]")[0] ?? null;
    } catch {
      return null;
    }
  }

  /** Send the form's request. Returns the scheduler's answer. */
  async submit({ code, energyKwh, readyBy, maxPriceCents = null }) {
    const args = { resident_code: String(code).trim(), energy_kwh: Number(energyKwh), ready_by: readyBy };
    if (maxPriceCents !== null && maxPriceCents !== undefined) args.max_price_cents = maxPriceCents;
    const r = await this.call("submit_charging_request", args);
    if (r.ok) {
      const list = [{ request_id: r.data.request_id, night: r.data.night, energyKwh: Number(energyKwh), readyBy }];
      this.local?.setItem(SENT_KEY, JSON.stringify(list));
    }
    return r;
  }

  /** The signed receipt for the last request sent from this browser. */
  async receipt(code) {
    const last = this.last();
    if (!last) return { ok: false, text: "No request has been sent from this browser." };
    return this.call("get_receipt", { request_id: last.request_id, resident_code: String(code).trim() });
  }

  /** Plan a practice night now (no code, nothing stored). */
  async practice({ energyKwh, readyBy, maxPriceCents = null }) {
    const body = { energy_kwh: Number(energyKwh), ready_by: readyBy, ...(maxPriceCents === null ? {} : { max_price_cents: maxPriceCents }) };
    const resp = await this.fetchImpl("/api/practice-night", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const answer = await resp.json().catch(() => null);
    if (!resp.ok || !answer?.receipt_jws) return { ok: false, text: answer?.error || `No practice night (HTTP ${resp.status}).` };
    return { ok: true, answer };
  }

  /** Show a practice night: the receipt, every car's result, and the browser's own checks. */
  async drawPractice(answer) {
    this.drawReceipt(answer.receipt, { title: "Your practice plan (signed, marked practice)" });
    const view = this.el("practice-view");
    if (!view) return;
    const eur = (x) => `€${Number(x).toFixed(2)}`;
    this.el("practice-cars")?.replaceChildren(...answer.plans.map((p) => {
      const li = this.doc.createElement("li");
      li.textContent = `${p.label}: ${p.deliveredKwh} of ${p.requestedKwh} kWh, ${eur(p.totalEur)}`;
      return li;
    }));
    const list = this.el("practice-checks");
    const item = (ok, text) => {
      const li = this.doc.createElement("li");
      li.className = ok ? "is-ok" : "is-bad";
      li.textContent = text;
      return li;
    };
    list?.replaceChildren(item(true, "Checking…"));
    view.hidden = false;
    try {
      const { checkPracticeNight } = await import("./verify-night.js");
      const dir = await (await this.fetchImpl("/.well-known/http-message-signatures-directory")).json();
      const checks = await checkPracticeNight(answer, { keyDirectory: dir, issuer: globalThis.location?.origin ?? answer.receipt.iss });
      list?.replaceChildren(...checks.map((c) => item(c.ok, c.text)));
    } catch (error) {
      list?.replaceChildren(item(false, `Your browser could not run the checks: ${error?.message || error}.`));
    }
  }

  /** Ask this site for a one-night demo resident code (simulated). */
  async demoCode() {
    const resp = await this.fetchImpl("/api/demo-resident", { method: "POST" });
    const body = await resp.json().catch(() => null);
    if (!resp.ok || !body?.code) return { ok: false, text: body?.error || `No demo code (HTTP ${resp.status}).` };
    return {
      ok: true,
      code: body.code,
      text: `Demo code filled in: simulated resident ${body.resident}, night of ${body.night}. Keep it to read your receipt after 18:00.`,
    };
  }

  // ---- the page -----------------------------------------------------------------------

  el(id) {
    return this.doc?.getElementById(id) ?? null;
  }

  bind() {
    const form = this.el("request-form");
    if (!form) return;
    this.fillCars();
    this.el("car")?.addEventListener("change", () => this.update());
    this.el("battery-size")?.addEventListener("input", () => this.update());
    this.el("soc-now")?.addEventListener("input", () => this.update("now"));
    this.el("soc-target")?.addEventListener("input", () => this.update("target"));
    for (const radio of this.el("ready-choices")?.querySelectorAll("input") ?? []) radio.addEventListener("change", () => this.update());
    this.el("ready-other")?.addEventListener("input", () => this.update());
    this.update();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = this.values();
      if (!values.ok) return this.show({ ok: false, text: values.reason });
      if (!(await this.confirm(values))) return;
      this.show({ ok: true, text: "Sending…" });
      const r = await this.submit({ code: form.elements.code.value, energyKwh: values.energyKwh, readyBy: values.readyBy, maxPriceCents: values.maxPriceCents });
      this.show(r.ok ? { ok: true, text: `Request received for the night of ${this.nightRange(r.data.night ?? values.night)}. It is final. Read your signed receipt here after ${RULES.requests.deadline}.` } : r);
      form.elements.code.value = "";
    });
    this.el("receipt-button")?.addEventListener("click", async () => {
      const code = form.elements.code.value;
      if (!code) return this.show({ ok: false, text: "Enter your resident code above to read your receipt." });
      this.show({ ok: true, text: "Asking the scheduler…" });
      const r = await this.receipt(code);
      this.show(r);
      if (r.ok && r.data?.receipt) this.drawReceipt(r.data.receipt);
    });
    this.el("practice-button")?.addEventListener("click", async () => {
      const values = this.values();
      if (!values.ok) return this.show({ ok: false, text: values.reason });
      this.show({ ok: true, text: "Planning a practice night…" });
      const r = await this.practice(values);
      this.show(r.ok ? { ok: true, text: `Practice night of ${this.nightRange(r.answer.night)} planned with real prices and three simulated neighbours. Nothing was stored; your real request is still open.` } : r);
      if (r.ok) await this.drawPractice(r.answer);
    });
    this.el("demo-button")?.addEventListener("click", async () => {
      const out = this.el("demo-result");
      out.textContent = "Getting a demo code…";
      const r = await this.demoCode();
      out.className = r.ok ? "form-note" : "form-error";
      out.textContent = r.text;
      if (r.ok) form.elements.code.value = r.code;
    });
  }

  show(r) {
    const out = this.el("request-result");
    if (!out) return;
    out.textContent = r.text;
    out.className = r.ok ? "form-result" : "form-error";
    const view = this.el("receipt-view");
    if (view) view.hidden = true;
  }

  /** One list, grouped by body type, then "Not listed". */
  fillCars() {
    const select = this.el("car");
    if (!select || select.children?.length) return;
    const d = this.doc;
    for (const type of BODY_TYPES) {
      const group = d.createElement("optgroup");
      group.label = type.label;
      for (const car of CARS.filter((c) => c.body === type.id)) {
        const o = d.createElement("option");
        o.value = car.name;
        o.textContent = car.name;
        group.append(o);
      }
      select.append(group);
    }
    const other = d.createElement("option");
    other.value = OTHER;
    other.textContent = "Not listed: enter the battery size";
    select.append(other);
    select.value = "Skoda Enyaq 85";
  }

  batteryKwh() {
    const choice = this.el("car")?.value;
    if (choice === OTHER) return Number(this.el("battery-size")?.value);
    return CARS.find((c) => c.name === choice)?.kwh ?? TYPICAL_KWH;
  }

  readyBy() {
    const picked = [...(this.el("ready-choices")?.querySelectorAll("input") ?? [])].find((r) => r.checked);
    if (!picked || picked.value === OTHER) return this.el("ready-other")?.value || "";
    return picked.value;
  }

  /** Keep the two levels apart, redraw the battery and the energy line. */
  update(moved) {
    const now = this.el("soc-now"), target = this.el("soc-target");
    if (now && target && Number(target.value) <= Number(now.value)) {
      if (moved === "now") target.value = String(Math.min(100, Number(now.value) + 5));
      else now.value = String(Math.max(0, Number(target.value) - 5));
    }
    const other = this.el("car")?.value === OTHER;
    const sizeField = this.el("battery-size-field");
    if (sizeField) sizeField.hidden = !other;
    const otherTime = this.el("ready-other-field");
    if (otherTime) otherTime.hidden = !this.el("ready-choice-other")?.checked;
    const size = this.batteryKwh();
    this.setText("car-note", other ? "Usable size, from the car's papers or app." : `≈ ${size} kWh usable battery`);
    const from = Number(now?.value ?? 30), to = Number(target?.value ?? 80);
    this.setText("soc-now-out", `${from}%`);
    this.setText("soc-target-out", `${to}%`);
    const held = this.el("battery-held"), added = this.el("battery-added");
    if (held) held.style.width = `${from}%`;
    if (added) { added.style.left = `${from}%`; added.style.width = `${to - from}%`; }
    const v = this.values();
    this.setText("energy-out", v.ok ? `${v.batteryKwh} kWh into the battery` : v.reason);
    this.setText("energy-grid", v.ok ? `≈ ${v.energyKwh} kWh from the grid, with charging losses` : "");
    const hidden = this.el("energy-kwh");
    if (hidden) hidden.value = v.ok ? String(v.energyKwh) : "";
    return v;
  }

  setText(id, text) {
    const e = this.el(id);
    if (e) e.textContent = text;
  }

  /** The request as the arbiter takes it, or the reason it can't be sent. */
  values() {
    const e = energyFromBattery({ batteryKwh: this.batteryKwh(), fromPercent: this.el("soc-now")?.value ?? 30, toPercent: this.el("soc-target")?.value ?? 80 });
    if (!e.ok) return e;
    if (e.gridKwh > MAX_KWH) return { ok: false, reason: `That is ${e.gridKwh} kWh; one night's request can be at most ${MAX_KWH} kWh.` };
    const readyBy = this.readyBy();
    if (!/^\d{2}:\d{2}$/.test(readyBy)) return { ok: false, reason: "Pick a ready-by time." };
    const [h, m] = readyBy.split(":").map(Number);
    const inNight = (h > 22 || (h === 22 && m > 0)) || h < 7 || (h === 7 && m === 0);
    if (!inNight) return { ok: false, reason: `Ready-by must be between ${RULES.night.from} and ${RULES.night.until}.` };
    const priceText = String(this.el("max-price")?.value ?? "").trim().replace(",", ".");
    const maxPriceCents = priceText === "" ? null : Number(priceText);
    if (maxPriceCents !== null && !(Number.isFinite(maxPriceCents) && maxPriceCents >= 0 && maxPriceCents <= 100)) {
      return { ok: false, reason: "A price limit must be a number of cents per kWh between 0 and 100, or empty for none." };
    }
    return { ok: true, batteryKwh: e.batteryKwh, energyKwh: e.gridKwh, readyBy, maxPriceCents, night: tonight(this.now()).night };
  }

  nightRange(night) {
    return `${dayLabel(night)} → ${dayLabel(addDays(night, 1))}`;
  }

  /** The site's own confirmation: what will be sent, and that it is final. */
  confirm(values) {
    const dialog = this.el("request-dialog");
    if (!dialog?.showModal) return Promise.resolve(Boolean(globalThis.confirm?.(`Send this request? ${values.energyKwh} kWh, ready by ${values.readyBy}. A request is final.`)));
    this.setText("dialog-night", this.nightRange(values.night));
    this.setText("dialog-energy", `≈ ${values.energyKwh} kWh from the grid (${values.batteryKwh} kWh into the battery)`);
    this.setText("dialog-ready", values.readyBy);
    this.setText("dialog-price", values.maxPriceCents === null ? "None" : `Never above ${values.maxPriceCents} c/kWh`);
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "send"), { once: true });
      dialog.showModal();
    });
  }

  /** The resident's own quarter-hours across the night, from the signed receipt. */
  drawReceipt(receipt, { title = "Your signed plan" } = {}) {
    const view = this.el("receipt-view"), strip = this.el("receipt-strip");
    if (!view || !strip) return;
    this.setText("receipt-title", title);
    const practice = this.el("practice-view");
    if (practice && !receipt.practice) practice.hidden = true;
    const start = helsinkiMs(receipt.night, RULES.night.from);
    const mine = new Set((receipt.schedule?.slots ?? []).map((s) => Math.round((Date.parse(s.start) - start) / 900_000)));
    strip.replaceChildren(...Array.from({ length: 36 }, (_, i) => {
      const cell = this.doc.createElement("span");
      cell.className = mine.has(i) ? "rs-cell is-mine" : "rs-cell";
      return cell;
    }));
    const s = receipt.schedule;
    const cap = s.max_price_cents === undefined ? "" : ` (your limit: ${s.max_price_cents} c/kWh)`;
    this.setText("receipt-energy", `${s.delivered_kwh} of ${s.requested_kwh} kWh${s.feasible ? ", fully met" : `, short by ${s.shortfall_kwh} kWh`}${cap}`);
    this.setText("receipt-cost", `€${Number(receipt.cost?.total_eur ?? 0).toFixed(2)} incl. the charger fee`);
    this.setText("receipt-signer", new URL(receipt.iss).host);
    view.hidden = false;
  }
}

function safeLocal() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// Only in a real browser: tests run the page in Node with a stub document and no window.
if (globalThis.window && globalThis.document?.getElementById("request-form")) {
  RequestForm.page = new RequestForm();
  RequestForm.page.bind();
}
