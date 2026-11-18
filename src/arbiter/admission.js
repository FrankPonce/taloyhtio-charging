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

import { DEFAULT_TRUST_POLICY, cachingFetch, checkNetwork, verifyRequest } from "agent-trust-kit";

// Tester crash-test, score ≥ 80, coverage ≥ 80, and no test that failed outright: an
// average can hide a critical failure (Spot Deals averaged 81 while inventing a whole
// price table, FINDINGS F45). The kit's default trust policy is exactly this.
export const DEFAULT_POLICY = DEFAULT_TRUST_POLICY;

const CACHE_MS = 5 * 60_000;
const cache = new Map(); // fetched public files; per Worker isolate

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

  // 1. Who is calling: an RFC 9421 signature from the caller's server.
  const sig = await verifyRequest(request, { jwks, fetchImpl });
  if (!sig.ok) return refuse("signature", `The request is not signed by a site's published key: ${sig.reason}.`);
  const agent = sig.agent;

  // 2 and 3: the same check a site's consent card uses for its partners (agent-trust-kit
  // checkNetwork): the caller's published network, signed by its own domain, and an
  // attestation from a trusted tester for exactly that network hash, meeting the policy.
  const r = await checkNetwork({ origin: agent }, { policy, fetchImpl: cachingFetch(fetchImpl, { cache, ttlMs: CACHE_MS, now: () => now }), now, jwks });
  const { network_url } = r;
  if (r.error) return refuse("network", `${r.error}.`, { agent, network_url });
  if (r.signature.status === "unsigned") return refuse("network", `${network_url} is not signed by its domain (no signature file).`, { agent, network_url });
  if (!r.signature.ok) return refuse("network", `${network_url} is not validly signed by ${agent}: ${r.signature.reason}.`, { agent, network_url });
  const a = r.attestation;
  if (!a.ok) {
    return refuse("attestation", `No trusted tester vouches for ${network_url} as published now (score ≥ ${policy.minScore}, coverage ≥ ${policy.minCoverage}${policy.noFailedTests !== false ? ", no failed test" : ""}): ${a.reason}.`, { agent, network_url });
  }
  return { ok: true, agent, network_url, network_sha256: r.network_sha256, attestation: { iss: a.iss, score: a.score, coverage: a.coverage, model: a.model, exp: a.exp } };
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
