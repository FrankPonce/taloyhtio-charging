// M5b admission check: who may send requests to the arbiter. A fake web with a caller site
// (keys, manifest, signed network, signing server) and a tester (keys, index, in-toto
// attestations); every refusal names the step that failed.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  KEY_DIRECTORY_PATH, attestationFromScorecard, canonicalHash, keyDirectory, newSiteKey, sha256Hex,
  signAttestation, signNetwork, signRequest, signStatement, ATTESTATION_TYPE,
} from "agent-trust-kit";
import { admit, authorizer, clearAdmissionCache } from "../src/arbiter/admission.js";
import { handleArbiterMcp } from "../src/arbiter/mcp.js";
import { migratedDb } from "./d1-sqlite.mjs";

const ARBITER = "https://taloyhtio.example";
const CALLER = "https://charge.example";
const TESTER = "https://tester.example";
const POLICY = { testers: [{ origin: TESTER, index: "/attestations/index.json" }], minScore: 80, minCoverage: 80 };
const NOW = Date.parse("2026-12-22T10:00:00Z");
const NETWORK = { tools: [{ name: "charge_assistant", instructions: "Plan charging from real prices.", tools: [] }] };

beforeEach(() => clearAdmissionCache());

/** Build a fake web; options change one thing to make a step fail. */
async function world({ signNet = true, servedNetwork = NETWORK, score = 100, coverage = 100, legacy = false, expired = false, failedTest = false } = {}) {
  const caller = await newSiteKey();
  const tester = await newSiteKey();
  const files = new Map();
  const put = (url, body) => files.set(url, typeof body === "string" ? body : JSON.stringify(body));
  put(`${CALLER}${KEY_DIRECTORY_PATH}`, await keyDirectory([caller.publicJwk]));
  put(`${TESTER}${KEY_DIRECTORY_PATH}`, await keyDirectory([tester.publicJwk]));
  put(`${CALLER}/agent-manifest.json`, { networks: [{ name: "charge_planner", front_man: "charge_assistant", hocon: "./charge_planner.network.json" }] });
  put(`${CALLER}/charge_planner.network.json`, servedNetwork);
  if (signNet) put(`${CALLER}/charge_planner.signature.json`, await signNetwork({ network: servedNetwork, name: "charge_planner", origin: CALLER, privateJwk: caller.privateJwk }));

  // The tester attested the network as it was (NETWORK), not necessarily as served now.
  const sha = await canonicalHash(NETWORK);
  const sub = `${CALLER}/charge_planner`;
  const iat = expired ? NOW - 40 * 864e5 : NOW - 864e5;
  let file;
  if (legacy) {
    file = await signStatement({ typ: ATTESTATION_TYPE, iss: TESTER, sub, network_sha256: sha, model: { name: "m" }, results: {}, score, iat: new Date(iat).toISOString(), exp: new Date(iat + 30 * 864e5).toISOString() }, tester.privateJwk);
  } else {
    const card = { target: { network_url: sub, network_sha256: sha }, model: { name: "alibaba/qwen3.8-flash", routerHost: "eu.api.otari.ai" }, tester: { test_version: 15 }, runs_per_test: 3, tests: [{ id: "static_validity", verdict: "pass", pass_rate: 1 }, ...(failedTest ? [{ id: "grounding_on_failure", verdict: "fail", pass_rate: 0 }] : [])], summary: { score, coverage, scoring: "decided/1" } };
    file = JSON.stringify(await signAttestation(attestationFromScorecard(card, { issuer: TESTER, now: iat }), tester.privateJwk));
  }
  put(`${TESTER}/attestations/x.att`, file);
  put(`${TESTER}/attestations/index.json`, { attestations: [{ sub, attestation: "attestations/x.att" }] });

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
const BODY = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });

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
  assert.match((await step(await world({ legacy: true }))).reason, /coverage unknown is below 80/);
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
  assert.match(results[0].reason, /attested 100 \(coverage 100\) by https:\/\/tester.example/);
});

test("end to end: an admitted caller submits; a refused one gets the reason; reads stay open", async () => {
  const db = await migratedDb();
  await db.prepare("INSERT INTO residents (id, code_sha256, label, created_at) VALUES ('A1', ?, 'Simulated resident A1', 'x')").bind(await sha256Hex("koivu-test-0001")).run();
  const call = async (w, name, args, opts = {}) => {
    clearAdmissionCache();
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
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
