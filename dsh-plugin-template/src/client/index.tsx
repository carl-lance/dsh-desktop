/**
 * dsh-plugin-template — browser half entry.
 *
 * Runs inside the webview. Registers the dictionaries and the settings
 * section; the section itself lives in ./McpSection with its pieces in
 * ./JsonEditor, ./ServerCard, ./validate, ./locales and ./styles.
 */

import { bindSnapshotSelector } from "@deepseek-ai/dsh-client-web-react";
import { McpSection } from "./McpSection";
import { dictionaries } from "./locales";
import { injectStyles } from "./styles";

/** Dictionary namespace owned by this plugin. */
const NS = "mcp";

/** Required services (cordis fiber inject). */
export const inject = ["slots", "locale", "settingsScope"];

/**
 * Register the dictionaries and the settings section, each once its slot
 * declaration is on the ledger.
 */
export function apply(ctx: any): void {
  injectStyles();
  ctx.effect(() => ctx.locale.register(NS, dictionaries), "plugin-template: dictionaries");
  const t = ctx.locale.bind(NS);
  const controller = ctx.settingsScope.bind({ namespace: NS });
  const useSnapshot = bindSnapshotSelector(controller);
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "mcp",
    order: 20,
    label: () => t("nav"),
    locale: NS,
    inject: () => ({ controller, useSnapshot, t })
  }, McpSection));
}
