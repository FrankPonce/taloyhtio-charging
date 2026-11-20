// Practice night: the real scheduler and receipt key, real-shaped prices, three simulated
// neighbours; the answer carries every input, so anyone can re-run the plan and check it.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { keyDirectory, newSiteKey } from "agent-trust-kit";
import { NEIGHBOURS, YOU, clearPracticeCache, handlePracticeNight, practiceNight } from "../src/arbiter/practice.js";
import { scheduleNight } from "../src/arbiter/scheduler.js";
import { pricesSnapshotHash, verifyReceipt } from "../src/arbiter/receipt.js";

const ISSUER = "https://taloyhtio.example";
const NOW = Date.parse("2026-12-22T10:00:00Z"); // 12:00 in Helsinki: tonight's prices not out yet

beforeEach(() => clearPracticeCache());

/** Price API: days up to and including `latest` are published; later days 404. */
function priceApi(latest = "2026-12-22") {
  const calls = [];
  const fetchImpl = async (url) => {
    const day = new URL(url).searchParams.get("day");
    calls.push(day);
    if (day > latest) return new Response("not yet", { status: 404 });
    const start = Date.parse(`${day}T00:00:00+02:00`);
    const points = Array.from({ length: 96 }, (_, i) => ({
      start: new Date(start + i * 900_000).toISOString(),
      end: new Date(start + (i + 1) * 900_000).toISOString(),
      price: (i < 24 ? 2 + (i % 5) * 0.75 : i >= 88 ? 7 - (i % 3) : 10 + (i % 7)),
    }));
    return new Response(JSON.stringify({ date: day, available: true, complete: true, points }));
  };
  return { fetchImpl, calls };
}

test("plans you with three simulated neighbours on the latest published night; signed, marked practice", async () => {
  const { privateJwk, publicJwk } = await newSiteKey();
  const api = priceApi();
  const r = await practiceNight({ energyKwh: 25, readyBy: "07:00", maxPriceCents: 4 }, { now: NOW, fetchImpl: api.fetchImpl, privateJwk, issuer: ISSUER });
  assert.equal(r.night, "2026-12-21", "tonight needs tomorrow's prices, not out at 12:00, so last night is used");
  const v = await verifyReceipt(r.receipt_jws, { issuer: ISSUER, jwks: await keyDirectory([publicJwk]) });
  assert.equal(v.ok, true, v.reason);
  assert.equal(v.receipt.practice, true);
  assert.equal(v.receipt.request_id, YOU);
  assert.equal(v.receipt.schedule.max_price_cents, 4);
  assert.ok(v.receipt.schedule.slots.every((s) => s.price_cents <= 4));
  assert.equal(r.inputs.requests.length, NEIGHBOURS.length + 1);
  assert.ok(r.inputs.requests.filter((x) => x.id !== YOU).every((x) => /simulated/.test(x.label)));
  assert.ok(r.load.every((l) => l.kw <= r.inputs.limitKw));
});

test("anyone can re-run the published inputs and get exactly the signed plan", async () => {
  const { privateJwk } = await newSiteKey();
  const r = await practiceNight({ energyKwh: 40, readyBy: "05:00" }, { now: NOW, fetchImpl: priceApi().fetchImpl, privateJwk, issuer: ISSUER });
  const again = scheduleNight({ requests: r.inputs.requests, prices: r.inputs.prices, limitKw: r.inputs.limitKw, feeCentsPerKwh: r.inputs.feeCentsPerKwh });
  const mine = again.assignments.find((a) => a.id === YOU);
  assert.deepEqual(
    r.receipt.schedule.slots,
    mine.slots.map((s) => ({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString(), kw: s.kw, kwh: s.kwh, price_cents: s.price })),
  );
  assert.deepEqual(again.load, r.load);
  assert.equal(r.receipt.prices_snapshot_sha256, await pricesSnapshotHash(r.inputs.prices));
  assert.equal(r.receipt.rule_version, again.ruleVersion);
});

