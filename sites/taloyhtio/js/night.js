// Tonight's state and the shared-night load chart. Times are Finnish (Europe/Helsinki).
// SIMULATED housing company; the load is real: the scheduler's published total kW per
// 15 minutes for a planned night (get_night_load on this site's own /mcp), with no
// resident data in it.

import { RULES } from "./rules.js";

const ZONE = "Europe/Helsinki";
const STEP = 15 * 60_000;
const SLOTS = 36; // 22:00-07:00

/** {y, m, d, hh, mm, wd} of a moment in Helsinki. */
export function helsinkiParts(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: Number(p.hour), mm: Number(p.minute), wd: p.weekday };
}

/** "YYYY-MM-DD" in Helsinki. */
export function helsinkiDate(ms) {
  const p = helsinkiParts(ms);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** The moment a Helsinki wall-clock time happens ("2026-11-19", "18:00"). */
export function helsinkiMs(date, clock) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = clock.split(":").map(Number);
  let guess = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) {
    const p = helsinkiParts(guess);
    const seen = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    guess += Date.UTC(y, m - 1, d, hh, mm) - seen;
  }
  return guess;
}

export function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const clock = (ms) => {
  const p = helsinkiParts(ms);
  return `${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")}`;
};

/** "Thu 19 Nov" for a night's date. */
export function dayLabel(date) {
  const ms = helsinkiMs(date, "12:00");
  return new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, weekday: "short", day: "numeric", month: "short" }).format(new Date(ms));
}

/**
 * Where the shared night stands now.
 *
 * :return: {phase: "open" | "planned" | "charging", night (the night requests go to),
 *   current (the night being planned or charged, if any), msLeft (until 18:00 when open)}.
 */
export function tonight(nowMs = Date.now()) {
  const today = helsinkiDate(nowMs);
  const deadline = helsinkiMs(today, RULES.requests.deadline);
  const nightStart = helsinkiMs(today, RULES.night.from);
  const morningEnd = helsinkiMs(today, RULES.night.until);
  if (nowMs < morningEnd) return { phase: "charging", night: today, current: addDays(today, -1), msLeft: deadline - nowMs };
  if (nowMs < deadline) return { phase: "open", night: today, current: null, msLeft: deadline - nowMs };
  if (nowMs < nightStart) return { phase: "planned", night: addDays(today, 1), current: today, msLeft: 0 };
  return { phase: "charging", night: addDays(today, 1), current: today, msLeft: 0 };
}

