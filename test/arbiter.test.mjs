// Arbiter core (M5a): scheduler examples, property tests over seeded random nights,
// commitments and signed receipts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newSiteKey } from "agent-trust-kit";
import { scheduleNight, requestProblem, RULE_VERSION } from "../src/arbiter/scheduler.js";
import { commitmentOf, newNonce, pricesSnapshotHash, receiptFor, signReceipt, verifyReceipt } from "../src/arbiter/receipt.js";

const SLOT = 15 * 60_000;
const T0 = Date.parse("2026-12-22T20:00:00Z"); // 22:00 in Helsinki (UTC+2)
const hex = (n) => n.toString(16).padStart(64, "0");

function nightPrices(cents) {
  return cents.map((price, i) => ({ start: T0 + i * SLOT, end: T0 + (i + 1) * SLOT, price }));
}

function req(id, energyKwh, readyBySlots, { chargerKw = 11, commitment = hex(id.charCodeAt(0)), fromSlots = 0 } = {}) {
  return { id, commitment, energyKwh, chargerKw, fromMs: T0 + fromSlots * SLOT, readyByMs: T0 + readyBySlots * SLOT };
}

// ---- examples -------------------------------------------------------------------------

test("one resident gets the cheapest slots before the deadline, last slot partly used", () => {
  const prices = nightPrices([10, 2, 8, 1, 5, 3]);
  const s = scheduleNight({ requests: [req("a", 6, 6)], prices, limitKw: 22 });
  const a = s.assignments[0];
  // 11 kW -> 2.75 kWh per slot. Cheapest: 1c (slot 3), 2c (slot 1), then 0.5 kWh at 3c (slot 5).
  assert.deepEqual(a.slots.map((x) => [(x.start - T0) / SLOT, x.kwh]), [[1, 2.75], [3, 2.75], [5, 0.5]]);
  assert.equal(a.feasible, true);
  assert.equal(a.energyCostEur, 0.1); // (2.75*2 + 2.75*1 + 0.5*3) / 100 = 0.0975
});

test("earliest deadline goes first; the later one works around it under the shared limit", () => {
  const prices = nightPrices([1, 1, 9, 9]);
  const late = req("late", 5.5, 4, { commitment: hex(1) });
  const early = req("early", 5.5, 2, { commitment: hex(2) });
  const s = scheduleNight({ requests: [late, early], prices, limitKw: 11 });
  assert.deepEqual(s.assignments.map((a) => a.id), ["early", "late"]);
  assert.deepEqual(s.assignments[0].slots.map((x) => (x.start - T0) / SLOT), [0, 1]);
  assert.deepEqual(s.assignments[1].slots.map((x) => (x.start - T0) / SLOT), [2, 3]);
});

test("equal deadlines are ordered by commitment hash, not by arrival", () => {
  const prices = nightPrices([1, 9]);
  const x = req("x", 2.75, 2, { commitment: hex(9) });
  const y = req("y", 2.75, 2, { commitment: hex(3) });
  for (const requests of [[x, y], [y, x]]) {
    const s = scheduleNight({ requests, prices, limitKw: 11 });
    assert.deepEqual(s.assignments.map((a) => [a.id, (a.slots[0].start - T0) / SLOT]), [["y", 0], ["x", 1]]);
  }
});

test("an infeasible request gets what is left and reports the shortfall", () => {
  const s = scheduleNight({ requests: [req("a", 20, 2)], prices: nightPrices([5, 5, 5]), limitKw: 22 });
  const a = s.assignments[0];
  assert.equal(a.feasible, false);
  assert.equal(a.deliveredKwh, 5.5);
  assert.equal(a.shortfallKwh, 14.5);
});

test("fee is per delivered kWh and the total adds up", () => {
  const s = scheduleNight({ requests: [req("a", 5.5, 2)], prices: nightPrices([4, 6]), limitKw: 22, feeCentsPerKwh: 2 });
  const a = s.assignments[0];
  assert.equal(a.energyCostEur, 0.28);
  assert.equal(a.feeEur, 0.11);
  assert.equal(a.totalEur, 0.39);
});

test("negative prices are used first", () => {
  const s = scheduleNight({ requests: [req("a", 2.75, 3)], prices: nightPrices([3, -1.5, 0]), limitKw: 22 });
  assert.equal((s.assignments[0].slots[0].start - T0) / SLOT, 1);
  assert.equal(s.assignments[0].energyCostEur, -0.04);
});

