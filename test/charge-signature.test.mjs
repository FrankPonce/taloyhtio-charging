// The published network must match its published signature. If this fails, the network
// changed without being re-signed: run `npm run sign:network` (needs the site key).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { verifyNetwork } from "agent-trust-kit";

const read = async (p) => JSON.parse(await readFile(new URL(`../sites/charge/${p}`, import.meta.url), "utf8"));
const ORIGIN = "https://charge.frankmp12357.workers.dev";

test("charge_planner's signature matches the network and the published key directory", async () => {
  const r = await verifyNetwork({
    doc: await read("charge_planner.signature.json"),
    network: await read("charge_planner.network.json"),
    name: "charge_planner",
    networkOrigin: ORIGIN,
    jwks: await read(".well-known/http-message-signatures-directory"),
  });
  assert.equal(r.ok, true, `${r.reason}. Run npm run sign:network after changing the network.`);
});

test("the published key directory holds no private key material", async () => {
  const dir = await read(".well-known/http-message-signatures-directory");
  assert.ok(dir.keys.length >= 1);
  for (const k of dir.keys) assert.equal(k.d, undefined);
});
