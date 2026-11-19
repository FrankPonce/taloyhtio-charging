// Charge's driver-facing form: car list, battery % to energy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BODY_TYPES, CARS, LOSS_FACTOR, TYPICAL_KWH, energyFromBattery } from "../sites/charge/js/cars.js";

test("battery % to energy: the battery's share plus about 10% losses, in half kWh", () => {
  assert.deepEqual(energyFromBattery({ batteryKwh: 60, fromPercent: 35, toPercent: 80 }), { ok: true, batteryKwh: 27, gridKwh: 29.5 });
  assert.deepEqual(energyFromBattery({ batteryKwh: 77, fromPercent: 20, toPercent: 100 }), { ok: true, batteryKwh: 61.5, gridKwh: 68 });
  assert.equal(LOSS_FACTOR, 1.1);
  assert.equal(TYPICAL_KWH, 60);
});

test("battery % refusals say what to fix", () => {
  assert.match(energyFromBattery({ batteryKwh: 60, fromPercent: 80, toPercent: 80 }).reason, /higher than/);
  assert.match(energyFromBattery({ batteryKwh: 60, fromPercent: -5, toPercent: 80 }).reason, /0 to 100/);
  assert.match(energyFromBattery({ batteryKwh: 5, fromPercent: 10, toPercent: 80 }).reason, /between 10 and 200/);
  assert.equal(energyFromBattery({ batteryKwh: "x", fromPercent: 10, toPercent: 80 }).ok, false);
});

test("every listed car has a known body type, a plausible battery, and a unique name", () => {
  const bodies = new Set(BODY_TYPES.map((b) => b.id));
  const names = new Set();
  for (const car of CARS) {
    assert.ok(bodies.has(car.body), car.name);
    assert.ok(car.kwh >= 20 && car.kwh <= 140, car.name);
    assert.ok(!names.has(car.name), `duplicate ${car.name}`);
    names.add(car.name);
  }
  for (const body of bodies) assert.ok(CARS.some((c) => c.body === body), `no car for ${body}`);
});

