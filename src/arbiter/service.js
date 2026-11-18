// The arbiter service: sealed night-slot requests in, signed receipts out. Plain code over
// D1; no language model anywhere. The MCP endpoint (mcp.js) and tests call these functions.
//
// Flow for one night (Helsinki time, from sites/taloyhtio/js/rules.js):
//   until 18:00   residents submit one sealed request each (energy, ready-by time, charger)
//   after 18:00   the first receipt lookup schedules the whole night once, with that night's
//                 real 15-minute prices, signs every resident's receipt and stores it all in
//                 one atomic batch. A scheduled night is final (D1 triggers refuse changes).
//
// Residents are SIMULATED for the demo; only a hash of each resident's code is stored.

import { sha256Hex } from "agent-trust-kit";
import { RULES } from "../../sites/taloyhtio/js/rules.js";
import { addDays, fromHelsinkiLocal, helsinkiDate, helsinkiParts } from "../../sites/charge/js/time.js";
import { normalizeDay, PRICE_SOURCE } from "../../sites/charge/js/prices.js";
import { scheduleNight, SLOT_MINUTES, REQUEST_LIMITS, requestProblem } from "./scheduler.js";
import { commitmentOf, newNonce, pricesSnapshotHash, receiptFor, signReceipt } from "./receipt.js";

const SLOT_MS = SLOT_MINUTES * 60_000;
const NIGHT_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A refusal a person can act on. Callers show the message as is. */
export class ArbiterError extends Error {
  constructor(message, code = "refused") {
    super(message);
    this.code = code;
  }
}

/** The fixed terms of one night: when requests close and which hours can be planned. */
export function nightTerms(night) {
  if (!NIGHT_RE.test(String(night))) throw new ArbiterError("Give the night as YYYY-MM-DD (the evening it starts).", "bad_night");
  const fromMs = fromHelsinkiLocal(`${night}T${RULES.night.from}`);
  const untilMs = fromHelsinkiLocal(`${addDays(night, 1)}T${RULES.night.until}`);
  const deadlineMs = fromHelsinkiLocal(`${night}T${RULES.requests.deadline}`);
  if (fromMs === null || untilMs === null || deadlineMs === null) throw new ArbiterError(`${night} is not a valid date.`, "bad_night");
  return { night, fromMs, untilMs, deadlineMs, limitKw: RULES.night.sharedLimitKw, feeCentsPerKwh: RULES.billing.feeCentsPerKwh };
}

/** The night that is open for requests now: tonight until 18:00, then tomorrow night. */
export function openNight(nowMs) {
  const today = helsinkiDate(nowMs);
  return nowMs < nightTerms(today).deadlineMs ? today : addDays(today, 1);
}

/**
 * Turn "HH:MM" into the ready-by moment of a night: 22:15-23:59 is that evening, 00:00-07:00
 * the next morning. Anything else is outside the night window.
 */
export function readyByOf(night, clock) {
  const m = CLOCK_RE.exec(String(clock ?? "").trim());
  if (!m) throw new ArbiterError('Give the ready-by time as HH:MM, for example "07:00".', "bad_ready_by");
  const terms = nightTerms(night);
  const evening = Number(m[1]) >= 12;
  const ms = fromHelsinkiLocal(`${evening ? night : addDays(night, 1)}T${clock.trim()}`);
  if (ms === null || ms <= terms.fromMs || ms > terms.untilMs) {
    throw new ArbiterError(`The ready-by time must be between ${RULES.night.from} and ${RULES.night.until} (night slots only).`, "bad_ready_by");
  }
  return ms;
}

async function residentByCode(db, code) {
  if (typeof code !== "string" || code.trim().length < 6) throw new ArbiterError("A resident code from the board is needed.", "unknown_resident");
  const row = await db.prepare("SELECT id FROM residents WHERE code_sha256 = ?").bind(await sha256Hex(code.trim())).first();
  if (!row) throw new ArbiterError("That resident code is not valid.", "unknown_resident");
  return row.id;
}

