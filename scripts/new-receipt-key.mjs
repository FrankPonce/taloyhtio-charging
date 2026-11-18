// Create the arbiter's receipt-signing key (separate from the network-signing key).
// Writes the private JWK to ../.secrets/taloyhtio/receipt-key.private.jwk.json (never
// committed, never printed) and adds the public part to the housing site's key directory.
// Refuses to overwrite an existing key. Then: npx wrangler secret put RECEIPT_SIGNING_JWK
// (from workers/taloyhtio), pasting the file's contents, or piping the file in.
//
//   node scripts/new-receipt-key.mjs

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { newSiteKey } from "agent-trust-kit";

const SECRET = "../.secrets/taloyhtio/receipt-key.private.jwk.json";
const DIRECTORY = "sites/taloyhtio/.well-known/http-message-signatures-directory";

const exists = await access(SECRET).then(() => true, () => false);
if (exists) {
  console.error(`${SECRET} already exists. Not overwriting it.`);
  process.exit(1);
}
const { privateJwk, publicJwk } = await newSiteKey();
await mkdir("../.secrets/taloyhtio", { recursive: true });
await writeFile(SECRET, `${JSON.stringify(privateJwk)}\n`, { mode: 0o600 });

const dir = JSON.parse(await readFile(DIRECTORY, "utf8"));
if (dir.keys.some((k) => k.kid === publicJwk.kid)) throw new Error("Key already published.");
dir.keys.push(publicJwk);
await writeFile(DIRECTORY, `${JSON.stringify(dir, null, 2)}\n`);
console.log(`Receipt key ${publicJwk.kid} created. Public part added to ${DIRECTORY}; private part in ${SECRET}.`);
