// Charge site Worker: serves the static site (sites/charge) and the site's default model.
//
//   POST /api/session                  -> {token, expiresAt, model}  (rate-limited per IP)
//   GET  /api/llm/v1/models            -> OpenAI-style model list (the runtime checks it)
//   POST /api/llm/v1/chat/completions  -> Workers AI, OpenAI format, streamed or not
//
// Everything else is a static asset. The API sends no CORS headers: only this site's own
// page may use the default model. Other sites that run this network use their own model.

import { issueSession, verifySession } from "./session.js";

export const ALLOWED_MODELS = ["@cf/openai/gpt-oss-20b", "@cf/zai-org/glm-4.7-flash"];
const MAX_BODY_BYTES = 256 * 1024;
const MAX_TOKENS_CAP = 2048;
const DEFAULT_TEMPERATURE = 0.2;

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });
const fail = (status, message) => json(status, { error: { message, type: "charge_proxy_error" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/session" && request.method === "POST") return await session(request, env);
      if (url.pathname === "/api/llm/v1/models" && request.method === "GET") return models();
      if (url.pathname === "/api/llm/v1/chat/completions" && request.method === "POST") return await chat(request, env);
      if (url.pathname.startsWith("/api/")) return fail(404, "Not found.");
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("charge worker error", error?.stack || error);
      return fail(500, "The site's assistant service had an unexpected error. Try again, or add your own AI key in settings.");
    }
  },
};

function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || "local";
}

// Browsers send Origin on POST. Refuse other sites' pages; tools without Origin are
// still bound by the per-IP limit.
function foreignOrigin(request) {
  const origin = request.headers.get("origin");
  return origin && origin !== new URL(request.url).origin;
}

async function limited(binding, key) {
  if (!binding?.limit) return false; // Not configured (e.g. plain local dev).
  const { success } = await binding.limit({ key });
  return !success;
}

async function session(request, env) {
  if (foreignOrigin(request)) return fail(403, "Sessions are only for this site's own page.");
  if (await limited(env.SESSION_LIMIT, `ip:${clientIp(request)}`)) return fail(429, "Too many new sessions from this address. Wait a minute and reload.");
  const s = await issueSession(env.SESSION_SECRET);
  return json(200, { token: s.token, expiresAt: s.expiresAt, model: ALLOWED_MODELS[0] });
}

function models() {
  return json(200, { object: "list", data: ALLOWED_MODELS.map((id) => ({ id, object: "model", owned_by: "cloudflare-workers-ai" })) });
}

async function chat(request, env) {
  if (foreignOrigin(request)) return fail(403, "This model is only for this site's own page.");
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const check = await verifySession(env.SESSION_SECRET, token);
  if (!check.ok) return fail(401, `Session ${check.reason}. Reload the page to get a new one, or add your own AI key in settings.`);
  if (await limited(env.LLM_LIMIT, `sid:${check.sid}`) || await limited(env.LLM_IP_LIMIT, `ip:${clientIp(request)}`)) {
    return fail(429, "You are sending messages too quickly for the site's free model. Wait a minute, or add your own AI key in settings.");
  }

  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) return fail(413, "The request is too large.");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return fail(413, "The request is too large.");
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, "The request is not valid JSON.");
  }
  const input = buildInput(body);
  if (!input.ok) return fail(400, input.reason);

  // Always ask Workers AI for a complete answer. Streamed tool calls from some models
  // (gpt-oss-20b) arrive inside the reasoning text instead of as tool_calls; the
  // non-streamed response is parsed correctly. A streaming client gets the complete
  // answer re-sent as OpenAI-style SSE chunks.
  const wantsStream = input.params.stream;
  let result;
  try {
    result = await env.AI.run(input.model, { ...input.params, stream: false });
  } catch (error) {
    const message = String(error?.message || error);
    console.error("Workers AI error", message);
    if (/allocation|quota|limit|429|exceed/i.test(message)) {
      return fail(429, "The site's free AI allowance is used up for now. Add your own AI key in settings, or try again later.");
    }
    return fail(502, "The site's AI model did not answer. Try again, or add your own AI key in settings.");
  }
  const completion = cleanToolArguments(toCompletion(result, input.model), input.params.tools);
  if (wantsStream) {
    return new Response(toSse(completion), {
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
    });
  }
  return json(200, completion);
}

/**
 * Make one OpenAI message acceptable to Workers AI, which needs string content:
 * null content (an assistant message that only calls tools) becomes "", and a list of
 * text parts is joined. Other fields (tool_calls, tool_call_id, name) are kept.
 *
 * :param message: An OpenAI-style chat message.
 * :return: The message with string content.
 */
export function normalizeMessage(message) {
  if (!message || typeof message !== "object") return { role: "user", content: "" };
  const { content } = message;
  let text;
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) text = content.map((p) => (typeof p === "string" ? p : p?.text ?? "")).join("");
  else text = content == null ? "" : JSON.stringify(content);
  return { ...message, content: text };
}

