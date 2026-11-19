// Page script for the charging planner. One page object (App.page) owns the state;
// the page's own form and the assistant's site actions both call its methods.

import { LIMITS, planCharging, round } from "./planner.js";
import { PRICE_SOURCE, loadPrices } from "./prices.js";
import { fromHelsinkiLocal, helsinkiClock, helsinkiDate, longLabel, toHelsinkiLocal, weekdayLabel, addDays } from "./time.js";
import { renderChart, renderSky, renderStrip } from "./chart.js";
import { CarForm } from "./car-form.js";

const euro = (x) => `€${x.toFixed(2)}`;
const cents = (x) => `${x.toFixed(2)} c/kWh`;

export class App {
  /** The single page object, created at startup. */
  static page = null;

  constructor({ doc = globalThis.document, now = () => Date.now(), pricesLoader = loadPrices } = {}) {
    this.doc = doc;
    this.now = now;
    this.pricesLoader = pricesLoader;
    this.prices = null;
    this.plan = null;
    this.planInput = null;
    this.form = { energyKwh: 30, chargerKw: 11, readyBy: "" };
  }

  /** Load prices and draw the page. Safe to call again to refresh. */
  async start() {
    this.prices = await this.pricesLoader({ nowMs: this.now() });
    if (!this.form.readyBy) this.form.readyBy = defaultReadyBy(this.now());
    this.render();
    return this.getState();
  }

  /**
   * Everything the page shows, as plain JSON (copies, not live objects).
   *
   * :return: Today, price availability and summaries, hourly prices from now on,
   *     the form values, the latest plan shown on the page, and the page's limits.
   */
  getState() {
    const nowMs = this.now();
    const today = helsinkiDate(nowMs);
    const p = this.prices;
    return {
      now: { local: toHelsinkiLocal(nowMs), label: longLabel(nowMs), timeZone: "Europe/Helsinki" },
      today: { date: today, label: weekdayLabel(nowMs) },
      tomorrow: { date: addDays(today, 1), label: weekdayLabel(nowMs + 24 * 3600_000) },
      prices: p ? {
        unit: "c/kWh including 25.5% VAT; energy only, without grid transfer fees or the seller's margin",
        resolutionMinutes: 15,
        today: daySummary(p.today),
        tomorrow: p.tomorrow.available
          ? daySummary(p.tomorrow)
          : { date: p.tomorrow.date, available: false, note: "Tomorrow's prices are published around 14:00 Finnish time." },
        hourlyFromNow: hourly(p.slots, nowMs),
        source: { name: PRICE_SOURCE.name, url: PRICE_SOURCE.url },
      } : { available: false, note: "Prices are still loading." },
      form: { ...this.form },
      shownPlan: this.plan ? formatPlan(this.plan, this.planInput) : null,
      limits: {
        energyKwh: { ...LIMITS.energyKwh },
        chargerKw: { ...LIMITS.chargerKw },
        readyBy: "Must be after now and within the days whose prices are published.",
      },
      // Partner sites the page links to, read from the page's own links.
      partners: [{
        name: "As Oy Koivurinne (a simulated housing company with shared chargers)",
        url: this.doc?.getElementById("housing-link")?.getAttribute("href") || "https://taloyhtio.frankmp12357.workers.dev/",
      }],
    };
  }

  /**
   * Work out a plan without changing the page.
   *
   * :param args: {energyKwh, chargerKw, readyBy} with readyBy as "YYYY-MM-DDTHH:MM" Finnish time.
   * :return: {ok: true, plan} with readable times and amounts, or {ok: false, reason, field}.
   */
  previewPlan({ energyKwh, chargerKw, readyBy }) {
    if (!this.prices) return { ok: false, reason: "Prices have not loaded yet. Try again in a moment.", field: "prices" };
    const readyByMs = fromHelsinkiLocal(readyBy);
    if (readyByMs === null) {
      return { ok: false, reason: "Write the ready-by time as YYYY-MM-DDTHH:MM in Finnish time, for example 2026-11-18T07:00.", field: "readyBy" };
    }
    const result = planCharging({
      energyKwh: Number(energyKwh),
      chargerKw: Number(chargerKw),
      fromMs: this.now(),
      readyByMs,
      prices: this.prices.slots,
    });
    if (!result.ok) return result;
    return { ok: true, plan: formatPlan(result.plan, { energyKwh: Number(energyKwh), chargerKw: Number(chargerKw), readyBy, readyByMs }) };
  }

