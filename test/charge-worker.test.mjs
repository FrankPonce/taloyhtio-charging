import { test } from "node:test";
import assert from "node:assert/strict";
import { issueSession, verifySession, SESSION_TTL_MS } from "../workers/charge/src/session.js";
import worker, { buildInput, ALLOWED_MODELS } from "../workers/charge/src/index.js";

const SECRET = "test-secret-test-secret-test-secret-0123";
const ORIGIN = "https://charge.example";

// ---- session tokens ------------------------------------------------------------

test("a fresh token verifies; tampered, foreign-key and expired tokens do not", async () => {
  const now = Date.parse("2026-11-18T08:00:00Z");
  const s = await issueSession(SECRET, now);
  assert.deepEqual(await verifySession(SECRET, s.token, now), { ok: true, sid: s.sid });
  const [payload, sig] = s.token.split(".");
  const flipped = sig.slice(0, -2) + (sig.at(-2) === "A" ? "B" : "A") + sig.at(-1);
  assert.equal((await verifySession(SECRET, `${payload}.${flipped}`, now)).ok, false);
  assert.equal((await verifySession("another-secret-another-secret-another-1", s.token, now)).ok, false);
  assert.equal((await verifySession(SECRET, s.token, now + SESSION_TTL_MS + 1)).reason, "expired token");
  for (const bad of ["", "abc", "a.b.c", null, 42, "x".repeat(600)]) {
    assert.equal((await verifySession(SECRET, bad, now)).ok, false, String(bad).slice(0, 20));
  }
});

test("a short secret is refused", async () => {
  await assert.rejects(issueSession("short"), /at least 32/);
});

// ---- input filtering ----------------------------------------------------------------

test("buildInput enforces the model list, caps output and drops unknown fields", () => {
  const ok = buildInput({ model: ALLOWED_MODELS[0], messages: [{ role: "user", content: "hi" }], stream: true, max_tokens: 99999, user: "x", tools: [{ type: "function", function: { name: "f", parameters: {} } }] });
  assert.equal(ok.ok, true);
  assert.equal(ok.params.max_tokens, 2048);
  assert.equal(ok.params.tool_choice, "auto");
  assert.equal("user" in ok.params, false);
  assert.equal(buildInput({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }).ok, false);
  assert.equal(buildInput({ model: ALLOWED_MODELS[0], messages: [] }).ok, false);
  assert.equal(buildInput({ model: ALLOWED_MODELS[0], messages: [{}], tools: new Array(33).fill({}) }).ok, false);
});

test("messages get string content for Workers AI; tool fields are kept", () => {
  const out = buildInput({ model: ALLOWED_MODELS[0], messages: [
    { role: "system", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: "{\"ok\":true}" },
  ] }).params.messages;
  assert.deepEqual(out.map((m) => m.content), ["ab", "", "{\"ok\":true}"]);
  assert.equal(out[1].tool_calls[0].id, "c1");
  assert.equal(out[2].tool_call_id, "c1");
});

test("stray arguments to a no-argument tool become {}; other arguments are left for the runtime to check", async () => {
  const { cleanToolArguments } = await import("../workers/charge/src/index.js");
  const tools = [
    { type: "function", function: { name: "website_get_charging_state", parameters: { type: "object", properties: {} } } },
    { type: "function", function: { name: "website_plan_charging", parameters: { type: "object", properties: { energyKwh: { type: "number" } } } } },
  ];
  const completion = { choices: [{ message: { tool_calls: [
    { id: "a", type: "function", function: { name: "website_get_charging_state", arguments: "{\"\":{}}" } },
    { id: "b", type: "function", function: { name: "website_plan_charging", arguments: "{\"energyKwh\":\"lots\"}" } },
    { id: "c", type: "function", function: { name: "website_plan_charging", arguments: "" } },
  ] } }] };
  const out = cleanToolArguments(completion, tools).choices[0].message.tool_calls.map((c) => c.function.arguments);
  assert.deepEqual(out, ["{}", "{\"energyKwh\":\"lots\"}", "{}"]);
});

