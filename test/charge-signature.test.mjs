// Each published network must match its published signature. If this fails, the network
// changed without being re-signed: run `npm run sign:network` or `npm run sign:taloyhtio`
// (needs the site key).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { verifyNetwork } from "agent-trust-kit";

const SITES = [
  { dir: "charge", network: "charge_planner", origin: "https://charge.frankmp12357.workers.dev", sign: "sign:network" },
  { dir: "taloyhtio", network: "koivurinne_charging", origin: "https://taloyhtio.frankmp12357.workers.dev", sign: "sign:taloyhtio" },
];

for (const site of SITES) {
  const read = async (p) => JSON.parse(await readFile(new URL(`../sites/${site.dir}/${p}`, import.meta.url), "utf8"));

  test(`${site.network}'s signature matches the network and the published key directory`, async () => {
    const r = await verifyNetwork({
      doc: await read(`${site.network}.signature.json`),
      network: await read(`${site.network}.network.json`),
      name: site.network,
      networkOrigin: site.origin,
      jwks: await read(".well-known/http-message-signatures-directory"),
    });
    assert.equal(r.ok, true, `${r.reason}. Run npm run ${site.sign} after changing the network.`);
  });

  test(`${site.dir}: the published key directory holds no private key material`, async () => {
    const dir = await read(".well-known/http-message-signatures-directory");
    assert.ok(dir.keys.length >= 1);
    for (const k of dir.keys) assert.equal(k.d, undefined);
  });
}

test("the two sites use different keys", async () => {
  const kids = await Promise.all(SITES.map(async (s) => JSON.parse(await readFile(new URL(`../sites/${s.dir}/.well-known/http-message-signatures-directory`, import.meta.url), "utf8")).keys.map((k) => k.kid)));
  assert.equal(kids[0].some((k) => kids[1].includes(k)), false);
});
