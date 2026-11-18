// The housing company's shared-charger rules. SIMULATED: As Oy Koivurinne is a fictional
// housing company for the Trust Before Transaction demo. The page and the assistant both
// read these values, and a test checks that the network's instructions say the same.

export const RULES = {
  company: "As Oy Koivurinne",
  simulated: true,
  chargers: { count: 4, ids: ["P1", "P2", "P3", "P4"], kwEach: 11, where: "the shared parking area, places P1–P4" },
  night: {
    from: "22:00",
    until: "07:00",
    sharedLimitKw: 22,
    why: "The building's main connection leaves 22 kW for car charging at night, so the four chargers share it.",
  },
  day: { sharedLimitKw: 11, note: "Daytime (07:00–22:00): first come, first served, up to 11 kW in total." },
  requests: {
    status: "open",
    statusNote: "Night-slot requests are open: send one before 18:00 for tonight, on this page or through Charge. After 18:00 the scheduler plans the night and signs your receipt.",
    deadline: "18:00",
    needs: ["energy in kWh", "ready-by time", "your resident code (given by the board)"],
    how: "Residents send one request per night before 18:00 with the energy needed and the ready-by time. A request is final. After 18:00 the scheduler gives each car its own slots and signs a receipt with the plan and cost.",
    where: ["the form on this page", "Charge, whose server signs the request so the scheduler can check it"],
  },
  fairShare: [
    "The car that must be ready earliest is planned first.",
    "Each car gets the cheapest slots that still finish before its ready-by time.",
    "The 22 kW limit is never exceeded.",
    "The same requests always give the same plan, and every plan comes with a signed receipt.",
  ],
  billing: {
    how: "You pay for your own slots only: the spot price of each 15-minute slot you charged in, plus a fee for the chargers.",
    feeCentsPerKwh: 2.0,
    note: "Billed to residents monthly by the housing company. Prices include VAT.",
  },
  cannot: [
    "reserve a specific charger place",
    "start, stop or control a charger or car",
    "take payments or show anyone's bill",
    "share other residents' requests, cars or plans",
  ],
  contact: { label: "the housing company's board", how: "through the residents' notice board or the property manager" },
};