  /**
   * Plan and show the result on the page (fills the form, the result card and the chart).
   *
   * :param args: Same as previewPlan.
   * :return: The same result as previewPlan. A refusal changes nothing.
   */
  showPlan({ energyKwh, chargerKw, readyBy }) {
    const result = this.previewPlan({ energyKwh, chargerKw, readyBy });
    if (!result.ok) return result;
    this.form = { energyKwh: Number(energyKwh), chargerKw: Number(chargerKw), readyBy };
    const readyByMs = fromHelsinkiLocal(readyBy);
    this.planInput = { energyKwh: Number(energyKwh), chargerKw: Number(chargerKw), readyBy, readyByMs };
    this.plan = planCharging({ ...this.planInput, fromMs: this.now(), prices: this.prices.slots }).plan;
    this.clearFormError();
    this.render();
    return result;
  }

  // ---- rendering ---------------------------------------------------------

  render() {
    const d = this.doc;
    if (!d) return;
    const state = this.getState();
    const set = (id, text) => { const el = d.getElementById(id); if (el) el.textContent = text; };

    set("now-label", state.now.label);
    const t = state.prices.today;
    set("today-summary", t?.available
      ? `Today: ${cents(t.min.price)} at ${t.min.time} (lowest), ${cents(t.max.price)} at ${t.max.time} (highest), average ${cents(t.average)}.`
      : "Today's prices are not available right now.");
    const tm = state.prices.tomorrow;
    set("tomorrow-summary", tm?.available
      ? `Tomorrow: lowest ${cents(tm.min.price)} at ${tm.min.time}, highest ${cents(tm.max.price)} at ${tm.max.time}, average ${cents(tm.average)}.`
      : "Tomorrow's prices are published around 14:00 Finnish time.");

    const setValue = (id, v) => { const el = d.getElementById(id); if (el) el.value = String(v); };
    setValue("energy", this.form.energyKwh);
    setValue("charger", this.form.chargerKw);
    setValue("ready-by", this.form.readyBy);

    const result = d.getElementById("plan-result");
    if (result) {
      result.hidden = !this.plan;
      if (this.plan) {
        const p = formatPlan(this.plan, this.planInput);
        set("plan-echo", `${p.energyKwh} kWh at ${p.chargerKw} kW${p.readyBy ? `, ready by ${p.readyBy.label}` : ""} (Finnish time)`);
        set("plan-now", p.chargeNowCost);
        set("plan-savings", p.savings);
        const flat = d.getElementById("plan-flat");
        if (flat) flat.hidden = !(this.plan.savingsEur < 0.5);
        const list = d.getElementById("plan-windows");
        if (list) {
          list.replaceChildren(...p.windows.map((w) => {
            const li = d.createElement("li");
            li.textContent = `${w.when}: ${w.kwh} kWh at ${w.averagePrice}`;
            return li;
          }));
        }
      }
    }
    this.drawCharts();
    this.carForm?.sync();
  }

  /**
   * The driver is still filling in the form: preview tonight at the top of the page with
   * these values. Only until a plan is shown; never the "shown plan" the assistant reads.
   *
   * :param draft: {energyKwh, chargerKw, readyBy} as the form holds them now.
   */
  /** The ready-by slider's range: {nowMs, minMs, maxMs} in epoch ms. */
  readyRange() {
    // The earliest sensible ready-by is an hour from the next quarter-hour; the latest is
    // the end of the last published price.
    const nowMs = this.now();
    const q = 15 * 60_000;
    const minMs = Math.ceil(nowMs / q) * q + 60 * 60_000;
    const last = this.prices?.slots?.at(-1)?.end;
    return { nowMs, minMs, maxMs: Math.max(minMs + q, last ?? nowMs + 24 * 3600_000) };
  }

