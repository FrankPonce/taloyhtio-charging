import { test } from "node:test";
import assert from "node:assert/strict";
import { planCharging, mergeWindows } from "../sites/charge/js/planner.js";
import { fromHelsinkiLocal, toHelsinkiLocal, helsinkiDate, addDays } from "../sites/charge/js/time.js";
import { normalizeDay, loadPrices } from "../sites/charge/js/prices.js";
import { App } from "../sites/charge/js/app.js";

const Q = 15 * 60_000;
const T0 = Date.parse("2026-11-17T22:00:00Z"); // 00:00 Helsinki, Wed 18 Nov (UTC+2)

/** Prices: one slot per entry, starting at T0. */
const slotsFrom = (prices, start = T0) => prices.map((price, i) => ({ start: start + i * Q, end: start + (i + 1) * Q, price }));

// ---- time ------------------------------------------------------------------

test("Helsinki local time round-trips in winter and summer", () => {
  assert.equal(fromHelsinkiLocal("2026-11-18T07:00"), Date.parse("2026-11-18T05:00:00Z")); // UTC+2
  assert.equal(fromHelsinkiLocal("2026-07-01T07:00"), Date.parse("2026-07-01T04:00:00Z")); // UTC+3
  assert.equal(toHelsinkiLocal(Date.parse("2026-11-18T05:00:00Z")), "2026-11-18T07:00");
});

test("a time skipped by the spring DST change is refused, bad text is refused", () => {
  // 29 Mar 2026: Helsinki jumps from 03:00 to 04:00.
  assert.equal(fromHelsinkiLocal("2026-03-29T03:30"), null);
  assert.equal(fromHelsinkiLocal("2026-03-29T04:30"), Date.parse("2026-03-29T01:30:00Z"));
  for (const bad of ["07:00", "2026-11-18 07:00", "2026-13-01T07:00", "2026-11-18T24:00", "", null, undefined]) {
    assert.equal(fromHelsinkiLocal(bad), null, String(bad));
  }
});