/** "3 h 12 min" (or "12 min"). */
export function durationLabel(ms) {
  const min = Math.max(0, Math.ceil(ms / 60_000));
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** 36 slots of kW for a planned night, from the scheduler's list of non-empty slots. */
export function slotsOf(night, load) {
  const start = helsinkiMs(night, RULES.night.from);
  const kw = Array(SLOTS).fill(0);
  for (const l of load) {
    const i = Math.round((l.start - start) / STEP);
    if (i >= 0 && i < SLOTS) kw[i] = l.kw;
  }
  return { start, kw };
}

/** One plain-language summary of a planned night (the chart's text equivalent). */
export function loadSummary(night, requests, kw, limit) {
  const used = kw.filter((x) => x > 0).length;
  const peak = Math.max(0, ...kw);
  const energy = kw.reduce((s, x) => s + x * 0.25, 0);
  const cars = requests === 1 ? "1 car" : `${requests} cars`;
  return `${dayLabel(night)}: ${cars}, ${Math.round(energy)} kWh in ${used} of ${SLOTS} quarter-hours. Peak ${peak} of ${limit} kW${peak <= limit ? ", never over the limit" : ""}.`;
}

const svgNS = "http://www.w3.org/2000/svg";

export class NightLoad {
  /**
   * :param doc: The page document.
   * :param call: async (toolName, args) -> {ok, data} on this site's /mcp.
   * :param now: () -> ms.
   */
  constructor({ doc = globalThis.document, call, now = () => Date.now() } = {}) {
    this.doc = doc;
    this.call = call;
    this.now = now;
    this.data = null;
  }

  el(id) {
    return this.doc.getElementById(id);
  }

  /** The most recent planned night: tonight if planned, else up to four nights back. */
  async latest() {
    const t = tonight(this.now());
    const first = t.current ?? addDays(t.night, -1);
    let answered = 0;
    for (let k = 0; k < 5; k++) {
      const night = addDays(first, -k);
      const r = await this.call("get_night_load", { night });
      if (r.ok) answered++;
      if (r.ok && r.data?.scheduled) return { ...r.data, isCurrent: night === t.current };
    }
    // "No night was planned" is a fact only if the scheduler actually answered.
    if (!answered) throw new Error("The scheduler did not answer.");
    return null;
  }

  async load() {
    this.failed = false;
    try {
      this.data = await this.latest();
    } catch {
      this.data = null;
      this.failed = true;
    }
    this.render();
    return this.data;
  }

  render() {
    const heading = this.el("load-heading"), summary = this.el("load-summary"), figure = this.el("load-chart");
    if (!figure) return;
    if (this.failed) {
      heading.textContent = "The shared night";
      summary.textContent = "The scheduler could not be reached just now, so the night's load can't be shown. The rest of the page still works; reload to try again.";
      figure.replaceChildren();
      return;
    }
    if (!this.data) {
      heading.textContent = "The shared night";
      summary.textContent = "No planned night to show from the last few days. When residents send requests, the night's load appears here after 18:00.";
      figure.replaceChildren();
      return;
    }
    const { night, requests, limit_kw: limit, load, isCurrent } = this.data;
    const { start, kw } = slotsOf(night, load);
    heading.textContent = isCurrent ? "Tonight's plan, under the limit" : "Last planned night, under the limit";
    summary.textContent = loadSummary(night, requests, kw, limit);
    this.slots = { start, kw, limit, night };
    this.draw();
    this.fillTable();
  }

  /** The chart, drawn at the figure's pixel width so labels keep their size. */
  draw() {
    const figure = this.el("load-chart");
    if (!figure || !this.slots) return;
    const { start, kw, limit } = this.slots;
    const width = Math.max(300, Math.round(figure.clientWidth || 900));
    const narrow = width < 560;
    const pad = { l: narrow ? 34 : 44, r: 8, t: 26, b: 30 };
    const h = narrow ? 220 : 300;
    const plotW = width - pad.l - pad.r, plotH = h - pad.t - pad.b;
    const x = (i) => pad.l + (i / SLOTS) * plotW;
    const y = (v) => pad.t + plotH - (v / limit) * plotH;
    const d = this.doc;
    const svg = d.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${h}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(h));
    svg.setAttribute("aria-hidden", "true");
    let body = "";
    // The limit as a band: the building's connection ends here, nothing may reach above it.
    body += `<rect class="lc-band" x="${pad.l}" y="${pad.t - 10}" width="${plotW}" height="10"/>`;
    // Hour grid.
    for (let i = 4; i < SLOTS; i += 4) body += `<line class="lc-vgrid" x1="${x(i)}" x2="${x(i)}" y1="${pad.t}" y2="${pad.t + plotH}"/>`;
    // kW grid: 0, 11 (one charger at full power), 22 (the limit).
    for (const v of [0, limit / 2, limit]) {
      body += `<line class="lc-grid${v === limit ? " lc-limit" : ""}" x1="${pad.l}" x2="${width - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      body += `<text class="lc-axis" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    }
    body += `<text class="lc-axis lc-unit" x="${pad.l - 8}" y="${pad.t - 12}" text-anchor="end">kW</text>`;
    body += `<text class="lc-limit-label" x="${width - pad.r}" y="${y(limit) - 15}" text-anchor="end">${limit} kW limit${narrow ? "" : ", the building's connection"}</text>`;
    // Hour ticks.
    for (let i = 0; i <= SLOTS; i += 4) {
      if (narrow && i % 8) continue;
      body += `<line class="lc-tick" x1="${x(i)}" x2="${x(i)}" y1="${pad.t + plotH}" y2="${pad.t + plotH + 5}"/>`;
      body += `<text class="lc-axis" x="${x(i)}" y="${h - 8}" text-anchor="${i === 0 ? "start" : i === SLOTS ? "end" : "middle"}">${clock(start + i * STEP)}</text>`;
    }
    // The load as a stepped area: one flat top per quarter-hour.
    let path = `M${x(0)} ${y(0)}`;
    kw.forEach((v, i) => { path += ` L${x(i)} ${y(v)} L${x(i + 1)} ${y(v)}`; });
    path += ` L${x(SLOTS)} ${y(0)} Z`;
    body += `<path class="lc-area" d="${path}"/>`;
    let top = "";
    kw.forEach((v, i) => { if (v) top += `M${x(i)} ${y(v)} H${x(i + 1)} `; });
    body += `<path class="lc-top" d="${top}"/>`;
    body += `<line class="lc-base" x1="${pad.l}" x2="${width - pad.r}" y1="${y(0)}" y2="${y(0)}"/>`;
    body += `<g class="lc-cursor" hidden><line class="lc-cursor-line" y1="${pad.t}" y2="${pad.t + plotH}"/></g>`;
    svg.innerHTML = body;
    figure.replaceChildren(svg);
    const tip = d.createElement("p");
    tip.className = "lc-tip";
    tip.hidden = true;
    figure.append(tip);
    this.bindHover(figure, svg, tip, { x, pad, plotW, start, kw, width });
  }

  /** Pointer and keyboard reading of one quarter-hour. */
  bindHover(figure, svg, tip, { x, pad, plotW, start, kw, width }) {
    const cursor = svg.querySelector(".lc-cursor"), line = svg.querySelector(".lc-cursor-line");
    let at = null;
    const show = (i) => {
      at = Math.max(0, Math.min(SLOTS - 1, i));
      const mid = (x(at) + x(at + 1)) / 2;
      line.setAttribute("x1", mid);
      line.setAttribute("x2", mid);
      cursor.hidden = false;
      tip.hidden = false;
      tip.textContent = `${clock(start + at * STEP)}–${clock(start + (at + 1) * STEP)} · ${kw[at] ? `${kw[at]} kW` : "nothing charging"}`;
      tip.style.left = `${Math.min(Math.max(mid / width, 0.12), 0.88) * 100}%`;
    };
    const hide = () => { cursor.hidden = true; tip.hidden = true; };
    figure.onpointermove = (e) => {
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * width;
      show(Math.floor(((px - pad.l) / plotW) * SLOTS));
    };
    figure.onpointerleave = hide;
    figure.onfocus = () => show(at ?? kw.findIndex((v) => v > 0));
    figure.onblur = hide;
    figure.onkeydown = (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        show((at ?? 0) + (e.key === "ArrowRight" ? 1 : -1));
      }
    };
  }

  /** The same numbers as a table, for anyone who prefers reading them. */
  fillTable() {
    const body = this.el("load-table-body");
    if (!body || !this.slots) return;
    const { start, kw } = this.slots;
    body.replaceChildren(...kw.map((v, i) => {
      const tr = this.doc.createElement("tr");
      tr.innerHTML = `<td>${clock(start + i * STEP)}–${clock(start + (i + 1) * STEP)}</td><td>${v}</td>`;
      return tr;
    }));
  }
}