  setDraft({ energyKwh, chargerKw, readyBy }) {
    if (this.plan || !(energyKwh > 0) || !(chargerKw > 0) || !readyBy) return;
    this.form = { energyKwh, chargerKw, readyBy };
    if (this.prices) this.drawCharts();
  }

  /**
   * Draw the night and the two-day chart only, leaving the form alone (also on resize, as
   * both are drawn in screen pixels). The chart lights the same periods as the skyline,
   * the preview included, so the page tells one story.
   */
  drawCharts() {
    const lit = this.renderNight();
    const chart = this.doc?.getElementById("price-chart");
    if (chart && this.prices) renderChart(chart, { slots: this.prices.slots, chosen: lit, nowMs: this.now() });
    const strip = this.doc?.getElementById("ready-strip");
    if (strip && this.prices) {
      const r = this.readyRange();
      const readyMs = fromHelsinkiLocal(this.form.readyBy) ?? r.maxMs;
      renderStrip(strip, { slots: this.prices.slots, chosen: lit, fromMs: r.minMs, untilMs: r.maxMs, readyMs });
    }
  }

  /**
   * The top of the page: tonight's answer and the night skyline. It shows the plan on the
   * page, or until the visitor asks for one, a preview for the form's current values. The
   * preview is never the "shown plan" the assistant reads.
   *
   * :return: The lit slots (the shown plan's, or the preview's), for the price chart.
   */
  renderNight() {
    const d = this.doc;
    const set = (id, text) => { const el = d.getElementById(id); if (el) el.textContent = text; };
    const nowMs = this.now();
    let plan = this.plan;
    let input = this.planInput;
    if (!plan && this.prices && this.form.readyBy) {
      const readyByMs = fromHelsinkiLocal(this.form.readyBy);
      const r = readyByMs === null ? null : planCharging({ energyKwh: this.form.energyKwh, chargerKw: this.form.chargerKw, fromMs: nowMs, readyByMs, prices: this.prices.slots });
      if (r?.ok) {
        plan = r.plan;
        input = { ...this.form, readyByMs };
      }
    }
    const heroPlan = d.getElementById("hero-plan");
    const empty = d.getElementById("hero-empty");
    if (heroPlan) heroPlan.hidden = !plan;
    if (empty) empty.hidden = Boolean(plan);
    if (plan) {
      const first = plan.windows[0];
      const startText = first ? helsinkiClock(first.start) : "Now";
      const startEl = d.getElementById("plan-start");
      const changed = startEl && startEl.textContent !== startText && startEl.textContent !== "…";
      set("plan-start", startText);
      // A new answer eases in from slightly below; skipped for reduced motion.
      if (changed && !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        startEl.animate?.([{ opacity: 0.2, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 450, easing: "cubic-bezier(.16, 1, .3, 1)" });
      }
      set("plan-finish", dayClock(plan.finishesAtMs, nowMs));
      set("plan-cost", euro(plan.costEur));
      set("plan-average", cents(plan.averagePriceCents));
      set("hero-echo-load", `${plan.energyKwh} kWh at ${plan.chargerKw} kW,`);
      set("hero-echo-ready", `ready ${weekdayLabel(input.readyByMs)} ${helsinkiClock(input.readyByMs)}`);
    } else {
      set("hero-echo-load", "");
      set("hero-echo-ready", "");
    }
    const sky = d.getElementById("night-sky");
    if (sky && this.prices) {
      const untilMs = input?.readyByMs ?? nowMs + 12 * 3600_000;
      renderSky(sky, { slots: this.prices.slots, chosen: plan?.slots ?? [], nowMs, untilMs });
    }
    return plan?.slots ?? [];
  }

  clearFormError() {
    const el = this.doc?.getElementById("form-error");
    if (el) { el.textContent = ""; el.hidden = true; }
    for (const id of Object.values(FIELD_INPUTS)) this.doc?.getElementById(id)?.removeAttribute?.("aria-invalid");
  }

  /**
   * Show the refusal above the button, mark the field it names and move focus there.
   *
   * :param reason: The planner's or page's reason.
   * :param field: The input it is about (energyKwh, chargerKw, readyBy), if any.
   */
  showFormError(reason, field) {
    const el = this.doc?.getElementById("form-error");
    if (el) { el.textContent = reason; el.hidden = false; }
    const input = FIELD_INPUTS[field] ? this.doc?.getElementById(FIELD_INPUTS[field]) : null;
    // The energy field sits in a closed "enter it yourself" panel; open it to show it.
    if (field === "energyKwh") { const exact = this.doc?.getElementById("energy-exact"); if (exact) exact.open = true; }
    if (input) {
      input.setAttribute?.("aria-invalid", "true");
      input.setAttribute?.("aria-describedby", "form-error");
      input.focus?.();
    }
  }

  /** Wire the page's own form to showPlan. */
  bindForm() {
    const form = this.doc?.getElementById("plan-form");
    if (!form) return;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = (id) => this.doc.getElementById(id).value;
      const result = this.showPlan({ energyKwh: Number(value("energy")), chargerKw: Number(value("charger")), readyBy: value("ready-by") });
      if (!result.ok) {
        this.showFormError(result.reason, result.field);
        return;
      }
      this.doc.getElementById("hero-plan")?.focus();
    });
  }
}