test("bad input is refused with a reason", () => {
  assert.match(requestProblem(req("a", 0.5, 2)), /Energy/);
  assert.match(requestProblem({ ...req("a", 5, 2), commitment: "nope" }), /commitment/);
  assert.match(requestProblem(req("a", 5, 0)), /ready-by/);
  assert.throws(() => scheduleNight({ requests: [req("a", 5, 2), req("a", 5, 2)], prices: [], limitKw: 22 }), /twice/);
  assert.throws(() => scheduleNight({ requests: [], prices: [], limitKw: 0 }), /limit/);
  const clash = [...nightPrices([1]), { start: T0, end: T0 + SLOT, price: 2 }];
  assert.throws(() => scheduleNight({ requests: [], prices: clash, limitKw: 22 }), /different prices/);
});

// ---- properties -----------------------------------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomNight(seed) {
  const r = rng(seed);
  const n = 36; // 22:00-07:00
  const prices = nightPrices(Array.from({ length: n }, () => Math.round((r() * 30 - 3) * 100) / 100));
  const chargers = [3.7, 7.4, 11, 11, 22];
  const requests = Array.from({ length: 1 + Math.floor(r() * 8) }, (_, i) => {
    const from = Math.floor(r() * 12);
    return {
      id: `r${i}`,
      commitment: hex(Math.floor(r() * 2 ** 40)),
      energyKwh: Math.round((1 + r() * 59) * 10) / 10,
      chargerKw: chargers[Math.floor(r() * chargers.length)],
      fromMs: T0 + from * SLOT,
      readyByMs: T0 + (from + 1 + Math.floor(r() * (n - from))) * SLOT,
    };
  });
  const limitKw = [11, 22, 33][Math.floor(r() * 3)];
  return { requests, prices, limitKw, r };
}

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

test("property: the shared limit is never exceeded, nor any car's own charger", () => {
  for (const seed of SEEDS) {
    const { requests, prices, limitKw } = randomNight(seed);
    const s = scheduleNight({ requests, prices, limitKw });
    const perSlot = new Map();
    for (const a of s.assignments) {
      const charger = requests.find((x) => x.id === a.id).chargerKw;
      for (const x of a.slots) {
        assert.ok(x.kw <= charger + 1e-9, `seed ${seed}: ${a.id} over its charger`);
        perSlot.set(x.start, (perSlot.get(x.start) ?? 0) + Math.round(x.kw * 1000));
      }
    }
    for (const [start, w] of perSlot) assert.ok(w <= limitKw * 1000, `seed ${seed}: ${w} W at ${start}`);
    for (const l of s.load) assert.equal(Math.round(l.kw * 1000), perSlot.get(l.start));
  }
});

test("property: no slot outside a request's window; energy adds up; shortfall only when the window is full", () => {
  for (const seed of SEEDS) {
    const { requests, prices, limitKw } = randomNight(seed);
    const s = scheduleNight({ requests, prices, limitKw });
    for (const a of s.assignments) {
      const q = requests.find((x) => x.id === a.id);
      for (const x of a.slots) assert.ok(x.start >= q.fromMs && x.end <= q.readyByMs, `seed ${seed}: ${a.id} outside window`);
      const sumWh = a.slots.reduce((t, x) => t + Math.round(x.kwh * 1000), 0);
      assert.equal(sumWh, Math.round(a.deliveredKwh * 1000));
      assert.equal(Math.round((a.deliveredKwh + a.shortfallKwh) * 1000), Math.round(q.energyKwh * 1000));
      assert.equal(a.feasible, a.shortfallKwh === 0);
      const cents = a.slots.reduce((t, x) => t + x.kwh * x.price, 0);
      assert.ok(Math.abs(a.energyCostEur - cents / 100) <= 0.005 + 1e-9, `seed ${seed}: cost is not own slots`);
      if (!a.feasible) {
        // Every slot in its window is either at this car's full power or at the shared limit.
        const loadW = new Map(s.load.map((l) => [l.start, Math.round(l.kw * 1000)]));
        for (const p of prices.filter((x) => x.start >= q.fromMs && x.end <= q.readyByMs)) {
          const mineW = Math.round((a.slots.find((x) => x.start === p.start)?.kw ?? 0) * 1000);
          const atCharger = Math.round(q.chargerKw * 1000) - mineW < 4;
          const atLimit = limitKw * 1000 - (loadW.get(p.start) ?? 0) < 4;
          assert.ok(atCharger || atLimit, `seed ${seed}: ${a.id} short but slot ${p.start} had room`);
        }
      }
    }
  }
});

