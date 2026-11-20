// Admission check for cross-site callers of the arbiter. No model involved.
//
// The check itself is agent-trust-kit's admit(): the caller's RFC 9421 signature, the model
// it declares (only an attestation for that model counts: trust is network × model, FINDINGS
// F1, F48), its domain-signed network, and an attestation from a trusted tester for exactly
// that network, its actions and that model (score ≥ 80, coverage ≥ 80, no test failed
// outright, F45). Every refusal names the step. This file adds what is local to the arbiter:
// a 5-minute cache of callers' public files, the admissions log, and the rule that the
// housing site's own page (same origin) is the housing company itself and skips the check.
// The resident code is checked after this, by the service: admission is not authorization.

import { DEFAULT_ADMIT_POLICY, admit as kitAdmit, cachingFetch } from "agent-trust-kit";

export { MODEL_META, declaredModel } from "agent-trust-kit";
export const DEFAULT_POLICY = DEFAULT_ADMIT_POLICY;

const CACHE_MS = 5 * 60_000;
const cache = new Map(); // fetched public files; per Worker isolate

/** Forget cached files (tests). */
export function clearAdmissionCache() {
  cache.clear();
}

const refuse = (step, reason, extra = {}) => ({ ok: false, step, reason, ...extra });

/**
 * Decide whether a cross-site request may reach the arbiter (agent-trust-kit admit(), with
 * callers' public files cached for 5 minutes).
 *
 * :param request: {method, url, headers, body} as received.
 * :param opts: {policy, fetchImpl, now, jwks (tests: the caller's key directory)}.
 * :return: admit()'s decision.
 */
export function admit(request, { policy = DEFAULT_POLICY, fetchImpl = globalThis.fetch, now = Date.now(), jwks = null } = {}) {
  return kitAdmit(request, { policy, now, jwks, fetchImpl: cachingFetch(fetchImpl, { cache, ttlMs: CACHE_MS, now: () => now }) });
}

/** Record an admission decision (no resident data). */
export async function logAdmission(db, decision, { now = Date.now(), origin = null } = {}) {
  await db.prepare(
    "INSERT INTO admissions (at, caller_origin, caller_network_url, caller_network_sha256, outcome, reason) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(
    new Date(now).toISOString(), decision.agent ?? origin, decision.network_url ?? null, decision.network_sha256 ?? null,
    decision.ok ? "admitted" : "refused",
    decision.ok ? `attested ${decision.attestation.score} (coverage ${decision.attestation.coverage}) on ${decision.attestation.model ?? "any model"} by ${decision.attestation.iss}` : `${decision.step}: ${decision.reason}`,
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
