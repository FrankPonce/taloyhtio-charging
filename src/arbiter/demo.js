// POST /api/demo-resident on the housing site: a self-serve SIMULATED resident code, so
// anyone (judges included) can try the arbiter without a code from the board. Same origin
// only, limited per IP and capped per night (service.js issueDemoResident).

import { ArbiterError, issueDemoResident } from "./service.js";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

/**
 * :param request: The page's POST.
 * :param env: Bindings (ARBITER_DB, DEMO_LIMIT).
 * :param opts: {now}.
 * :return: 200 {code, resident, night, expires_at, requests_close_at} or an error.
 */
export async function handleDemoResident(request, env, { now = Date.now() } = {}) {
  if (request.method !== "POST") return json(405, { error: "Use POST." });
  if (request.headers.get("origin") !== new URL(request.url).origin) return json(403, { error: "Demo codes are given out on the housing company's own page." });
  if (!env.ARBITER_DB) return json(503, { error: "The scheduler is not configured." });
  if (env.DEMO_LIMIT?.limit) {
    const { success } = await env.DEMO_LIMIT.limit({ key: `ip:${request.headers.get("cf-connecting-ip") || "local"}` });
    if (!success) return json(429, { error: "Too many demo codes from this address. Wait a minute." });
  }
  try {
    return json(200, await issueDemoResident(env.ARBITER_DB, { now }));
  } catch (error) {
    if (error instanceof ArbiterError) return json(409, { error: error.message, code: error.code });
    throw error;
  }
}
