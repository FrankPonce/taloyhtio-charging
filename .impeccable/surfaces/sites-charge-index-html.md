---
version: 1
slug: "sites-charge-index-html"
primary_target: "sites/charge/index.html"
related_targets: []
---

# Surface brief: Charge (sites/charge/index.html)

Mode: Operate (a planning tool; mobile-first, used on a phone on a dark winter evening).
Audience and job: a Finnish EV owner deciding when to plug in tonight so the car is ready by a time, at the lowest spot-price energy cost; secondary: a resident sending one night-slot request; judges see the trust layer through it.
Constraints: page works without the assistant; numbers come only from page code; simulated housing company labelled; price source credited; no secrets in the browser; runtime and network files untouched (no re-sign needed for CSS/page JS).
Chosen direction: Kaamos Blue Hour (Frank, 19 Nov 2026, decision page; my pick card). Memorable moment: tonight's prices as a night skyline that lights up at your charging hours.
Decided 19 Nov (Frank): Albert Sans self-hosted (fonts/, OFL); driver form with a text car list plus generic body silhouettes and ~10% charging losses; stars and a C-shaped crescent moon on the skyline (his wish, decorative, not the real phase); one car list with the silhouette beside it, five body types EVs really come in (no coupé or pickup); battery as a two-handle bar, ready-by as a slider, chargers as icon tiles; smooth section scrolling and one orchestrated motion (skyline rises, windows switch on, a few stars twinkle, a new start time eases in), all off for reduced motion. Car battery sizes are approximate and unverified (labelled ≈, editable).

## Direction contract

THESIS: The night is the interface. Charge refuses the category's white card with a blue bar chart; the first viewport is tonight itself, from now to ready-by, and the plan is the hours that light up in it.

OWN-WORLD: Kaamos blue: a navy night ground (#0e1f3d) with dusk blue (#24467a) toward the edges of the night, lit-window amber (#f4b23a) only for charging and the one primary action, pale frost panels (#e9eef7) where people type and read. Building silhouettes, flat fills, no glow, no gradients except the sky that maps clock time.

STORY: The visitor sees tonight's answer before touching anything (defaults: 30 kWh, 11 kW, next 07:00), understands lower buildings are cheaper periods and lit ones are when to charge, picks their car from one list (its generic silhouette and ≈ battery size appear beside it; "Not listed" takes a size), drags two handles on a battery for now % and charge-to %, drags a ready-by slider over the hours with prices (the skyline's "ready" end follows), taps a charger tile, sees the energy that means (≈ kWh incl. about 10% charging losses) and tonight's answer update live, and presses the button for the full plan computed by code; then may ask the assistant or send a housing request with a plain confirmation.

FIRST VIEWPORT: Dark header (Charge, Plan / Prices / Ask). Small context line "Cheapest time to charge tonight · 30 kWh at 11 kW, ready Thu 07:00". Huge start time "02:15" with "plug in and start", then Done by, cost in amber, average. Full-bleed night skyline, now to ready-by, every 15-minute period a building whose height is its price, planned periods lit with window panes; hour ticks under it. Stars that fade toward dusk and a decorative "C" crescent moon sit behind the buildings (frost, never amber). Then the frost form panel with almost no text boxes: car list with the chosen car's silhouette (hatchback, sedan, estate, SUV, van) and ≈ battery to its right; a battery with two handles (held charge pale, the added charge amber); a ready-by slider with the time in large type; charger tiles with drawn icons (wall box 11 / 22 kW, charging cable, household socket) and "Another power"; the energy line; amber "Find the cheapest time".

FORM: Kaamos Blue Hour, the IMPECCABLE'S PICK card (position 1 on my grounded list); seed:22931cc2c849f26b. Signature move: the night skyline (price as building height, charging as lit windows, sky colour mapped to clock time). Raises kept from the round: state by form not hue (lit periods carry window panes), length is exact duration, one fixed scale per chart.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