/**
 * Normalize a Workers AI answer to an OpenAI chat.completion.
 *
 * Most models already answer in OpenAI format. Older ones answer {response, tool_calls}
 * with arguments as an object.
 *
 * :param result: The Workers AI result.
 * :param model: The model id.
 * :return: An OpenAI-style chat.completion object.
 */
export function toCompletion(result, model) {
  if (Array.isArray(result?.choices)) return result;
  const toolCalls = Array.isArray(result?.tool_calls) ? result.tool_calls.map((tc, i) => ({
    id: tc.id || `call_${i}`,
    type: "function",
    function: {
      name: tc.name ?? tc.function?.name ?? "",
      arguments: typeof (tc.arguments ?? tc.function?.arguments) === "string"
        ? (tc.arguments ?? tc.function.arguments)
        : JSON.stringify(tc.arguments ?? tc.function?.arguments ?? {}),
    },
  })) : [];
  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: typeof result?.response === "string" ? result.response : "", ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
      finish_reason: toolCalls.length ? "tool_calls" : "stop",
    }],
    usage: result?.usage ?? null,
  };
}

/**
 * Re-send a complete chat.completion as OpenAI-style SSE chunks.
 *
 * :param completion: An OpenAI chat.completion object.
 * :return: The SSE body text: a content chunk, a tool-calls chunk if any, a finish chunk, [DONE].
 */
export function toSse(completion) {
  const choice = completion.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const base = { id: completion.id, object: "chat.completion.chunk", created: completion.created ?? Math.floor(Date.now() / 1000), model: completion.model };
  const chunk = (delta, finish = null, extra = {}) => `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
  let out = chunk({ role: "assistant", content: message.content ?? "" });
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if (toolCalls.length) {
    out += chunk({
      tool_calls: toolCalls.map((tc, index) => ({ index, id: tc.id, type: "function", function: { name: tc.function?.name ?? "", arguments: tc.function?.arguments ?? "" } })),
    });
  }
  out += chunk({}, choice.finish_reason ?? (toolCalls.length ? "tool_calls" : "stop"), completion.usage ? { usage: completion.usage } : {});
  return `${out}data: [DONE]\n\n`;
}

/**
 * Keep only the fields the runtime sends, enforce the model list and cap the output.
 *
 * :param body: The parsed OpenAI-style request.
 * :return: {ok: true, model, params} or {ok: false, reason}.
 */
export function buildInput(body) {
  if (!body || typeof body !== "object") return { ok: false, reason: "Missing request body." };
  const model = String(body.model || "");
  if (!ALLOWED_MODELS.includes(model)) {
    return { ok: false, reason: `Model ${model || "(none)"} is not offered by this site. Use one of: ${ALLOWED_MODELS.join(", ")}.` };
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 200) {
    return { ok: false, reason: "messages must be a list of 1 to 200 messages." };
  }
  const params = { messages: body.messages.map(normalizeMessage), stream: body.stream === true };
  if (Array.isArray(body.tools) && body.tools.length) {
    if (body.tools.length > 32) return { ok: false, reason: "At most 32 tools." };
    params.tools = body.tools;
    params.tool_choice = typeof body.tool_choice === "string" ? body.tool_choice : "auto";
  }
  const asked = Number(body.max_tokens ?? body.max_completion_tokens);
  params.max_tokens = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_TOKENS_CAP) : MAX_TOKENS_CAP;
  // The runtime sends no temperature. A low default keeps tool calls and wording steady.
  params.temperature = Number.isFinite(body.temperature) ? Math.min(Math.max(body.temperature, 0), 1.5) : DEFAULT_TEMPERATURE;
  return { ok: true, model, params };
}

/**
 * Repair tool-call arguments the model got wrong in ways that cannot matter.
 *
 * - A tool whose schema takes no arguments always gets "{}". Models sometimes send
 *   stray keys (gpt-oss-20b sends {"": {}}), which the runtime then refuses, costing a call.
 * - Empty arguments become "{}".
 * Anything else is left alone, so the runtime's schema check still refuses real mistakes.
 *
 * :param completion: An OpenAI chat.completion.
 * :param tools: The tools from the request, with their JSON schemas.
 * :return: The completion, with arguments fixed in place.
 */
export function cleanToolArguments(completion, tools = []) {
  const noArgs = new Set();
  for (const tool of tools || []) {
    const fn = tool?.function;
    const props = fn?.parameters?.properties;
    if (fn?.name && (!props || Object.keys(props).length === 0)) noArgs.add(fn.name);
  }
  for (const choice of completion?.choices || []) {
    for (const call of choice?.message?.tool_calls || []) {
      if (!call?.function) continue;
      const args = call.function.arguments;
      if (noArgs.has(call.function.name) || args === undefined || args === null || String(args).trim() === "") {
        call.function.arguments = "{}";
      }
    }
  }
  return completion;
}
