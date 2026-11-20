// M5b admission check: who may send requests to the arbiter. A fake web with a caller site
// (keys, manifest, signed network, signing server) and a tester (keys, index, in-toto
// attestations); every refusal names the step that failed.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  KEY_DIRECTORY_PATH, attestationFromScorecard, canonicalHash, keyDirectory, newSiteKey, sha256Hex,
  signAttestation, signNetwork, signRequest, signStatement, ATTESTATION_TYPE, actionsSha256,
} from "agent-trust-kit";
import { MODEL_META, admit, authorizer, clearAdmissionCache } from "../src/arbiter/admission.js";
import { handleArbiterMcp } from "../src/arbiter/mcp.js";
import { migratedDb } from "./d1-sqlite.mjs";

const ARBITER = "https://taloyhtio.example";
const CALLER = "https://charge.example";
const TESTER = "https://tester.example";
const POLICY = { testers: [{ origin: TESTER, index: "/attestations/index.json" }], minScore: 80, minCoverage: 80, requireModel: true };
const MODEL = "alibaba/qwen3.8-flash"; // the model the fixture attestation covers
const NOW = Date.parse("2026-12-22T10:00:00Z");
const NETWORK = { tools: [{ name: "charge_assistant", instructions: "Plan charging from real prices.", tools: [] }] };
const ACTIONS = { version: 1, agentTools: ["plan_charging", "send_night_request"] };

beforeEach(() => clearAdmissionCache());

/** Build a fake web; options change one thing to make a step fail. */
async function world({ signNet = true, servedNetwork = NETWORK, score = 100, coverage = 100, legacy = false, expired = false, failedTest = false, servedActions = ACTIONS } = {}) {
  const caller = await newSiteKey();
  const tester = await newSiteKey();
  const files = new Map();
  const put = (url, body) => files.set(url, typeof body === "string" ? body : JSON.stringify(body));
  put(`${CALLER}${KEY_DIRECTORY_PATH}`, await keyDirectory([caller.publicJwk]));
  put(`${TESTER}${KEY_DIRECTORY_PATH}`, await keyDirectory([tester.publicJwk]));
  put(`${CALLER}/agent-manifest.json`, { networks: [{ name: "charge_planner", front_man: "charge_assistant", hocon: "./charge_planner.network.json" }], actions: servedActions });
  put(`${CALLER}/charge_planner.network.json`, servedNetwork);
  if (signNet) put(`${CALLER}/charge_planner.signature.json`, await signNetwork({ network: servedNetwork, name: "charge_planner", origin: CALLER, privateJwk: caller.privateJwk }));

  // The tester attested the network as it was (NETWORK), not necessarily as served now.
  const sha = await canonicalHash(NETWORK);
  const sub = `${CALLER}/charge_planner`;
  const iat = expired ? NOW - 40 * 864e5 : NOW - 864e5;
  let file;
  if (legacy) {
    file = await signStatement({ typ: ATTESTATION_TYPE, iss: TESTER, sub, network_sha256: sha, model: { name: "alibaba/qwen3.8-flash" }, results: {}, score, iat: new Date(iat).toISOString(), exp: new Date(iat + 30 * 864e5).toISOString() }, tester.privateJwk);
  } else {
    const card = { target: { network_url: sub, network_sha256: sha, manifest_url: `${CALLER}/agent-manifest.json`, actions_sha256: await actionsSha256({ actions: ACTIONS }) }, model: { name: "alibaba/qwen3.8-flash", routerHost: "eu.api.otari.ai" }, tester: { test_version: 15 }, runs_per_test: 3, tests: [{ id: "static_validity", verdict: "pass", pass_rate: 1 }, ...(failedTest ? [{ id: "grounding_on_failure", verdict: "fail", pass_rate: 0 }] : [])], summary: { score, coverage, scoring: "decided/1" } };
    file = JSON.stringify(await signAttestation(attestationFromScorecard(card, { issuer: TESTER, now: iat }), tester.privateJwk));
  }
  put(`${TESTER}/attestations/x.att`, file);
  put(`${TESTER}/attestations/index.json`, { attestations: [{ sub, model: "alibaba/qwen3.8-flash", attestation: "attestations/x.att" }] });

  const fetchImpl = async (url) => (files.has(String(url))
    ? new Response(files.get(String(url)), { headers: { "content-type": "application/json" } })
    : new Response("not found", { status: 404 }));
  const signed = async (body, key = caller.privateJwk) => {
    const s = await signRequest({ method: "POST", url: `${ARBITER}/mcp`, headers: { "content-type": "application/json" }, body }, { privateJwk: key, signatureAgent: CALLER });
    return new Request(s.url, { method: "POST", headers: s.headers, body: s.body });
  };
  return { fetchImpl, signed, caller };
}

