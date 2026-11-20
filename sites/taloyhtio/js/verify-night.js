// Check a practice night in the visitor's own browser, trusting nothing the server said:
//   1. the receipt's signature (Ed25519 JWS) against this site's published key directory;
//   2. the receipt's price snapshot hash against the prices it was planned on (RFC 8785 JCS);
//   3. the plan itself, by running the published scheduler (js/scheduler.js, a byte-for-byte
//      copy of the arbiter's) on the same inputs and comparing every car's result.
// The crypto is agent-trust-kit's verify-lite.js (WebCrypto only), copied unchanged next to this
// file. Real nights are not checked this way: their inputs stay private.

import { normalizePrices, scheduleNight } from "./scheduler.js";
import { canonicalJson, sha256Hex, verifyJws } from "./verify-lite.js";

export { canonicalJson };

const slotOf = (s) => ({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString(), kw: s.kw, kwh: s.kwh, price_cents: s.price });

/**
 * Check a practice night answer.
 *
 * :param answer: The /api/practice-night response.
 * :param opts: {keyDirectory (this site's published JWKS), issuer (this site's origin)}.
 * :return: [{id, ok, text}] for signature, prices and plan.
 */
export async function checkPracticeNight(answer, { keyDirectory, issuer }) {
  const out = [];
  const sig = await verifyJws(answer.receipt_jws, keyDirectory);
  const receipt = sig.ok ? sig.statement : null;
  const signedHere = sig.ok && receipt.iss === issuer && receipt.practice === true;
  out.push({
    id: "signature",
    ok: signedHere,
    text: signedHere
      ? `Signed by ${new URL(issuer).host} with a key it publishes (${sig.kid.slice(0, 10)}…), marked as practice.`
      : `The signature does not check out: ${sig.ok ? "issued by another site or not a practice receipt" : sig.reason}.`,
  });
  if (!receipt) return out;

  const hash = await sha256Hex(canonicalJson(normalizePrices(answer.inputs.prices)));
  out.push({
    id: "prices",
    ok: hash === receipt.prices_snapshot_sha256,
    text: hash === receipt.prices_snapshot_sha256
      ? `Planned on the ${answer.inputs.prices.length} real quarter-hour prices of the night of ${receipt.night}: their hash matches the signed one.`
      : "The prices sent with the plan are not the ones the receipt was signed for.",
  });

  const again = scheduleNight({ requests: answer.inputs.requests, prices: answer.inputs.prices, limitKw: answer.inputs.limitKw, feeCentsPerKwh: answer.inputs.feeCentsPerKwh });
  const mine = again.assignments.find((a) => a.id === receipt.request_id);
  // Compare canonical forms: the signed payload is canonical JSON, so its keys are sorted.
  const sameMine = !!mine && canonicalJson(mine.slots.map(slotOf)) === canonicalJson(receipt.schedule.slots) && mine.totalEur === receipt.cost.total_eur;
  const sameAll = canonicalJson(again.load) === canonicalJson(answer.load) && again.ruleVersion === receipt.rule_version;
  out.push({
    id: "plan",
    ok: sameMine && sameAll,
    text: sameMine && sameAll
      ? `Re-ran the published scheduler (${again.ruleVersion}) here for all ${answer.inputs.requests.length} cars: same plan, same cost, never over ${answer.inputs.limitKw} kW.`
      : "Re-running the published scheduler here gives a different plan than the one signed.",
  });
  return out;
}
