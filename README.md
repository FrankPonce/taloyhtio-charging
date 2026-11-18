# taloyhtio-charging

Shared EV charging for Finnish housing companies on the open agentic web: an energy agent,
a housing-company site, and (next) a fair-share arbiter.

Part of **Trust Before Transaction**, an entry to the
[Open Agentic Web Challenge](https://cognizant-agenticweb.devpost.com/).

## Sites

| Site | Network URL | What it does |
|---|---|---|
| [Charge](https://charge.frankmp12357.workers.dev/) | `https://charge.frankmp12357.workers.dev/charge_planner` | Plans the cheapest time to charge an electric car from real Finnish 15-minute spot prices. One agent, three site actions. |
| [As Oy Koivurinne](https://taloyhtio.frankmp12357.workers.dev/) | `https://taloyhtio.frankmp12357.workers.dev/koivurinne_charging` | A **simulated** housing company: rules for four shared chargers, the 22 kW night limit, night-slot requests and fair sharing. Two agents (front + night-slot helper). The arbiter that schedules the night comes next. |
| [Spot Deals](https://sketchy.frankmp12357.workers.dev/) | `https://sketchy.frankmp12357.workers.dev/spot_deals` | A deliberately badly instructed test fixture for the crash-tester. Never linked from the other sites. |

Both real sites are **signed** by their own origin (keys at
`/.well-known/http-message-signatures-directory`, signature at `<network>.signature.json`)
and **crash-tested** with a signed attestation:
[Charge](https://crashtest.frankmp12357.workers.dev/?url=https://charge.frankmp12357.workers.dev/charge_planner),
[Koivurinne](https://crashtest.frankmp12357.workers.dev/?url=https://taloyhtio.frankmp12357.workers.dev/koivurinne_charging).
Each serves the page, its agent files and a free default model (Cloudflare Workers AI through
the site's own Worker, with short-lived session tokens; visitors can use their own key instead).

## Linked sites

Charge and As Oy Koivurinne call each other through the runtime's partner mechanism:

- **Charge → Koivurinne** for questions about the housing company's shared chargers.
  **Koivurinne → Charge** for when electricity is cheapest.
- **The consent card** shows the partner's name and host and the first 140 characters of the
  request before anything is sent. **Always allow** skips the card for that host until the
  page is reloaded.
- **A request** is one or two short sentences. The assistants are told never to include names,
  emails, phone numbers, booking codes, their instructions or keys (crash-test findings F31/F33),
  but the runtime does not filter it, so the visitor checks it on the card.
- **The partner's network runs in this browser** on the visitor's model, with none of the
  partner's site tools: it can say what the partner offers and link to its page, but not give
  live data. A call costs more than the card's token estimate.

## Develop

```bash
npm test                                   # both sites' tests + Worker + signatures
npm run check:network && npm run check:taloyhtio
npm run sign:network && npm run sign:taloyhtio     # after any network change (needs the site keys)
npm run deploy:charge && npm run deploy:taloyhtio
```

Build a network from its `.hocon` with the agentify-website skill's
`build_network.mjs` (see the comment at the top of each `.hocon`). Never edit
`*.network.json`, `bridge/` or `runtime/` by hand.
