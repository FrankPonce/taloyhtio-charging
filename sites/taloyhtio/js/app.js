// Page script for the housing company's charger page. One page object (App.page) owns the
// page; the page shows the rules and the assistant's read action returns the same data.

import { RULES } from "./rules.js";

export class App {
  /** The single page object, created at startup. */
  static page = null;

  constructor({ doc = globalThis.document, base = globalThis.location?.href ?? "" } = {}) {
    this.doc = doc;
    this.base = base;
  }

  /**
   * The rules and the page's links, as plain JSON (a copy).
   *
   * :return: The charger rules, with where to read more and how requests work today.
   */
  getState() {
    return {
      ...structuredClone(RULES),
      page: {
        rulesUrl: this.link("#rules"),
        requestUrl: this.link("#request"),
        chargePlannerUrl: "https://charge.frankmp12357.workers.dev/",
      },
    };
  }

  link(hash) {
    try {
      return new URL(hash, this.base).href;
    } catch {
      return hash;
    }
  }

  /** Fill the page's rule lists from RULES. */
  render() {
    const set = (id, text) => {
      const el = this.doc.getElementById(id);
      if (el) el.textContent = text;
    };
    const list = (id, items) => {
      const el = this.doc.getElementById(id);
      if (!el) return;
      el.replaceChildren(...items.map((t) => {
        const li = this.doc.createElement("li");
        li.textContent = t;
        return li;
      }));
    };
    const r = RULES;
    set("chargers", `${r.chargers.count} chargers, ${r.chargers.kwEach} kW each, in ${r.chargers.where}.`);
    set("night", `${r.night.from}–${r.night.until}: the chargers share ${r.night.sharedLimitKw} kW. ${r.night.why}`);
    set("day", r.day.note);
    set("request-status", r.requests.statusNote);
    list("fair-share", r.fairShare);
    set("billing", `${r.billing.how} Fee ${r.billing.feeCentsPerKwh.toFixed(2)} c/kWh. ${r.billing.note}`);
    list("cannot", r.cannot.map((c) => `This site cannot ${c}.`));
  }
}

/** This site's own arbiter (same origin), for the night's published load. */
async function callArbiter(name, args) {
  const resp = await fetch("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await resp.json().catch(() => null);
  return { ok: Boolean(body?.result && !body.result.isError), data: body?.result?.structuredContent ?? null };
}

// Start the page when loaded in a browser. Tests set up a document first.
if (globalThis.document?.getElementById("rules")) {
  App.page = new App();
  App.page.render();
  // Only in a real browser: tests run the page in Node with a stub document and no window.
  if (globalThis.window && globalThis.document.getElementById("scene")) {
    const [{ Scene }, { Tonight, NightLoad }] = await Promise.all([import("./scene.js"), import("./night.js")]);
    const scene = new Scene(globalThis.document.getElementById("scene"));
    scene.draw();
    new Tonight({ scene }).start();
    const load = new NightLoad({ call: callArbiter });
    load.load();
    let width = 0;
    globalThis.addEventListener("resize", () => {
      const w = globalThis.document.getElementById("load-chart")?.clientWidth ?? 0;
      if (w !== width) { width = w; load.draw(); }
    });
  }
}
