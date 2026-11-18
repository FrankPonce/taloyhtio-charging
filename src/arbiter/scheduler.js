// Fair-share night scheduler for the shared chargers: a plain function, no model involved.
//
// Rule (koivurinne-fair-share/1, published in sites/taloyhtio/js/rules.js):
//   1. Requests are planned in order of ready-by time, earliest first. Equal ready-by times
//      are ordered by commitment hash, which the requester cannot choose (it includes a
//      server nonce), so arriving first or last gives no advantage.
//   2. Each request gets the cheapest 15-minute slots that finish before its ready-by time,
//      using what is left of the shared limit and at most its own charger's power.
//      Equal prices: the earlier slot first. The last slot may be only partly used.
//   3. The shared limit is never exceeded.
//   4. Each resident pays for their own slots only: kWh x spot price, plus the fee per kWh.
//   5. If a request cannot be met in full, it gets everything that was still free in its
//      window, and the shortfall is reported. Nothing is taken from earlier requests.
//
// All power and energy is integer watts and watt-hours inside, so limits hold exactly.
// The same requests and prices always give the same schedule, in any input order.

export const RULE_VERSION = "koivurinne-fair-share/1";
export const SLOT_MINUTES = 15;
const SLOT_MS = SLOT_MINUTES * 60_000;
const SLOTS_PER_HOUR = 60 / SLOT_MINUTES; // Wh in a slot = W / 4.

export const REQUEST_LIMITS = Object.freeze({
  energyKwh: { min: 1, max: 120 },
  chargerKw: { min: 1.4, max: 22 },
});

/**
 * Check one request's fields. Returns null when valid, else a reason a person can read.
 *
 * :param r: {id, commitment, energyKwh, chargerKw, fromMs, readyByMs}.
 */
export function requestProblem(r) {
  if (!r || typeof r !== "object") return "The request is missing.";
  if (typeof r.id !== "string" || !r.id) return "The request has no ID.";
  if (typeof r.commitment !== "string" || !/^[0-9a-f]{64}$/.test(r.commitment)) return "The request has no valid commitment hash.";
  const { energyKwh: e, chargerKw: k } = REQUEST_LIMITS;
  if (!Number.isFinite(r.energyKwh) || r.energyKwh < e.min || r.energyKwh > e.max) return `Energy must be between ${e.min} and ${e.max} kWh.`;
  if (!Number.isFinite(r.chargerKw) || r.chargerKw < k.min || r.chargerKw > k.max) return `Charger power must be between ${k.min} and ${k.max} kW.`;
  if (!Number.isFinite(r.fromMs) || !Number.isFinite(r.readyByMs)) return "The request needs a start and a ready-by time.";
  if (r.readyByMs <= r.fromMs) return "The ready-by time must be after the start.";
  return null;
}

/**
 * Plan one night for all requests.
 *
 * :param input: {requests, prices, limitKw, feeCentsPerKwh = 0}. prices is
 *     [{start, end, price}] (epoch ms, c/kWh incl. VAT); only 15-minute slots are used.
 * :return: {ruleVersion, limitKw, feeCentsPerKwh, assignments, load}. assignments are in
 *     planning order; load is the total kW per used slot (no resident data).
 * :raises TypeError: On an invalid request, duplicate IDs or an invalid limit.
 */
export function scheduleNight({ requests, prices, limitKw, feeCentsPerKwh = 0 }) {
  if (!Number.isFinite(limitKw) || limitKw <= 0) throw new TypeError("The shared limit must be a positive number of kW.");
  if (!Number.isFinite(feeCentsPerKwh) || feeCentsPerKwh < 0) throw new TypeError("The fee must be zero or more.");
  const ids = new Set();
  for (const r of requests || []) {
    const problem = requestProblem(r);
    if (problem) throw new TypeError(`Request ${r?.id ?? "?"}: ${problem}`);
    if (ids.has(r.id)) throw new TypeError(`Request ID ${r.id} appears twice.`);
    ids.add(r.id);
  }

  const slots = normalizePrices(prices);
  const limitW = Math.round(limitKw * 1000);
  const usedW = new Map(); // slot start -> W already given out

  const order = [...(requests || [])].sort(
    (a, b) => a.readyByMs - b.readyByMs || (a.commitment < b.commitment ? -1 : a.commitment > b.commitment ? 1 : 0),
  );

  const assignments = order.map((r, index) => {
    const chargerW = Math.round(r.chargerKw * 1000);
    const wantWh = Math.round(r.energyKwh * 1000);
    const window = slots
      .filter((s) => s.start >= r.fromMs && s.end <= r.readyByMs)
      .map((s) => ({ ...s, maxWh: Math.floor(Math.min(chargerW, limitW - (usedW.get(s.start) ?? 0)) / SLOTS_PER_HOUR) }))
      .filter((s) => s.maxWh > 0)
      .sort((a, b) => a.price - b.price || a.start - b.start);

    let remainingWh = wantWh;
    const chosen = [];
    for (const s of window) {
      if (remainingWh === 0) break;
      const wh = Math.min(s.maxWh, remainingWh);
      const w = wh * SLOTS_PER_HOUR;
      usedW.set(s.start, (usedW.get(s.start) ?? 0) + w);
      remainingWh -= wh;
      chosen.push({ start: s.start, end: s.end, price: s.price, w, wh });
    }
    chosen.sort((a, b) => a.start - b.start);

    const deliveredWh = wantWh - remainingWh;
    const energyCostCents = chosen.reduce((sum, s) => sum + (s.wh / 1000) * s.price, 0);
    const feeCents = (deliveredWh / 1000) * feeCentsPerKwh;
    return {
      id: r.id,
      commitment: r.commitment,
      position: index + 1,
      requestedKwh: wantWh / 1000,
      deliveredKwh: deliveredWh / 1000,
      shortfallKwh: remainingWh / 1000,
      feasible: remainingWh === 0,
      slots: chosen.map((s) => ({ start: s.start, end: s.end, kw: s.w / 1000, kwh: s.wh / 1000, price: s.price })),
      energyCostEur: round(energyCostCents / 100, 2),
      feeEur: round(feeCents / 100, 2),
      totalEur: round((energyCostCents + feeCents) / 100, 2),
    };
  });

  const load = [...usedW.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, w]) => ({ start, end: start + SLOT_MS, kw: w / 1000 }));

  return { ruleVersion: RULE_VERSION, limitKw: limitW / 1000, feeCentsPerKwh, assignments, load };
}

/**
 * Keep 15-minute slots with finite prices, sorted by start. Exact duplicates are merged;
 * two different prices for one slot are refused, since either choice would depend on
 * input order.
 */
export function normalizePrices(prices) {
  const byStart = new Map();
  for (const p of prices || []) {
    if (!p || p.end - p.start !== SLOT_MS || !Number.isFinite(p.price) || !Number.isFinite(p.start)) continue;
    const seen = byStart.get(p.start);
    if (seen && seen.price !== p.price) throw new TypeError(`Two different prices for the slot starting ${new Date(p.start).toISOString()}.`);
    if (!seen) byStart.set(p.start, { start: p.start, end: p.end, price: p.price });
  }
  return [...byStart.values()].sort((a, b) => a.start - b.start);
}

/** Round half away from zero, avoiding float noise. */
export function round(x, digits) {
  const f = 10 ** digits;
  const r = (Math.sign(x) * Math.round(Math.abs(x) * f * (1 + Number.EPSILON))) / f;
  return Object.is(r, -0) ? 0 : r;
}