test("temperature defaults low and is clamped", () => {
  const base = { model: ALLOWED_MODELS[0], messages: [{ role: "user", content: "x" }] };
  assert.equal(buildInput(base).params.temperature, 0.2);
  assert.equal(buildInput({ ...base, temperature: 9 }).params.temperature, 1.5);
  assert.equal(buildInput({ ...base, temperature: 0.7 }).params.temperature, 0.7);
});

test("chat route cleans arguments before the runtime sees them", async () => {
  const { LlmClient } = await import("../sites/charge/runtime/llm.js");
  const e = env({ aiResult: { choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [
    { id: "a", type: "function", function: { name: "website_get_charging_state", arguments: "{\"\":{}}" } },
  ] } }] } });
  const t = await token(e);
  const body = JSON.stringify({ model: ALLOWED_MODELS[0], stream: true, messages: [{ role: "user", content: "x" }],
    tools: [{ type: "function", function: { name: "website_get_charging_state", parameters: { type: "object", properties: {} } } }] });
  const r = await worker.fetch(req("/api/llm/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${t}` }, body }), e);
  const parsed = await new LlmClient({ baseUrl: "https://x", apiKey: "k" })._readSse(r, () => {}, null, undefined);
  assert.equal(parsed.toolCalls[0].function.arguments, "{}");
});

// ---- routes ---------------------------------------------------------------------------

function env({ aiResult = { choices: [] }, aiError = null, limits = {} } = {}) {
  const calls = [];
  const limiter = (name) => ({ limit: async ({ key }) => ({ success: !(limits[name] || []).includes(key) }) });
  return {
    calls,
    SESSION_SECRET: SECRET,
    SESSION_LIMIT: limiter("SESSION_LIMIT"),
    LLM_LIMIT: limiter("LLM_LIMIT"),
    LLM_IP_LIMIT: limiter("LLM_IP_LIMIT"),
    ASSETS: { fetch: async (req) => new Response(`asset ${new URL(req.url).pathname}`) },
    AI: { run: async (model, params) => { calls.push({ model, params }); if (aiError) throw aiError; return aiResult; } },
  };
}

const req = (path, { method = "GET", origin = ORIGIN, headers = {}, body } = {}) =>
  new Request(ORIGIN + path, { method, headers: { ...(origin ? { origin } : {}), "cf-connecting-ip": "1.2.3.4", ...headers }, body });

async function token(e) {
  const r = await worker.fetch(req("/api/session", { method: "POST" }), e);
  assert.equal(r.status, 200);
  return (await r.json()).token;
}

test("session: same-origin page gets a token; other sites and rate-limited IPs do not", async () => {
  const e = env();
  const r = await worker.fetch(req("/api/session", { method: "POST" }), e);
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.model, ALLOWED_MODELS[0]);
  assert.equal(r.headers.get("access-control-allow-origin"), null, "no CORS on the API");
  assert.equal((await worker.fetch(req("/api/session", { method: "POST", origin: "https://evil.example" }), e)).status, 403);
  assert.equal((await worker.fetch(req("/api/session", { method: "POST" }), env({ limits: { SESSION_LIMIT: ["ip:1.2.3.4"] } }))).status, 429);
});

const TOOL_ANSWER = {
  id: "chatcmpl-1", object: "chat.completion", created: 1, model: ALLOWED_MODELS[0],
  choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [
    { id: "call-a", type: "function", function: { name: "website_get_charging_state", arguments: "{}" } },
    { id: "call-b", type: "function", function: { name: "website_plan_charging", arguments: "{\"energyKwh\":30,\"chargerKw\":11,\"readyBy\":\"2026-11-18T07:00\"}" } },
  ] } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
};

