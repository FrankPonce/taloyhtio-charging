// The arbiter's MCP server: Streamable HTTP at POST /mcp on the housing site, stateless,
// JSON responses only (same transport as crash-test's MCP server). Four tools:
//   get_rules                 the published rules (read-only)
//   submit_charging_request   one sealed request per resident per night (writes, final)
//   get_receipt               the resident's own signed receipt, once the night is scheduled
//   get_night_load            total kW per slot for a scheduled night, no resident data
// No language model in here: the arbiter only computes and signs.
//
// No CORS headers: only the housing site's own page (same origin) and servers may call it.
// Cross-site calls come from the caller's server with an RFC 9421 signature (M5b).
//
// Spec: https://modelcontextprotocol.io/specification (lifecycle, transports, tools).

import { ArbiterError, getReceipt, nightLoad, publicRules, submitRequest } from "./service.js";

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
export const SERVER_INFO = { name: "koivurinne-arbiter", title: "As Oy Koivurinne night-charging arbiter (simulated housing company)", version: "0.1.0" };
const INSTRUCTIONS = "Fair-share scheduler for the shared EV chargers of As Oy Koivurinne, a SIMULATED Finnish housing company. "
  + "Residents send one sealed request per night before 18:00 Helsinki time (energy in kWh, ready-by time HH:MM, resident code). "
  + "After 18:00 the arbiter plans the whole night with a fixed published rule and real 15-minute spot prices, and signs a receipt per request. "
  + "Submitting is final: confirm the exact values with the resident first. Never guess a resident code, energy or time.";

const RPC = { PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL: -32603 };
const str = (description) => ({ type: "string", description });
const num = (description) => ({ type: "number", description });