const asPlain = async (req) => ({ method: req.method, url: req.url, headers: Object.fromEntries(req.headers), body: await req.clone().text() });
const BODY = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { _meta: { [MODEL_META]: MODEL } } });

test("admitted: signed request, domain-signed network, fresh attestation for that exact hash", async () => {
  const w = await world();
  const d = await admit(await asPlain(await w.signed(BODY)), { policy: POLICY, fetchImpl: w.fetchImpl, now: NOW });
  assert.equal(d.ok, true, d.reason);
  assert.equal(d.agent, CALLER);
  assert.equal(d.network_url, `${CALLER}/charge_planner`);
  assert.equal(d.network_sha256, await canonicalHash(NETWORK));
  assert.deepEqual([d.attestation.iss, d.attestation.score, d.attestation.coverage], [TESTER, 100, 100]);
});

test("refused at each step, with the reason", async () => {
  const step = async (w, req) => {
    clearAdmissionCache();
    const d = await admit(await asPlain(req ?? (await w.signed(BODY))), { policy: POLICY, fetchImpl: w.fetchImpl, now: NOW });
    assert.equal(d.ok, false);
    return d;
  };
  // Signature: a key the caller doesn't publish; a body changed after signing.
  let w = await world();
  assert.equal((await step(w, await w.signed(BODY, (await newSiteKey()).privateJwk))).step, "signature");
  const good = await asPlain(await w.signed(BODY));
  const tampered = await admit({ ...good, body: BODY.replace("ping", "pong") }, { policy: POLICY, fetchImpl: w.fetchImpl, now: NOW });
  assert.equal(tampered.step, "signature");
  // Network: not signed by its domain (like Spot Deals).
  const unsigned = await step(await world({ signNet: false }));
  assert.equal(unsigned.step, "network");
  assert.match(unsigned.reason, /not signed by its domain/);
  // Attestation: the network changed since it was tested; score too low; expired; old format without coverage.
  const changed = await step(await world({ servedNetwork: { ...NETWORK, extra: "new instructions" } }));
  assert.equal(changed.step, "attestation");
  assert.match(changed.reason, /different version of the network/);
  assert.match((await step(await world({ score: 71 }))).reason, /score 71 is below 80/);
  assert.match((await step(await world({ coverage: 60 }))).reason, /coverage 60 is below 80/);
  assert.match((await step(await world({ expired: true }))).reason, /expired/);
  assert.match((await step(await world({ legacy: true }))).reason, /does not cover the site's actions/);
  // F39: a new action declared in the manifest alone (network and signature unchanged).
  const newAction = await step(await world({ servedActions: { ...ACTIONS, agentTools: [...ACTIONS.agentTools, "pay_now"] } }));
  assert.equal(newAction.step, "attestation");
  assert.match(newAction.reason, /different set of site actions/);
  // A high average does not hide a test that failed outright (F45: Spot Deals averaged 81).
  const hidden = await step(await world({ score: 81, failedTest: true }));
  assert.equal(hidden.step, "attestation");
  assert.match(hidden.reason, /failed outright: grounding_on_failure \(score 81\)/);
});

test("authorizer: own page passes, unsigned outsiders are refused, signed callers go through admit and are logged", async () => {
  const w = await world();
  const db = await migratedDb();
  const own = authorizer(new Request(`${ARBITER}/mcp`, { method: "POST", headers: { origin: ARBITER } }), { db, policy: POLICY, fetchImpl: w.fetchImpl, now: NOW });
  assert.equal((await own(BODY)).ok, true);
  const outsider = authorizer(new Request(`${ARBITER}/mcp`, { method: "POST", headers: { origin: "https://elsewhere.example" } }), { db, policy: POLICY, fetchImpl: w.fetchImpl, now: NOW });
  assert.match((await outsider(BODY)).reason, /signed request/);
  const req = await w.signed(BODY);
  const signed = authorizer(req, { db, policy: POLICY, fetchImpl: w.fetchImpl, now: NOW });
  assert.equal((await signed(BODY)).ok, true);
  const { results } = await db.prepare("SELECT outcome, caller_origin, caller_network_url, reason FROM admissions").all();
  assert.deepEqual(results.map((r) => [r.outcome, r.caller_origin, r.caller_network_url]), [["admitted", CALLER, `${CALLER}/charge_planner`]]);
  assert.match(results[0].reason, /attested 100 \(coverage 100\) on alibaba\/qwen3\.8-flash by https:\/\/tester.example/);
});

test("end to end: an admitted caller submits; a refused one gets the reason; reads stay open", async () => {
  const db = await migratedDb();
  await db.prepare("INSERT INTO residents (id, code_sha256, label, created_at) VALUES ('A1', ?, 'Simulated resident A1', 'x')").bind(await sha256Hex("koivu-test-0001")).run();
  // The resident's mandate for other sites' assistants (set on the housing page in real use).
  await db.prepare("INSERT INTO mandates (resident, max_energy_kwh, max_price_cents, set_at) VALUES ('A1', 30, NULL, 'x')").run();
  const call = async (w, name, args, opts = {}) => {
    clearAdmissionCache();
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args, _meta: { [MODEL_META]: opts.model ?? MODEL } } });
    const req = opts.unsigned ? new Request(`${ARBITER}/mcp`, { method: "POST", body }) : await w.signed(body);
    const res = await handleArbiterMcp(req.clone(), { ARBITER_DB: db }, { now: NOW, authorize: authorizer(req, { db, policy: POLICY, fetchImpl: w.fetchImpl, now: NOW }) });
    return (await res.json()).result;
  };
  const ok = await call(await world(), "submit_charging_request", { resident_code: "koivu-test-0001", energy_kwh: 20, ready_by: "07:00" });
  assert.ok(!ok.isError, ok.content[0].text);
  const row = await db.prepare("SELECT caller_network_sha256 FROM requests").first();
  assert.equal(row.caller_network_sha256, await canonicalHash(NETWORK), "the request records which attested network sent it");

  const bad = await call(await world({ score: 71 }), "submit_charging_request", { resident_code: "koivu-test-0001", energy_kwh: 20, ready_by: "06:00" });
  assert.equal(bad.isError, true);
  assert.equal(bad.structuredContent.code, "not_admitted");
  assert.match(bad.content[0].text, /^Not admitted \(attestation\): .*score 71 is below 80/);

  const anon = await call(await world(), "submit_charging_request", { resident_code: "koivu-test-0001", energy_kwh: 20, ready_by: "06:00" }, { unsigned: true });
  assert.match(anon.content[0].text, /Not admitted \(signature\)/);
  const rules = await call(await world(), "get_rules", {}, { unsigned: true });
  assert.ok(!rules.isError, "reading the rules needs no admission");
});

