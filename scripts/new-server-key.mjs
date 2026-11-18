// Create an online server key for a site (separate from its offline network-signing key):
// e.g. the housing arbiter's receipt key, or Charge's request-signing key.
// Writes the private JWK to ../.secrets/<site>/<name>.private.jwk.json (never committed,
// never printed) and adds the public part to the site's key directory. Refuses to
// overwrite. Then set it as a Worker secret from workers/<site>:
//   npx wrangler secret put <SECRET_NAME> < ../../../.secrets/<site>/<name>.private.jwk.json
//
//   node scripts/new-server-key.mjs taloyhtio receipt-key      (secret RECEIPT_SIGNING_JWK)
//   node scripts/new-server-key.mjs charge request-key         (secret REQUEST_SIGNING_JWK)

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { newSiteKey } from "agent-trust-kit";

const [site, name] = process.argv.slice(2);
if (!/^[a-z]+$/.test(site ?? "") || !/^[a-z-]+$/.test(name ?? "")) {
  console.error("Usage: node scripts/new-server-key.mjs <site> <key-name>");
  process.exit(1);
}
const secret = `../.secrets/${site}/${name}.private.jwk.json`;
const directory = `sites/${site}/.well-known/http-message-signatures-directory`;

if (await access(secret).then(() => true, () => false)) {
  console.error(`${secret} already exists. Not overwriting it.`);
  process.exit(1);
}
const dir = JSON.parse(await readFile(directory, "utf8"));
const { privateJwk, publicJwk } = await newSiteKey();
await mkdir(`../.secrets/${site}`, { recursive: true });
await writeFile(secret, `${JSON.stringify(privateJwk)}\n`, { mode: 0o600 });
dir.keys.push(publicJwk);
await writeFile(directory, `${JSON.stringify(dir, null, 2)}\n`);
console.log(`Key ${publicJwk.kid} created. Public part added to ${directory}; private part in ${secret}.`);