test("dates are Helsinki dates, not UTC dates", () => {
  assert.equal(helsinkiDate(Date.parse("2026-11-17T22:30:00Z")), "2026-11-18");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

// ---- planner -----------------------------------------------------------------

test("picks the cheapest slots, in time order, and prices them by hand", () => {
  // 8 slots; 11 kW gives 2.75 kWh per slot. 5.5 kWh needs exactly 2 slots.
  const prices = slotsFrom([10, 3, 8, 1, 9, 2, 7, 6]);
  const r = planCharging({ energyKwh: 5.5, chargerKw: 11, fromMs: T0, readyByMs: T0 + 8 * Q, prices });
  assert.equal(r.ok, true);
  assert.deepEqual(r.plan.slots.map((s) => s.price), [1, 2]);
  assert.deepEqual(r.plan.slots.map((s) => s.start), [T0 + 3 * Q, T0 + 5 * Q]);
  assert.equal(r.plan.costEur, 0.08); // 2.75*0.01 + 2.75*0.02 = 0.0825 -> 0.08
  assert.equal(r.plan.baselineCostEur, 0.36); // 2.75*0.10 + 2.75*0.03 = 0.3575
  assert.equal(r.plan.savingsEur, 0.28);
  assert.equal(r.plan.windows.length, 2);
});

test("the last slot is partly used, and it is the dearest one chosen", () => {
  // 3.4 kW -> 0.85 kWh per slot. 2 kWh needs 3 slots: 0.85 + 0.85 + 0.30.
  const prices = slotsFrom([5, 4, 1, 2, 9]);
  const r = planCharging({ energyKwh: 2, chargerKw: 3.4, fromMs: T0, readyByMs: T0 + 5 * Q, prices });
  assert.equal(r.ok, true);
  const byPrice = Object.fromEntries(r.plan.slots.map((s) => [s.price, s.kwh]));
  assert.deepEqual(byPrice, { 1: 0.85, 2: 0.85, 4: 0.3 });
  assert.equal(r.plan.slots.reduce((s, x) => s + x.kwh, 0).toFixed(2), "2.00");
});

test("equal prices: the earlier slot wins", () => {
  const prices = slotsFrom([5, 5, 5, 5]);
  const r = planCharging({ energyKwh: 2.75, chargerKw: 11, fromMs: T0, readyByMs: T0 + 4 * Q, prices });
  assert.deepEqual(r.plan.slots.map((s) => s.start), [T0]);
});

test("negative prices are used and lower the cost", () => {
  const prices = slotsFrom([4, -2, 3]);
  const r = planCharging({ energyKwh: 2.75, chargerKw: 11, fromMs: T0, readyByMs: T0 + 3 * Q, prices });
  assert.equal(r.plan.slots[0].price, -2);
  assert.equal(r.plan.costEur, -0.06); // 2.75 * -0.02 = -0.055 -> -0.06 (half away from zero)
});

test("only slots fully inside [from, readyBy] are used", () => {
  const prices = slotsFrom([1, 1, 50, 50, 1, 1]);
  // From mid-slot 0 to mid-slot 5: slots 1..4 are inside.
  const r = planCharging({ energyKwh: 5.5, chargerKw: 11, fromMs: T0 + Q / 2, readyByMs: T0 + 5 * Q + Q / 2, prices });
  assert.deepEqual(r.plan.slots.map((s) => (s.start - T0) / Q), [1, 4]);
});

test("refusals: limits, past deadline, not enough time, prices not published", () => {
  const prices = slotsFrom([1, 2, 3, 4]);
  const base = { energyKwh: 5, chargerKw: 11, fromMs: T0, readyByMs: T0 + 4 * Q, prices };
  assert.equal(planCharging({ ...base, energyKwh: 0.5 }).field, "energyKwh");
  assert.equal(planCharging({ ...base, energyKwh: 121 }).field, "energyKwh");
  assert.equal(planCharging({ ...base, chargerKw: 1 }).field, "chargerKw");
  assert.equal(planCharging({ ...base, chargerKw: 23 }).field, "chargerKw");
  assert.equal(planCharging({ ...base, readyByMs: T0 }).field, "readyBy");
  assert.equal(planCharging({ ...base, readyByMs: NaN }).field, "readyBy");
  const tight = planCharging({ ...base, energyKwh: 20 });
  assert.equal(tight.ok, false);
  assert.match(tight.reason, /at most 11 kWh/);
  const beyond = planCharging({ ...base, energyKwh: 20, readyByMs: T0 + 40 * Q });
  assert.equal(beyond.field, "readyBy");
  assert.match(beyond.reason, /14:00/);
});

test("limits are inclusive", () => {
  const prices = slotsFrom(new Array(96).fill(5));
  const ok = (a) => planCharging({ fromMs: T0, readyByMs: T0 + 96 * Q, prices, ...a }).ok;
  assert.equal(ok({ energyKwh: 1, chargerKw: 1.4 }), true);
  assert.equal(ok({ energyKwh: 120, chargerKw: 22 }), true);
});

test("mergeWindows joins back-to-back slots", () => {
  const w = mergeWindows([
    { start: 0, end: Q, price: 2, kwh: 1 },
    { start: Q, end: 2 * Q, price: 4, kwh: 1 },
    { start: 3 * Q, end: 4 * Q, price: 1, kwh: 1 },
  ]);
  assert.deepEqual(w.map((x) => [x.start, x.end, x.kwh, x.avgPriceCents]), [[0, 2 * Q, 2, 3], [3 * Q, 4 * Q, 1, 1]]);
});

// ---- prices --------------------------------------------------------------------

test("normalizeDay keeps valid points and handles unpublished days", () => {
  const day = normalizeDay({ date: "2026-11-18", available: true, complete: true, points: [
    { start: "2026-11-17T22:00:00Z", end: "2026-11-17T22:15:00Z", price: 3.5 },
    { start: "bad", end: "2026-11-17T22:30:00Z", price: 1 },
  ] });
  assert.equal(day.available, true);
  assert.equal(day.points.length, 1);
  assert.equal(normalizeDay({ date: "2026-11-19", available: false, reason: "not_published" }).available, false);
});

test("loadPrices fetches both days, caches complete days, survives a failed day", async () => {
  const calls = [];
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("2026-11-19")) throw new Error("offline");
    return { ok: true, json: async () => ({ date: "2026-11-18", available: true, complete: true, points: [{ start: "2026-11-17T22:00:00Z", end: "2026-11-17T22:15:00Z", price: 2 }] }) };
  };
  const nowMs = Date.parse("2026-11-18T08:00:00Z");
  const first = await loadPrices({ nowMs, fetchImpl, storage });
  assert.equal(first.today.available, true);
  assert.equal(first.tomorrow.available, false);
  assert.match(first.tomorrow.error, /Could not load/);
  assert.equal(first.slots.length, 1);
  assert.ok(calls.every((u) => u.startsWith("https://api.sähkönhintanyt.org/v1/prices?zone=FI&day=")));
  await loadPrices({ nowMs, fetchImpl, storage });
  assert.equal(calls.filter((u) => u.includes("2026-11-18")).length, 1, "today is cached after the first load");
});