test("refusal reasons end with exactly one full stop", async () => {
  const w = await world({ signNet: false });
  const d = await admit(await asPlain(await w.signed(BODY)), { policy: POLICY, fetchImpl: w.fetchImpl, now: NOW });
  assert.match(d.reason, /[^.]\.$/);
  const sig = await admit({ method: "POST", url: `${ARBITER}/mcp`, headers: { "signature-agent": '"https://nokeys.example"' }, body: BODY }, { policy: POLICY, fetchImpl: w.fetchImpl, now: NOW });
  assert.match(sig.reason, /[^.]\.$/);
});

test("network × model: the caller must say which model ran its agent, and only that model's attestation counts", async () => {
  const w = await world();
  const noModel = await admit(await asPlain(await w.signed(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }))), { policy: POLICY, fetchImpl: w.fetchImpl, now: NOW });
  assert.equal(noModel.ok, false);
  assert.equal(noModel.step, "model");
  assert.match(noModel.reason, /does not say which model ran https:\/\/charge\.example's agent/);

  clearAdmissionCache();
  const other = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { _meta: { [MODEL_META]: "mistralai/ministral-3-8b" } } });
  const weak = await admit(await asPlain(await w.signed(other)), { policy: POLICY, fetchImpl: w.fetchImpl, now: NOW });
  assert.equal(weak.ok, false);
  assert.equal(weak.step, "attestation");
  assert.match(weak.reason, /as published now on mistralai\/ministral-3-8b .*not tested on mistralai\/ministral-3-8b \(tested on alibaba\/qwen3\.8-flash\)/);

  clearAdmissionCache();
  const ok = await admit(await asPlain(await w.signed(BODY)), { policy: POLICY, fetchImpl: w.fetchImpl, now: NOW });
  assert.equal(ok.ok, true, ok.reason);
  assert.equal(ok.model, MODEL);
  assert.equal(ok.attestation.model, MODEL);

  // The model is inside the signed body: changing it after signing breaks the signature.
  clearAdmissionCache();
  const signed = await asPlain(await w.signed(BODY));
  const swapped = await admit({ ...signed, body: BODY.replace(MODEL, "openai/gpt-oss-20b") }, { policy: POLICY, fetchImpl: w.fetchImpl, now: NOW });
  assert.equal(swapped.step, "signature");
});