const randomId = (prefix) => `${prefix}_${[...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;

/**
 * Accept one sealed request.
 *
 * :param db: The arbiter's D1 database.
 * :param input: {residentCode, night (optional, default: the open night), energyKwh, readyBy: "HH:MM",
 *     chargerKw (optional, default: the charger's power)}.
 * :param opts: {now, callerNetworkSha256 (from the admission check, M5b)}.
 * :return: {request_id, commitment, night, requests_close_at, status}.
 * :raises ArbiterError: With a reason the resident can act on.
 */
export async function submitRequest(db, input, { now = Date.now(), callerNetworkSha256 = null } = {}) {
  const resident = await residentByCode(db, input.residentCode);
  const night = input.night ?? openNight(now);
  const terms = nightTerms(night);
  if (now >= terms.deadlineMs) throw new ArbiterError(`Requests for the night of ${night} closed at ${RULES.requests.deadline}.`, "closed");
  if (terms.fromMs - now > 7 * 24 * 3600_000) throw new ArbiterError("Requests open at most a week ahead.", "too_early");
  const chargerKw = input.chargerKw ?? RULES.chargers.kwEach;
  if (!(chargerKw <= RULES.chargers.kwEach)) throw new ArbiterError(`The chargers deliver at most ${RULES.chargers.kwEach} kW.`, "bad_charger");
  const sealed = { resident, night, energyKwh: input.energyKwh, chargerKw, fromMs: terms.fromMs, readyByMs: readyByOf(night, input.readyBy) };
  const nonce = newNonce();
  const commitment = await commitmentOf(sealed, nonce);
  const id = randomId("req");
  const problem = requestProblem({ id, commitment, ...sealed });
  if (problem) throw new ArbiterError(problem, "bad_request");
  try {
    await db.prepare(
      `INSERT INTO requests (id, night, resident, energy_kwh, charger_kw, from_ms, ready_by_ms, nonce, commitment, caller_network_sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, night, resident, sealed.energyKwh, chargerKw, sealed.fromMs, sealed.readyByMs, nonce, commitment, callerNetworkSha256, new Date(now).toISOString()).run();
  } catch (error) {
    if (/UNIQUE/i.test(String(error?.message))) throw new ArbiterError(`You already sent a request for the night of ${night}. One request per night.`, "duplicate");
    throw error;
  }
  return { request_id: id, commitment, night, requests_close_at: new Date(terms.deadlineMs).toISOString(), status: "received" };
}

/**
 * Fetch the 15-minute prices covering a night from the public price API.
 *
 * :return: [{start, end, price}] for every slot of the night.
 * :raises ArbiterError: When the night's prices are not published or incomplete.
 */
export async function nightPrices(night, { fetchImpl = globalThis.fetch } = {}) {
  const terms = nightTerms(night);
  const days = await Promise.all([night, addDays(night, 1)].map(async (date) => {
    const resp = await fetchImpl(`${PRICE_SOURCE.api}?zone=FI&day=${date}`);
    if (!resp.ok) throw new ArbiterError(`The price service answered ${resp.status} for ${date}. Try again later.`, "prices_unavailable");
    return normalizeDay(await resp.json());
  }));
  const slots = days.flatMap((d) => d.points).filter((p) => p.start >= terms.fromMs && p.end <= terms.untilMs && p.end - p.start === SLOT_MS);
  const needed = Math.round((terms.untilMs - terms.fromMs) / SLOT_MS);
  const unique = new Map(slots.map((s) => [s.start, s]));
  if (unique.size < needed) throw new ArbiterError(`Prices for the night of ${night} are not fully published yet (${unique.size} of ${needed} slots). They usually appear around 14:00.`, "prices_unavailable");
  return [...unique.values()].sort((a, b) => a.start - b.start);
}

/**
 * Schedule a night once, after its deadline: plan, sign every receipt, store atomically.
 * Safe to call repeatedly or concurrently; the first complete call wins and the night is final.
 *
 * :param opts: {now, prices: [{start,end,price}] (optional, else fetched), fetchImpl, privateJwk, issuer}.
 * :return: {night, scheduled: true, created: bool} or {night, scheduled: false, requests_close_at}.
 */