// ---- page object (no document) ----------------------------------------------------

function appAt(nowIso, prices) {
  const nowMs = Date.parse(nowIso);
  const app = new App({ doc: null, now: () => nowMs, pricesLoader: async () => ({
    today: { date: "2026-11-18", available: true, complete: true, points: prices },
    tomorrow: { date: "2026-11-19", available: false, complete: false, points: [] },
    slots: prices,
  }) });
  return app;
}

test("previewPlan uses Finnish local time and returns readable amounts", async () => {
  const prices = slotsFrom(Array.from({ length: 96 }, (_, i) => (i >= 8 && i < 16 ? 1 : 20))); // 02:00–04:00 cheap
  const app = appAt("2026-11-17T22:00:00Z", prices);
  await app.start();
  const r = app.previewPlan({ energyKwh: 22, chargerKw: 11, readyBy: "2026-11-18T07:00" });
  assert.equal(r.ok, true);
  assert.equal(r.plan.windows.length, 1);
  assert.equal(r.plan.windows[0].from.clock, "02:00");
  assert.equal(r.plan.windows[0].until.clock, "04:00");
  assert.equal(r.plan.cost, "€0.22");
  assert.equal(r.plan.readyBy.local, "2026-11-18T07:00");
  assert.equal(app.getState().shownPlan, null, "preview does not change the page state");
});

test("showPlan updates the form and shown plan; a refusal changes nothing", async () => {
  const prices = slotsFrom(new Array(96).fill(5));
  const app = appAt("2026-11-17T22:00:00Z", prices);
  await app.start();
  const before = JSON.stringify(app.getState());
  const bad = app.showPlan({ energyKwh: 10, chargerKw: 11, readyBy: "tomorrow 7" });
  assert.equal(bad.ok, false);
  assert.equal(bad.field, "readyBy");
  assert.equal(JSON.stringify(app.getState()), before);
  const good = app.showPlan({ energyKwh: 10, chargerKw: 11, readyBy: "2026-11-18T07:00" });
  assert.equal(good.ok, true);
  const s = app.getState();
  assert.deepEqual(s.form, { energyKwh: 10, chargerKw: 11, readyBy: "2026-11-18T07:00" });
  assert.equal(s.shownPlan.cost, good.plan.cost);
});

test("state is plain JSON with today's date and tomorrow's publication note", async () => {
  const app = appAt("2026-11-18T08:00:00Z", slotsFrom(new Array(96).fill(5)));
  await app.start();
  const s = app.getState();
  assert.equal(s.today.date, "2026-11-18");
  assert.equal(s.prices.tomorrow.available, false);
  assert.match(s.prices.tomorrow.note, /14:00/);
  assert.ok(s.prices.hourlyFromNow.length > 0 && s.prices.hourlyFromNow.length <= 24);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(s)));
});

test("a split plan also offers the cheapest single session, and says it needs a schedule", async () => {
  const { continuousNote } = await import("../sites/charge/js/app.js");
  // 4 kW: 1 kWh per slot, 2 kWh needed. Cheapest two slots are 0 and 3 (split); the cheapest
  // back-to-back pair is 0-1 (1 + 6 = 7 c) vs 2-3 (8 + 2) vs 1-2 (6 + 8).
  const r = planCharging({ energyKwh: 2, chargerKw: 4, fromMs: T0, readyByMs: T0 + 4 * Q, prices: slotsFrom([1, 6, 8, 2]) });
  assert.equal(r.ok, true);
  assert.equal(r.plan.windows.length, 2);
  assert.deepEqual(r.plan.continuous, { start: T0, end: T0 + 2 * Q, costEur: 0.07 });
  assert.match(continuousNote(r.plan), /2 separate windows, so your car or charger app must take a charging schedule\. One continuous session instead: .*00:00–00:30, €0\.07 \(€0\.04 more\)/);
  const one = planCharging({ energyKwh: 2, chargerKw: 4, fromMs: T0, readyByMs: T0 + 4 * Q, prices: slotsFrom([1, 2, 8, 9]) });
  assert.equal(continuousNote(one.plan), null, "one window needs no note");
});
