// Fair-share night scheduler for the shared chargers: a plain function, no model involved.
//
// Rule (koivurinne-fair-share/2, published in sites/taloyhtio/js/rules.js):
//   1. The night delivers as much energy as the shared limit and the chargers allow, in total.
//      If every car can be charged in full, every car is.
//   2. Among the plans that deliver that much, the one with the lowest total cost is chosen.
//   3. Where plans cost the same, a car with an earlier ready-by time is charged first and
//      gets the cheaper slots; equal ready-by times are ordered by commitment hash, which the
//      requester cannot choose (it includes a server nonce). Then the earlier slot first.
//   4. A resident may set a maximum price (c/kWh incl. VAT): their car never charges in a
//      slot that costs more. This is the resident's mandate; no agent can widen it.
//   5. The shared limit is never exceeded, nor any car's own charger power.
//   6. Each resident pays for their own slots only: kWh x spot price, plus the fee per kWh.
//      A request that cannot be met in full reports its shortfall.
//
// Rule 1-3 is a minimum-cost maximum flow (requests -> 15-minute slots -> the shared limit),
// solved exactly with integer watt-hours. Version 1 planned cars one by one, earliest
// deadline first, and could leave a car short that a different plan would have charged in
// full (see test/arbiter.test.mjs). Claiming an earlier deadline now only wins ties.
// The same requests and prices always give the same schedule, in any input order.

export const RULE_VERSION = "koivurinne-fair-share/2";
export const SLOT_MINUTES = 15;
const SLOT_MS = SLOT_MINUTES * 60_000;
const SLOTS_PER_HOUR = 60 / SLOT_MINUTES; // Wh in a slot = W / 4.
const PRICE_SCALE = 10_000; // prices compared exactly in 1/10,000 c/kWh

export const REQUEST_LIMITS = Object.freeze({
  energyKwh: { min: 1, max: 120 },
  chargerKw: { min: 1.4, max: 22 },
  maxPriceCents: { min: -100, max: 1000 },
});

/**
 * Check one request's fields. Returns null when valid, else a reason a person can read.
 *
 * :param r: {id, commitment, energyKwh, chargerKw, fromMs, readyByMs, maxPriceCents?}.
 */
export function requestProblem(r) {
  if (!r || typeof r !== "object") return "The request is missing.";
  if (typeof r.id !== "string" || !r.id) return "The request has no ID.";
  if (typeof r.commitment !== "string" || !/^[0-9a-f]{64}$/.test(r.commitment)) return "The request has no valid commitment hash.";
  const { energyKwh: e, chargerKw: k, maxPriceCents: m } = REQUEST_LIMITS;
  if (!Number.isFinite(r.energyKwh) || r.energyKwh < e.min || r.energyKwh > e.max) return `Energy must be between ${e.min} and ${e.max} kWh.`;
  if (!Number.isFinite(r.chargerKw) || r.chargerKw < k.min || r.chargerKw > k.max) return `Charger power must be between ${k.min} and ${k.max} kW.`;
  if (r.maxPriceCents !== undefined && r.maxPriceCents !== null && (!Number.isFinite(r.maxPriceCents) || r.maxPriceCents < m.min || r.maxPriceCents > m.max)) {
    return `A maximum price must be between ${m.min} and ${m.max} c/kWh.`;
  }
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
 *     priority order (ready-by, then commitment); load is the total kW per used slot (no
 *     resident data).
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
  const order = [...(requests || [])].sort(
    (a, b) => a.readyByMs - b.readyByMs || (a.commitment < b.commitment ? -1 : a.commitment > b.commitment ? 1 : 0),
  );

  // Graph: source -> request (its energy) -> slot (its charger, in its window, at or under its
  // price cap) -> sink (the shared limit). Costs are compared as tuples, most important first:
  // [price, earlier car served first, earlier car in the cheaper slot, earlier slot].
  const n = order.length;
  const flow = new MinCostFlow(2 + n + slots.length);
  const SOURCE = 0;
  const SINK = 1;
  const slotNode = (j) => 2 + n + j;
  const limitWh = Math.floor(limitW / SLOTS_PER_HOUR);
  slots.forEach((_, j) => flow.addEdge(slotNode(j), SINK, limitWh, [0, 0, 0, 0]));
  const edges = order.map((r, i) => {
    const weight = n - i; // earlier in priority order = heavier
    flow.addEdge(SOURCE, 2 + i, Math.round(r.energyKwh * 1000), [0, 0, 0, 0]);
    const chargerWh = Math.floor(Math.round(r.chargerKw * 1000) / SLOTS_PER_HOUR);
    const cap = r.maxPriceCents ?? Infinity;
    const mine = [];
    slots.forEach((s, j) => {
      if (s.start < r.fromMs || s.end > r.readyByMs || s.price > cap) return;
      const p = Math.round(s.price * PRICE_SCALE);
      mine.push({ slot: s, edge: flow.addEdge(2 + i, slotNode(j), chargerWh, [p, -weight, weight * p, j]) });
    });
    return mine;
  });
  flow.run(SOURCE, SINK);

  const usedW = new Map();
  const assignments = order.map((r, index) => {
    const wantWh = Math.round(r.energyKwh * 1000);
    const chosen = [];
    for (const { slot: s, edge } of edges[index]) {
      const wh = flow.flowOn(edge);
      if (wh === 0) continue;
      const w = wh * SLOTS_PER_HOUR;
      usedW.set(s.start, (usedW.get(s.start) ?? 0) + w);
      chosen.push({ start: s.start, end: s.end, price: s.price, w, wh });
    }
    const deliveredWh = chosen.reduce((sum, s) => sum + s.wh, 0);
    const remainingWh = wantWh - deliveredWh;
    const energyCostCents = chosen.reduce((sum, s) => sum + (s.wh / 1000) * s.price, 0);
    const feeCents = (deliveredWh / 1000) * feeCentsPerKwh;
    const assignment = {
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
    if (r.maxPriceCents !== undefined && r.maxPriceCents !== null) assignment.maxPriceCents = r.maxPriceCents;
    // Why a request fell short, so the receipt can say it plainly: the resident's own price
    // limit (slots in the window cost more), or capacity (the shared limit, the car's charger
    // power and the window were full).
    if (remainingWh > 0) {
      const capped = Number.isFinite(r.maxPriceCents) && slots.some((s) => s.start >= r.fromMs && s.end <= r.readyByMs && s.price > r.maxPriceCents);
      assignment.shortfallReason = capped ? "price_limit" : "capacity";
    }
    return assignment;
  });

  const load = [...usedW.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, w]) => ({ start, end: start + SLOT_MS, kw: w / 1000 }));

  return { ruleVersion: RULE_VERSION, limitKw: limitW / 1000, feeCentsPerKwh, assignments, load };
}

