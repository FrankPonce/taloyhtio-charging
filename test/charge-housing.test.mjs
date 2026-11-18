// Charge's shared-chargers box (M5b): night requests go through the site's signed server
// link; the resident code stays on the page and never reaches the assistant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Housing } from "../sites/charge/js/housing.js";

const CODE = "koivu-test-0001";

function store() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function arbiter(reply) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(reply(calls.at(-1).body)));
  };
  return { fetchImpl, calls };
}

const ok = (text, structuredContent) => ({ result: { content: [{ type: "text", text }], structuredContent } });

test("sends a night request with the page's code; the result the assistant reads has no code", async () => {
  const a = arbiter(() => ok("Request received for the night of 2026-12-22.", { request_id: "req_abc123", night: "2026-12-22", commitment: "c".repeat(64) }));
  const h = new Housing({ doc: null, fetchImpl: a.fetchImpl, session: store(), local: store() });
  assert.equal(h.saveCode(CODE).ok, true);
  const r = await h.sendNightRequest({ energyKwh: 30, readyBy: "2026-12-23T07:00", chargerKw: 22 });
  assert.equal(r.ok, true);
  assert.equal(r.request_id, "req_abc123");
  assert.ok(!JSON.stringify(r).includes(CODE), "the code never appears in what the assistant reads");
  assert.equal(a.calls[0].url, "/api/arbiter", "through this site's own server");
  assert.deepEqual(a.calls[0].body, {
    tool: "submit_charging_request",
    arguments: { resident_code: CODE, energy_kwh: 30, ready_by: "07:00", night: "2026-12-22", charger_kw: 11 },
  }, "07:00 belongs to the night that started the evening before; charger capped at 11 kW");
  assert.ok(!JSON.stringify(h.sent()).includes(CODE), "stored request list has no code");
});

test("an evening ready-by time belongs to that evening's night", async () => {
  const a = arbiter(() => ok("ok", { request_id: "req_1", night: "2026-12-22" }));
  const h = new Housing({ doc: null, fetchImpl: a.fetchImpl, session: store(), local: store() });
  h.saveCode(CODE);
  await h.sendNightRequest({ energyKwh: 10, readyBy: "2026-12-22T23:30" });
  assert.equal(a.calls[0].body.arguments.night, "2026-12-22");
  assert.equal(a.calls[0].body.arguments.charger_kw, undefined);
});

test("without a saved code nothing is sent, and the reason says to use the page, not the chat", async () => {
  const a = arbiter(() => { throw new Error("must not be called"); });
  const h = new Housing({ doc: null, fetchImpl: a.fetchImpl, session: store(), local: store() });
  const r = await h.sendNightRequest({ energyKwh: 30, readyBy: "2026-12-23T07:00" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /Shared chargers box.*Never type it in the chat/);
  assert.equal(a.calls.length, 0);
  assert.equal(h.saveCode("abc").ok, false, "too short to be a code");
});

test("refusals from the arbiter or the server come back as reasons", async () => {
  const refused = arbiter(() => ({ result: { isError: true, content: [{ type: "text", text: "Not admitted (attestation): score 71 is below 80." }] } }));
  const h = new Housing({ doc: null, fetchImpl: refused.fetchImpl, session: store(), local: store() });
  h.saveCode(CODE);
  const r = await h.sendNightRequest({ energyKwh: 30, readyBy: "2026-12-23T07:00" });
  assert.deepEqual(r, { ok: false, reason: "Not admitted (attestation): score 71 is below 80." });
  assert.equal(h.sent().length, 0, "nothing remembered when refused");
  const down = arbiter(() => ({ error: { message: "This site is not set up to send signed requests to the housing company yet." } }));
  const h2 = new Housing({ doc: null, fetchImpl: down.fetchImpl, session: store(), local: store() });
  h2.saveCode(CODE);
  assert.match((await h2.sendNightRequest({ energyKwh: 30, readyBy: "2026-12-23T07:00" })).reason, /not set up/);
});

test("the latest receipt: pending, then the signed plan in plain values", async () => {
  let scheduled = false;
  const a = arbiter((body) => {
    if (body.tool === "submit_charging_request") return ok("received", { request_id: "req_xyz", night: "2026-12-22" });
    if (!scheduled) return ok("Not planned yet.", { status: "pending", night: "2026-12-22" });
    return ok("Plan for the night of 2026-12-22: 30 of 30 kWh.", {
      status: "scheduled", night: "2026-12-22",
      receipt: { iss: "https://taloyhtio.example", schedule: { delivered_kwh: 30, requested_kwh: 30, slots: [{ start: "2026-12-22T23:00:00Z", end: "2026-12-22T23:15:00Z" }, { start: "2026-12-23T01:45:00Z", end: "2026-12-23T02:00:00Z" }] }, cost: { total_eur: 1.42 } },
    });
  });
  const h = new Housing({ doc: null, fetchImpl: a.fetchImpl, session: store(), local: store() });
  h.saveCode(CODE);
  assert.equal((await h.latestReceipt()).ok, false, "nothing sent yet");
  await h.sendNightRequest({ energyKwh: 30, readyBy: "2026-12-23T07:00" });
  assert.equal((await h.latestReceipt()).status, "pending");
  scheduled = true;
  const r = await h.latestReceipt();
  assert.deepEqual([r.status, r.deliveredKwh, r.totalEur, r.windows, r.signedBy], ["scheduled", 30, 1.42, "01:00-04:00", "https://taloyhtio.example"]);
  assert.equal(a.calls.at(-1).body.arguments.request_id, "req_xyz");
});

test("housing page form: same-origin request, code never stored, receipt for the last request", async () => {
  const { RequestForm } = await import("../sites/taloyhtio/js/request.js");
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const name = body.params.name;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: name === "get_receipt" ? "Not planned yet." : "Request received." }], structuredContent: { request_id: "req_1", night: "2026-12-22" } } }));
  };
  const local = store();
  const f = new RequestForm({ doc: null, fetchImpl, local });
  const r = await f.submit({ code: ` ${CODE} `, energyKwh: "25", readyBy: "06:30" });
  assert.equal(r.ok, true);
  assert.equal(calls[0].url, "/mcp", "same origin: this site's own arbiter");
  assert.deepEqual(calls[0].body.params, { name: "submit_charging_request", arguments: { resident_code: CODE, energy_kwh: 25, ready_by: "06:30" } });
  assert.ok(!local.getItem("koivurinne.requests").includes(CODE), "the code is not stored in the browser");
  await f.receipt(CODE);
  assert.deepEqual(calls[1].body.params.arguments, { request_id: "req_1", resident_code: CODE });
});
