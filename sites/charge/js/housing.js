// The "shared chargers" box: night-slot requests to As Oy Koivurinne (a SIMULATED housing
// company) through this site's server, which signs each call (/api/arbiter, RFC 9421).
//
// The resident code stays on this page: it lives in sessionStorage (gone when the tab
// closes), is sent only to this site's server, and never appears in anything the
// assistant reads. The assistant supplies energy and ready-by time only; the browser asks
// the visitor to confirm before anything is sent.

import { addDays, fromHelsinkiLocal, helsinkiClock } from "./time.js";

const CODE_KEY = "charge.housing.code";
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

  saveCode(code) {
    const clean = String(code ?? "").trim();
    if (clean.length < 6) return { ok: false, reason: "Enter the resident code the board gave you." };
    this.session?.setItem(CODE_KEY, clean);
    this.render();
    return { ok: true };
  }

  forgetCode() {
    this.session?.removeItem(CODE_KEY);
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

  async call(tool, args) {
    const resp = await this.fetchImpl("/api/arbiter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool, arguments: args }),
    });
    const body = await resp.json().catch(() => null);
    if (!body || body.error) return { ok: false, reason: body?.error?.message || `The housing company could not be reached (HTTP ${resp.status}).` };
    const r = body.result;
    const text = r?.content?.[0]?.text ?? "";
    if (r?.isError) return { ok: false, reason: text };
    return { ok: true, text, data: r?.structuredContent ?? {} };
  }

  /**
   * Send one night-slot request (final, one per night).
   *
   * :param args: {energyKwh, readyBy: "YYYY-MM-DDTHH:MM" Finnish time, chargerKw (optional)}.
   * :return: {ok: true, summary, request_id, night, energyKwh, readyBy} or {ok: false, reason}.
   */
  async sendNightRequest({ energyKwh, readyBy, chargerKw }) {
    if (!this.hasCode()) return { ok: false, reason: "Enter your resident code in the page's Shared chargers box first. Never type it in the chat.", field: "residentCode" };
    const ms = fromHelsinkiLocal(readyBy);
    if (ms === null) return { ok: false, reason: "Write the ready-by time as YYYY-MM-DDTHH:MM in Finnish time.", field: "readyBy" };
    const [date, clock] = readyBy.split("T");
    // A night is named by the evening it starts: 22:15-23:59 that evening, 00:00-07:00 the next morning.
    const night = Number(clock.slice(0, 2)) >= 12 ? date : addDays(date, -1);
    const args = { resident_code: this.code(), energy_kwh: Number(energyKwh), ready_by: clock, night };
    if (chargerKw !== undefined) args.charger_kw = Math.min(Number(chargerKw), MAX_KW);
    const r = await this.call("submit_charging_request", args);
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
      const r = this.saveCode(input?.value);
      if (input) input.value = "";
      this.status(r.ok ? "Saved for this tab. The assistant never sees it." : r.reason);
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
    if (codeState) codeState.textContent = has ? "Resident code saved for this tab." : "No resident code saved.";
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
