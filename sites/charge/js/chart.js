// The page's two drawings, both in screen pixels (redrawn on resize by app.js):
// - renderSky: tonight as a skyline, the signature at the top of the page;
// - renderChart: today's and tomorrow's 15-minute prices, with planned slots lit.

import { helsinkiClock, helsinkiParts, weekdayLabel } from "./time.js";

const NS = "http://www.w3.org/2000/svg";

/**
 * Draw the price chart into a container element, sized to the container's width so text
 * stays at its real size on a phone.
 *
 * :param container: The element to draw into (its content is replaced).
 * :param data: {slots, chosen, nowMs} with epoch-ms slot times and c/kWh prices.
 */
export function renderChart(container, { slots, chosen = [], nowMs }) {
  const doc = container.ownerDocument;
  if (!doc?.createElementNS || !slots.length) return;
  const W = Math.max(300, Math.round(container.clientWidth || 960));
  const narrow = W < 600;
  // padT leaves room above the plot for the unit label, clear of the top tick.
  const H = narrow ? 220 : 272, padL = 32, padB = 30, padT = 24;
  const chosenStarts = new Set(chosen.map((s) => s.start));
  const maxPrice = Math.max(1, ...slots.map((s) => s.price));
  const minPrice = Math.min(0, ...slots.map((s) => s.price));
  const span = maxPrice - minPrice;
  const bw = (W - padL) / slots.length;
  const y = (v) => padT + (H - padT - padB) * (1 - (v - minPrice) / span);

  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", String(W));
  svg.setAttribute("height", String(H));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Spot prices for ${slots.length / 96 > 1 ? "today and tomorrow" : "today"}, 15-minute periods. ${chosen.length ? `${chosen.length} planned charging periods are lit.` : ""}`);

  const add = (tag, attrs, text) => {
    const el = doc.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    if (text) el.textContent = text;
    svg.appendChild(el);
    return el;
  };

  for (const tick of niceTicks(minPrice, maxPrice)) {
    add("line", { x1: padL, x2: W, y1: y(tick), y2: y(tick), class: "grid" });
    add("text", { x: padL - 6, y: y(tick) + 4, class: "axis", "text-anchor": "end" }, String(tick));
  }

  const every = narrow ? 6 : 3;
  slots.forEach((s, i) => {
    const top = y(Math.max(0, s.price));
    const bottom = y(Math.min(0, s.price));
    const cls = chosenStarts.has(s.start) ? "bar chosen" : s.end <= nowMs ? "bar past" : "bar";
    const rect = add("rect", { x: padL + i * bw, y: top, width: Math.max(bw - (bw > 3 ? 0.8 : 0.3), 0.6), height: Math.max(bottom - top, 0.5), class: cls });
    const title = doc.createElementNS(NS, "title");
    title.textContent = `${weekdayLabel(s.start)} ${helsinkiClock(s.start)}: ${s.price.toFixed(2)} c/kWh`;
    rect.appendChild(title);
    const p = helsinkiParts(s.start);
    if (p.minute === 0 && p.hour % every === 0) {
      add("text", { x: padL + i * bw, y: H - padB + 16, class: p.hour === 0 ? "axis day" : "axis" }, p.hour === 0 ? weekdayLabel(s.start).split(" ")[0] : `${String(p.hour).padStart(2, "0")}`);
    }
  });

  const nowIndex = slots.findIndex((s) => s.start <= nowMs && nowMs < s.end);
  if (nowIndex >= 0) add("line", { x1: padL + nowIndex * bw, x2: padL + nowIndex * bw, y1: padT, y2: H - padB, class: "now" });

  add("text", { x: 0, y: 12, class: "axis unit" }, "c/kWh");
  container.replaceChildren(svg);
}

/**
 * Draw tonight as a skyline: one building per 15-minute period from now until untilMs.
 * A building's height is its price on one scale for the night shown (lower is cheaper);
 * planned periods have their windows lit, so they differ by form as well as colour. The
 * sky behind follows the clock: dusk blue in the evening and morning, deepest at 01:00.
 *
 * :param container: The element to draw into (its content is replaced).
 * :param data: {slots, chosen, nowMs, untilMs} with epoch-ms times and c/kWh prices.
 */
export function renderSky(container, { slots, chosen = [], nowMs, untilMs }) {
  const doc = container.ownerDocument;
  if (!doc?.createElementNS) return;
  const shown = slots.filter((s) => s.end > nowMs && s.start < untilMs);
  if (!shown.length) {
    container.replaceChildren();
    return;
  }
  const W = Math.max(280, Math.round(container.clientWidth || 960));
  const H = W < 600 ? 170 : 230;
  const ground = H;
  const lit = new Set(chosen.map((s) => s.start));
  const prices = shown.map((s) => s.price);
  const lo = Math.min(...prices), hi = Math.max(...prices);
  // One scale for the night shown: the cheapest period is a low house at 22% of the
  // band, the dearest a tower at 88%, so "lower is cheaper" reads at a glance.
  const height = (p) => H * (0.22 + 0.66 * ((p - lo) / (hi - lo || 1)));
  // A street on every hour: buildings within an hour stand shoulder to shoulder.
  const startsHour = (s) => helsinkiParts(s.start).minute === 0;
  const streets = shown.filter((s, i) => i > 0 && startsHour(s)).length;
  const street = Math.min(6, Math.max(2, W / 160));
  const bw = (W - streets * street) / shown.length;

  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", String(W));
  svg.setAttribute("height", String(H));
  svg.setAttribute("role", "img");
  // Motion (styles.css, off for reduced motion): the skyline rises on the first draw only,
  // and windows switch on only for periods that weren't lit in the previous draw, so live
  // redraws while the driver types don't replay anything.
  const firstDraw = !container.skyLit;
  const litBefore = container.skyLit ?? new Set();
  container.skyLit = lit;
  if (firstDraw) svg.setAttribute("class", "sky-rising");
  const litCount = shown.filter((s) => lit.has(s.start)).length;
  svg.setAttribute("aria-label", `Prices from ${helsinkiClock(shown[0].start)} to ${helsinkiClock(shown.at(-1).end)}, one building per 15 minutes, taller is dearer. ${litCount ? `${litCount} planned charging periods are lit.` : "No charging planned yet."}`);
  const add = (parent, tag, attrs) => {
    const el = doc.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    parent.appendChild(el);
    return el;
  };

  const defs = add(svg, "defs", {});
  const grad = add(defs, "linearGradient", { id: "sky-time", x1: 0, x2: 1, y1: 0, y2: 0 });
  const steps = Math.min(shown.length, 24);
  for (let i = 0; i <= steps; i++) {
    const s = shown[Math.min(shown.length - 1, Math.round((i / steps) * (shown.length - 1)))];
    add(grad, "stop", { offset: `${(i / steps) * 100}%`, "stop-color": skyColour(helsinkiParts(s.start)) });
  }
  add(svg, "rect", { width: W, height: ground, fill: "url(#sky-time)" });
  drawStarsAndMoon(svg, add, { W, H, shown, nowMs });

  const ticks = doc.createElement("div");
  ticks.className = "sky-ticks";
  ticks.setAttribute("aria-hidden", "true");
  const every = shown.length > 64 ? 3 : shown.length > 32 ? 2 : 1;
  let x = 0;
  let litIndex = 0;
  shown.forEach((s, i) => {
    if (i > 0 && startsHour(s)) x += street;
    const h = height(s.price);
    const isLit = lit.has(s.start);
    const switching = isLit && !litBefore.has(s.start);
    const g = add(svg, "g", { class: `sky-building${isLit ? " lit" : ""}${switching ? " switching-on" : ""}` });
    const rise = firstDraw ? i * 14 : 0;
    const on = switching ? (firstDraw ? 420 + rise : 0) + Math.min(litIndex++ * 45, 900) : 0;
    g.setAttribute("style", `--rise: ${rise}ms; --on: ${on}ms`);
    add(g, "rect", { x, y: ground - h, width: bw, height: h, class: "sky-facade" });
    // A roof line, so neighbouring buildings of different heights read as a skyline.
    add(g, "rect", { x, y: ground - h, width: bw, height: 2, class: "sky-roof" });
    if (isLit) drawWindows(g, add, x, ground - h, bw, h);
    const title = doc.createElementNS(NS, "title");
    title.textContent = `${weekdayLabel(s.start)} ${helsinkiClock(s.start)}: ${s.price.toFixed(2)} c/kWh${isLit ? ", charging" : ""}`;
    g.appendChild(title);
    const p = helsinkiParts(s.start);
    // Leave room for the named ends ("now 02:18", "07:00 ready") at both edges.
    if (p.minute === 0 && p.hour % every === 0 && x > 110 && x < W - 120) {
      const t = doc.createElement("span");
      t.className = "sky-tick";
      t.style.left = `${(x / W) * 100}%`;
      t.textContent = String(p.hour).padStart(2, "0");
      ticks.appendChild(t);
    }
    x += bw;
  });
  // The two ends of the night, named: from now to when the car must be ready.
  const start = doc.createElement("span");
  start.className = "sky-end";
  start.textContent = `now ${helsinkiClock(nowMs)}`;
  const end = doc.createElement("span");
  end.className = "sky-end sky-end-ready";
  end.textContent = `${helsinkiClock(Math.min(untilMs, shown.at(-1).end))} ready`;
  ticks.append(start, end);
  container.replaceChildren(svg, ticks);
}

/**
 * A slim strip of the same night above the ready-by slider: one bar per 15 minutes from
 * the slider's first to its last step, height = price, planned periods amber, periods
 * after the chosen ready-by time greyed (charging can't use them).
 *
 * :param container: The element to draw into (its content is replaced).
 * :param data: {slots, chosen, fromMs, untilMs, readyMs}.
 */
export function renderStrip(container, { slots, chosen = [], fromMs, untilMs, readyMs }) {
  const doc = container.ownerDocument;
  if (!doc?.createElementNS) return;
  const shown = slots.filter((s) => s.end > fromMs && s.start < untilMs);
  if (!shown.length) return;
  const W = Math.max(200, Math.round(container.clientWidth || 600)), H = 30;
  const lit = new Set(chosen.map((s) => s.start));
  const prices = shown.map((s) => s.price);
  const lo = Math.min(...prices), hi = Math.max(...prices);
  const bw = W / shown.length;
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", String(W));
  svg.setAttribute("height", String(H));
  shown.forEach((s, i) => {
    const h = H * (0.2 + 0.8 * ((s.price - lo) / (hi - lo || 1)));
    const rect = doc.createElementNS(NS, "rect");
    const cls = lit.has(s.start) ? "strip-bar lit" : s.start >= readyMs ? "strip-bar after" : "strip-bar";
    for (const [k, v] of Object.entries({ x: i * bw, y: H - h, width: Math.max(bw - (bw > 3 ? 1 : 0.3), 0.6), height: h, class: cls })) rect.setAttribute(k, String(v));
    svg.appendChild(rect);
  });
  container.replaceChildren(svg);
}

/**
 * Stars that fade toward dusk, and a crescent moon. Both sit behind the buildings. Star positions come from a
 * fixed seed per night, so they don't jump on every redraw.
 */
function drawStarsAndMoon(svg, add, { W, H, shown, nowMs }) {
  const night = Math.floor(nowMs / 864e5);
  let seed = (night * 2654435761) >>> 0;
  const rand = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const stars = add(svg, "g", { class: "sky-stars", "aria-hidden": "true" });
  const count = Math.round(W / 11);
  for (let i = 0; i < count; i++) {
    const x = rand() * W, y = (0.04 + rand() * 0.5) * H, size = 0.5 + rand() * rand() * 1.3;
    const slot = shown[Math.min(shown.length - 1, Math.floor((x / W) * shown.length))];
    const dark = 1 - skyLight(helsinkiParts(slot.start));
    if (dark < 0.2) continue;
    const star = add(stars, "circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: size.toFixed(2), opacity: (dark * (0.35 + rand() * 0.6)).toFixed(2) });
    if (rand() < 0.18) {
      star.setAttribute("class", "twinkle");
      star.setAttribute("style", `--tw: ${(3 + rand() * 4).toFixed(1)}s; --tw-delay: -${(rand() * 6).toFixed(1)}s`);
    }
  }
  // A "C"-shaped crescent (lit on the left, like a waning moon seen from Finland).
  // Decorative: the same shape every night, not tonight's real phase.
  const r = Math.max(8, H * 0.085), cx = W * 0.2, cy = H * 0.25;
  const inner = r * 0.45;
  add(svg, "path", {
    class: "sky-moon-lit",
    "aria-hidden": "true",
    d: `M ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx} ${cy + r} A ${inner} ${r} 0 0 1 ${cx} ${cy - r} Z`,
  });
}

/** A grid of lit windows in screen pixels: 3-4 px panes with a mullion between them. */
function drawWindows(g, add, x, top, w, h) {
  const pane = w >= 14 ? 4 : 3, gap = w >= 14 ? 3 : 2;
  const cols = Math.max(1, Math.floor((w - gap) / (pane + gap)));
  const rows = Math.max(1, Math.floor((h - 6) / (pane + gap + 1)));
  const left = x + (w - (cols * pane + (cols - 1) * gap)) / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      add(g, "rect", { x: left + c * (pane + gap), y: top + 5 + r * (pane + gap + 1), width: pane, height: pane + 1, class: "sky-window" });
    }
  }
}

/** How light the sky is at a clock time: 0 at 01:00 (deepest) … 1 toward 17 and 08. */
function skyLight({ hour, minute }) {
  const h = hour + minute / 60;
  const away = Math.min(Math.abs(h - 1), 24 - Math.abs(h - 1));
  return Math.min(1, away / 7) ** 1.4;
}

/** Night-sky colour for a clock time: dusk blue toward 17 and 08, deepest navy at 01. */
function skyColour(parts) {
  const t = skyLight(parts);
  const deep = [8, 19, 42], dusk = [58, 96, 158];
  const c = deep.map((v, i) => Math.round(v + (dusk[i] - v) * t));
  return `rgb(${c.join(",")})`;
}

function niceTicks(min, max) {
  const step = max - min > 30 ? 10 : max - min > 12 ? 5 : 2;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
  return out;
}