export async function scheduleIfDue(db, night, { now = Date.now(), prices = null, fetchImpl, privateJwk, issuer }) {
  const terms = nightTerms(night);
  if (now < terms.deadlineMs) return { night, scheduled: false, requests_close_at: new Date(terms.deadlineMs).toISOString() };
  if (await db.prepare("SELECT night FROM nights WHERE night = ?").bind(night).first()) return { night, scheduled: true, created: false };
  if (!privateJwk?.kid || !issuer) throw new ArbiterError("The arbiter's receipt key is not configured.", "not_configured");

  const used = prices ?? (await nightPrices(night, { fetchImpl }));
  const { results: rows } = await db.prepare("SELECT * FROM requests WHERE night = ? ORDER BY id").bind(night).all();
  const requests = rows.map((r) => ({ id: r.id, commitment: r.commitment, energyKwh: r.energy_kwh, chargerKw: r.charger_kw, fromMs: r.from_ms, readyByMs: r.ready_by_ms }));
  const schedule = scheduleNight({ requests, prices: used, limitKw: terms.limitKw, feeCentsPerKwh: terms.feeCentsPerKwh });
  const pricesSha256 = await pricesSnapshotHash(used);
  const at = new Date(now).toISOString();

  const statements = [
    db.prepare(
      `INSERT INTO nights (night, rule_version, limit_kw, fee_cents_per_kwh, prices_snapshot_sha256, prices_json, load_json, scheduled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(night, schedule.ruleVersion, schedule.limitKw, schedule.feeCentsPerKwh, pricesSha256, JSON.stringify(used), JSON.stringify(schedule.load), at),
  ];
  for (const a of schedule.assignments) {
    const jws = await signReceipt(receiptFor({ schedule, requestId: a.id, issuer, night, pricesSha256, now }), privateJwk);
    statements.push(db.prepare("INSERT INTO receipts (request_id, night, jws, issued_at) VALUES (?, ?, ?, ?)").bind(a.id, night, jws, at));
  }
  try {
    await db.batch(statements);
  } catch (error) {
    // Another call scheduled the night first: its result stands.
    if (/UNIQUE|PRIMARY KEY/i.test(String(error?.message)) && (await db.prepare("SELECT night FROM nights WHERE night = ?").bind(night).first())) {
      return { night, scheduled: true, created: false };
    }
    throw error;
  }
  return { night, scheduled: true, created: true };
}

/**
 * A resident's receipt. Only the resident who sent the request can read it.
 *
 * :param input: {requestId, residentCode}.
 * :param opts: as scheduleIfDue.
 * :return: {status: "pending", requests_close_at} or {status: "scheduled", receipt_jws, receipt}.
 */
export async function getReceipt(db, { requestId, residentCode }, opts = {}) {
  const resident = await residentByCode(db, residentCode);
  const req = await db.prepare("SELECT id, night, resident FROM requests WHERE id = ?").bind(String(requestId ?? "")).first();
  // Same answer for "no such request" and "not yours": nothing to learn about others.
  if (!req || req.resident !== resident) throw new ArbiterError("No request with that ID for this resident.", "not_found");
  const s = await scheduleIfDue(db, req.night, opts);
  if (!s.scheduled) return { status: "pending", night: req.night, requests_close_at: s.requests_close_at };
  const row = await db.prepare("SELECT jws FROM receipts WHERE request_id = ?").bind(req.id).first();
  if (!row) throw new ArbiterError("This request has no receipt (it arrived after the night was scheduled).", "not_found");
  const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(row.jws.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
  return { status: "scheduled", night: req.night, receipt_jws: row.jws, receipt: payload };
}

/** Total kW per slot for a scheduled night: no resident data. */
export async function nightLoad(db, night) {
  const terms = nightTerms(night);
  const row = await db.prepare("SELECT load_json, limit_kw, rule_version FROM nights WHERE night = ?").bind(night).first();
  if (!row) return { night, scheduled: false, requests_close_at: new Date(terms.deadlineMs).toISOString() };
  const { results } = await db.prepare("SELECT COUNT(*) AS n FROM requests WHERE night = ?").bind(night).all();
  return { night, scheduled: true, limit_kw: row.limit_kw, rule_version: row.rule_version, requests: results[0].n, load: JSON.parse(row.load_json) };
}

/** The published rules, for agents and pages. */
export function publicRules(nowMs = Date.now()) {
  const night = openNight(nowMs);
  return {
    company: RULES.company,
    simulated: RULES.simulated,
    night_window: `${RULES.night.from}-${RULES.night.until}`,
    shared_limit_kw: RULES.night.sharedLimitKw,
    charger_kw: RULES.chargers.kwEach,
    requests_close_daily_at: RULES.requests.deadline,
    open_night: night,
    energy_kwh: REQUEST_LIMITS.energyKwh,
    fee_cents_per_kwh: RULES.billing.feeCentsPerKwh,
    fair_share: RULES.fairShare,
    billing: RULES.billing.how,
    time_zone: "Europe/Helsinki",
    helsinki_now: (() => { const p = helsinkiParts(nowMs); return `${helsinkiDate(nowMs)} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`; })(),
  };
}