// Rule version 1 (earliest deadline first, each car takes its cheapest slots in turn), kept
// as a reference: version 2 must never deliver less, nor cost more for the same energy.
function greedyV1({ requests, prices, limitKw }) {
  const limitW = Math.round(limitKw * 1000);
  const usedW = new Map();
  let deliveredWh = 0;
  let cents = 0;
  const order = [...requests].sort((a, b) => a.readyByMs - b.readyByMs || (a.commitment < b.commitment ? -1 : 1));
  for (const r of order) {
    let left = Math.round(r.energyKwh * 1000);
    const win = prices
      .filter((s) => s.start >= r.fromMs && s.end <= r.readyByMs)
      .sort((a, b) => a.price - b.price || a.start - b.start);
    for (const s of win) {
      const wh = Math.min(left, Math.floor(Math.min(Math.round(r.chargerKw * 1000), limitW - (usedW.get(s.start) ?? 0)) / 4));
      if (wh <= 0) continue;
      usedW.set(s.start, (usedW.get(s.start) ?? 0) + wh * 4);
      left -= wh;
      deliveredWh += wh;
      cents += (wh / 1000) * s.price;
    }
  }
  return { deliveredWh, cents };
}

const totals = (s) => ({
  deliveredWh: s.assignments.reduce((t, a) => t + Math.round(a.deliveredKwh * 1000), 0),
  cents: s.assignments.reduce((t, a) => t + a.slots.reduce((u, x) => u + x.kwh * x.price, 0), 0),
});

test("rule 2: no avoidable shortfall (version 1 left a car 0.5 kWh short here)", () => {
  // Three slots, prices rising, 4 kW shared. A: 1 kWh by slot 2 on a 4 kW charger. B: 1.5 kWh
  // by slot 3 on a 2 kW charger. Version 1 gave A all of slot 1, so B could only get 1 kWh.
  const prices = nightPrices([1, 2, 3]);
  const a = req("a", 1, 2, { chargerKw: 4, commitment: hex(1) });
  const b = req("b", 1.5, 3, { chargerKw: 2, commitment: hex(2) });
  assert.equal(greedyV1({ requests: [a, b], prices, limitKw: 4 }).deliveredWh, 2000);
  const s = scheduleNight({ requests: [a, b], prices, limitKw: 4 });
  assert.deepEqual(s.assignments.map((x) => [x.id, x.feasible]), [["a", true], ["b", true]]);
  assert.ok(s.load.every((l) => l.kw <= 4));
});

test("rule 3: at equal total cost, the earlier ready-by gets the cheaper slot", () => {
  const prices = nightPrices([1, 5]);
  const early = req("early", 2.75, 2, { commitment: hex(9) });
  const late = req("late", 2.75, 2, { fromSlots: 0, commitment: hex(1) });
  late.readyByMs += 1; // a minute later, same window
  const s = scheduleNight({ requests: [late, early], prices, limitKw: 11 });
  assert.deepEqual(s.assignments.map((a) => [a.id, a.slots.map((x) => (x.start - T0) / SLOT)]), [["early", [0]], ["late", [1]]]);
});

test("rule 4: a car never charges above its resident's maximum price", () => {
  const prices = nightPrices([3, 12, 4, 20]);
  const s = scheduleNight({ requests: [{ ...req("a", 11, 4), maxPriceCents: 5 }], prices, limitKw: 22 });
  const a = s.assignments[0];
  assert.deepEqual(a.slots.map((x) => x.price), [3, 4]);
  assert.equal(a.deliveredKwh, 5.5);
  assert.equal(a.shortfallKwh, 5.5);
  assert.equal(a.maxPriceCents, 5);
  assert.match(requestProblem({ ...req("b", 5, 4), maxPriceCents: 5000 }), /maximum price/);
});

