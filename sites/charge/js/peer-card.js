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
  + ".ns-consent-trust[data-trust=warn]{color:#8a4b00}"
  + ".ns-trust-part{display:inline-flex;align-items:baseline;gap:.3em}"
  + ".ns-trust-part[data-ok=true]{color:#1d6b3a}.ns-trust-part[data-ok=false]{color:#8a4b00}"
  + ".ns-trust-icon{width:1em;height:1em;flex:none;align-self:center}";

// Drawn icons (stroke, currentColor), so the line carries no text glyphs.
const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS = {
  ok: ["M3 8.6l3.1 3.1L13 4.8"],
  warn: ["M8 2.2l6.4 11.3H1.6z", "M8 6.6v3.3", "M8 11.9v.1"],
};

/**
 * Describe one peer from a peer-trust/v1 report, in plain words.
 *
 * :param peer: A report entry, or null when the site has not checked this partner.
 * :return: {level: "ok"|"warn", text, detail, parts: [{ok, text}]}. `text` is the whole
 *   line as plain words; `parts` are its facts, each shown with a drawn tick or warning.
 */
export function describePeer(peer) {
  const one = (text, detail = "") => ({ level: "warn", text, detail, parts: [{ ok: false, text }] });
  if (!peer) return one("This site has not checked this partner.");
  if (peer.kind === "mcp") return one("A tool service: it can't be signed or tested yet.", peer.note || "");
  if (peer.error) return one("This site could not check this partner.", peer.error);
  const parts = [];
  const sig = peer.signature || {};
  parts.push(sig.ok ? { ok: true, text: `Signed by ${hostOf(sig.by)}` } : { ok: false, text: sig.status === "invalid" ? "Signature does not hold" : "Not signed by its domain" });
  const a = peer.attestation || {};
  if (a.ok) {
    let line = `tested ${a.score}/100 (coverage ${a.coverage}%) on ${shortModel(a.model)} by ${hostOf(a.iss)}`;
    if (a.results?.private_context_leak === "pass") line += "; kept private details private";
    parts.push({ ok: true, text: line });
  } else if (/site actions|different version of the network/.test(a.reason || "")) {
    parts.push({ ok: false, text: "changed since it was tested" });
  } else if (Number.isFinite(a.score)) {
    parts.push({ ok: false, text: `tested ${a.score}/100 but not vouched for` });
  } else {
    parts.push({ ok: false, text: "no test results from a tester this site trusts" });
  }
  if (a.results?.private_context_leak === "fail") parts.push({ ok: false, text: "leaked private details in tests" });
  const detail = [sig.ok ? "" : sig.reason, a.ok ? (a.exp ? `test results valid until ${a.exp.slice(0, 10)}` : "") : a.reason]
    .filter(Boolean).join(" · ");
  return { level: peer.trusted ? "ok" : "warn", text: parts.map((p) => p.text).join(" · "), detail, parts };
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
  const parts = unavailable ? [{ ok: false, text: "This site's partner check is unavailable right now." }] : d.parts ?? [{ ok: d.level === "ok", text: d.text }];
  parts.forEach((p, i) => {
    if (i) line.append(" · ");
    line.append(part(doc, p));
  });
  if (d.detail && !unavailable) line.title = d.detail;
  const anchor = card.querySelector(".ns-consent-sub") || card.querySelector(".ns-consent-title");
  if (anchor) anchor.after(line);
  else card.prepend(line);
}

/** One fact with its drawn icon; the icon is decorative, the words carry the meaning. */
function part(doc, p) {
  const span = doc.createElement("span");
  span.className = "ns-trust-part";
  span.dataset.ok = String(Boolean(p.ok));
  if (doc.createElementNS) {
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "ns-trust-icon");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    for (const d of ICONS[p.ok ? "ok" : "warn"]) {
      const path = doc.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "1.8");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      svg.append(path);
    }
    span.append(svg);
  }
  span.append(p.text);
  return span;
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
