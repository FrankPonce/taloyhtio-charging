// The housing page's own logic: the car list it shares with Charge, tonight's phase, and
// how the scheduler's published load maps onto the night's 36 quarter-hours.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { durationLabel, helsinkiMs, loadSummary, slotsOf, tonight } from "../sites/taloyhtio/js/night.js";

test("the housing page's car list is the same file as Charge's", async () => {
  const a = await readFile(new URL("../sites/charge/js/cars.js", import.meta.url), "utf8");
  const b = await readFile(new URL("../sites/taloyhtio/js/cars.js", import.meta.url), "utf8");
  assert.equal(b, a, "copy sites/charge/js/cars.js to sites/taloyhtio/js/cars.js after changing it");
});

test("tonight's phase follows the 18:00 deadline and the 22:00-07:00 night, in Finnish time", () => {
  const at = (date, clock) => tonight(helsinkiMs(date, clock));
  assert.deepEqual([at("2026-11-19", "12:00").phase, at("2026-11-19", "12:00").night], ["open", "2026-11-19"]);
  assert.equal(at("2026-11-19", "12:00").msLeft, 6 * 3600_000);
  assert.deepEqual([at("2026-11-19", "19:30").phase, at("2026-11-19", "19:30").current, at("2026-11-19", "19:30").night], ["planned", "2026-11-19", "2026-11-20"]);
  assert.deepEqual([at("2026-11-19", "23:00").phase, at("2026-11-19", "23:00").current], ["charging", "2026-11-19"]);
  assert.deepEqual([at("2026-11-20", "03:00").phase, at("2026-11-20", "03:00").current, at("2026-11-20", "03:00").night], ["charging", "2026-11-19", "2026-11-20"]);
});

test("durations read as people say them", () => {
  assert.equal(durationLabel(3 * 3600_000 + 12 * 60_000), "3 h 12 min");
  assert.equal(durationLabel(6 * 3600_000), "6 h");
  assert.equal(durationLabel(59_000), "1 min");
});

test("the published load lands on the right quarter-hours, across midnight and DST-free winter time", () => {
  const night = "2026-11-18";
  const start = helsinkiMs(night, "22:00");
  const load = [{ start: start + 11 * 900_000, kw: 7 }, { start: start + 12 * 900_000, kw: 22 }, { start: start + 35 * 900_000, kw: 11 }];
  const { kw } = slotsOf(night, load);
  assert.equal(kw.length, 36);
  assert.deepEqual([kw[11], kw[12], kw[35], kw[0]], [7, 22, 11, 0]);
  assert.match(loadSummary(night, 4, kw, 22), /^Wed 18 Nov: 4 cars, 10 kWh in 3 of 36 quarter-hours\. Peak 22 of 22 kW, never over the limit\.$/);
});
