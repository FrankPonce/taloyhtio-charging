// Practice night: try the real scheduler now instead of waiting for 18:00.
//
//   POST /api/practice-night  {energy_kwh, ready_by: "HH:MM", max_price_cents?}
//     -> {practice: true, night, receipt_jws, receipt, inputs, load, plans}
//
// The visitor's car and three SIMULATED neighbours are planned at once by the same scheduler
// (rule koivurinne-fair-share/2), on the real 15-minute prices of the latest night that is
// fully published, and the visitor's receipt is signed with the same receipt key as real
// nights, marked `practice: true`. Nothing is stored and no resident code is needed. Every
// input comes back with the answer, so the page can re-run the published scheduler in the
// browser and check the plan, the price snapshot and the signature itself. (Real nights
// never publish their inputs: they would show when neighbours need their cars.)

import { REQUEST_LIMITS, requestProblem, scheduleNight } from "./scheduler.js";
import { commitmentOf, newNonce, pricesSnapshotHash, receiptFor, signReceipt } from "./receipt.js";
import { ArbiterError, nightPrices, nightTerms, openNight, readyByOf } from "./service.js";
import { addDays } from "../../sites/charge/js/time.js";

/** The simulated neighbours, the same every time. */
export const NEIGHBOURS = Object.freeze([
  { id: "practice-a", label: "Neighbour A (simulated)", energyKwh: 30, chargerKw: 11, readyBy: "06:00" },
  { id: "practice-b", label: "Neighbour B (simulated)", energyKwh: 18, chargerKw: 7.4, readyBy: "05:30" },
  { id: "practice-c", label: "Neighbour C (simulated)", energyKwh: 42, chargerKw: 11, readyBy: "07:00", maxPriceCents: 6 },
]);
export const YOU = "practice-you";

const PRICE_TTL_MS = 60 * 60_000;
const priceCache = new Map(); // night -> {at, prices}; per Worker isolate

/** Forget cached prices (tests). */
export function clearPracticeCache() {
  priceCache.clear();
}

async function pricesFor(night, { fetchImpl, now }) {
  const hit = priceCache.get(night);
  if (hit && now - hit.at < PRICE_TTL_MS) return hit.prices;
  const prices = await nightPrices(night, { fetchImpl });
  priceCache.set(night, { at: now, prices });
  return prices;
}

/**
 * The latest night (the one open now, or up to two before it) whose prices are fully published.
 *
 * :return: {night, prices}.
 * :raises ArbiterError: When none is (the price service is down).
 */
async function latestPublishedNight({ fetchImpl, now }) {
  let night = openNight(now);
  let last;
  for (let i = 0; i < 3; i++, night = addDays(night, -1)) {
    try {
      return { night, prices: await pricesFor(night, { fetchImpl, now }) };
    } catch (error) {
      if (!(error instanceof ArbiterError)) throw error;
      last = error;
    }
  }
  throw new ArbiterError(`No recent night has published prices right now (${last?.message ?? "price service unavailable"}). Try again later.`, "prices_unavailable");
}

/**
 * Plan a practice night and sign the visitor's receipt.
 *
 * :param input: {energyKwh, readyBy: "HH:MM", maxPriceCents (optional)}.
 * :param opts: {now, fetchImpl, privateJwk, issuer}.
 * :raises ArbiterError: With a reason the visitor can act on.
 */
