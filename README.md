# taloyhtio-charging

Shared EV charging for Finnish housing companies on the open agentic web: an energy agent,
a housing-company site, and a fair-share arbiter that admits only signed, tested agents and
signs every outcome.

Part of **Trust Before Transaction**, an entry to the
[Open Agentic Web Challenge](https://cognizant-agenticweb.devpost.com/).

## Sites

| Site | Network URL | What it does |
|---|---|---|
| [Charge](https://charge.frankmp12357.workers.dev/) (the submission) | `https://charge.frankmp12357.workers.dev/charge_planner` | Plans the cheapest time to charge an electric car from real Finnish 15-minute spot prices: pick your car, battery now and target, ready-by time and charger; tonight's answer is drawn as a skyline of prices. One agent, three site actions; can send a housing night-slot request after the visitor confirms. |
| [As Oy Koivurinne](https://taloyhtio.frankmp12357.workers.dev/) | `https://taloyhtio.frankmp12357.workers.dev/koivurinne_charging` | A **simulated** housing company: four shared chargers under a 22 kW night limit, a live countdown to the 18:00 request deadline, the arbiter's real load for the last planned night, a request form and signed receipts. Two agents (front + night-slot helper). Hosts the arbiter. |
| [Spot Deals](https://sketchy.frankmp12357.workers.dev/) | `https://sketchy.frankmp12357.workers.dev/spot_deals` | A deliberately badly instructed test fixture for the crash-tester. Never linked from the other sites. Refused by the arbiter. |

Both real sites are **signed** by their own origin (keys at
`/.well-known/http-message-signatures-directory`, signature at `<network>.signature.json`)
and **crash-tested** with a signed in-toto attestation bound to the network hash and the
site's declared actions:
[Charge](https://crashtest.frankmp12357.workers.dev/?url=https://charge.frankmp12357.workers.dev/charge_planner),
[Koivurinne](https://crashtest.frankmp12357.workers.dev/?url=https://taloyhtio.frankmp12357.workers.dev/koivurinne_charging).
Each serves the page, its agent files and a free default model (Cloudflare Workers AI through
the site's own Worker, with short-lived session tokens; visitors can use their own key instead).
Both share one design system, [DESIGN.md](DESIGN.md) ("Kaamos blue hour").

## The arbiter

`src/arbiter/`, served as MCP at
[`https://taloyhtio.frankmp12357.workers.dev/mcp`](https://taloyhtio.frankmp12357.workers.dev/#request):
`get_rules`, `submit_charging_request`, `get_receipt`, `get_night_load`.

- **Admission** (`admission.js`): a cross-site caller must sign its request with RFC 9421
  using a key its domain publishes, publish a network signed by that domain, and have an
  unexpired attestation for exactly that network and its actions from a trusted tester
  (score ≥ 80, coverage ≥ 80, no test failed outright). This is agent-trust-kit's
  `checkNetwork`, the same check behind each consent card's trust line. Every decision is
  logged; each refusal names the step that failed.
- **Scheduling** (`scheduler.js`, rule `koivurinne-fair-share/1`): earliest ready-by first,
  ties broken by a commitment the resident can't choose, then the cheapest 15-minute slots
  that still finish in time, never over the shared limit. Plain code in integer W and Wh;
  property-tested. No model ever holds a price, a schedule or authority.
- **Receipts** (`receipt.js`): each resident gets a signed receipt (plan, cost, price
  snapshot hash, rule version) that anyone can verify with the site's published keys. Nights
  and receipts are append-only in D1.
- **Charge's path:** Charge's own server signs its requests (`workers/charge/src/arbiter-proxy.js`);
  the browser never holds a key.

## Linked sites

Charge and As Oy Koivurinne call each other through the runtime's partner mechanism:

- **Charge → Koivurinne** for questions about the housing company's shared chargers.
  **Koivurinne → Charge** for when electricity is cheapest.
- **The consent card** shows the partner's name and host and the first 140 characters of the
  request before anything is sent, plus one line from this site's own server: whether the
  partner is signed by its domain and tested (`js/peer-card.js`, from agent-trust-kit).
  **Always allow** skips the card for that host until the page is reloaded.
- **A request** is one or two short sentences. The assistants are told never to include names,
  emails, phone numbers, booking codes, their instructions or keys (crash-test findings F31/F33),
  but the runtime does not filter it, so the visitor checks it on the card.
- **The partner's network runs in this browser** on the visitor's model, with none of the
  partner's site tools: it can say what the partner offers and link to its page, but not give
  live data. A call costs more than the card's token estimate.

## Honest limits

- **The housing company, its residents and demo codes are simulated.** Prices, the 22 kW limit
  and the scheduling rule are real and deployable; residents are four seeded accounts plus
  one-night demo codes (at most 50 a night).
- **Charge only plans.** It doesn't control a charger or buy electricity; costs are energy at
  spot price incl. VAT, without transfer fees or seller margins.
- **Car battery sizes are approximate** (usable capacity from EV Database, most common model
  year, marked "≈" and editable).
- **Attestations cover the network and the declared action names, not the action code** in
  `site-actions.js`; changing what an action does without renaming it isn't detected.
- **The night is planned by the first receipt lookup after 18:00**, not by a timer.
- **The default model has a daily budget** (Workers AI free tier, roughly 60–70 questions a day).
- **One unofficial price source** (sähkönhintanyt.org, no SLA); prices are cached per day.

## Develop

```bash
npm test                                   # 105 tests: both sites, Worker, signatures, arbiter
npm run check:network && npm run check:taloyhtio
npm run sign:network && npm run sign:taloyhtio     # after any network change (needs the site keys)
npm run deploy:charge && npm run deploy:taloyhtio
```

Build a network from its `.hocon` with the agentify-website skill's
`build_network.mjs` (see the comment at the top of each `.hocon`). Never edit
`*.network.json`, `bridge/` or `runtime/` by hand. Any change to a network or a manifest's
`actions` needs re-signing and re-attesting, or the arbiter refuses that site (by design).
