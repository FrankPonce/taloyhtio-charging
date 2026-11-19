---
version: 1
slug: "sites-taloyhtio-index-html"
primary_target: "sites/taloyhtio/index.html"
related_targets: ["sites/taloyhtio/styles.css"]
---

# Surface: As Oy Koivurinne (sites/taloyhtio/index.html)

Mode: **Operate** (a resident reads tonight's state and sends one night-slot request; judges see the
arbiter's rules and real load). World: Kaamos Blue Hour, inherited from Charge's DESIGN.md; this
page is "the same night, its own building".

Audience: residents (simulated) on a phone in the evening; judges once, on a laptop.
Job: know whether requests are open and how long is left, send one request without knowing kWh,
read the signed receipt after 18:00, understand how the night is shared.
Proof on hand: the arbiter's real night load (get_night_load, total kW per 15 min, no resident data),
real signed receipts, the published rules. Everything simulated is labelled.
Constraints: keep the ids app.js/request.js/tests use; the network file and the manifest's
`actions` stay untouched (no re-sign, no re-attest); amber only for charging and the one primary action.

Frank (19 Nov): picked the first hand's "building at night" structure, "but less minimal/abstract",
"make it ACTUALLY look good and professional", unsure about the bar charts. Form keeps Charge's
fields (car, battery now / charge to, ready by) with controls designed fresh.

## Direction contract

THESIS: The page is Koivurinne itself on a winter night: a detailed, illustrated Finnish apartment
block seen from its car park, with tonight's answer beside it. It refuses the category default of a
rules page as white cards and bullet lists, and refuses abstract boxes standing in for a building.

OWN-WORLD: Kaamos navy night, frost panels, Albert Sans with tabular figures. The scene is a crafted
flat illustration in layers: spruce treeline, the four-storey block with two staircases (A, B),
glazed balconies, home windows lit cool frost-blue, snow on roof and ground, birch trunks in front,
a lamp post, four parked cars at P1-P4. Amber appears in the scene only as the charging cables, the
charge-post lights and the building's 22 kW feed: the one warm light, as in Charge.

STORY: A resident sees at once whether tonight is open and how long is left, sends one request
in plain terms (car, battery now, charge to, ready by), confirms it in the site's own dialog, and
after 18:00 reads a signed receipt. A judge sees the shared limit held on a real night.

FIRST VIEWPORT: Top bar (wordmark with a drawn birch-leaf mark, "Simulated housing company" chip,
nav Tonight / Request / Rules / Ask). Left ~58%: the scene, full height of the fold, edge-bled to the
left. Right ~42%: state kicker ("Tonight, Thu 19 Nov · requests open"), countdown at display size,
one sentence, three facts (4 chargers, 22 kW shared, 1 request), the amber "Send tonight's request",
demo-code link. Phone: scene first at full width, state below.

FORM: Structure 4 of 7 on the grounded list, "the building at night", dealt lead of the first hand,
locked after a bolder re-roll; seed:6b3735d14122d7cb. Signature interaction: while a planned night
charges, the building's shared 22 kW feed draws on in amber from the electrical room (finish
review, 19 Nov: posts and cables stay neutral, because lighting each car would show who charges
when and four cars at once would exceed the limit); motion: snow falls slowly, the feed draws on,
all off under reduced motion. The load gets its own section as a finished chart (axis in kW, the
limit as a band, hour grid, per-period tooltip, text summary), not a bare bar strip.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
