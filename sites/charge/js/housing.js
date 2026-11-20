// The "shared chargers" box: night-slot requests to As Oy Koivurinne (a SIMULATED housing
// company) through this site's server, which signs each call (/api/arbiter, RFC 9421).
//
// The resident code stays on this page: it lives in sessionStorage (gone when the tab
// closes), is sent only to this site's server, and never appears in anything the
// assistant reads. The assistant supplies energy and ready-by time only; the browser asks
// the visitor to confirm before anything is sent.

import { addDays, fromHelsinkiLocal, helsinkiClock, longLabel, weekdayLabel } from "./time.js";

const CODE_KEY = "charge.housing.code";
// The resident's price limit (c/kWh incl. VAT) is their mandate: like the code it lives only
// on this page, the assistant never sees or sets it, and the arbiter enforces it.
const PRICE_KEY = "charge.housing.maxPrice";
const PRICE_RANGE = { min: 0, max: 100 };
const SENT_KEY = "charge.housing.requests";
const MAX_KW = 11; // the housing company's chargers

export class Housing {
  /** The single page object, created at startup. */
  static page = null;

  constructor({ doc = globalThis.document, fetchImpl = (...a) => globalThis.fetch(...a), session = safe("sessionStorage"), local = safe("localStorage"), now = () => Date.now() } = {}) {
    this.doc = doc;
    this.fetchImpl = fetchImpl;
    this.session = session;
    this.local = local;
    this.now = now;
  }

  // ---- resident code (page only) ---------------------------------------------

  hasCode() {
    return Boolean(this.code());
  }

  code() {
    try {
      return this.session?.getItem(CODE_KEY) || "";
    } catch {
      return "";
    }
  }

  /** The resident's price limit in c/kWh, or null for none. */
  maxPrice() {
    try {
      const v = this.session?.getItem(PRICE_KEY);
      return v === null || v === undefined || v === "" ? null : Number(v);
    } catch {
      return null;
    }
  }

  /**
   * Save the resident code and an optional price limit for this tab.
   *
   * :param code: The resident code.
   * :param maxPrice: Optional c/kWh limit (string or number); empty means none.
   */
  saveCode(code, maxPrice = "") {
    const clean = String(code ?? "").trim();
    if (clean.length < 6) return { ok: false, reason: "Enter the resident code the board gave you." };
    const text = String(maxPrice ?? "").trim().replace(",", ".");
    const price = text === "" ? null : Number(text);
    if (price !== null && !(Number.isFinite(price) && price >= PRICE_RANGE.min && price <= PRICE_RANGE.max)) {
      return { ok: false, reason: `A price limit must be a number of cents per kWh between ${PRICE_RANGE.min} and ${PRICE_RANGE.max}, or empty for none.` };
    }
    this.session?.setItem(CODE_KEY, clean);
    if (price === null) this.session?.removeItem(PRICE_KEY);
    else this.session?.setItem(PRICE_KEY, String(price));
    this.render();
    return { ok: true };
  }

  forgetCode() {
    this.session?.removeItem(CODE_KEY);
    this.session?.removeItem(PRICE_KEY);
    this.render();
  }

  sent() {
    try {
      return JSON.parse(this.local?.getItem(SENT_KEY) || "[]");
    } catch {
      return [];
    }
  }

  remember(entry) {
    const list = [entry, ...this.sent().filter((e) => e.request_id !== entry.request_id)].slice(0, 10);
    this.local?.setItem(SENT_KEY, JSON.stringify(list));
  }

  // ---- calls through this site's server ----------------------------------------

  /**
   * The model this page's assistant runs on, set by site.js at startup: the site's default
   * model, or the one in the visitor's own AI settings. The housing company checks that this
   * network was tested on it (trust is network × model).
   */
  static modelSource = () => null;

