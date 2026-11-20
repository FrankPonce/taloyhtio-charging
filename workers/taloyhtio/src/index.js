// As Oy Koivurinne (simulated housing company) Worker: the shared site Worker (static site,
// session tokens, default-model proxy; ../../charge/src) plus the arbiter's MCP server.
//
//   POST /api/demo-resident  a self-serve simulated resident code (src/arbiter/demo.js)
//   POST /api/practice-night plan a practice night now: your car + 3 simulated neighbours,
//                            real prices, a signed practice receipt (src/arbiter/practice.js)
//   POST /mcp     arbiter MCP (src/arbiter/mcp.js): rules, sealed requests, signed receipts.
//                 Writes and receipts need the site's own page or an admitted caller
//                 (src/arbiter/admission.js: RFC 9421 signature, signed network, attestation).
//   everything else → the shared site Worker
//
// Bindings: ARBITER_DB (D1). Var ARBITER_ORIGIN: this site's origin, the receipts' issuer
// for the 18:05 timer (scheduled), which has no request to read it from. Secret
// RECEIPT_SIGNING_JWK: the receipt key's private JWK (its public part is in the site's key
// directory). Without it, requests are still accepted but no night is scheduled, and the
// tool says the receipt key is not configured.

import site from "../../charge/src/index.js";
import { handleArbiterMcp } from "../../../src/arbiter/mcp.js";
import { authorizer } from "../../../src/arbiter/admission.js";
import { handleDemoResident } from "../../../src/arbiter/demo.js";
import { handlePracticeNight } from "../../../src/arbiter/practice.js";
import { planClosedNight } from "../../../src/arbiter/service.js";

function receiptKey(env) {
  try {
    return env.RECEIPT_SIGNING_JWK ? JSON.parse(env.RECEIPT_SIGNING_JWK) : null;
  } catch {
    console.error("RECEIPT_SIGNING_JWK is not valid JSON");
    return null;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") {
      try {
        if (env.MCP_LIMIT?.limit) {
          const { success } = await env.MCP_LIMIT.limit({ key: `ip:${request.headers.get("cf-connecting-ip") || "local"}` });
          if (!success) return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Too many requests. Wait a minute." } }), { status: 429, headers: { "content-type": "application/json" } });
        }
        return await handleArbiterMcp(request, env, {
          privateJwk: receiptKey(env),
          issuer: url.origin,
          // Sending requests and reading receipts: own page, or an admitted, attested caller (M5b).
          authorize: authorizer(request, { db: env.ARBITER_DB }),
        });
      } catch (error) {
        console.error("arbiter error", error?.stack || error);
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error." } }), { status: 500, headers: { "content-type": "application/json" } });
      }
    }
    if (url.pathname === "/api/practice-night") {
      try {
        return await handlePracticeNight(request, env, { privateJwk: receiptKey(env), issuer: url.origin });
      } catch (error) {
        console.error("practice night error", error?.stack || error);
        return new Response(JSON.stringify({ error: "Internal error." }), { status: 500, headers: { "content-type": "application/json" } });
      }
    }
    if (url.pathname === "/api/demo-resident") {
      try {
        return await handleDemoResident(request, env);
      } catch (error) {
        console.error("demo resident error", error?.stack || error);
        return new Response(JSON.stringify({ error: "Internal error." }), { status: 500, headers: { "content-type": "application/json" } });
      }
    }
    return site.fetch(request, env, ctx);
  },

  // A few minutes after 18:00 Finnish time: plan tonight and sign every receipt. Cron runs in
  // UTC, so two triggers cover winter (16:05 UTC) and summer (15:05 UTC) time; the one that
  // fires before the deadline does nothing.
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(planClosedNight(env.ARBITER_DB, {
      now: controller.scheduledTime,
      privateJwk: receiptKey(env),
      issuer: env.ARBITER_ORIGIN,
    }).then((r) => console.log("planned night", JSON.stringify(r)))
      .catch((error) => console.error("night planning failed", error?.stack || error)));
  },
};
