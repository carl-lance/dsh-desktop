/**
 * dsh-ide — workspace root resolution (host side).
 *
 * The runtime keeps the canonical mapping in `<DSH_HOME>/storages/
 * workspace.json` (workspace records with `sessionIds` and a `path`).
 * Resolution order:
 *   1. session id present → record whose `sessionIds` contains it
 *      (lenient suffix match, ids may appear with/without the `session-` prefix);
 *   2. otherwise the single known workspace;
 *   3. otherwise an error note.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface WorkspaceRecord {
  path: string;
  title?: string;
  sessionIds?: string[];
}

export interface WorkspaceBinding {
  cwd: string;
  title: string;
}

function looksLike(want: string, have: string): boolean {
  const a = want.startsWith("session-") ? want.slice("session-".length) : want;
  const b = have.startsWith("session-") ? have.slice("session-".length) : have;
  return a !== "" && (a === b || have === want);
}

/** Read workspace.json under a DSH home. Returns [] on any read/parse error. */
export async function readWorkspaces(home: string): Promise<WorkspaceRecord[]> {
  try {
    const raw = await readFile(join(home, "storages", "workspace.json"), "utf8");
    const data = JSON.parse(raw) as {
      tables?: { workspaces?: Record<string, WorkspaceRecord> };
    };
    const table = data?.tables?.workspaces;
    return table ? Object.values(table) : [];
  } catch {
    return [];
  }
}

/**
 * Resolve the workspace root for a session id (or the single workspace).
 * Throws a descriptive Error when nothing can be resolved.
 */
export async function resolveWorkspace(home: string, sessionId: string): Promise<WorkspaceBinding> {
  const records = await readWorkspaces(home);

  if (sessionId) {
    const hit = records.find((r) => (r.sessionIds ?? []).some((s) => looksLike(sessionId, s)));
    if (hit) {
      return { cwd: hit.path, title: hit.title ?? basenameOf(hit.path) };
    }
  }

  if (records.length === 1) {
    const only = records[0];
    return { cwd: only.path, title: only.title ?? basenameOf(only.path) };
  }

  if (records.length > 1) {
    throw new Error(`multiple workspaces and session '${sessionId || "(none)"}' matches none`);
  }
  throw new Error("no workspace record found in storages/workspace.json");
}

function basenameOf(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}
