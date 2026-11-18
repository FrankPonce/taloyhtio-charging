// Admission check for cross-site callers of the arbiter (M5b). No model involved.
//
// A request from another site's server is admitted only if, in order:
//   1. its RFC 9421 signature verifies against the keys the caller's domain publishes
//      (Signature-Agent names the domain; agent-trust-kit verifyRequest);
//   2. the caller's agent network (from its standard agent-manifest.json) is signed by that
//      same domain (agent-trust-kit verifyNetwork);
//   3. a tester this arbiter trusts has a valid, unexpired attestation for exactly that
//      network hash, meeting the policy (score, coverage);
// The resident code is checked after this, by the service. Every refusal says which step
// failed and why, so the caller can fix it.
//
// The housing site's own page (same origin) is the housing company itself and skips this.

import { verifyAttestation, verifyNetwork, verifyRequest } from "agent-trust-kit";
import { canonicalHash } from "agent-trust-kit";

export const DEFAULT_POLICY = Object.freeze({
  // Testers whose attestations count, and where each publishes its index.
  testers: [{ origin: "https://crashtest.frankmp12357.workers.dev", index: "/attestations/index.json" }],
  minScore: 80,
  minCoverage: 80,
  // An average can hide a critical failure: Spot Deals averaged 81 while inventing a whole
  // price table (FINDINGS F45). Refuse any network with a test that failed outright.
  noFailedTests: true,
});

const CACHE_MS = 5 * 60_000;
const cache = new Map(); // url -> {at, value}; per Worker isolate

async function fetchJson(url, { fetchImpl, now }) {
  const hit = cache.get(url);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  const resp = await fetchImpl(url, { headers: { accept: "application/json" }, redirect: "manual" });
  if (!resp.ok) throw new Error(`${url} answered ${resp.status}`);
  const value = await resp.json();
  cache.set(url, { at: now, value });
  return value;
}

async function fetchText(url, { fetchImpl, now }) {
  const hit = cache.get(`text:${url}`);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  const resp = await fetchImpl(url, { redirect: "manual" });
  if (!resp.ok) throw new Error(`${url} answered ${resp.status}`);
  const value = await resp.text();
  cache.set(`text:${url}`, { at: now, value });
  return value;
}

/** Forget cached files (tests). */
export function clearAdmissionCache() {
  cache.clear();
}

// Reasons from the kit may end with a full stop; ours add one, so drop doubles.
const refuse = (step, reason, extra = {}) => ({ ok: false, step, reason: String(reason).replace(/\.{2,}$/, "."), ...extra });

/**
 * Decide whether a cross-site request may reach the arbiter.
 *
 * :param request: {method, url, headers, body} as received.
 * :param opts: {policy, fetchImpl, now, jwks (tests: the caller's key directory)}.
 * :return: {ok: true, agent, network_url, network_sha256, attestation: {iss, score,
 *     coverage, model, exp}} or {ok: false, step: "signature"|"network"|"attestation",
 *     reason, agent?, network_url?}.
 */
