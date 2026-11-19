// Common electric cars in Finland, with an approximate usable battery size in kWh, so a
// driver can pick their car instead of knowing kWh. Approximate on purpose: the page
// shows "≈" and the battery field stays editable, and "Not listed" takes any size.
// Body types pick the silhouette shown on the form (generic drawings, no makes or logos).

// The body types electric cars actually come in on Finnish roads; anything else goes
// under "Not listed".
export const BODY_TYPES = [
  { id: "hatchback", label: "Hatchback" },
  { id: "sedan", label: "Sedan" },
  { id: "estate", label: "Estate" },
  { id: "suv", label: "SUV" },
  { id: "van", label: "Van" },
];

export const CARS = [
  { body: "hatchback", name: "Volkswagen ID.3 Pro", kwh: 58 },
  { body: "hatchback", name: "Volkswagen ID.3 Pro S", kwh: 77 },
  { body: "hatchback", name: "Cupra Born 58 kWh", kwh: 58 },
  { body: "hatchback", name: "Nissan Leaf 40 kWh", kwh: 39 },
  { body: "hatchback", name: "Nissan Leaf e+ 62 kWh", kwh: 59 },
  { body: "hatchback", name: "MG4 Standard", kwh: 49 },
  { body: "hatchback", name: "MG4 Long Range", kwh: 62 },
  { body: "hatchback", name: "Peugeot e-208", kwh: 48 },
  { body: "hatchback", name: "Renault 5 E-Tech 52 kWh", kwh: 52 },
  { body: "hatchback", name: "Renault Megane E-Tech 60 kWh", kwh: 60 },
  { body: "sedan", name: "Tesla Model 3 Rear-Wheel Drive", kwh: 57 },
  { body: "sedan", name: "Tesla Model 3 Long Range", kwh: 75 },
  { body: "sedan", name: "Polestar 2 Long Range", kwh: 79 },
  { body: "sedan", name: "Hyundai Ioniq 6 Long Range", kwh: 74 },
  { body: "sedan", name: "BYD Seal", kwh: 82 },
  { body: "sedan", name: "BMW i4 eDrive40", kwh: 81 },
  { body: "sedan", name: "Porsche Taycan (Performance Battery Plus)", kwh: 84 },
  { body: "estate", name: "Volkswagen ID.7 Tourer Pro S", kwh: 86 },
  { body: "estate", name: "MG5 Long Range", kwh: 57 },
  { body: "estate", name: "Peugeot e-308 SW", kwh: 51 },
  { body: "estate", name: "Audi A6 Avant e-tron", kwh: 95 },
  { body: "suv", name: "Tesla Model Y Rear-Wheel Drive", kwh: 60 },
  { body: "suv", name: "Tesla Model Y Long Range", kwh: 75 },
  { body: "suv", name: "Volkswagen ID.4 Pro", kwh: 77 },
  { body: "suv", name: "Skoda Enyaq 85", kwh: 77 },
  { body: "suv", name: "Skoda Elroq 85", kwh: 77 },
  { body: "suv", name: "Kia EV6 Long Range", kwh: 80 },
  { body: "suv", name: "Kia EV3 Long Range", kwh: 78 },
  { body: "suv", name: "Kia Niro EV", kwh: 65 },
  { body: "suv", name: "Hyundai Ioniq 5 Long Range", kwh: 80 },
  { body: "suv", name: "Hyundai Kona Electric 65 kWh", kwh: 65 },
  { body: "suv", name: "Volvo EX30 Extended Range", kwh: 64 },
  { body: "suv", name: "Volvo EX40 / XC40 Recharge", kwh: 79 },
  { body: "suv", name: "BMW iX1 xDrive30", kwh: 65 },
  { body: "suv", name: "Mercedes-Benz EQA 250+", kwh: 70 },
  { body: "suv", name: "Audi Q4 e-tron 45", kwh: 77 },
  { body: "suv", name: "Toyota bZ4X", kwh: 64 },
  { body: "suv", name: "BYD Atto 3", kwh: 60 },
  { body: "suv", name: "Ford Mustang Mach-E Extended Range", kwh: 91 },
  { body: "suv", name: "Nissan Ariya 87 kWh", kwh: 87 },
  { body: "van", name: "Volkswagen ID. Buzz", kwh: 77 },
  { body: "van", name: "Ford E-Transit Custom", kwh: 64 },
];

/** Battery size used until the driver picks a car or types one. */
export const TYPICAL_KWH = 60;

/** AC charging loses roughly this share as heat; the grid supplies it too. */
export const LOSS_FACTOR = 1.1;

/**
 * Energy to plan for: what the battery needs to go from one charge level to another, plus
 * about 10% charging losses, because the grid supplies (and the driver pays for) both.
 *
 * :param input: {batteryKwh, fromPercent, toPercent}.
 * :return: {ok: true, batteryKwh, gridKwh} rounded to 0.5 kWh, or {ok: false, reason}.
 */
export function energyFromBattery({ batteryKwh, fromPercent, toPercent }) {
  const size = Number(batteryKwh), from = Number(fromPercent), to = Number(toPercent);
  if (!Number.isFinite(size) || size < 10 || size > 200) return { ok: false, reason: "Battery size must be between 10 and 200 kWh." };
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to > 100) return { ok: false, reason: "Charge levels are percentages from 0 to 100." };
  if (to <= from) return { ok: false, reason: "Charge to must be higher than the battery's level now." };
  const battery = (size * (to - from)) / 100;
  const half = (x) => Math.round(x * 2) / 2;
  return { ok: true, batteryKwh: half(battery), gridKwh: half(battery * LOSS_FACTOR) };
}
