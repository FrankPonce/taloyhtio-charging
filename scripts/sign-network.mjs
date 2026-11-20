// Sign a site's network with that site's key. Run after every network change:
//   npm run sign:network               Charge     (sites/charge, charge_planner)
//   npm run sign:taloyhtio             Koivurinne (sites/taloyhtio, koivurinne_charging)
//   npm run sign:sketchy               Spot Deals (sites/sketchy, spot_deals; the bad fixture)
// Key: TRUST_KIT_KEY, or ../.secrets/<site>/site-key.private.jwk.json (never committed).
import { readFile, writeFile } from "node:fs/promises";
import { signNetwork } from "agent-trust-kit";

export const SITES = {
  charge: { network: "charge_planner", origin: "https://charge.frankmp12357.workers.dev" },
  taloyhtio: { network: "koivurinne_charging", origin: "https://taloyhtio.frankmp12357.workers.dev" },
  // The bad fixture is signed too, on purpose: a signature proves who published it, not that
  // it behaves. The arbiter then refuses it on its attestation (a failed test), not its keys.
  sketchy: { network: "spot_deals", origin: "https://sketchy.frankmp12357.workers.dev" },
};

const site = process.argv[2] || "charge";
const cfg = SITES[site];
if (!cfg) throw new Error(`Unknown site ${site}. Use one of: ${Object.keys(SITES).join(", ")}`);
const origin = process.env.SITE_ORIGIN || cfg.origin;
const keyPath = process.env.TRUST_KIT_KEY || `../.secrets/${site}/site-key.private.jwk.json`;
const file = `sites/${site}/${cfg.network}.network.json`;
const network = JSON.parse(await readFile(file, "utf8"));
const privateJwk = JSON.parse(await readFile(keyPath, "utf8"));
const doc = await signNetwork({ network, name: cfg.network, origin, privateJwk });
await writeFile(`sites/${site}/${cfg.network}.signature.json`, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`signed ${cfg.network} for ${origin}`);
