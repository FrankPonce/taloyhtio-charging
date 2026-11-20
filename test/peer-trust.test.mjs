// Drop-in peer trust check: the site Worker serves /.well-known/peer-trust.json about the
// partners its own network links, and both sites ship the kit's consent-card script as is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { clearPeerTrustCache } from "agent-trust-kit";
import worker from "../workers/charge/src/index.js";
import { peerTrust } from "../workers/charge/src/peer-trust.js";

const SITE = "https://charge.example";
const files = {
  "/agent-manifest.json": { networks: [{ name: "charge_planner", hocon: "./charge_planner.network.json" }] },
  "/charge_planner.network.json": { tools: [{ name: "front", tools: ["https://housing.example/housing", "front_helper"] }] },
};
const env = { ASSETS: { fetch: async (req) => {
  const body = files[new URL(req.url).pathname];
  return body ? new Response(JSON.stringify(body)) : new Response("missing", { status: 404 });
} } };
// The partner publishes nothing: unsigned, no attestation.
const nothing = async () => new Response("not found", { status: 404 });

test("peer-trust.json lists the network's partners with what is known about them", async () => {
  clearPeerTrustCache();
  const resp = await peerTrust(new Request(`${SITE}/.well-known/peer-trust.json`), env, { fetchImpl: nothing });
  assert.equal(resp.status, 200);
  const report = await resp.json();
  assert.equal(report.site, `${SITE}/charge_planner`);
  assert.equal(report.peers.length, 1);
  assert.equal(report.peers[0].host, "housing.example");
  assert.equal(report.peers[0].trusted, false);
});

test("the route is wired into the site Worker, and a broken site gives 503, not a crash", async () => {
  clearPeerTrustCache();
  const broken = { ASSETS: { fetch: async () => new Response("missing", { status: 404 }) } };
  const resp = await worker.fetch(new Request(`${SITE}/.well-known/peer-trust.json`), broken);
  assert.equal(resp.status, 503);
  assert.match((await resp.json()).error, /unavailable/);
});

test("both sites ship the kit's consent-card script unchanged", async () => {
  const require = createRequire(import.meta.url);
  const kit = await readFile(require.resolve("agent-trust-kit/peer-card"), "utf8");
  for (const site of ["charge", "taloyhtio"]) {
    const copy = await readFile(new URL(`../sites/${site}/js/peer-card.js`, import.meta.url), "utf8");
    assert.equal(copy, kit, `sites/${site}/js/peer-card.js differs from agent-trust-kit; copy it again`);
  }
});

test("the practice-night page ships the kit's verify-lite script unchanged", async () => {
  const require = createRequire(import.meta.url);
  const kit = await readFile(require.resolve("agent-trust-kit/verify-lite"), "utf8");
  const copy = await readFile(new URL("../sites/taloyhtio/js/verify-lite.js", import.meta.url), "utf8");
  assert.equal(copy, kit, "sites/taloyhtio/js/verify-lite.js differs from agent-trust-kit; copy it again");
});
