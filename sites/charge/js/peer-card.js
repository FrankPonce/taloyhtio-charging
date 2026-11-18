// Drop-in peer trust line for the agentic-web runtime's consent card. Browser only, no
// dependencies. Copy this file next to your site.js, then, after boot():
//
//   import { withPeerTrust } from "./js/peer-card.js";
//   booted.engine.onConsent = withPeerTrust(booted.engine.onConsent);
//
// (If your site.js already wraps onConsent, wrap the runtime's default card instead:
//  AssistantMount.defaultConsent = withPeerTrust(booted.engine.onConsent).)
//
// What it does: before the visitor answers a consent card, it adds one line saying what
// this site's own server found about that partner: signed by its domain or not, and
// tested by a tester it trusts (score, coverage, model) or not. The facts come from
// /.well-known/peer-trust.json on THIS site's origin (agent-trust-kit peerTrustReport(),
// or `trust-kit peer-trust` in a build step), so the browser never contacts the partner
// before the visitor agrees. Nothing changes in the runtime, in agent-to-agent messages,
// or in what the model sees: the model only ever learns "allowed" or "declined".
//
// Options: {url: where the report is (default /.well-known/peer-trust.json),
//           block: true to decline partners that aren't trusted without asking (default
//           false: show the facts, let the visitor decide), doc: the document}.

const STYLE_ID = "peer-trust-style";
const CSS = ".ns-consent-trust{margin:.35em 0 .1em;font-size:.85em;line-height:1.35}"
  + ".ns-consent-trust[data-trust=ok]{color:#1d6b3a}"
  + ".ns-consent-trust[data-trust=warn]{color:#8a4b00}";

/**
 * Describe one peer from a peer-trust/v1 report, in plain words.
 *
 * :param peer: A report entry, or null when the site has not checked this partner.
 * :return: {level: "ok"|"warn", text, detail}.
 */
export function describePeer(peer) {
  if (!peer) return { level: "warn", text: "⚠ This site has not checked this partner.", detail: "" };
  if (peer.kind === "mcp") return { level: "warn", text: "⚠ A tool service: it can't be signed or tested yet.", detail: peer.note || "" };
  if (peer.error) return { level: "warn", text: "⚠ This site could not check this partner.", detail: peer.error };
  const parts = [];
  const sig = peer.signature || {};
  parts.push(sig.ok ? `✓ Signed by ${hostOf(sig.by)}` : sig.status === "invalid" ? "⚠ Signature does not hold" : "⚠ Not signed by its domain");
  const a = peer.attestation || {};
  if (a.ok) {
    let line = `✓ tested ${a.score}/100 (coverage ${a.coverage}%) on ${shortModel(a.model)} by ${hostOf(a.iss)}`;
    if (a.results?.private_context_leak === "pass") line += "; kept private details private";
    parts.push(line);
  } else if (/site actions|different version of the network/.test(a.reason || "")) {
    parts.push("⚠ changed since it was tested");
  } else if (Number.isFinite(a.score)) {
    parts.push(`⚠ tested ${a.score}/100 but not vouched for`);
  } else {
    parts.push("⚠ no test results from a tester this site trusts");
  }
  if (a.results?.private_context_leak === "fail") parts.push("⚠ leaked private details in tests");
  const detail = [sig.ok ? "" : sig.reason, a.ok ? (a.exp ? `test results valid until ${a.exp.slice(0, 10)}` : "") : a.reason]
    .filter(Boolean).join(" · ");
  return { level: peer.trusted ? "ok" : "warn", text: parts.join(" · "), detail };
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return String(url || "unknown");
  }
}

function shortModel(model) {
  return String(model || "an unnamed model").split("/").pop();
}

/**
 * Wrap the runtime's consent handler with the peer trust line.
 *
 * :param showCard: The handler to wrap: async (info) => "allow"|"always"|"decline".
 * :param opts: {url, block, doc} (see the top of this file).
 * :return: A handler with the same contract.
 */
export function withPeerTrust(showCard, { url = "/.well-known/peer-trust.json", block = false, doc = globalThis.document } = {}) {
  let report = null;
  const load = () => (report ??= fetch(url, { headers: { accept: "application/json" }, credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null));
  load(); // same origin only; fetched once, at boot
  addStyle(doc);
  const findPeer = (r, info) => r?.peers?.find((p) => p.host === info.peerOrigin) ?? null;

  return async (info) => {
    if (block) {
      const peer = findPeer(await load(), info);
      if (!peer?.trusted) {
        note(doc, `Not contacted: ${info.peerLabel || info.peerOrigin} (${info.peerOrigin}). This site only contacts partners that are signed and tested.`, describePeer(peer));
        return "decline";
      }
    }
    // Show the card at once (callers may focus it right away), then add the line.
    const answer = showCard(info);
    const card = newestCard(doc);
    load().then((r) => decorate(doc, card, describePeer(r ? findPeer(r, info) : null), !r));
    return answer;
  };
}

function newestCard(doc) {
  const cards = doc?.querySelectorAll?.(".ns-consent") || [];
  return cards[cards.length - 1] || null;
}

function decorate(doc, card, d, unavailable) {
  if (!card || card.querySelector(".ns-consent-trust")) return;
  const line = doc.createElement("div");
  line.className = "ns-consent-trust";
  line.dataset.trust = d.level;
  line.textContent = unavailable ? "⚠ This site's partner check is unavailable right now." : d.text;
  if (d.detail && !unavailable) line.title = d.detail;
  const anchor = card.querySelector(".ns-consent-sub") || card.querySelector(".ns-consent-title");
  if (anchor) anchor.after(line);
  else card.prepend(line);
}

function note(doc, text, d) {
  const msgs = doc?.querySelector?.("#ns-msgs");
  if (!msgs) return;
  const el = doc.createElement("div");
  el.className = "ns-msg bot ns-consent";
  const title = doc.createElement("div");
  title.className = "ns-consent-title";
  title.textContent = text;
  el.append(title);
  decorate(doc, el, d, false);
  msgs.append(el);
  msgs.scrollTop = msgs.scrollHeight;
}

function addStyle(doc) {
  if (!doc?.head || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}
