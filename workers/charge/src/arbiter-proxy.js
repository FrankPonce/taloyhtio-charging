// Charge's server-side link to the housing company's arbiter (M5b).
//
//   POST /api/arbiter   {tool, arguments}  ->  the arbiter's JSON-RPC result
//
// The visitor's browser never holds a key. This Worker signs each call with HTTP Message
// Signatures (RFC 9421; agent-trust-kit signRequest) as this site's origin, so the arbiter
// can check who is calling, that this site's agent network is signed, and that a tester
// vouches for it. Only this site's own page may use it, only for the arbiter's tools.
//
// Config: ARBITER_MCP_URL (var; the route exists only where it is set), SITE_ORIGIN (var;
// the origin whose key directory holds the key), REQUEST_SIGNING_JWK (secret; private JWK).

import { signRequest } from "agent-trust-kit/http";

export const ARBITER_TOOLS = ["get_rules", "submit_charging_request", "get_receipt", "get_night_load"];
const MAX_BODY = 8 * 1024;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const fail = (status, message) => json(status, { error: { message, type: "arbiter_proxy_error" } });

/**
 * Forward one arbiter tool call, signed as this site.
 *
 * :param request: The page's request (same origin).
 * :param env: Worker bindings and vars.
 * :param opts: {fetchImpl, limited(key) -> Promise<boolean>}.
 * :return: The HTTP response: {result} or {error}.
 */
export async function arbiterProxy(request, env, { fetchImpl = globalThis.fetch, limited = async () => false } = {}) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail(403, "Only this site's own page can reach the housing company's arbiter through it.");
  if (await limited(`ip:${request.headers.get("cf-connecting-ip") || "local"}`)) return fail(429, "Too many requests to the housing company. Wait a minute.");
  let key;
  try {
    key = JSON.parse(env.REQUEST_SIGNING_JWK || "");
  } catch {
    key = null;
  }
  if (!key?.kid || !env.SITE_ORIGIN) return fail(503, "This site is not set up to send signed requests to the housing company yet.");

  const text = await request.text();
  if (text.length > MAX_BODY) return fail(413, "The request is too large.");
  let call;
  try {
    call = JSON.parse(text);
  } catch {
    return fail(400, "The request is not valid JSON.");
  }
  if (!ARBITER_TOOLS.includes(call?.tool)) return fail(400, `Unknown arbiter tool. Use one of: ${ARBITER_TOOLS.join(", ")}.`);
  const args = call.arguments ?? {};
  if (typeof args !== "object" || Array.isArray(args)) return fail(400, "arguments must be an object.");

  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: call.tool, arguments: args } });
  const signed = await signRequest(
    { method: "POST", url: env.ARBITER_MCP_URL, headers: { "content-type": "application/json", accept: "application/json" }, body },
    { privateJwk: key, signatureAgent: env.SITE_ORIGIN },
  );
  let resp;
  try {
    resp = await fetchImpl(env.ARBITER_MCP_URL, { method: "POST", headers: signed.headers, body: signed.body, redirect: "manual" });
  } catch (error) {
    console.error("arbiter unreachable", error?.message);
    return fail(502, "The housing company's arbiter could not be reached. Try again later.");
  }
  let out;
  try {
    out = await resp.json();
  } catch {
    return fail(502, `The housing company's arbiter answered ${resp.status} without JSON.`);
  }
  if (out?.error) return fail(502, `The housing company's arbiter refused the call: ${out.error.message}`);
  return json(200, { result: out?.result ?? null });
}