/** The page input for each field name a refusal can give. */
const FIELD_INPUTS = { energyKwh: "energy", chargerKw: "charger", readyBy: "ready-by" };

// ---- formatting helpers (pure) --------------------------------------------

function daySummary(day) {
  if (!day?.available) return { date: day?.date ?? null, available: false };
  const pts = day.points;
  const min = pts.reduce((a, b) => (b.price < a.price ? b : a));
  const max = pts.reduce((a, b) => (b.price > a.price ? b : a));
  const avg = pts.reduce((s, p) => s + p.price, 0) / pts.length;
  return {
    date: day.date,
    available: true,
    min: { price: round(min.price, 2), time: helsinkiClock(min.start) },
    max: { price: round(max.price, 2), time: helsinkiClock(max.start) },
    average: round(avg, 2),
  };
}

// Hourly averages from the current hour on, to keep the agent's state small.
function hourly(slots, nowMs) {
  const hourStart = nowMs - (nowMs % 3600_000);
  const byHour = new Map();
  for (const s of slots) {
    if (s.end <= hourStart) continue;
    const h = s.start - (s.start % 3600_000);
    const e = byHour.get(h) ?? { sum: 0, n: 0 };
    e.sum += s.price;
    e.n += 1;
    byHour.set(h, e);
  }
  return [...byHour.entries()].map(([h, e]) => ({ hour: toHelsinkiLocal(h), price: round(e.sum / e.n, 2) }));
}

/** "01:45 today", "06:15 tomorrow", or "Sat 21 Nov 06:15" further out, in Finnish time. */
export function dayClock(ms, nowMs) {
  const today = helsinkiDate(nowMs);
  const day = helsinkiDate(ms);
  if (day === today) return `${helsinkiClock(ms)} today`;
  if (day === addDays(today, 1)) return `${helsinkiClock(ms)} tomorrow`;
  return `${weekdayLabel(ms)} ${helsinkiClock(ms)}`;
}

/** "Wed 18 Nov 00:15–01:00", or with both dates when a window crosses midnight. */
export function windowLabel(startMs, endMs) {
  const sameDay = helsinkiDate(startMs) === helsinkiDate(endMs - 1);
  return sameDay
    ? `${weekdayLabel(startMs)} ${helsinkiClock(startMs)}–${helsinkiClock(endMs)}`
    : `${weekdayLabel(startMs)} ${helsinkiClock(startMs)} – ${weekdayLabel(endMs)} ${helsinkiClock(endMs)}`;
}