test("HTTP: own page only, input checked, price service down says so", async () => {
  const { privateJwk } = await newSiteKey();
  const opts = { now: NOW, fetchImpl: priceApi().fetchImpl, privateJwk, issuer: ISSUER };
  const post = (body, origin = ISSUER) => new Request(`${ISSUER}/api/practice-night`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await handlePracticeNight(post({ energy_kwh: 20, ready_by: "07:00" }, "https://elsewhere.example"), {}, opts)).status, 403);
  assert.equal((await handlePracticeNight(post({ energy_kwh: 500, ready_by: "07:00" }), {}, opts)).status, 400);
  assert.equal((await handlePracticeNight(post({ energy_kwh: 20, ready_by: "12:00" }), {}, opts)).status, 400);
  const ok = await handlePracticeNight(post({ energy_kwh: 20, ready_by: "07:00" }), {}, opts);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).practice, true);
  clearPracticeCache();
  const down = await handlePracticeNight(post({ energy_kwh: 20, ready_by: "07:00" }), {}, { ...opts, fetchImpl: async () => new Response("x", { status: 503 }) });
  assert.equal(down.status, 503);
  assert.match((await down.json()).error, /No recent night has published prices/);
});

test("the page's checker passes a genuine answer and catches each kind of tampering", async () => {
  const { checkPracticeNight, canonicalJson } = await import("../sites/taloyhtio/js/verify-night.js");
  const { canonicalJson: kitJson } = await import("agent-trust-kit");
  const { privateJwk, publicJwk } = await newSiteKey();
  const dir = await keyDirectory([publicJwk]);
  const r = await practiceNight({ energyKwh: 30, readyBy: "06:30", maxPriceCents: 5 }, { now: NOW, fetchImpl: priceApi().fetchImpl, privateJwk, issuer: ISSUER });
  assert.equal(canonicalJson(r.inputs.prices), kitJson(r.inputs.prices), "same JCS as the kit");
  const good = await checkPracticeNight(r, { keyDirectory: dir, issuer: ISSUER });
  assert.deepEqual(good.map((c) => [c.id, c.ok]), [["signature", true], ["prices", true], ["plan", true]], JSON.stringify(good));

  const clone = () => JSON.parse(JSON.stringify(r));
  const cheaper = clone();
  cheaper.inputs.prices[3].price -= 1;
  assert.equal((await checkPracticeNight(cheaper, { keyDirectory: dir, issuer: ISSUER })).find((c) => c.id === "prices").ok, false);
  const bigger = clone();
  bigger.inputs.requests.find((x) => x.id === YOU).energyKwh += 10;
  assert.equal((await checkPracticeNight(bigger, { keyDirectory: dir, issuer: ISSUER })).find((c) => c.id === "plan").ok, false);
  const otherKey = await checkPracticeNight(r, { keyDirectory: await keyDirectory([(await newSiteKey()).publicJwk]), issuer: ISSUER });
  assert.equal(otherKey[0].ok, false);
  const forged = clone();
  const [h, , s] = forged.receipt_jws.split(".");
  forged.receipt_jws = `${h}.${Buffer.from(JSON.stringify({ ...r.receipt, cost: { ...r.receipt.cost, total_eur: 0 } })).toString("base64url")}.${s}`;
  assert.equal((await checkPracticeNight(forged, { keyDirectory: dir, issuer: ISSUER }))[0].ok, false);
});

test("the page's scheduler is a byte-for-byte copy of the arbiter's", async () => {
  const { readFile } = await import("node:fs/promises");
  const a = await readFile(new URL("../src/arbiter/scheduler.js", import.meta.url), "utf8");
  const b = await readFile(new URL("../sites/taloyhtio/js/scheduler.js", import.meta.url), "utf8");
  assert.equal(b, a, "copy src/arbiter/scheduler.js to sites/taloyhtio/js/scheduler.js");
});
