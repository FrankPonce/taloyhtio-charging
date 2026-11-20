// Commitments and signed receipts for the arbiter. No model involved.
//
// Commitment: SHA-256 of the canonical JSON of the sealed request plus a random server
// nonce. The resident gets it back at once as proof of what was asked; it also orders
// requests with the same ready-by time (see scheduler.js), and nobody can pick it.
//
// Receipt: a compact JWS (agent-trust-kit signStatement) by the housing site's key over
//   {typ, iss, request_id, commitment, night, rule_version, limit_kw, fee_cents_per_kwh,
//    prices_snapshot_sha256, schedule: {position, requested_kwh, delivered_kwh,
//    shortfall_kwh, feasible, slots}, cost: {energy_eur, fee_eur, total_eur}, iat}
// It names only the resident's own request, never anyone else's.

import { canonicalHash, commit, newNonce as kitNonce, signReceipt as kitSignReceipt, verifyReceipt as kitVerifyReceipt } from "agent-trust-kit";
import { RULE_VERSION, normalizePrices } from "./scheduler.js";

export const RECEIPT_TYPE = "charging-receipt/v1";

/** Random 128-bit nonce as hex (agent-trust-kit). */
export const newNonce = kitNonce;

/**
 * Commitment hash of a sealed request.
 *
 * :param sealed: {resident, night, energyKwh, chargerKw, fromMs, readyByMs, maxPriceCents?}.
 *     maxPriceCents is sealed only when set, so requests without one keep their old commitment.
 * :param nonce: Server nonce (hex), kept with the request.
 * :return: Hex SHA-256.
 */
export async function commitmentOf(sealed, nonce) {
  // agent-trust-kit commit(): the sealed fields plus the nonce; an unset mandate is left out.
  const { resident, night, energyKwh, chargerKw, fromMs, readyByMs, maxPriceCents } = sealed;
  return commit({ resident, night, energyKwh, chargerKw, fromMs, readyByMs, maxPriceCents }, nonce);
}

/** SHA-256 of the canonical JSON of the 15-minute prices the schedule used. */
export async function pricesSnapshotHash(prices) {
  return canonicalHash(normalizePrices(prices));
}

/**
 * Build one resident's receipt statement from a schedule.
 *
 * :param opts: {schedule: scheduleNight() result, requestId, issuer: site origin, night:
 *     "YYYY-MM-DD", pricesSha256, now}.
 * :return: The statement (not yet signed).
 * :raises Error: If the request is not in the schedule.
 */
export function receiptFor({ schedule, requestId, issuer, night, pricesSha256, now = Date.now(), admittedBy = null }) {
  const a = schedule.assignments.find((x) => x.id === requestId);
  if (!a) throw new Error(`Request ${requestId} is not in this schedule.`);
  return {
    typ: RECEIPT_TYPE,
    iss: new URL(issuer).origin,
    request_id: a.id,
    commitment: a.commitment,
    night,
    rule_version: schedule.ruleVersion ?? RULE_VERSION,
    limit_kw: schedule.limitKw,
    fee_cents_per_kwh: schedule.feeCentsPerKwh,
    prices_snapshot_sha256: pricesSha256,
    schedule: {
      position: a.position,
      requested_kwh: a.requestedKwh,
      delivered_kwh: a.deliveredKwh,
      shortfall_kwh: a.shortfallKwh,
      feasible: a.feasible,
      ...(a.maxPriceCents !== undefined ? { max_price_cents: a.maxPriceCents } : {}),
      ...(a.shortfallReason ? { shortfall_reason: a.shortfallReason } : {}),
      slots: a.slots.map((s) => ({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString(), kw: s.kw, kwh: s.kwh, price_cents: s.price })),
    },
    cost: { energy_eur: a.energyCostEur, fee_eur: a.feeEur, total_eur: a.totalEur },
    // For a request another site sent: who sent it, the network and model it declared, and the
    // digest of the admission policy that let it in. Absent when the resident sent it here.
    ...(admittedBy ? { admitted_by: admittedBy } : {}),
    iat: new Date(now).toISOString(),
  };
}

/** Sign a receipt statement with the site's private JWK. */
export function signReceipt(statement, privateJwk) {
  if (statement?.typ !== RECEIPT_TYPE) throw new Error("Not a charging receipt.");
  return kitSignReceipt(statement, privateJwk);
}

/**
 * Verify a receipt against the issuer's published keys.
 *
 * :return: {ok: true, receipt, kid} or {ok: false, reason}.
 */
export async function verifyReceipt(jws, { issuer, jwks = null, fetchImpl } = {}) {
  const r = await kitVerifyReceipt(jws, { issuer, typ: RECEIPT_TYPE, jwks, fetchImpl });
  return r.ok || !/^not a /.test(r.reason) ? r : { ok: false, reason: "not a charging receipt" };
}
