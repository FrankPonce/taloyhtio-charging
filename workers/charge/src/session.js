// Short-lived session tokens for the site's default model.
// Format: base64url(JSON {sid, exp}) "." base64url(HMAC-SHA256(payload, secret)).
// A token is only accepted by this site's own LLM proxy; it is not a provider key.

const enc = new TextEncoder();

export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(text) {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function hmacKey(secret) {
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/**
 * Issue a session token.
 *
 * :param secret: The server's SESSION_SECRET.
 * :param nowMs: Current time in epoch ms.
 * :return: {token, sid, expiresAt} where expiresAt is an ISO time.
 */
export async function issueSession(secret, nowMs = Date.now()) {
  const sid = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const exp = nowMs + SESSION_TTL_MS;
  const payload = b64url(enc.encode(JSON.stringify({ sid, exp })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payload));
  return { token: `${payload}.${b64url(sig)}`, sid, expiresAt: new Date(exp).toISOString() };
}

/**
 * Check a session token.
 *
 * :param secret: The server's SESSION_SECRET.
 * :param token: The token from the Authorization header.
 * :param nowMs: Current time in epoch ms.
 * :return: {ok: true, sid} or {ok: false, reason}.
 */
export async function verifySession(secret, token, nowMs = Date.now()) {
  if (typeof token !== "string" || token.length > 512) return { ok: false, reason: "missing or malformed token" };
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return { ok: false, reason: "malformed token" };
  let valid = false;
  try {
    valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(sig), enc.encode(payload));
  } catch {
    return { ok: false, reason: "malformed token" };
  }
  if (!valid) return { ok: false, reason: "invalid token" };
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
  } catch {
    return { ok: false, reason: "malformed token" };
  }
  if (typeof body?.exp !== "number" || body.exp <= nowMs) return { ok: false, reason: "expired token" };
  if (typeof body?.sid !== "string" || !body.sid) return { ok: false, reason: "malformed token" };
  return { ok: true, sid: body.sid };
}