  async call(tool, args) {
    let model = null;
    try {
      model = (await Housing.modelSource()) || null;
    } catch {
      model = null;
    }
    const resp = await this.fetchImpl("/api/arbiter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool, arguments: args, ...(model ? { model } : {}) }),
    });
    const body = await resp.json().catch(() => null);
    if (!body || body.error) return { ok: false, reason: body?.error?.message || `The housing company could not be reached (HTTP ${resp.status}).` };
    const r = body.result;
    const text = r?.content?.[0]?.text ?? "";
    if (r?.isError) return { ok: false, reason: text };
    return { ok: true, text, data: r?.structuredContent ?? {} };
  }

  /**
   * Check a night-slot request without sending it, and work out what would be sent. The
   * confirmation dialog (site.js) and sendNightRequest use this same check.
   *
   * :param input: {energyKwh, readyBy: "YYYY-MM-DDTHH:MM" Finnish time, chargerKw (optional)}.
   * :return: {ok: true, args, night, nightLabel, readyByLabel, energyKwh, chargerKw} or
   *   {ok: false, reason, field}. args includes the resident code: never show it.
   */
  prepareNightRequest({ energyKwh, readyBy, chargerKw } = {}) {
    if (!this.hasCode()) return { ok: false, reason: "Enter your resident code in the page's Shared chargers box first. Never type it in the chat.", field: "residentCode" };
    const ms = fromHelsinkiLocal(String(readyBy ?? ""));
    if (ms === null) return { ok: false, reason: "Write the ready-by time as YYYY-MM-DDTHH:MM in Finnish time.", field: "readyBy" };
    const [date, clock] = readyBy.split("T");
    // A night is named by the evening it starts: 22:15-23:59 that evening, 00:00-07:00 the next morning.
    const night = Number(clock.slice(0, 2)) >= 12 ? date : addDays(date, -1);
    const args = { resident_code: this.code(), energy_kwh: Number(energyKwh), ready_by: clock, night };
    const kw = chargerKw === undefined ? MAX_KW : Math.min(Number(chargerKw), MAX_KW);
    if (chargerKw !== undefined) args.charger_kw = kw;
    // The price limit comes from the page, never from the assistant's arguments.
    const maxPriceCents = this.maxPrice();
    if (maxPriceCents !== null) args.max_price_cents = maxPriceCents;
    const nightStart = fromHelsinkiLocal(`${night}T22:15`);
    return {
      ok: true,
      args,
      night,
      maxPriceCents,
      nightLabel: `${weekdayLabel(nightStart)} → ${weekdayLabel(fromHelsinkiLocal(`${addDays(night, 1)}T07:00`))}`,
      readyByLabel: longLabel(ms),
      energyKwh: Number(energyKwh),
      chargerKw: kw,
    };
  }

  /**
   * Send one night-slot request (final, one per night).
   *
   * :param args: {energyKwh, readyBy: "YYYY-MM-DDTHH:MM" Finnish time, chargerKw (optional)}.
   * :return: {ok: true, summary, request_id, night, energyKwh, readyBy} or {ok: false, reason}.
   */
  async sendNightRequest(input) {
    const prepared = this.prepareNightRequest(input);
    if (!prepared.ok) return prepared;
    const { energyKwh, readyBy } = input;
    const r = await this.call("submit_charging_request", prepared.args);
    if (!r.ok) return r;
    this.remember({ request_id: r.data.request_id, night: r.data.night, energyKwh: Number(energyKwh), readyBy, sentAt: this.now() });
    this.render();
    return { ok: true, summary: r.text, request_id: r.data.request_id, night: r.data.night, energyKwh: Number(energyKwh), readyBy };
  }

  /**
   * The signed plan and cost for the latest request, once the night is planned (after 18:00).
   *
   * :return: {ok: true, status: "pending"|"scheduled", summary, ...} or {ok: false, reason}.
   */
  async latestReceipt() {
    const last = this.sent()[0];
    if (!last) return { ok: false, reason: "No night-slot request has been sent from this browser." };
    if (!this.hasCode()) return { ok: false, reason: "Enter your resident code in the page's Shared chargers box to read your receipt.", field: "residentCode" };
    const r = await this.call("get_receipt", { request_id: last.request_id, resident_code: this.code() });
    if (!r.ok) return r;
    const d = r.data;
    const out = { ok: true, status: d.status, night: d.night, summary: r.text };
    if (d.status === "scheduled") {
      const rc = d.receipt;
      Object.assign(out, {
        deliveredKwh: rc.schedule.delivered_kwh,
        requestedKwh: rc.schedule.requested_kwh,
        totalEur: rc.cost.total_eur,
        signedBy: rc.iss,
        windows: rc.schedule.slots.length ? `${clockOf(rc.schedule.slots[0].start)}-${clockOf(rc.schedule.slots.at(-1).end)}` : null,
      });
    }
    this.render();
    return out;
  }

  // ---- page ---------------------------------------------------------------------

  bind() {
    const d = this.doc;
    d?.getElementById("housing-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = d.getElementById("resident-code");
      const price = d.getElementById("max-price");
      const r = this.saveCode(input?.value, price?.value);
      if (r.ok && input) input.value = "";
      this.status(r.ok ? "Saved for this tab. The assistant never sees either. Next: ask the assistant to send tonight's request, for example “send my request: 30 kWh by 7”." : r.reason);
    });
    d?.getElementById("housing-forget")?.addEventListener("click", () => {
      this.forgetCode();
      this.status("Forgotten.");
    });
    d?.getElementById("housing-receipt")?.addEventListener("click", async () => {
      this.status("Asking the housing company…");
      const r = await this.latestReceipt();
      this.status(r.ok ? r.summary : r.reason);
    });
    this.render();
  }

  status(text) {
    const el = this.doc?.getElementById("housing-status");
    if (el) el.textContent = text;
  }

  render() {
    const d = this.doc;
    if (!d) return;
    const has = this.hasCode();
    const codeState = d.getElementById("housing-code-state");
    const cap = this.maxPrice();
    if (codeState) codeState.textContent = has ? `Resident code saved for this tab${cap === null ? ", no price limit" : `, price limit ${cap} c/kWh`}.` : "No resident code saved.";
    const forget = d.getElementById("housing-forget");
    if (forget) forget.hidden = !has;
    const list = d.getElementById("housing-requests");
    if (list) {
      const sent = this.sent();
      list.replaceChildren(...sent.map((e) => {
        const li = d.createElement("li");
        li.textContent = `Night of ${e.night}: ${e.energyKwh} kWh by ${e.readyBy.slice(11)}, request ${e.request_id.slice(0, 12)}…`;
        return li;
      }));
      const receipt = d.getElementById("housing-receipt");
      if (receipt) receipt.hidden = sent.length === 0;
    }
  }
}

function clockOf(iso) {
  return helsinkiClock(Date.parse(iso));
}

function safe(name) {
  try {
    return globalThis[name] ?? null;
  } catch {
    return null;
  }
}

// Start in a browser; tests construct Housing themselves.
if (globalThis.document?.getElementById("housing-form")) {
  Housing.page = new Housing();
  Housing.page.bind();
}