/**
 * The plan as ready-to-show Markdown, written by the site so dates and amounts are exact.
 * The assistant shows it as given instead of reformatting the numbers itself.
 */
export function planSummary(plan, input) {
  const kwh = (x) => `${Number(x.toFixed(2))} kWh`;
  const rows = plan.windows.map((w) => `| ${windowLabel(w.start, w.end)} | ${kwh(w.kwh)} | ${cents(w.avgPriceCents)} |`);
  const readyBy = input ? `${weekdayLabel(input.readyByMs)} ${helsinkiClock(input.readyByMs)}` : "the ready-by time";
  return [
    `**Charge ${kwh(plan.energyKwh)} at ${plan.chargerKw} kW, ready by ${readyBy} (Finnish time)**`,
    "",
    "| When | Energy | Average price |",
    "|---|---|---|",
    ...rows,
    "",
    `- Energy cost: **${euro(plan.costEur)}** (charging right away: ${euro(plan.baselineCostEur)}, so you save **${euro(plan.savingsEur)}**)`,
    `- Average price: ${cents(plan.averagePriceCents)} · done by ${weekdayLabel(plan.finishesAtMs)} ${helsinkiClock(plan.finishesAtMs)}`,
    "",
    "*Energy only, at spot prices including VAT. Grid transfer fees and the seller's margin are not included.*",
  ].join("\n");
}

function formatPlan(plan, input) {
  const at = (ms) => ({ local: toHelsinkiLocal(ms), clock: helsinkiClock(ms), label: longLabel(ms) });
  return {
    summary: planSummary(plan, input),
    energyKwh: plan.energyKwh,
    chargerKw: plan.chargerKw,
    readyBy: input ? at(input.readyByMs) : null,
    windows: plan.windows.map((w) => ({ when: windowLabel(w.start, w.end), from: at(w.start), until: at(w.end), kwh: w.kwh, averagePrice: cents(w.avgPriceCents) })),
    cost: euro(plan.costEur),
    costCents: Math.round(plan.costEur * 100),
    chargeNowCost: euro(plan.baselineCostEur),
    savings: euro(plan.savingsEur),
    averagePrice: cents(plan.averagePriceCents),
    finishesAt: at(plan.finishesAtMs),
    note: "Energy cost only, at spot prices including VAT. Grid transfer fees and the seller's margin are not included.",
  };
}

function defaultReadyBy(nowMs) {
  // Next 07:00 Finnish time that is at least 2 hours away.
  const today = helsinkiDate(nowMs);
  for (const date of [today, addDays(today, 1)]) {
    const candidate = fromHelsinkiLocal(`${date}T07:00`);
    if (candidate - nowMs >= 2 * 3600_000) return `${date}T07:00`;
  }
  return `${addDays(today, 1)}T07:00`;
}

// Start the page when loaded in a browser. Tests import App without a document, or set
// globalThis.chargePageHooks ({now, pricesLoader}) first to pin the clock and prices.
if (globalThis.document?.getElementById("plan-form")) {
  App.page = new App(globalThis.chargePageHooks || {});
  App.page.bindForm();
  let lastWidth = globalThis.innerWidth;
  let queued = false;
  globalThis.addEventListener?.("resize", () => {
    if (queued || globalThis.innerWidth === lastWidth) return;
    queued = true;
    globalThis.requestAnimationFrame(() => {
      queued = false;
      lastWidth = globalThis.innerWidth;
      if (App.page.prices) App.page.drawCharts();
    });
  });
  // The car form binds after the first render, so its numbers win over the defaults.
  App.page.start().catch((error) => {
    console.error("Price load failed", error);
    App.page.showFormError("Could not load prices. Check your connection and reload the page.");
  }).finally(() => {
    App.page.carForm = new CarForm(globalThis.document, (draft) => App.page.setDraft(draft), () => App.page.readyRange());
    App.page.carForm.bind();
  });
}
