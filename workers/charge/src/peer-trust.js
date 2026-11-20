// GET /.well-known/peer-trust.json: what this site's server knows about each partner its
// agent network can contact (signed by its domain? attested by a trusted tester?), from
// agent-trust-kit peerTrustReport(). Served from this site's own origin, so the consent
// card can show it before the visitor agrees, without the browser contacting the partner.
// Checked at most every 5 minutes per isolate.

import { peerTrustResponse } from "agent-trust-kit/peer";

async function asset(env, origin, path) {
  const resp = await env.ASSETS.fetch(new Request(new URL(path, `${origin}/`)));
  if (!resp.ok) throw new Error(`${path} answered ${resp.status}`);
  return resp.json();
}

/**
 * :param request: The GET request.
 * :param env: Worker env with ASSETS (this site's own files).
 * :param opts: {fetchImpl, now, policy} for tests.
 */
export async function peerTrust(request, env, opts = {}) {
  const origin = new URL(request.url).origin;
  try {
    const manifest = await asset(env, origin, "agent-manifest.json");
    const entry = manifest?.networks?.[0];
    if (!entry?.name || !entry?.hocon) throw new Error("no network in agent-manifest.json");
    const network = await asset(env, origin, entry.hocon);
    // Trust is network × model: a partner runs here on this site's default model, so only an
    // attestation for that model counts (PEER_TRUST_MODELS, the tester's name for it).
    const models = String(env.PEER_TRUST_MODELS || "").split(",").map((m) => m.trim()).filter(Boolean);
    return await peerTrustResponse(new URL(encodeURIComponent(entry.name), `${origin}/`).href, { network, ...(models.length ? { models } : {}), ...opts });
  } catch (error) {
    console.error("peer trust error", error?.stack || error);
    return new Response(JSON.stringify({ error: "The partner check is unavailable right now." }), {
      status: 503, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
