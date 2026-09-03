/**
 * dsh-ide — settings namespace schema.
 *
 * A single `ide` namespace carries everything the workbench needs:
 * the active session binding and a serialized request/result envelope.
 * Requests/results ride as JSON strings (schema keeps it strict: plain
 * strings + empty defaults, no nulls).
 */

import z from "@deepseek-ai/schemastery";

/** Settings namespace owned by this plugin. */
export const NS = "ide";

/** The full namespace document. */
export const IdeSchema = z.object({
  /** Active session id reported by the header entry ("" when unknown). */
  sessionId: z.string().default(""),
  /** Resolved workspace root (absolute path, host-owned projection). */
  cwd: z.string().default(""),
  /** Workspace display title (host-owned projection). */
  title: z.string().default(""),
  /** Client → host request envelope (JSON string, see shared/types). */
  reqJson: z.string().default(""),
  /** Host → client answer envelope (JSON string). */
  resultJson: z.string().default(""),
  /** Human-readable host note surfaced in the UI empty state. */
  note: z.string().default(""),
  /** Filesystem watch counter: bumped when workspace files change. */
  fsRev: z.number().default(0),
  /** Recent fs events (JSON string; diagnostics / future use). */
  fsEvents: z.string().default(""),
});
