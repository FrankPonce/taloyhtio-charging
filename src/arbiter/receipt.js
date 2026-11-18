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

import { canonicalHash, signStatement, verifyStatement } from "agent-trust-kit";
import { RULE_VERSION, normalizePrices } from "./scheduler.js";

export const RECEIPT_TYPE = "charging-receipt/v1";

/** Random 128-bit nonce as hex. */
export function newNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Commitment hash of a sealed request.
 *
 * :param sealed: {resident, night, energyKwh, chargerKw, fromMs, readyByMs}.
 * :param nonce: Server nonce (hex), kept with the request.
 * :return: Hex SHA-256.
 */
export async function commitmentOf(sealed, nonce) {
  if (typeof nonce !== "string" || nonce.length < 32) throw new TypeError("A commitment needs a server nonce of at least 128 bits.");
  const { resident, night, energyKwh, chargerKw, fromMs, readyByMs } = sealed;
  return canonicalHash({ resident, night, energyKwh, chargerKw, fromMs, readyByMs, nonce });
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
export function receiptFor({ schedule, requestId, issuer, night, pricesSha256, now = Date.now() }) {
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
      slots: a.slots.map((s) => ({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString(), kw: s.kw, kwh: s.kwh, price_cents: s.price })),
    },
    cost: { energy_eur: a.energyCostEur, fee_eur: a.feeEur, total_eur: a.totalEur },
    iat: new Date(now).toISOString(),
  };
}

/** Sign a receipt statement with the site's private JWK. */
export function signReceipt(statement, privateJwk) {
  if (statement?.typ !== RECEIPT_TYPE) throw new Error("Not a charging receipt.");
  return signStatement(statement, privateJwk);
}

/**
 * Verify a receipt against the issuer's published keys.
 *
 * :return: {ok: true, receipt, kid} or {ok: false, reason}.
 */
export async function verifyReceipt(jws, { issuer, jwks = null, fetchImpl } = {}) {
  const r = await verifyStatement(jws, { issuer, jwks, fetchImpl });
  if (!r.ok) return r;
  if (r.statement.typ !== RECEIPT_TYPE) return { ok: false, reason: "not a charging receipt" };
  if (issuer && r.statement.iss !== new URL(issuer).origin) return { ok: false, reason: "issued by another site" };
  return { ok: true, receipt: r.statement, kid: r.kid };
}
