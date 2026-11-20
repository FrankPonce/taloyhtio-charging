// verify-lite: check the kit's signed statements (receipts, network signatures' JWS) with
// WebCrypto only, no dependencies. For static pages that can't bundle the full kit: copy
// this one file next to your page. Same results as statements.js verifyStatement and
// canonical.js canonicalJson for plain JSON data (a test keeps them equal).

const enc = new TextEncoder();

function b64urlBytes(text) {
  const s = atob(String(text).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/**
 * RFC 8785 canonical JSON for plain data: objects (keys sorted by UTF-16 code units),
 * arrays, strings, finite numbers (ECMAScript number form), booleans, null. Undefined
 * object members are left out, as JSON.stringify does.
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("Not JSON: a non-finite number.");
    if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") throw new TypeError("Not JSON.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

/** Hex SHA-256 of a string (UTF-8). */
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hex SHA-256 of a value's canonical JSON: the kit's canonicalHash. */
export async function canonicalHash(value) {
  return sha256Hex(canonicalJson(value));
}

/**
 * Verify a compact EdDSA JWS (the kit's signStatement output) against a key directory.
 *
 * :param jws: The compact JWS.
 * :param keyDirectory: The signer's published JWKS ({keys: [...]}).
 * :return: {ok: true, kid, statement} or {ok: false, reason}.
 */
export async function verifyJws(jws, keyDirectory) {
  const parts = String(jws).split(".");
  if (parts.length !== 3) return { ok: false, reason: "not a compact JWS" };
  let header;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[0])));
  } catch {
    return { ok: false, reason: "unreadable header" };
  }
  if (header.alg !== "EdDSA" || !header.kid) return { ok: false, reason: "unsupported algorithm or missing kid" };
  const jwk = (keyDirectory?.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: `key ${String(header.kid).slice(0, 10)}… is not in the signer's key directory` };
  try {
    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, { name: "Ed25519" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("Ed25519", key, b64urlBytes(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return { ok: false, reason: "signature does not verify" };
  } catch (error) {
    return { ok: false, reason: `this browser cannot check Ed25519 signatures (${error?.name || "error"})` };
  }
  try {
    return { ok: true, kid: header.kid, statement: JSON.parse(new TextDecoder().decode(b64urlBytes(parts[1]))) };
  } catch {
    return { ok: false, reason: "unreadable payload" };
  }
}

/**
 * Verify a statement against its issuer's published key directory (fetched from the issuer's
 * origin unless given), and check its type and issuer.
 *
 * :param jws: The compact JWS.
 * :param opts: {issuer (origin), typ (expected statement type), keyDirectory (optional),
 *     fetchImpl}.
 * :return: {ok: true, kid, statement} or {ok: false, reason}.
 */
export async function verifyStatementLite(jws, { issuer, typ = null, keyDirectory = null, fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
  let dir = keyDirectory;
  if (!dir) {
    try {
      const resp = await fetchImpl(`${new URL(issuer).origin}/.well-known/http-message-signatures-directory`);
      if (!resp.ok) return { ok: false, reason: `the key directory answered ${resp.status}` };
      dir = await resp.json();
    } catch (error) {
      return { ok: false, reason: `the key directory could not be read (${error?.message || error})` };
    }
  }
  const r = await verifyJws(jws, dir);
  if (!r.ok) return r;
  if (issuer && r.statement.iss !== new URL(issuer).origin) return { ok: false, reason: "issued by another site" };
  if (typ && r.statement.typ !== typ) return { ok: false, reason: `not a ${typ} statement` };
  return r;
}
