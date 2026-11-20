// M5a exit gate: a scripted client submits 5 residents' requests through the arbiter's MCP
// endpoint and gets back valid, signed, deterministic receipts. Runs the real handler on a
// real SQLite database with the D1 migrations; only the price API and the clock are faked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keyDirectory, newSiteKey, sha256Hex } from "agent-trust-kit";
import { migratedDb } from "./d1-sqlite.mjs";
import { handleArbiterMcp } from "../src/arbiter/mcp.js";
import { nightTerms, readyByOf, openNight, planClosedNight } from "../src/arbiter/service.js";
import { scheduleNight } from "../src/arbiter/scheduler.js";
import { pricesSnapshotHash, verifyReceipt } from "../src/arbiter/receipt.js";

const ISSUER = "https://taloyhtio.example";
const NIGHT = "2026-12-22";
const BEFORE = Date.parse("2026-12-22T10:00:00Z"); // 12:00 in Helsinki
const AFTER = Date.parse("2026-12-22T16:30:00Z"); // 18:30 in Helsinki
const RESIDENTS = [
  { id: "A1", code: "koivu-A1-7741" },
  { id: "A2", code: "koivu-A2-1186" },
  { id: "B5", code: "koivu-B5-4410" },
  { id: "B7", code: "koivu-B7-9023" },
  { id: "C3", code: "koivu-C3-3367" },
  { id: "C4", code: "koivu-C4-5852" },
];