test("chat: needs a valid token, asks Workers AI without streaming, re-streams for the runtime", async () => {
  const e = env({ aiResult: TOOL_ANSWER });
  const t = await token(e);
  const payload = JSON.stringify({ model: ALLOWED_MODELS[0], stream: true, messages: [{ role: "user", content: "hi" }] });
  const noAuth = await worker.fetch(req("/api/llm/v1/chat/completions", { method: "POST", body: payload }), e);
  assert.equal(noAuth.status, 401);
  const r = await worker.fetch(req("/api/llm/v1/chat/completions", { method: "POST", body: payload, headers: { authorization: `Bearer ${t}` } }), e);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/event-stream/);
  assert.equal(e.calls.length, 1);
  assert.equal(e.calls[0].model, ALLOWED_MODELS[0]);
  assert.equal(e.calls[0].params.stream, false, "Workers AI is always asked for a complete answer");

  // The runtime's own stream reader must get both tool calls back intact.
  const { LlmClient } = await import("../sites/charge/runtime/llm.js");
  const parsed = await new LlmClient({ baseUrl: "https://x", apiKey: "k" })._readSse(r, () => {}, null, undefined);
  assert.deepEqual(parsed.toolCalls.map((c) => [c.id, c.function.name, c.function.arguments]), [
    ["call-a", "website_get_charging_state", "{}"],
    ["call-b", "website_plan_charging", "{\"energyKwh\":30,\"chargerKw\":11,\"readyBy\":\"2026-11-18T07:00\"}"],
  ]);
  assert.equal(parsed.finishReason, "tool_calls");
});

test("chat: a plain text answer streams as content; legacy {response} answers are converted", async () => {
  const { LlmClient } = await import("../sites/charge/runtime/llm.js");
  const read = async (aiResult) => {
    const e = env({ aiResult });
    const t = await token(e);
    const r = await worker.fetch(req("/api/llm/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${t}` }, body: JSON.stringify({ model: ALLOWED_MODELS[0], stream: true, messages: [{ role: "user", content: "x" }] }) }), e);
    let streamed = "";
    const parsed = await new LlmClient({ baseUrl: "https://x", apiKey: "k" })._readSse(r, (d) => { streamed += d; }, null, undefined);
    return { parsed, streamed };
  };
  const text = await read({ choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Charge at 02:00." } }] });
  assert.equal(text.parsed.content, "Charge at 02:00.");
  assert.equal(text.streamed, "Charge at 02:00.");
  assert.equal(text.parsed.toolCalls.length, 0);
  const legacy = await read({ response: "", tool_calls: [{ name: "website_get_charging_state", arguments: {} }] });
  assert.equal(legacy.parsed.toolCalls[0].function.name, "website_get_charging_state");
  assert.equal(legacy.parsed.toolCalls[0].function.arguments, "{}");
});

test("chat: refuses other models, other origins, bad JSON; maps quota errors to 429", async () => {
  const e = env();
  const t = await token(e);
  const auth = { authorization: `Bearer ${t}` };
  const send = (body, opts = {}) => worker.fetch(req("/api/llm/v1/chat/completions", { method: "POST", body, headers: auth, ...opts }), e);
  assert.equal((await send(JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "x" }] }))).status, 400);
  assert.equal((await send("{nope")).status, 400);
  assert.equal((await send("{}", { origin: "https://evil.example" })).status, 403);
  assert.equal(e.calls.length, 0, "Workers AI was never called");
  const quota = env({ aiError: new Error("3036: Account limited: daily free allocation exceeded") });
  const t2 = await token(quota);
  const r = await worker.fetch(req("/api/llm/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${t2}` }, body: JSON.stringify({ model: ALLOWED_MODELS[0], messages: [{ role: "user", content: "x" }] }) }), quota);
  assert.equal(r.status, 429);
  assert.match((await r.json()).error.message, /own AI key/);
});

test("models lists the allowed models; other paths go to static assets", async () => {
  const e = env();
  const m = await (await worker.fetch(req("/api/llm/v1/models"), e)).json();
  assert.deepEqual(m.data.map((x) => x.id), ALLOWED_MODELS);
  assert.equal(await (await worker.fetch(req("/agent-manifest.json"), e)).text(), "asset /agent-manifest.json");
  assert.equal((await worker.fetch(req("/api/nothing"), e)).status, 404);
});