/** The top of the page: heading, sentence and the scene's state, kept current each minute. */
export class Tonight {
  constructor({ doc = globalThis.document, scene = null, now = () => Date.now() } = {}) {
    this.doc = doc;
    this.scene = scene;
    this.now = now;
  }

  el(id) {
    return this.doc.getElementById(id);
  }

  render() {
    const t = tonight(this.now());
    const set = (id, text) => { const e = this.el(id); if (e) e.textContent = text; };
    if (t.phase === "open") {
      set("tonight-lead", "Requests for tonight close in");
      set("tonight-figure", durationLabel(t.msLeft));
      set("tonight-text", `Send yours before ${RULES.requests.deadline}. The scheduler then plans every car under the shared limit and signs each resident's receipt.`);
    } else if (t.phase === "planned") {
      set("tonight-lead", "Tonight is planned. Charging starts at");
      set("tonight-figure", RULES.night.from);
      set("tonight-text", `Receipts are signed and ready. Requests now go to the night of ${dayLabel(t.night)}, until ${RULES.requests.deadline} that day.`);
    } else {
      set("tonight-lead", "Charging now, cars ready by");
      set("tonight-figure", RULES.night.until);
      set("tonight-text", `The chargers share ${RULES.night.sharedLimitKw} kW until ${RULES.night.until}. Requests for the night of ${dayLabel(t.night)} close at ${RULES.requests.deadline}.`);
    }
    set("tonight-date", dayLabel(t.phase === "open" ? t.night : t.current));
    this.scene?.setState(t.phase === "charging" ? "charging" : "open");
    return t;
  }

  start() {
    this.render();
    globalThis.setInterval?.(() => this.render(), 30_000);
  }
}