/** A fake price API: every 15-minute slot of a Helsinki day, with a night dip. */
function priceApi() {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const day = new URL(url).searchParams.get("day");
    const start = Date.parse(`${day}T00:00:00+02:00`);
    const points = Array.from({ length: 96 }, (_, i) => {
      const s = start + i * 900_000;
      const hour = (i / 4) | 0;
      const price = hour < 6 ? 2 + (i % 4) * 0.25 : hour >= 22 ? 6 - (i % 4) * 0.5 : 9 + (i % 7);
      return { start: new Date(s).toISOString(), end: new Date(s + 900_000).toISOString(), price };
    });
    return new Response(JSON.stringify({ date: day, available: true, complete: true, points }), { headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}

async function setup() {
  const db = await migratedDb();
  for (const r of RESIDENTS) {
    await db.prepare("INSERT INTO residents (id, code_sha256, label, created_at) VALUES (?, ?, ?, ?)")
      .bind(r.id, await sha256Hex(r.code), `Simulated resident ${r.id}`, "2026-12-01T00:00:00Z").run();
  }
  const { privateJwk, publicJwk } = await newSiteKey();
  const prices = priceApi();
  const env = { ARBITER_DB: db };
  let id = 0;
  const call = async (name, args, now) => {
    const res = await handleArbiterMcp(
      new Request(`${ISSUER}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }) }),
      env,
      { now, fetchImpl: prices.fetchImpl, privateJwk, issuer: ISSUER },
    );
    const body = await res.json();
    assert.ok(!body.error, JSON.stringify(body.error));
    return body.result;
  };
  return { db, call, jwks: await keyDirectory([publicJwk]), prices, privateJwk };
}

const ASKS = [
  { energy_kwh: 30, ready_by: "07:00" },
  { energy_kwh: 20, ready_by: "05:00" },
  { energy_kwh: 40, ready_by: "07:00", charger_kw: 7.4 },
  { energy_kwh: 15, ready_by: "02:00" },
  { energy_kwh: 50, ready_by: "06:30" },
];

test("exit gate: 5 residents, signed and deterministic receipts, never over the limit", async () => {
  const { db, call, jwks, prices } = await setup();
  const sent = [];
  for (let i = 0; i < 5; i++) {
    const r = await call("submit_charging_request", { resident_code: RESIDENTS[i].code, ...ASKS[i] }, BEFORE);
    assert.ok(!r.isError, r.content[0].text);
    assert.equal(r.structuredContent.night, NIGHT, "before 18:00 the open night is tonight");
    assert.match(r.structuredContent.request_id, /^req_[0-9a-f]{24}$/);
    assert.match(r.structuredContent.commitment, /^[0-9a-f]{64}$/);
    sent.push(r.structuredContent);
  }

  // Before the deadline: nothing is planned and no prices are fetched.
  const early = await call("get_receipt", { request_id: sent[0].request_id, resident_code: RESIDENTS[0].code }, BEFORE);
  assert.equal(early.structuredContent.status, "pending");
  assert.equal(prices.calls.length, 0);

  // After 18:00: each resident gets a signed receipt for their own request only.
  const receipts = [];
  for (let i = 0; i < 5; i++) {
    const r = await call("get_receipt", { request_id: sent[i].request_id, resident_code: RESIDENTS[i].code }, AFTER);
    assert.ok(!r.isError, r.content[0].text);
    const v = await verifyReceipt(r.structuredContent.receipt_jws, { issuer: ISSUER, jwks });
    assert.equal(v.ok, true, v.reason);
    assert.equal(v.receipt.request_id, sent[i].request_id);
    assert.equal(v.receipt.commitment, sent[i].commitment, "the receipt is bound to what was asked");
    for (const other of sent.filter((_, j) => j !== i)) assert.ok(!r.structuredContent.receipt_jws.includes(other.request_id));
    receipts.push(v.receipt);
  }
  assert.equal(prices.calls.length, 2, "the night was scheduled once (two price days)");

  // Every slot is inside its own window and the shared 22 kW limit holds.
  const perSlot = new Map();
  for (const [i, rc] of receipts.entries()) {
    const readyBy = readyByOf(NIGHT, ASKS[i].ready_by);
    for (const s of rc.schedule.slots) {
      assert.ok(Date.parse(s.end) <= readyBy && Date.parse(s.start) >= nightTerms(NIGHT).fromMs);
      perSlot.set(s.start, (perSlot.get(s.start) ?? 0) + s.kw);
    }
  }
  for (const kw of perSlot.values()) assert.ok(kw <= 22 + 1e-9);

  // Deterministic and auditable: recomputing from the stored requests and price snapshot gives
  // exactly the signed plans and costs.
  const night = await db.prepare("SELECT * FROM nights WHERE night = ?").bind(NIGHT).first();
  const storedPrices = JSON.parse(night.prices_json);
  assert.equal(await pricesSnapshotHash(storedPrices), night.prices_snapshot_sha256);
  const { results: rows } = await db.prepare("SELECT * FROM requests WHERE night = ?").bind(NIGHT).all();
  const again = scheduleNight({
    requests: rows.reverse().map((r) => ({ id: r.id, commitment: r.commitment, energyKwh: r.energy_kwh, chargerKw: r.charger_kw, fromMs: r.from_ms, readyByMs: r.ready_by_ms })),
    prices: storedPrices, limitKw: night.limit_kw, feeCentsPerKwh: night.fee_cents_per_kwh,
  });
  for (const rc of receipts) {
    const a = again.assignments.find((x) => x.id === rc.request_id);
    assert.deepEqual(rc.schedule.slots.map((s) => [Date.parse(s.start), s.kwh]), a.slots.map((s) => [s.start, s.kwh]));
    assert.deepEqual(rc.cost, { energy_eur: a.energyCostEur, fee_eur: a.feeEur, total_eur: a.totalEur });
    assert.equal(rc.prices_snapshot_sha256, night.prices_snapshot_sha256);
  }

  // Asking again returns the same signed receipt; the night is final.
  const again1 = await call("get_receipt", { request_id: sent[0].request_id, resident_code: RESIDENTS[0].code }, AFTER + 3600_000);
  assert.equal((await verifyReceipt(again1.structuredContent.receipt_jws, { issuer: ISSUER, jwks })).receipt.iat, receipts[0].iat);
  await assert.rejects(db.prepare("DELETE FROM receipts").run(), /append-only/);

  // The public load has totals only.
  const load = await call("get_night_load", { night: NIGHT }, AFTER);
  assert.equal(load.structuredContent.requests, 5);
  const pub = JSON.stringify(load.structuredContent);
  for (const leak of ["req_", ...RESIDENTS.map((r) => `"${r.id}"`), ...RESIDENTS.map((r) => r.code)]) assert.ok(!pub.includes(leak), leak);
});

test("refusals: unknown code, duplicate, closed night, another resident's receipt, bad times", async () => {
  const { call } = await setup();
  const sub = (args, now = BEFORE) => call("submit_charging_request", args, now);
  const err = (r) => (assert.equal(r.isError, true, r.content[0].text), r.structuredContent.code);

  assert.equal(err(await sub({ resident_code: "not-a-code", energy_kwh: 10, ready_by: "07:00" })), "unknown_resident");
  const ok = await sub({ resident_code: RESIDENTS[0].code, energy_kwh: 10, ready_by: "07:00" });
  assert.equal(err(await sub({ resident_code: RESIDENTS[0].code, energy_kwh: 12, ready_by: "06:00" })), "duplicate");
  assert.equal(err(await sub({ resident_code: RESIDENTS[1].code, energy_kwh: 10, ready_by: "07:00", night: NIGHT }, AFTER)), "closed");
  assert.equal(err(await sub({ resident_code: RESIDENTS[1].code, energy_kwh: 10, ready_by: "08:00" })), "bad_ready_by");
  assert.equal(err(await sub({ resident_code: RESIDENTS[1].code, energy_kwh: 10, ready_by: "21:00" })), "bad_ready_by");
  assert.equal(err(await sub({ resident_code: RESIDENTS[1].code, energy_kwh: 200, ready_by: "07:00" })), "bad_request");
  assert.equal(err(await sub({ resident_code: RESIDENTS[1].code, energy_kwh: 10, ready_by: "07:00", charger_kw: 22 })), "bad_charger");
  // Another resident asking for this receipt learns nothing, not even that it exists.
  const theirs = await call("get_receipt", { request_id: ok.structuredContent.request_id, resident_code: RESIDENTS[1].code }, AFTER);
  assert.equal(err(theirs), "not_found");
  assert.equal(theirs.content[0].text, "No request with that ID for this resident.");
});

test("after 18:00 the open night is tomorrow; times map to the right morning", () => {
  assert.equal(openNight(BEFORE), "2026-12-22");
  assert.equal(openNight(AFTER), "2026-12-23");
  assert.equal(new Date(readyByOf(NIGHT, "07:00")).toISOString(), "2026-12-23T05:00:00.000Z");
  assert.equal(new Date(readyByOf(NIGHT, "23:30")).toISOString(), "2026-12-22T21:30:00.000Z");
  // DST night (last Sunday of October): 22:00-07:00 is 10 hours, so 40 slots.
  const t = nightTerms("2026-10-24");
  assert.equal((t.untilMs - t.fromMs) / 900_000, 40);
});

test("MCP protocol: initialize, tools/list, bad arguments", async () => {
  const db = await migratedDb();
  const rpc = async (body) => (await handleArbiterMcp(new Request(`${ISSUER}/mcp`, { method: "POST", body: JSON.stringify(body) }), { ARBITER_DB: db }, { now: BEFORE })).json();
  const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.match(init.result.instructions, /SIMULATED/);
  const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepEqual(list.result.tools.map((t) => t.name), ["get_rules", "submit_charging_request", "get_receipt", "get_night_load"]);
  const bad = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "submit_charging_request", arguments: { resident_code: "x", energy_kwh: "30", ready_by: "07:00" } } });
  assert.match(bad.error.message, /energy_kwh must be a number/);
  const extra = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_rules", arguments: { admin: true } } });
  assert.match(extra.error.message, /Unknown argument/);
  const rules = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_rules", arguments: {} } });
  assert.equal(rules.result.structuredContent.shared_limit_kw, 22);
  const get = await handleArbiterMcp(new Request(`${ISSUER}/mcp`), {}, {});
  assert.equal(get.status, 405);
});

test("night load: an empty closed night is never scheduled; a closed night with requests is", async () => {
  const { db, call, prices } = await setup();
  const empty = await call("get_night_load", { night: "2026-12-21" }, AFTER);
  assert.equal(empty.content[0].text, "The night of 2026-12-21 had no requests, so nothing was planned.");
  assert.equal(prices.calls.length, 0, "no price fetch for an empty night");
  assert.equal(await db.prepare("SELECT night FROM nights").first(), null, "no rows written");

  await call("submit_charging_request", { resident_code: RESIDENTS[0].code, energy_kwh: 20, ready_by: "07:00" }, BEFORE);
  const open = await call("get_night_load", { night: NIGHT }, BEFORE);
  assert.match(open.content[0].text, /not planned yet/);
  const planned = await call("get_night_load", { night: NIGHT }, AFTER);
  assert.equal(planned.structuredContent.scheduled, true);
  assert.equal(planned.structuredContent.requests, 1);
  assert.ok(planned.structuredContent.load.length > 0);
});

test("the 18:05 timer plans tonight once: not before the deadline, not an empty night, not twice", async () => {
  const { db, call, prices, privateJwk } = await setup();
  const opts = (now) => ({ now, fetchImpl: prices.fetchImpl, privateJwk, issuer: ISSUER });
  assert.deepEqual(await planClosedNight(db, opts(AFTER)), { night: NIGHT, planned: false, why: "no requests" }, "nobody asked: nothing written, no prices fetched");
  assert.equal(prices.calls.length, 0);
  const sent = await call("submit_charging_request", { resident_code: RESIDENTS[0].code, energy_kwh: 20, ready_by: "06:00" }, BEFORE);
  assert.equal((await planClosedNight(db, opts(BEFORE))).why, "requests are still open");
  assert.deepEqual(await planClosedNight(db, opts(AFTER)), { night: NIGHT, planned: true, created: true });
  assert.deepEqual(await planClosedNight(db, opts(AFTER + 60_000)), { night: NIGHT, planned: true, created: false }, "a second trigger changes nothing");
  const fetched = prices.calls.length;
  const receipt = await call("get_receipt", { request_id: sent.structuredContent.request_id, resident_code: RESIDENTS[0].code }, AFTER + 120_000);
  assert.equal(receipt.structuredContent.status, "scheduled", "the receipt is ready the moment someone asks");
  assert.equal(prices.calls.length, fetched, "reading it plans nothing again");
});

test("a resident's maximum price is sealed, enforced and shown on the signed receipt", async () => {
  const { db, call, jwks } = await setup();
  // Night prices in the fake API: 22:00-24:00 run 4.5-6 c, 00:00-06:00 run 2-2.75 c.
  const r = await call("submit_charging_request", { resident_code: RESIDENTS[0].code, energy_kwh: 60, ready_by: "07:00", max_price_cents: 2.5 }, BEFORE);
  assert.ok(!r.isError, r.content[0].text);
  assert.match(r.content[0].text, /never above 2\.5 c\/kWh/);
  const row = await db.prepare("SELECT max_price_cents FROM requests WHERE id = ?").bind(r.structuredContent.request_id).first();
  assert.equal(row.max_price_cents, 2.5);

  const got = await call("get_receipt", { request_id: r.structuredContent.request_id, resident_code: RESIDENTS[0].code }, AFTER);
  assert.ok(!got.isError, got.content[0].text);
  const verified = await verifyReceipt(got.structuredContent.receipt_jws, { issuer: ISSUER, jwks });
  assert.equal(verified.ok, true, verified.reason);
  const s = verified.receipt.schedule;
  assert.equal(s.max_price_cents, 2.5);
  assert.ok(s.slots.length > 0 && s.slots.every((x) => x.price_cents <= 2.5));
  assert.equal(s.feasible, false, "60 kWh does not fit in the slots at or under 2.5 c");
  assert.match(got.content[0].text, /at or below your 2\.5 c\/kWh limit/);
  assert.equal(verified.receipt.rule_version, "koivurinne-fair-share/2");
});