// ---- minimum-cost maximum flow ----------------------------------------------------------

const lexLess = (a, b) => {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k];
  return false;
};
const lexAdd = (a, b) => a.map((x, k) => x + b[k]);

/**
 * Successive shortest paths with tuple costs (compared lexicographically, exact integers).
 * Small graphs only: one night has at most a few dozen requests and 36 slots.
 */
class MinCostFlow {
  constructor(size) {
    this.g = Array.from({ length: size }, () => []);
  }

  addEdge(u, v, cap, cost) {
    const e = { to: v, cap, cap0: cap, cost, rev: this.g[v].length };
    this.g[u].push(e);
    this.g[v].push({ to: u, cap: 0, cap0: 0, cost: cost.map((x) => -x), rev: this.g[u].length - 1 });
    return e;
  }

  flowOn(edge) {
    return edge.cap0 - edge.cap;
  }

  run(s, t) {
    const size = this.g.length;
    for (;;) {
      // Shortest path by queue-based Bellman-Ford (residual costs can be negative).
      const dist = new Array(size).fill(null);
      const prev = new Array(size).fill(null);
      const queued = new Array(size).fill(false);
      dist[s] = this.g[s].length ? this.g[s][0].cost.map(() => 0) : [0];
      const queue = [s];
      queued[s] = true;
      for (let head = 0; head < queue.length; head++) {
        const u = queue[head];
        queued[u] = false;
        this.g[u].forEach((e, k) => {
          if (e.cap <= 0) return;
          const d = lexAdd(dist[u], e.cost);
          if (dist[e.to] === null || lexLess(d, dist[e.to])) {
            dist[e.to] = d;
            prev[e.to] = [u, k];
            if (!queued[e.to]) {
              queued[e.to] = true;
              queue.push(e.to);
            }
          }
        });
      }
      if (dist[t] === null) return;
      let push = Infinity;
      for (let v = t; v !== s; v = prev[v][0]) push = Math.min(push, this.g[prev[v][0]][prev[v][1]].cap);
      for (let v = t; v !== s; v = prev[v][0]) {
        const e = this.g[prev[v][0]][prev[v][1]];
        e.cap -= push;
        this.g[v][e.rev].cap += push;
      }
    }
  }
}

/**
 * Keep 15-minute slots with finite prices, sorted by start. Exact duplicates are merged;
 * two different prices for one slot are refused, since either choice would depend on
 * input order. A slot off the quarter-hour grid is refused, so slots can never overlap.
 */
export function normalizePrices(prices) {
  const byStart = new Map();
  for (const p of prices || []) {
    if (!p || p.end - p.start !== SLOT_MS || !Number.isFinite(p.price) || !Number.isFinite(p.start)) continue;
    // Capacity is counted per slot start, so slots must sit on the quarter-hour grid:
    // 22:00-22:15 and 22:05-22:20 would otherwise be two buckets for the same minutes.
    if (p.start % SLOT_MS !== 0) throw new TypeError(`The slot starting ${new Date(p.start).toISOString()} is not on the 15-minute grid.`);
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
