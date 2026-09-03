/**
 * dsh-ide — host half entry (placeholder).
 *
 * Runs inside the DeepSeek Harness Node host. Phase 0 ships no host logic —
 * later phases add the git/file/pty services here (git.exe invocation, fs
 * operations scoped to the workspace root, node-pty terminals, SSH key
 * management), exposed to the client half through dsh services/settings.
 *
 * The module still must be a valid cordis plugin (name/inject/apply) because
 * the profile boot loads this package host-side to discover its client
 * manifest.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = "dsh-ide";

/** Services required by this plugin (none yet). */
export const inject: string[] = [];

/** Mount the plugin. */
export function apply(_ctx: any): void {
  // Phase 1+: ctx.inject([...services], ...) to register git/fs/pty logic.
}