export async function admit(request, { policy = DEFAULT_POLICY, fetchImpl = globalThis.fetch, now = Date.now(), jwks = null } = {}) {
  const io = { fetchImpl, now };

  // 1. Who is calling: an RFC 9421 signature from the caller's server.
  const sig = await verifyRequest(request, { jwks, fetchImpl });
  if (!sig.ok) return refuse("signature", `The request is not signed by a site's published key: ${sig.reason}.`);
  const agent = sig.agent;

  // 2. Which agent network: the caller's published, domain-signed network.
  let network_url;
  let network_sha256;
  try {
    const base = `${agent}/`;
    const manifest = await fetchJson(new URL("agent-manifest.json", base).href, io);
    const entry = manifest?.networks?.[0];
    if (!entry?.name || !entry?.hocon) return refuse("network", `${agent} publishes no agent network in agent-manifest.json.`, { agent });
    network_url = new URL(entry.name, base).href;
    const network = JSON.parse(await fetchText(new URL(entry.hocon, base).href, io));
    network_sha256 = await canonicalHash(network);
    let doc;
    try {
      doc = await fetchJson(new URL(`${encodeURIComponent(entry.name)}.signature.json`, base).href, io);
    } catch {
      return refuse("network", `${network_url} is not signed by its domain (no signature file).`, { agent, network_url });
    }
    const v = await verifyNetwork({ doc, network, name: entry.name, networkOrigin: agent, jwks, fetchImpl });
    if (!v.ok) return refuse("network", `${network_url} is not validly signed by ${agent}: ${v.reason}.`, { agent, network_url });
  } catch (error) {
    return refuse("network", `Could not load ${agent}'s agent network: ${error.message}.`, { agent, network_url });
  }

  // 3. Does it behave: an attestation from a trusted tester for exactly this network hash.
  const problems = [];
  for (const t of policy.testers) {
    let index;
    try {
      index = await fetchJson(new URL(t.index, t.origin).href, io);
    } catch (error) {
      problems.push(`${t.origin}: ${error.message}`);
      continue;
    }
    for (const a of (index.attestations || []).filter((x) => x.sub === network_url)) {
      const file = a.attestation ?? a.jws;
      let signed;
      try {
        signed = (await fetchText(new URL(file, `${t.origin}/`).href, io)).trim();
      } catch (error) {
        problems.push(error.message);
        continue;
      }
      const v = await verifyAttestation(signed, {
        issuer: t.origin, fetchImpl, now,
        expect: { sub: network_url, network_sha256, minScore: policy.minScore, minCoverage: policy.minCoverage },
      });
      if (v.ok) {
        const s = v.statement;
        const failed = Object.entries(s.results || {}).filter(([, r]) => r?.verdict === "fail").map(([id]) => id);
        // On unless a policy explicitly sets noFailedTests: false.
        if (policy.noFailedTests !== false && failed.length) {
          problems.push(`failed outright: ${failed.join(", ")} (score ${s.score})`);
          continue;
        }
        return { ok: true, agent, network_url, network_sha256, attestation: { iss: s.iss, score: s.score, coverage: s.coverage, model: s.model?.name ?? null, exp: s.exp } };
      }
      problems.push(v.reason);
    }
  }
  const why = problems.length ? problems.join("; ") : "no attestation found";
  return refuse("attestation", `No trusted tester vouches for ${network_url} as published now (score ≥ ${policy.minScore}, coverage ≥ ${policy.minCoverage}${policy.noFailedTests !== false ? ", no failed test" : ""}): ${why}.`, { agent, network_url });
}

/** Record an admission decision (no resident data). */
export async function logAdmission(db, decision, { now = Date.now(), origin = null } = {}) {
  await db.prepare(
    "INSERT INTO admissions (at, caller_origin, caller_network_url, caller_network_sha256, outcome, reason) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(
    new Date(now).toISOString(), decision.agent ?? origin, decision.network_url ?? null, decision.network_sha256 ?? null,
    decision.ok ? "admitted" : "refused",
    decision.ok ? `attested ${decision.attestation.score} (coverage ${decision.attestation.coverage}) by ${decision.attestation.iss}` : `${decision.step}: ${decision.reason}`,
  ).run();
}

/**
 * Build the arbiter's authorize(bodyText) for one HTTP request:
 * - the housing site's own page (Origin equals the site's origin, no Signature-Agent) passes;
 * - a request with Signature-Agent goes through admit() and the decision is logged;
 * - anything else is refused (an unsigned call from elsewhere).
 * A forged Origin from a non-browser client only reaches what the site's own page can,
 * which still needs a valid resident code.
 *
 * :param request: The incoming Request.
 * :param opts: {db (for the admissions log), policy, fetchImpl, now, jwks}.
 */
export function authorizer(request, { db = null, policy, fetchImpl, now = Date.now(), jwks = null } = {}) {
  const site = new URL(request.url).origin;
  return async (bodyText) => {
    const signed = request.headers.get("signature-agent");
    if (!signed) {
      if (request.headers.get("origin") === site) return { ok: true, caller: "same-origin" };
      return refuse("signature", "Only the housing site's own page, or another site's server sending a signed request (HTTP Message Signatures, RFC 9421), can send requests or read receipts.");
    }
    const decision = await admit(
      { method: request.method, url: request.url, headers: Object.fromEntries(request.headers), body: bodyText },
      { policy, fetchImpl, now, jwks },
    );
    if (db) await logAdmission(db, decision, { now }).catch((error) => console.error("admission log failed", error?.message));
    return decision;
  };
}
