// Charging planner: a plain function, no model involved. The page form and the
// agent's tools both call planCharging, so they always agree.

export const SLOT_MINUTES = 15;
const SLOT_MS = SLOT_MINUTES * 60_000;

export const LIMITS = Object.freeze({
  energyKwh: { min: 1, max: 120 },
  chargerKw: { min: 1.4, max: 22 },
});

/**
 * Plan the cheapest charging slots before a deadline.
 *
 * Slots are the 15-minute price periods that start at or after `fromMs` and end at
 * or before `readyByMs`. Each slot can deliver `chargerKw * 0.25` kWh. The cheapest
 * slots are chosen (earlier first on equal prices); the last chosen slot may be
 * only partly used. The baseline is charging right away, in time order.
 *
 * :param input: {energyKwh, chargerKw, fromMs, readyByMs, prices}, where prices is
 *     [{start, end, price}] with epoch-ms times and price in c/kWh incl. VAT.
 * :return: {ok: true, plan} or {ok: false, reason, field}. Never throws on bad input.
 */
export function planCharging({ energyKwh, chargerKw, fromMs, readyByMs, prices }) {
  const refuse = (reason, field) => ({ ok: false, reason, field });

  if (!Number.isFinite(energyKwh) || energyKwh < LIMITS.energyKwh.min || energyKwh > LIMITS.energyKwh.max) {
    return refuse(`Energy must be between ${LIMITS.energyKwh.min} and ${LIMITS.energyKwh.max} kWh.`, "energyKwh");
  }
  if (!Number.isFinite(chargerKw) || chargerKw < LIMITS.chargerKw.min || chargerKw > LIMITS.chargerKw.max) {
    return refuse(`Charger power must be between ${LIMITS.chargerKw.min} and ${LIMITS.chargerKw.max} kW.`, "chargerKw");
  }
  if (!Number.isFinite(readyByMs)) return refuse("Give the time the car must be ready, as YYYY-MM-DDTHH:MM in Finnish time.", "readyBy");
  if (readyByMs <= fromMs) return refuse("The ready-by time has already passed. Pick a later time.", "readyBy");

  const known = (prices || []).filter((p) => p.end - p.start === SLOT_MS).sort((a, b) => a.start - b.start);
  const lastKnownEnd = known.length ? known[known.length - 1].end : null;
  const window = known.filter((p) => p.start >= fromMs && p.end <= readyByMs);
  const perSlotKwh = chargerKw * (SLOT_MINUTES / 60);
  const slotsNeeded = Math.ceil(round(energyKwh / perSlotKwh, 9));

  if (window.length < slotsNeeded) {
    const maxKwh = round(window.length * perSlotKwh, 2);
    const beyondPrices = lastKnownEnd !== null && readyByMs > lastKnownEnd;
    const reason = beyondPrices && window.length < slotsNeeded
      ? `Prices are only published until the end of the last known day, and there is not enough time before that. The most this charger can add in the known hours is ${maxKwh} kWh. Tomorrow's prices are published around 14:00 Finnish time.`
      : `Not enough time: at ${chargerKw} kW the charger can add at most ${maxKwh} kWh before the ready-by time.`;
    return refuse(reason, beyondPrices ? "readyBy" : "energyKwh");
  }

  const chosen = pickCheapest(window, slotsNeeded);
  const baseline = window.slice(0, slotsNeeded);
  const planned = withEnergy(chosen, energyKwh, perSlotKwh);
  const baselinePlanned = withEnergy(baseline, energyKwh, perSlotKwh);
  const costEur = costOf(planned);
  const baselineCostEur = costOf(baselinePlanned);

  return {
    ok: true,
    plan: {
      energyKwh,
      chargerKw,
      slots: planned,
      windows: mergeWindows(planned),
      costEur,
      baselineCostEur,
      savingsEur: round(baselineCostEur - costEur, 2),
      averagePriceCents: round((costEur * 100) / energyKwh, 2),
      finishesAtMs: Math.max(...planned.map((s) => s.end)),
      // For chargers that take only one start and stop time: the cheapest unbroken block.
      continuous: continuousBlock(window, slotsNeeded, energyKwh, perSlotKwh),
      pricesIncludeVat: true,
    },
  };
}

/**
 * The cheapest run of n back-to-back slots in the window, as {start, end, costEur}, or null
 * when the window has gaps (missing prices) everywhere.
 */
function continuousBlock(window, n, energyKwh, perSlotKwh) {
  let best = null;
  for (let i = 0; i + n <= window.length; i++) {
    const run = window.slice(i, i + n);
    if (run.some((s, k) => k > 0 && run[k - 1].end !== s.start)) continue;
    const costEur = costOf(withEnergy(run, energyKwh, perSlotKwh));
    if (!best || costEur < best.costEur) best = { start: run[0].start, end: run[n - 1].end, costEur };
  }
  return best;
}

function pickCheapest(window, n) {
  return [...window]
    .sort((a, b) => a.price - b.price || a.start - b.start)
    .slice(0, n)
    .sort((a, b) => a.start - b.start);
}

// Fill slots in price order so a partly used slot is the most expensive one chosen.
function withEnergy(slots, energyKwh, perSlotKwh) {
  let remaining = energyKwh;
  const byPrice = [...slots].sort((a, b) => a.price - b.price || a.start - b.start);
  const energy = new Map();
  for (const s of byPrice) {
    const kwh = Math.min(perSlotKwh, remaining);
    energy.set(s.start, round(kwh, 4));
    remaining = round(remaining - kwh, 9);
  }
  return slots.map((s) => ({ start: s.start, end: s.end, price: s.price, kwh: energy.get(s.start) }));
}

function costOf(slots) {
  return round(slots.reduce((sum, s) => sum + (s.kwh * s.price) / 100, 0), 2);
}

/** Join back-to-back slots into windows: [{start, end, kwh, avgPrice}]. */
export function mergeWindows(slots) {
  const out = [];
  for (const s of slots) {
    const last = out[out.length - 1];
    if (last && last.end === s.start) {
      last.end = s.end;
      last.kwh = round(last.kwh + s.kwh, 4);
      last.cost += (s.kwh * s.price) / 100;
    } else {
      out.push({ start: s.start, end: s.end, kwh: s.kwh, cost: (s.kwh * s.price) / 100 });
    }
  }
  return out.map((w) => ({ start: w.start, end: w.end, kwh: round(w.kwh, 2), avgPriceCents: round((w.cost * 100) / w.kwh, 2) }));
}

/** Round half away from zero (also for negative prices), avoiding float noise. */
export function round(x, digits) {
  const f = 10 ** digits;
  const r = Math.sign(x) * Math.round(Math.abs(x) * f * (1 + Number.EPSILON)) / f;
  return Object.is(r, -0) ? 0 : r;
}
