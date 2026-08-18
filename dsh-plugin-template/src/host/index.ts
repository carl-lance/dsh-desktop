/**
 * dsh-plugin-template — host half entry.
 *
 * Runs inside the DeepSeek Harness Node host. Wires the pieces together:
 *   1. registers the `mcp` settings namespace (schema in ./schema),
 *   2. declares it Web-exposed via the `settings-exposure` namespace,
 *   3. instantiates the reconciler (./reconciler) and connects it to the
 *      namespace's watch + this plugin's lifecycle.
 */

import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { NS, EXPOSURE_NS, McpSettingsSchema, ExposureSchema } from "./schema";
import { Reconciler } from "./reconciler";
import type { McpSettings, ExposureSettings, RuntimeStatus } from "../shared/types";

/** Cordis plugin name used by loader diagnostics. */
export const name = "plugin-template";

/** Services required by this plugin. */
export const inject = ["settings"];

/**
 * Mount the plugin.
 *
 * `ctx.inject(["settings"])` waits for the settings provider before the
 * registrations happen; every mounted fiber is scoped to this plugin's
 * context, so disposal or a profile HMR reload tears the whole set down.
 */
export function apply(ctx: any): void {
  ctx.inject(["settings"], (settingsCtx: any) => {
    const scope = settingsCtx.settings.register(settingsNamespace(NS), McpSettingsSchema);
    const exposure = settingsCtx.settings.register(settingsNamespace(EXPOSURE_NS), ExposureSchema);

    declareExposure(settingsCtx, exposure);

    // Host-owned status projection; never write an empty section back.
    let lastStatusJson = "{}";
    const publishStatus = (status: Record<string, RuntimeStatus>) => {
      const next = JSON.stringify(status);
      if (next === lastStatusJson) return;
      lastStatusJson = next;
      if (Object.keys(status).length === 0) return;
      settingsCtx.settings.update(NS, { runtimeStatus: status }).catch((error: unknown) => {
        settingsCtx.logger.warn(`plugin-template: failed to publish runtime status: ${String(error)}`);
      });
    };

    const reconciler = new Reconciler(settingsCtx, () => (scope.get() as McpSettings).servers ?? [], publishStatus);
    reconciler.reconcile();

    const off = scope.watch(() => reconciler.reconcile());
    settingsCtx.effect(() => off, "plugin-template: settings watch");
    settingsCtx.effect(() => reconciler.dispose(), "plugin-template: teardown");
  });
}

/** Make our namespace readable/writable from Web settings (needed on rc.6). */
function declareExposure(settingsCtx: any, exposure: { get(): ExposureSettings }): void {
  const declared = exposure.get().extra;
  if (!declared.includes(NS)) {
    settingsCtx.settings.update(EXPOSURE_NS, { extra: [...declared, NS] }).catch((error: unknown) => {
      settingsCtx.logger.warn(`plugin-template: failed to declare settings exposure: ${String(error)}`);
    });
  }
}
