// "Request a night slot" form: sends one sealed request to this site's own arbiter
// (/mcp, same origin) and reads the signed receipt after 18:00. SIMULATED housing company.
// The resident code is sent only to this site and is never stored in the browser.

const SENT_KEY = "koivurinne.requests";

export class RequestForm {
  static page = null;

  constructor({ doc = globalThis.document, fetchImpl = (...a) => globalThis.fetch(...a), local = safeLocal() } = {}) {
    this.doc = doc;
    this.fetchImpl = fetchImpl;
    this.local = local;
  }

  async call(name, args) {
    const resp = await this.fetchImpl("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const body = await resp.json().catch(() => null);
    if (!body || body.error) return { ok: false, text: body?.error?.message || `The scheduler could not be reached (HTTP ${resp.status}).` };
    const text = body.result?.content?.[0]?.text ?? "";
    return { ok: !body.result?.isError, text, data: body.result?.structuredContent ?? {} };
  }

  last() {
    try {
      return JSON.parse(this.local?.getItem(SENT_KEY) || "[]")[0] ?? null;
    } catch {
      return null;
    }
  }

  /** Send the form's request. Returns the scheduler's answer. */
  async submit({ code, energyKwh, readyBy }) {
    const r = await this.call("submit_charging_request", { resident_code: String(code).trim(), energy_kwh: Number(energyKwh), ready_by: readyBy });
    if (r.ok) {
      const list = [{ request_id: r.data.request_id, night: r.data.night, energyKwh: Number(energyKwh), readyBy }];
      this.local?.setItem(SENT_KEY, JSON.stringify(list));
    }
    return r;
  }

  /** The signed receipt for the last request sent from this browser. */
  async receipt(code) {
    const last = this.last();
    if (!last) return { ok: false, text: "No request has been sent from this browser." };
    return this.call("get_receipt", { request_id: last.request_id, resident_code: String(code).trim() });
  }

  bind() {
    const d = this.doc;
    const form = d?.getElementById("request-form");
    if (!form) return;
    const out = d.getElementById("request-result");
    const show = (r) => { out.textContent = r.text; out.className = r.ok ? "summary" : "error"; };
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      if (!globalThis.confirm?.(`Send this request for tonight? ${values.energyKwh} kWh, ready by ${values.readyBy}. A request is final: it cannot be changed.`)) return;
      out.textContent = "Sending…";
      show(await this.submit(values));
      form.elements.code.value = "";
    });
    d.getElementById("receipt-button")?.addEventListener("click", async () => {
      const code = form.elements.code.value;
      if (!code) return show({ ok: false, text: "Enter your resident code above to read your receipt." });
      out.textContent = "Asking the scheduler…";
      show(await this.receipt(code));
    });
  }
}

function safeLocal() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

if (globalThis.document?.getElementById("request-form")) {
  RequestForm.page = new RequestForm();
  RequestForm.page.bind();
}
