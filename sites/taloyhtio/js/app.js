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
    set("request-how", `${r.requests.how} Deadline ${r.requests.deadline}. You need: ${r.requests.needs.join(", ")}.`);
    list("fair-share", r.fairShare);
    set("billing", `${r.billing.how} Fee ${r.billing.feeCentsPerKwh.toFixed(2)} c/kWh. ${r.billing.note}`);
    list("cannot", r.cannot.map((c) => `This site cannot ${c}.`));
  }
}

// Start the page when loaded in a browser. Tests set up a document first.
if (globalThis.document?.getElementById("rules")) {
  App.page = new App();
  App.page.render();
}