test("the mandate holds even for a signed, well-tested agent: asking for more is refused, and only the housing page sets it", async () => {
  const db = await migratedDb();
  for (const [id, code] of [["B1", "koivu-test-0101"], ["B2", "koivu-test-0102"], ["B3", "koivu-test-0103"], ["B4", "koivu-test-0104"]]) {
    await db.prepare("INSERT INTO residents (id, code_sha256, label, created_at) VALUES (?, ?, ?, 'x')").bind(id, await sha256Hex(code), `Simulated resident ${id}`).run();
  }
  await db.prepare("INSERT INTO mandates (resident, max_energy_kwh, max_price_cents, set_at) VALUES ('B1', 20, 6, 'x'), ('B2', 20, 6, 'x'), ('B3', 20, 6, 'x')").run();
  const w = await world(); // signed, domain-signed network, attested 100 on the declared model
  const call = async (name, args, { sameOrigin = false } = {}) => {
    clearAdmissionCache();
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args, _meta: { [MODEL_META]: MODEL } } });
    const req = sameOrigin ? new Request(`${ARBITER}/mcp`, { method: "POST", headers: { origin: ARBITER }, body }) : await w.signed(body);
    const res = await handleArbiterMcp(req.clone(), { ARBITER_DB: db }, { now: NOW, authorize: authorizer(req, { db, policy: POLICY, fetchImpl: w.fetchImpl, now: NOW }) });
    return (await res.json()).result;
  };
  // Admitted, but asks for more energy than the resident allowed: refused at the mandate.
  const tooMuch = await call("submit_charging_request", { resident_code: "koivu-test-0101", energy_kwh: 60, ready_by: "07:00" });
  assert.equal(tooMuch.isError, true);
  assert.match(tooMuch.content[0].text, /Outside your mandate: this asks for 60 kWh, and your limit .* is 20 kWh/);
  // A higher price limit than the resident's: refused. No price limit: the resident's applies.
  const pricier = await call("submit_charging_request", { resident_code: "koivu-test-0102", energy_kwh: 10, ready_by: "07:00", max_price_cents: 15 });
  assert.match(pricier.content[0].text, /Outside your mandate: this allows up to 15 c\/kWh/);
  const noCap = await call("submit_charging_request", { resident_code: "koivu-test-0103", energy_kwh: 10, ready_by: "07:00" });
  assert.ok(!noCap.isError, noCap.content[0].text);
  const row = await db.prepare("SELECT max_price_cents, caller_origin, caller_model, caller_policy_sha256 FROM requests WHERE resident = 'B3'").first();
  assert.equal(row.max_price_cents, 6, "the agent can't widen the limit by leaving it out");
  assert.equal(row.caller_origin, "https://charge.example");
  assert.equal(row.caller_model, MODEL);
  assert.match(row.caller_policy_sha256, /^[0-9a-f]{64}$/);
  // No mandate at all: another site's assistant can't act for this resident yet.
  const none = await call("submit_charging_request", { resident_code: "koivu-test-0104", energy_kwh: 5, ready_by: "07:00" });
  assert.match(none.content[0].text, /haven't set limits for other sites' assistants/);
  // Another site can't set or widen the mandate; the housing page can.
  const widen = await call("set_mandate", { resident_code: "koivu-test-0101", max_energy_kwh: 120 });
  assert.match(widen.content[0].text, /only be set on As Oy Koivurinne's own page/);
  const own = await call("set_mandate", { resident_code: "koivu-test-0104", max_energy_kwh: 15 }, { sameOrigin: true });
  assert.ok(!own.isError, own.content[0].text);
  const after = await call("submit_charging_request", { resident_code: "koivu-test-0104", energy_kwh: 5, ready_by: "07:00" });
  assert.ok(!after.isError, after.content[0].text);
  // The resident's own request on the housing page needs no mandate.
  await db.prepare("DELETE FROM mandates WHERE resident = 'B1'").run();
  const byHand = await call("submit_charging_request", { resident_code: "koivu-test-0101", energy_kwh: 60, ready_by: "07:00" }, { sameOrigin: true });
  assert.ok(!byHand.isError, byHand.content[0].text);
});
