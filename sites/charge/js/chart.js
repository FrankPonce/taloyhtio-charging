// Inline SVG bar chart of 15-minute prices, with planned slots highlighted.

import { helsinkiClock, helsinkiParts, weekdayLabel } from "./time.js";

const NS = "http://www.w3.org/2000/svg";

/**
 * Draw the price chart into a container element.
 *
 * :param container: The element to draw into (its content is replaced).
 * :param data: {slots, chosen, nowMs} with epoch-ms slot times and c/kWh prices.
 */
export function renderChart(container, { slots, chosen = [], nowMs }) {
  const doc = container.ownerDocument;
  if (!doc?.createElementNS || !slots.length) return;
  const W = 960, H = 260, padL = 44, padB = 34, padT = 12;
  const chosenStarts = new Set(chosen.map((s) => s.start));
  const maxPrice = Math.max(1, ...slots.map((s) => s.price));
  const minPrice = Math.min(0, ...slots.map((s) => s.price));
  const span = maxPrice - minPrice;
  const bw = (W - padL) / slots.length;
  const y = (v) => padT + (H - padT - padB) * (1 - (v - minPrice) / span);

  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Spot prices for ${slots.length / 96 > 1 ? "today and tomorrow" : "today"}, 15-minute periods. ${chosen.length ? `${chosen.length} planned charging periods are highlighted.` : ""}`);

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

  slots.forEach((s, i) => {
    const top = y(Math.max(0, s.price));
    const bottom = y(Math.min(0, s.price));
    const cls = chosenStarts.has(s.start) ? "bar chosen" : s.end <= nowMs ? "bar past" : "bar";
    const rect = add("rect", { x: padL + i * bw, y: top, width: Math.max(bw - 0.6, 0.6), height: Math.max(bottom - top, 0.5), class: cls });
    const title = doc.createElementNS(NS, "title");
    title.textContent = `${weekdayLabel(s.start)} ${helsinkiClock(s.start)}: ${s.price.toFixed(2)} c/kWh`;
    rect.appendChild(title);
    const p = helsinkiParts(s.start);
    if (p.minute === 0 && p.hour % 3 === 0) {
      add("text", { x: padL + i * bw, y: H - padB + 16, class: "axis" }, p.hour === 0 ? weekdayLabel(s.start) : `${String(p.hour).padStart(2, "0")}`);
    }
  });

  const nowIndex = slots.findIndex((s) => s.start <= nowMs && nowMs < s.end);
  if (nowIndex >= 0) add("line", { x1: padL + nowIndex * bw, x2: padL + nowIndex * bw, y1: padT, y2: H - padB, class: "now" });

  add("text", { x: 4, y: padT + 4, class: "axis unit" }, "c/kWh");
  container.replaceChildren(svg);
}

function niceTicks(min, max) {
  const step = max - min > 30 ? 10 : max - min > 12 ? 5 : 2;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
  return out;
}