export const TOOLS = [
  {
    name: "get_rules",
    title: "Night-charging rules",
    description: "The housing company's published rules: night window, shared kW limit, request deadline, fee, how the fair-share plan works, and which night is open for requests now.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "submit_charging_request",
    title: "Send a night-slot request",
    description: "Send the resident's one sealed request for a night. Final: it cannot be changed or withdrawn, and only one request per resident per night is accepted. Returns a request ID and a commitment hash (proof of exactly what was asked).",
    inputSchema: {
      type: "object",
      properties: {
        resident_code: str("The resident's code from the board. Ask the resident; never guess."),
        energy_kwh: num("Energy needed, in kWh (1-120)."),
        ready_by: str('When the car must be ready, Helsinki time, HH:MM between 22:15 and 07:00, e.g. "07:00".'),
        charger_kw: num("Optional: the car's charging power in kW, at most 11 (default 11)."),
        max_price_cents: num("Optional: the resident's maximum price in c/kWh incl. VAT. The car never charges in a slot that costs more. Only the resident sets it; never choose one for them."),
        night: str("Optional: the evening the night starts, YYYY-MM-DD. Default: the night open for requests now."),
      },
      required: ["resident_code", "energy_kwh", "ready_by"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "get_receipt",
    title: "Get a signed receipt",
    description: "The resident's own plan and cost for a request, as a receipt signed by the housing company. Before 18:00 the night is not planned yet and the answer says when it will be.",
    inputSchema: {
      type: "object",
      properties: { request_id: str("The request ID returned when the request was sent."), resident_code: str("The same resident code.") },
      required: ["request_id", "resident_code"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_night_load",
    title: "Total load for a night",
    description: "Total charging power per 15-minute slot for a scheduled night, against the shared limit. Contains no resident data.",
    inputSchema: { type: "object", properties: { night: str("The evening the night starts, YYYY-MM-DD.") }, required: ["night"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

// ---- transport ----------------------------------------------------------------------------

const json = (status, body, headers = {}) => new Response(body === null ? null : JSON.stringify(body), {
  status,
  headers: { ...(body === null ? {} : { "content-type": "application/json" }), "cache-control": "no-store", ...headers },
});
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Handle a request to /mcp.
 *
 * :param request: The HTTP request.
 * :param env: Worker bindings (ARBITER_DB).
 * :param ctx: {now, fetchImpl, privateJwk: the receipt key, issuer: this site's origin}.
 * :return: The HTTP response.
 */
export async function handleArbiterMcp(request, env, ctx) {
  if (request.method !== "POST") return json(405, rpcError(null, RPC.INVALID_REQUEST, "Use POST. This server has no SSE stream and no sessions."), { allow: "POST" });
  const text = await request.text();
  if (text.length > 16 * 1024) return json(413, rpcError(null, RPC.INVALID_REQUEST, "Request too large."));
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return json(400, rpcError(null, RPC.PARSE, "Parse error: the body must be JSON-RPC 2.0."));
  }
  if (Array.isArray(msg)) return json(400, rpcError(null, RPC.INVALID_REQUEST, "Batches are not supported."));
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    if (msg && msg.jsonrpc === "2.0" && ("result" in msg || "error" in msg)) return json(202, null);
    return json(400, rpcError(msg?.id, RPC.INVALID_REQUEST, "Invalid JSON-RPC 2.0 request."));
  }
  if (!("id" in msg)) return json(202, null); // notifications
  // The admission check needs the exact body (its digest is signed); run it at most once.
  if (typeof ctx.authorize === "function") {
    const check = ctx.authorize;
    let decision = null;
    ctx = { ...ctx, authorize: () => (decision ??= check(text)) };
  }
  try {
    return json(200, { jsonrpc: "2.0", id: msg.id, result: await dispatch(msg, env, ctx) });
  } catch (error) {
    if (error instanceof RpcError) return json(200, rpcError(msg.id, error.code, error.message));
    console.error("arbiter mcp error", error?.stack || error);
    return json(200, rpcError(msg.id, RPC.INTERNAL, "Internal error."));
  }
}

function checkArgs(tool, args) {
  if (typeof args !== "object" || args === null || Array.isArray(args)) throw new RpcError(RPC.INVALID_PARAMS, "arguments must be an object.");
  const props = tool.inputSchema.properties;
  for (const key of Object.keys(args)) {
    if (!props[key]) throw new RpcError(RPC.INVALID_PARAMS, `Unknown argument: ${key}.`);
  }
  for (const key of tool.inputSchema.required ?? []) {
    if (args[key] === undefined || args[key] === null || args[key] === "") throw new RpcError(RPC.INVALID_PARAMS, `${key} is required.`);
  }
  for (const [key, value] of Object.entries(args)) {
    const type = props[key].type;
    if (type === "number" && !(typeof value === "number" && Number.isFinite(value))) throw new RpcError(RPC.INVALID_PARAMS, `${key} must be a number.`);
    if (type === "string" && typeof value !== "string") throw new RpcError(RPC.INVALID_PARAMS, `${key} must be a string.`);
  }
}

async function dispatch(msg, env, ctx) {
  const params = msg.params ?? {};
  switch (msg.method) {
    case "initialize": {
      const asked = params.protocolVersion;
      return {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) throw new RpcError(RPC.INVALID_PARAMS, `Unknown tool: ${params.name}`);
      const args = params.arguments ?? {};
      checkArgs(tool, args);
      try {
        return await HANDLERS[tool.name](args, env, ctx);
      } catch (error) {
        if (error instanceof ArbiterError) return toolResult(error.message, { error: error.message, code: error.code }, true);
        throw error;
      }
    }
    default:
      throw new RpcError(RPC.METHOD_NOT_FOUND, `Method not found: ${msg.method}`);
  }
}

function toolResult(text, data, isError = false) {
  return { content: [{ type: "text", text }], structuredContent: data, ...(isError ? { isError: true } : {}) };
}

function db(env) {
  if (!env.ARBITER_DB) throw new ArbiterError("The arbiter's database is not configured on this server.", "not_configured");
  return env.ARBITER_DB;
}

/**
 * Sending a request or reading a receipt needs an admitted caller: the housing site's own
 * page, or another site's server that passed the admission check (admission.js). The
 * host decides via ctx.authorize(). Without one, protected tools refuse: forgetting to wire
 * the check must never open the arbiter (tests pass an explicit allow-all).
 */
async function admitted(ctx) {
  if (typeof ctx.authorize !== "function") throw new ArbiterError("This server has no admission check configured, so it accepts no requests.", "not_configured");
  const d = await ctx.authorize();
  if (!d.ok) throw new ArbiterError(`Not admitted (${d.step}): ${d.reason}`, "not_admitted");
  return d;
}

const eur = (x) => `€${x.toFixed(2)}`;
const hhmm = (iso) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/Helsinki", hour: "2-digit", minute: "2-digit" });

const HANDLERS = {
  async get_rules(_args, _env, ctx) {
    const r = publicRules(ctx.now ?? Date.now());
    const text = `${r.company} (simulated). Night ${r.night_window}: the ${r.charger_kw} kW chargers share ${r.shared_limit_kw} kW. `
      + `One request per resident per night, before ${r.requests_close_daily_at}; the night open now is ${r.open_night}. `
      + `Fair share: ${r.fair_share.join(" ")} ${r.billing} Fee ${r.fee_cents_per_kwh} c/kWh.`;
    return toolResult(text, r);
  },

  async submit_charging_request(args, env, ctx) {
    const caller = await admitted(ctx);
    const r = await submitRequest(db(env), {
      residentCode: args.resident_code, energyKwh: args.energy_kwh, readyBy: args.ready_by, chargerKw: args.charger_kw, night: args.night,
      maxPriceCents: args.max_price_cents,
    }, { now: ctx.now ?? Date.now(), callerNetworkSha256: caller.network_sha256 ?? null });
    const cap = args.max_price_cents === undefined || args.max_price_cents === null ? "" : `, never above ${args.max_price_cents} c/kWh`;
    const text = `${r.status === "already_received" ? "Already received earlier (this is the same request, nothing new was sent). " : ""}Request received for the night of ${r.night}: ${args.energy_kwh} kWh by ${args.ready_by}${cap}. Request ID ${r.request_id}. `
      + `Commitment ${r.commitment.slice(0, 16)}… (proof of exactly what was asked). The night is planned after ${hhmm(r.requests_close_at)}; then get_receipt returns the signed plan and cost.`;
    return toolResult(text, r);
  },

  async get_receipt(args, env, ctx) {
    await admitted(ctx);
    const r = await getReceipt(db(env), { requestId: args.request_id, residentCode: args.resident_code }, ctx);
    if (r.status === "pending") return toolResult(`Not planned yet: requests for the night of ${r.night} close at ${hhmm(r.requests_close_at)}. Ask again after that.`, r);
    const s = r.receipt.schedule;
    // The actual charging intervals: back-to-back quarter-hours joined, gaps kept.
    const runs = [];
    for (const x of s.slots) {
      const last = runs.at(-1);
      if (last && last.end === x.start) last.end = x.end;
      else runs.push({ start: x.start, end: x.end });
    }
    const windows = runs.length ? `${runs.map((w) => `${hhmm(w.start)}–${hhmm(w.end)}`).join(", ")} (${s.slots.length} quarter-hours)` : "no quarter-hours";
    const text = `Plan for the night of ${r.night}: ${s.delivered_kwh} of ${s.requested_kwh} kWh, ${windows}. `
      + `${s.feasible ? "Fully met." : `Short by ${s.shortfall_kwh} kWh: ${s.shortfall_reason === "price_limit" ? `not enough room in quarter-hours at or below your ${s.max_price_cents} c/kWh spot-price limit before your ready-by time` : "the shared limit and your charger were full before your ready-by time"}.`} `
      + `Cost ${eur(r.receipt.cost.total_eur)} (energy ${eur(r.receipt.cost.energy_eur)} + fee ${eur(r.receipt.cost.fee_eur)}). `
      + `Signed by ${r.receipt.iss}; anyone can verify it with the site's published keys.`;
    return toolResult(text, r);
  },

  async get_night_load(args, env, ctx) {
    const r = await nightLoad(db(env), args.night, ctx);
    if (!r.scheduled && r.closed) return toolResult(`The night of ${r.night} had no requests, so nothing was planned.`, r);
    if (!r.scheduled) return toolResult(`The night of ${r.night} is not planned yet (requests close at ${hhmm(r.requests_close_at)}).`, r);
    const peak = Math.max(0, ...r.load.map((l) => l.kw));
    return toolResult(`Night of ${r.night}: ${r.requests} requests, peak ${peak} kW of the ${r.limit_kw} kW limit (${r.rule_version}).`, r);
  },
};
