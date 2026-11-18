// Registers this website's operations with the agent runtime.
// agent-manifest.json loads this module through "actions.module". Only the names in
// "actions.agentTools" become model tools, called website_<name>.
// Each action wraps a method of the page object, so the assistant and the page's own
// form share one set of rules. Import the page script by the same URL the page uses.
import { App } from "./js/app.js";
import { Housing } from "./js/housing.js";
import { LIMITS } from "./js/planner.js";

const planProperties = {
  energyKwh: {
    type: "number",
    minimum: LIMITS.energyKwh.min,
    maximum: LIMITS.energyKwh.max,
    description: "Energy to add, in kWh, from the visitor.",
  },
  chargerKw: {
    type: "number",
    minimum: LIMITS.chargerKw.min,
    maximum: LIMITS.chargerKw.max,
    description: "Charger power in kW, from the visitor; otherwise form.chargerKw from website_get_charging_state.",
  },
  readyBy: {
    type: "string",
    minLength: 16,
    maxLength: 16,
    description: "When the car must be ready, Finnish time, as YYYY-MM-DDTHH:MM. Build the date from today.date or tomorrow.date in website_get_charging_state.",
  },
};

/**
 * Describes the site's operations as actions the agents can call.
 */
class SiteActions {
  /**
   * Register every site action with the runtime.
   *
   * :param actions: The runtime registry facade with a register(definition) method.
   */
  static registerActions(actions) {
    actions.register(SiteActions.readStateAction());
    actions.register(SiteActions.planAction());
    actions.register(SiteActions.showPlanAction());
    actions.register(SiteActions.sendNightRequestAction());
    actions.register(SiteActions.nightReceiptAction());
  }

  static sendNightRequestAction() {
    return {
      name: "send_night_request",
      description: "Send the visitor's one night-slot request to As Oy Koivurinne's shared chargers (a simulated housing company), signed by this site. Final: it cannot be changed, and only one request per resident per night is accepted; requests close at 18:00. The visitor's resident code is read from the page, never from the chat: never ask for it. Returns ok false with a reason (for example no code saved on the page) and nothing sent.",
      effect: "irreversible",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["energyKwh", "readyBy"],
        properties: {
          energyKwh: { ...planProperties.energyKwh, description: "Energy needed, in kWh, from the visitor." },
          readyBy: { ...planProperties.readyBy, description: "When the car must be ready, Finnish time, YYYY-MM-DDTHH:MM, between 22:15 and 07:00 the next morning." },
          chargerKw: { type: "number", minimum: 1.4, maximum: 11, description: "Optional: the car's charging power in kW (the housing chargers give at most 11)." },
        },
      },
      execute: SiteActions.sendNightRequest,
    };
  }

  static sendNightRequest(args) {
    return Housing.page.sendNightRequest(args);
  }

  static nightReceiptAction() {
    return {
      name: "get_night_receipt",
      description: "Read the plan and cost for the latest night-slot request sent from this browser: pending until 18:00, then the housing company's signed receipt (charging windows, kWh delivered, total cost).",
      effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: SiteActions.nightReceipt,
    };
  }

  static nightReceipt() {
    return Housing.page.latestReceipt();
  }

  static readStateAction() {
    return {
      name: "get_charging_state",
      description: "Read the current Finnish time, today's and tomorrow's dates, spot price summaries and hourly prices from now on (c/kWh incl. VAT), whether tomorrow's prices are published, the form values, the plan shown on the page, the page's limits and the price source link.",
      effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: SiteActions.readState,
    };
  }

  static readState() {
    return App.page.getState();
  }

  static planAction() {
    return {
      name: "plan_charging",
      description: "Work out the cheapest charging plan before a ready-by time: charging windows, energy cost, cost if charging now, savings, average price and finish time. Changes nothing on the page. Returns ok false with a reason when the input is refused or prices are not published far enough.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["energyKwh", "chargerKw", "readyBy"],
        properties: planProperties,
      },
      execute: SiteActions.plan,
    };
  }

  static plan(args) {
    return App.page.previewPlan(args);
  }

  static showPlanAction() {
    return {
      name: "show_plan",
      description: "Fill the page's form with these values and show the plan in the page's result card and chart. Use only when the visitor asks to see it on the page. Returns the same plan as website_plan_charging, or ok false with a reason and no change.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["energyKwh", "chargerKw", "readyBy"],
        properties: planProperties,
      },
      execute: SiteActions.showPlan,
    };
  }

  static showPlan(args) {
    return App.page.showPlan(args);
  }
}

// The runtime calls the module's registerActions export.
export const registerActions = SiteActions.registerActions;