test("property: version 2 never delivers less than version 1, nor costs more for the same energy", () => {
  for (const seed of SEEDS) {
    const { requests, prices, limitKw } = randomNight(seed);
    const v1 = greedyV1({ requests, prices, limitKw });
    const v2 = totals(scheduleNight({ requests, prices, limitKw }));
    assert.ok(v2.deliveredWh >= v1.deliveredWh, `seed ${seed}: ${v2.deliveredWh} < ${v1.deliveredWh}`);
    if (v2.deliveredWh === v1.deliveredWh) assert.ok(v2.cents <= v1.cents + 1e-6, `seed ${seed}: costs more`);
  }
});

test("a full demo night (50 requests, 36 slots) plans quickly", () => {
  const prices = nightPrices(Array.from({ length: 36 }, (_, i) => 2 + ((i * 7) % 11) - (i === 20 ? 4 : 0)));
  const requests = Array.from({ length: 50 }, (_, i) => req(`r${i}`, 5 + (i % 30), 12 + (i % 25), { chargerKw: [3.7, 7.4, 11][i % 3], commitment: hex(1000 + i), fromSlots: i % 6 }));
  const t = performance.now();
  scheduleNight({ requests, prices, limitKw: 22 });
  const ms = performance.now() - t;
  assert.ok(ms < 500, `${ms.toFixed(0)} ms`);
});

test("property: same input gives the same output, in any order", () => {
  for (const seed of SEEDS) {
    const { requests, prices, limitKw, r } = randomNight(seed);
    const a = scheduleNight({ requests, prices, limitKw });
    const shuffle = (xs) => xs.map((x) => [r(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
    const b = scheduleNight({ requests: shuffle(requests), prices: shuffle(prices), limitKw });
    assert.deepEqual(b, a, `seed ${seed}`);
  }
});

// ---- commitments and receipts ---------------------------------------------------------

const sealed = { resident: "B12", night: "2026-12-22", energyKwh: 20, chargerKw: 11, fromMs: T0, readyByMs: T0 + 36 * SLOT };

test("commitments depend on every sealed field and the nonce", async () => {
  const nonce = newNonce();
  const c = await commitmentOf(sealed, nonce);
  assert.match(c, /^[0-9a-f]{64}$/);
  assert.equal(await commitmentOf({ ...sealed }, nonce), c);
  assert.notEqual(await commitmentOf({ ...sealed, energyKwh: 21 }, nonce), c);
  assert.notEqual(await commitmentOf(sealed, newNonce()), c);
  await assert.rejects(commitmentOf(sealed, "short"), /nonce/);
});

test("a receipt is signed, verifies, names only its own request and is bound to the prices", async () => {
  const { privateJwk, publicJwk } = await newSiteKey();
  const jwks = { keys: [publicJwk] };
  const issuer = "https://taloyhtio.example";
  const prices = nightPrices(Array.from({ length: 36 }, (_, i) => (i * 7) % 13));
  const mine = { ...req("mine", 20, 36), commitment: await commitmentOf(sealed, newNonce()) };
  const theirs = req("theirs", 10, 20);
  const schedule = scheduleNight({ requests: [mine, theirs], prices, limitKw: 22, feeCentsPerKwh: 2 });
  const pricesSha256 = await pricesSnapshotHash(prices);
  assert.equal(await pricesSnapshotHash([...prices].reverse()), pricesSha256);

  const statement = receiptFor({ schedule, requestId: "mine", issuer, night: "2026-12-22", pricesSha256, now: T0 });
  assert.equal(statement.rule_version, RULE_VERSION);
  assert.ok(!JSON.stringify(statement).includes("theirs"));

  const jws = await signReceipt(statement, privateJwk);
  const ok = await verifyReceipt(jws, { issuer, jwks });
  assert.equal(ok.ok, true, ok.reason);
  assert.deepEqual(ok.receipt, statement);

  assert.equal((await verifyReceipt(jws, { issuer: "https://other.example", jwks })).ok, false);
  const [h, p, sig] = jws.split(".");
  const forged = Buffer.from(JSON.stringify({ ...statement, cost: { ...statement.cost, total_eur: 0 } })).toString("base64url");
  assert.equal((await verifyReceipt(`${h}.${forged}.${sig}`, { issuer, jwks })).ok, false);
  assert.ok(p);
});
