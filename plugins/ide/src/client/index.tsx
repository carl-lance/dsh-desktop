/**
 * dsh-ide — browser half entry.
 *
 * Runs inside the webview. Registers dictionaries, binds the `ide` settings
 * namespace to the settingsScope service (see ./ideApi), then registers two
 * shell surfaces:
 *   1. a session-header utility button (`conversation.session.header.utilities`)
 *      that binds the active session and toggles the IDE,
 *   2. the fullscreen IDE floating layer (`shell.overlay`) hosting the
 *      workbench.
 */

import { bindIde } from "./ideApi";
import { IdeHeaderAction } from "./IdeHeaderAction";
import { IdeOverlay } from "./IdeOverlay";
import { dictionaries } from "./locales";

/** Dictionary namespace owned by this plugin. */
const NS = "ide";

/** Required services (cordis fiber inject). */
export const inject = ["slots", "locale", "settingsScope"];

/**
 * Register dictionaries, the header utility and the overlay, each once its
 * slot declaration is on the ledger.
 */
export function apply(ctx: any): void {
  ctx.effect(() => ctx.locale.register(NS, dictionaries), "dsh-ide: dictionaries");
  bindIde(ctx.settingsScope, NS);

  ctx.slots.inject("conversation.session.header.utilities", () =>
    ctx.slots.register(
      {
        name: "conversation.session.header.utilities",
        id: "dsh-ide",
        order: 30,
        locale: NS,
      },
      IdeHeaderAction
    )
  );

  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      {
        name: "shell.overlay",
        id: "dsh-ide",
        order: 100,
        locale: NS,
      },
      IdeOverlay
    )
  );
}
