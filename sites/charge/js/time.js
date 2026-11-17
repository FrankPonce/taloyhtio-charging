// Time helpers for Finnish local time (Europe/Helsinki), without libraries.
// All internal times are epoch milliseconds (UTC). Visitors and the agent use
// Helsinki local time written as "YYYY-MM-DDTHH:MM".

export const TZ = "Europe/Helsinki";

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Helsinki wall-clock parts of an instant.
 *
 * :param ms: Epoch milliseconds.
 * :return: {year, month, day, hour, minute} as numbers.
 */
export function helsinkiParts(ms) {
  const out = {};
  for (const p of partsFormatter.formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

const pad = (n) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of an instant in Helsinki. */
export function helsinkiDate(ms) {
  const p = helsinkiParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "YYYY-MM-DDTHH:MM" of an instant in Helsinki. */
export function toHelsinkiLocal(ms) {
  const p = helsinkiParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** "HH:MM" of an instant in Helsinki. */
export function helsinkiClock(ms) {
  const p = helsinkiParts(ms);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * Convert Helsinki local time to epoch milliseconds.
 *
 * :param local: "YYYY-MM-DDTHH:MM" in Helsinki time.
 * :return: Epoch milliseconds, or null when the text is not a valid local time
 *     (wrong format, impossible date, or a time skipped by the spring DST change).
 */
export function fromHelsinkiLocal(local) {
  const m = LOCAL_RE.exec(String(local ?? "").trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Helsinki is UTC+2 or UTC+3. Try both offsets and keep the one that maps back.
  for (const offsetH of [3, 2]) {
    const ms = asUtc - offsetH * 3600_000;
    const p = helsinkiParts(ms);
    if (p.year === y && p.month === mo && p.day === d && p.hour === h && p.minute === mi) return ms;
  }
  return null;
}

/** "Tue 18 Nov" style label for a Helsinki date. */
export function weekdayLabel(ms) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(new Date(ms));
}

/** "Tue, 18 Nov 2026, 07:00" style label in Helsinki time. */
export function longLabel(ms) {
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(ms));
  return `${date}, ${helsinkiClock(ms)}`;
}

/** Add whole days to a Helsinki "YYYY-MM-DD" date. */
export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
