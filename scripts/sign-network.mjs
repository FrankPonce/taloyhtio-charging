// Sign sites/charge's network with the site key. Run after every network change:
//   npm run sign:network            (key from TRUST_KIT_KEY, or ../.secrets/charge/...)
import { readFile, writeFile } from "node:fs/promises";
import { signNetwork } from "agent-trust-kit";

const ORIGIN = process.env.CHARGE_ORIGIN || "https://charge.frankmp12357.workers.dev";
const keyPath = process.env.TRUST_KIT_KEY || "../.secrets/charge/site-key.private.jwk.json";
const file = "sites/charge/charge_planner.network.json";
const network = JSON.parse(await readFile(file, "utf8"));
const privateJwk = JSON.parse(await readFile(keyPath, "utf8"));
const doc = await signNetwork({ network, name: "charge_planner", origin: ORIGIN, privateJwk });
await writeFile("sites/charge/charge_planner.signature.json", `${JSON.stringify(doc, null, 2)}\n`);
console.log(`signed charge_planner for ${ORIGIN}`);
