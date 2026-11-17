// Finnish day-ahead spot prices, 15-minute resolution, c/kWh including 25.5% VAT.
// Source: sähkönhintanyt.org (ENTSO-E / Nord Pool). The page must credit it.

import { addDays, helsinkiDate } from "./time.js";

export const PRICE_SOURCE = Object.freeze({
  name: "sähkönhintanyt.org",
  url: "https://sähkönhintanyt.org/",
  api: "https://api.sähkönhintanyt.org/v1/prices",
});

const CACHE_PREFIX = "charge.prices.";

/**
 * Turn one API day into price slots.
 *
 * :param body: The API's JSON for one day.
 * :return: {date, available, complete, points: [{start, end, price}]} with epoch-ms times.
 */
export function normalizeDay(body) {
  const available = body?.available === true && Array.isArray(body?.points);
  const points = available
    ? body.points
      .map((p) => ({ start: Date.parse(p.start), end: Date.parse(p.end), price: Number(p.price) }))
      .filter((p) => Number.isFinite(p.start) && Number.isFinite(p.end) && Number.isFinite(p.price))
    : [];
  return {
    date: String(body?.date ?? ""),
    available: available && points.length > 0,
    complete: body?.complete === true,
    points,
  };
}

/**
 * Load today's and tomorrow's prices (Helsinki dates).
 *
 * Complete days are cached per date in sessionStorage. Tomorrow is fetched again
 * until it is published (around 14:00 Finnish time).
 *
 * :param opts: {nowMs, fetchImpl, storage}; all optional, for tests.
 * :return: {today, tomorrow, slots, fetchedAtMs}. A day that failed to load has
 *     available false and an error message.
 */
export async function loadPrices({ nowMs = Date.now(), fetchImpl = globalThis.fetch, storage = safeStorage() } = {}) {
  const todayDate = helsinkiDate(nowMs);
  const tomorrowDate = addDays(todayDate, 1);
  const [today, tomorrow] = await Promise.all([
    loadDay(todayDate, { fetchImpl, storage }),
    loadDay(tomorrowDate, { fetchImpl, storage }),
  ]);
  const slots = [...today.points, ...tomorrow.points].sort((a, b) => a.start - b.start);
  return { today, tomorrow, slots, fetchedAtMs: nowMs };
}

async function loadDay(date, { fetchImpl, storage }) {
  const cached = readCache(storage, date);
  if (cached) return cached;
  try {
    const resp = await fetchImpl(`${PRICE_SOURCE.api}?zone=FI&day=${date}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const day = normalizeDay(await resp.json());
    if (day.available && day.complete) writeCache(storage, date, day);
    return day.date ? day : { ...day, date };
  } catch (error) {
    return { date, available: false, complete: false, points: [], error: `Could not load prices for ${date}.` };
  }
}

function readCache(storage, date) {
  try {
    const raw = storage?.getItem(CACHE_PREFIX + date);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(storage, date, day) {
  try {
    storage?.setItem(CACHE_PREFIX + date, JSON.stringify(day));
  } catch {
    // Storage full or blocked: prices still work, just uncached.
  }
}

function safeStorage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}