export async function practiceNight(input, { now = Date.now(), fetchImpl = globalThis.fetch, privateJwk, issuer }) {
  if (!privateJwk?.kid || !issuer) throw new ArbiterError("The arbiter's receipt key is not configured.", "not_configured");
  const { night, prices } = await latestPublishedNight({ fetchImpl, now });
  const terms = nightTerms(night);

  const asked = [
    ...NEIGHBOURS,
    { id: YOU, label: "You", energyKwh: input.energyKwh, chargerKw: 11, readyBy: input.readyBy, maxPriceCents: input.maxPriceCents ?? undefined },
  ];
  const requests = [];
  for (const a of asked) {
    let readyByMs;
    try {
      readyByMs = readyByOf(night, a.readyBy);
    } catch (error) {
      throw new ArbiterError(error.message, "bad_request");
    }
    const sealed = { resident: a.id, night, energyKwh: a.energyKwh, chargerKw: a.chargerKw, fromMs: terms.fromMs, readyByMs };
    if (a.maxPriceCents !== undefined && a.maxPriceCents !== null) sealed.maxPriceCents = a.maxPriceCents;
    const r = { id: a.id, label: a.label, commitment: await commitmentOf(sealed, newNonce()), ...sealed };
    const problem = requestProblem(r);
    if (problem) throw new ArbiterError(problem, "bad_request");
    requests.push(r);
  }

  const schedule = scheduleNight({ requests, prices, limitKw: terms.limitKw, feeCentsPerKwh: terms.feeCentsPerKwh });
  const pricesSha256 = await pricesSnapshotHash(prices);
  const receipt = { ...receiptFor({ schedule, requestId: YOU, issuer, night, pricesSha256, now }), practice: true };
  const receipt_jws = await signReceipt(receipt, privateJwk);
  const label = new Map(requests.map((r) => [r.id, r.label]));
  return {
    practice: true,
    night,
    receipt_jws,
    receipt,
    inputs: {
      ruleVersion: schedule.ruleVersion,
      limitKw: terms.limitKw,
      feeCentsPerKwh: terms.feeCentsPerKwh,
      prices,
      requests: requests.map(({ id, label: l, commitment, energyKwh, chargerKw, fromMs, readyByMs, maxPriceCents }) => ({
        id, label: l, commitment, energyKwh, chargerKw, fromMs, readyByMs, ...(maxPriceCents === undefined ? {} : { maxPriceCents }),
      })),
    },
    load: schedule.load,
    plans: schedule.assignments.map((a) => ({
      id: a.id, label: label.get(a.id), requestedKwh: a.requestedKwh, deliveredKwh: a.deliveredKwh, totalEur: a.totalEur,
    })),
  };
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

/**
 * HTTP handler for POST /api/practice-night (same origin only, rate-limited per IP).
 *
 * :param env: Bindings (PRACTICE_LIMIT).
 * :param opts: {now, fetchImpl, privateJwk, issuer}.
 */
export async function handlePracticeNight(request, env, opts) {
  if (request.method !== "POST") return json(405, { error: "Use POST." });
  if (request.headers.get("origin") !== new URL(request.url).origin) return json(403, { error: "Practice nights run on the housing company's own page." });
  if (env.PRACTICE_LIMIT?.limit) {
    const { success } = await env.PRACTICE_LIMIT.limit({ key: `ip:${request.headers.get("cf-connecting-ip") || "local"}` });
    if (!success) return json(429, { error: "Too many practice nights from this address. Wait a minute." });
  }
  const body = await request.json().catch(() => null);
  const e = REQUEST_LIMITS.energyKwh;
  if (!body || !Number.isFinite(body.energy_kwh) || body.energy_kwh < e.min || body.energy_kwh > e.max) return json(400, { error: `energy_kwh must be between ${e.min} and ${e.max}.` });
  if (typeof body.ready_by !== "string" || !/^\d{2}:\d{2}$/.test(body.ready_by)) return json(400, { error: 'ready_by must be "HH:MM".' });
  if (body.max_price_cents !== undefined && body.max_price_cents !== null && !Number.isFinite(body.max_price_cents)) return json(400, { error: "max_price_cents must be a number." });
  try {
    return json(200, await practiceNight({ energyKwh: body.energy_kwh, readyBy: body.ready_by, maxPriceCents: body.max_price_cents ?? null }, opts));
  } catch (error) {
    if (error instanceof ArbiterError) return json(error.code === "not_configured" || error.code === "prices_unavailable" ? 503 : 400, { error: error.message, code: error.code });
    throw error;
  }
}
