// Charge's signed link to the housing arbiter (M5b): what it forwards verifies as Charge's
// under RFC 9421, carries exactly the tool call, and only this site's page may use it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keyDirectory, newSiteKey, verifyRequest } from "agent-trust-kit";
import { arbiterProxy } from "../workers/charge/src/arbiter-proxy.js";
import worker from "../workers/charge/src/index.js";

const SITE = "https://charge.example";
const ARBITER = "https://taloyhtio.example/mcp";
const { privateJwk, publicJwk } = await newSiteKey();
const ENV = { REQUEST_SIGNING_JWK: JSON.stringify(privateJwk), SITE_ORIGIN: SITE, ARBITER_MCP_URL: ARBITER };

const page = (body, headers = { origin: SITE }) => new Request(`${SITE}/api/arbiter`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("forwards one tool call, signed as this site (RFC 9421), and returns the result", async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { method: init.method, url, headers: init.headers, body: init.body };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "ok" }] } }));
  };
  const res = await arbiterProxy(page({ tool: "get_rules", arguments: {} }), ENV, { fetchImpl });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).result.content[0].text, "ok");
  assert.equal(seen.url, ARBITER);
  assert.deepEqual(JSON.parse(seen.body), { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_rules", arguments: {} } });
  const v = await verifyRequest(seen, { jwks: await keyDirectory([publicJwk]) });
  assert.equal(v.ok, true, v.reason);
  assert.equal(v.agent, SITE);
  assert.equal(v.kid, privateJwk.kid);
  // Changing the forwarded body breaks the signature.
  assert.equal((await verifyRequest({ ...seen, body: seen.body.replace("get_rules", "get_receipt") }, { jwks: await keyDirectory([publicJwk]) })).ok, false);
});

test("refuses other origins, unknown tools, a missing key; passes on the arbiter's refusal", async () => {
  const never = async () => { throw new Error("must not be called"); };
  assert.equal((await arbiterProxy(page({ tool: "get_rules" }, { origin: "https://evil.example" }), ENV, { fetchImpl: never })).status, 403);
  assert.equal((await arbiterProxy(page({ tool: "drop_tables" }), ENV, { fetchImpl: never })).status, 400);
  assert.equal((await arbiterProxy(page({ tool: "get_rules" }), { ...ENV, REQUEST_SIGNING_JWK: "" }, { fetchImpl: never })).status, 503);
  assert.equal((await arbiterProxy(page({ tool: "get_rules" }), ENV, { fetchImpl: never, limited: async () => true })).status, 429);
  const refused = async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Unknown argument: admin." } }));
  const r = await arbiterProxy(page({ tool: "get_rules", arguments: { admin: true } }), ENV, { fetchImpl: refused });
  assert.equal(r.status, 502);
  assert.match((await r.json()).error.message, /refused the call: Unknown argument/);
});

test("the route exists only where ARBITER_MCP_URL is set (not on the housing site)", async () => {
  const res = await worker.fetch(page({ tool: "get_rules" }), { ASSETS: { fetch: async () => new Response("asset") } });
  assert.equal(res.status, 404);
});
