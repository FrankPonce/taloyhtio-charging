# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: electric-car owners in Finland** (confirmed by Frank, 19 Nov 2026) who want to know
  when to charge tonight so the car is ready by a given time at the lowest spot-price cost. They
  arrive on a phone or laptop, usually in the evening, without an account or an AI key, and either
  fill in the form or ask the assistant in plain words.
- **Residents of a housing company with shared chargers** (As Oy Koivurinne, simulated): they read
  the charging rules and send one night-slot request before 18:00, then check a signed receipt.
- **Hackathon judges** (Open Agentic Web Challenge, judging 11–18 Jan 2027): one visit, no key; they
  see the trust layer through a working tool, not instead of one.
- **Other sites' agents** that call these networks through the runtime's partner mechanism.

## Product Purpose

taloyhtio-charging holds the transaction layer of *Trust Before Transaction*:

- **Charge** (`sites/charge`, the challenge submission): plans the cheapest 15-minute periods to
  charge before a ready-by time, from real Finnish day-ahead prices. Works fully without the
  assistant; the assistant reads the same page data and can send a housing night-slot request
  after the visitor confirms.
- **As Oy Koivurinne** (`sites/taloyhtio`): a simulated housing company with four shared chargers
  under a 22 kW night limit; explains the rules, shows the night's load, and hosts the **arbiter**
  (MCP at `/mcp`) that schedules every car fairly and signs receipts.
- **Spot Deals** (`sites/sketchy`): a deliberately bad fixture for the crash-tester; never linked
  from the other sites.

Success: a stranger gets a correct, grounded charging plan in under a minute, and a resident's
request is planned by plain code under published rules, with a receipt anyone can verify.

## Positioning

No model ever holds a price, a schedule or authority: plain functions plan, the arbiter admits only
callers whose network is domain-signed and attested by a tester for that exact network and set of
actions, and every outcome is a signed receipt. Built only from existing standards (JWS/Ed25519,
JCS, RFC 9421, Web Bot Auth keys, MCP, in-toto + DSSE).

## Operating Context

- Live on Cloudflare Workers (`charge.frankmp12357.workers.dev`, `taloyhtio.frankmp12357.workers.dev`,
  `sketchy.frankmp12357.workers.dev`), D1 database `taloyhtio-arbiter`.
- Prices from sähkönhintanyt.org (credit required on every page that shows prices), c/kWh incl.
  25.5% VAT; tomorrow's prices appear around 14:00 Finnish time.
- Free default model: Cloudflare Workers AI through the site's own Worker (session tokens, rate
  limits); visitors may bring their own key.
- The agent runtime and bridge are vendored and never edited by hand; the network instruction
  budget is 5,000 characters and nearly full on both sites.
- Any change to a network or a manifest's `actions` needs re-signing and re-attesting, or the
  arbiter refuses that site.

## Capabilities and Constraints

- Charge only plans: it does not control a charger or buy electricity. Costs shown are energy at
  spot price incl. VAT; transfer fees and seller margins are excluded and said so.
- Irreversible actions (sending a night-slot request) always need the visitor's confirmation.
- Resident codes stay in the page and go only to the housing company through the site's server;
  the assistant never sees them.
- The housing company, its residents and demo codes are **simulated** and must be labelled so.
- Static HTML/CSS/JS per site, no framework; English UI.

## Evidence on Hand

Real spot prices; live signed networks and attestations (Charge 100, Koivurinne 97 at test v20);
live arbiter receipts verified after 18:00 on 18 Nov; crash-test FINDINGS (F31, F33, F39, F45).
No real residents, housing companies, users, testimonials or savings statistics exist; do not
invent them.

## Product Principles

1. The tool works without the AI; the assistant is a faster way to the same grounded answer.
2. Numbers come from code and real data, never from a model.
3. Say what is simulated, what is excluded, and what is not verified, in plain words.
4. Nothing irreversible happens without the visitor seeing and confirming it.
5. Trust is shown as checkable evidence (signature, attestation, receipt), not as a claim.

## Accessibility & Inclusion

Usable at mobile widths and by keyboard; status never by colour alone; the price chart has a text
summary next to it.
