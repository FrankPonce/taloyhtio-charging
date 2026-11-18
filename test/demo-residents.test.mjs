// Self-serve demo residents (simulated): one night only, capped per night, same origin only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { migratedDb } from "./d1-sqlite.mjs";
import { DEMO_PER_NIGHT, issueDemoResident, submitRequest, getReceipt } from "../src/arbiter/service.js";
import { handleDemoResident } from "../src/arbiter/demo.js";

const BEFORE = Date.parse("2026-12-22T10:00:00Z"); // 12:00 Helsinki: tonight is open
const AFTER = Date.parse("2026-12-22T16:30:00Z"); // 18:30: tomorrow night is open

test("a demo code works for its own night only, and only the hash is stored", async () => {
  const db = await migratedDb();
  const d = await issueDemoResident(db, { now: BEFORE });
  assert.match(d.code, /^demo-[a-z2-9]{4}-[a-z2-9]{4}$/);
  assert.equal(d.night, "2026-12-22");
  const row = await db.prepare("SELECT kind, night, simulated, code_sha256, label FROM residents WHERE id = ?").bind(d.resident).first();
  assert.deepEqual([row.kind, row.night, row.simulated], ["demo", "2026-12-22", 1]);
  assert.ok(!JSON.stringify(row).includes(d.code), "the code itself is not stored");
  assert.match(row.label, /simulated/);

  const r = await submitRequest(db, { residentCode: d.code, energyKwh: 20, readyBy: "07:00" }, { now: BEFORE });
  assert.equal(r.night, "2026-12-22", "defaults to the demo code's night");
  await assert.rejects(submitRequest(db, { residentCode: d.code, energyKwh: 20, readyBy: "07:00", night: "2026-12-23" }, { now: BEFORE }), /for the night of 2026-12-22 only/);
  // Readable the next day; refused a day after the night ends.
  assert.equal((await getReceipt(db, { requestId: r.request_id, residentCode: d.code }, { now: BEFORE })).status, "pending");
  await assert.rejects(getReceipt(db, { requestId: r.request_id, residentCode: d.code }, { now: Date.parse("2026-12-24T06:00:00Z") }), /expired/);
});

test("after 18:00 a new demo code is for tomorrow night", async () => {
  const db = await migratedDb();
  assert.equal((await issueDemoResident(db, { now: AFTER })).night, "2026-12-23");
});

test("at most DEMO_PER_NIGHT demo residents per night", async () => {
  const db = await migratedDb();
  for (let i = 0; i < DEMO_PER_NIGHT; i++) await issueDemoResident(db, { now: BEFORE });
  await assert.rejects(issueDemoResident(db, { now: BEFORE }), /demo places .* are taken/);
  assert.equal((await issueDemoResident(db, { now: AFTER })).night, "2026-12-23", "the next night has its own places");
});

test("endpoint: POST from the site's own page only, rate-limited", async () => {
  const db = await migratedDb();
  const site = "https://taloyhtio.example";
  const req = (headers = { origin: site }, method = "POST") => new Request(`${site}/api/demo-resident`, { method, headers });
  const ok = await handleDemoResident(req(), { ARBITER_DB: db }, { now: BEFORE });
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).code, /^demo-/);
  assert.equal((await handleDemoResident(req({ origin: "https://elsewhere.example" }), { ARBITER_DB: db }, { now: BEFORE })).status, 403);
  assert.equal((await handleDemoResident(req({}), { ARBITER_DB: db }, { now: BEFORE })).status, 403, "no Origin: not a page");
  assert.equal((await handleDemoResident(req({ origin: site }, "GET"), { ARBITER_DB: db }, { now: BEFORE })).status, 405);
  const limited = { ARBITER_DB: db, DEMO_LIMIT: { limit: async () => ({ success: false }) } };
  assert.equal((await handleDemoResident(req(), limited, { now: BEFORE })).status, 429);
});
