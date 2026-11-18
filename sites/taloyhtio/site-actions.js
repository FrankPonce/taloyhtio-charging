// Registers this website's operations with the agent runtime.
// agent-manifest.json loads this module through "actions.module". Only the names in
// "actions.agentTools" become model tools, called website_<name>.
import { App } from "./js/app.js";

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
    actions.register(SiteActions.readRulesAction());
  }

  static readRulesAction() {
    return {
      name: "get_charging_rules",
      description: "Read the housing company's shared-charger rules: the chargers, the night and day power limits, how and when residents request a night slot (and whether requests are open yet), the fair-share rules, billing, what this site cannot do, whom to contact, and links to this page's sections and to the Charge planner.",
      effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: SiteActions.readRules,
    };
  }

  static readRules() {
    return App.page.getState();
  }
}

// The runtime calls the module's registerActions export.
export const registerActions = SiteActions.registerActions;
