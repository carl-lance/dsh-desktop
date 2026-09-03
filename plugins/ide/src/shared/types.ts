/**
 * dsh-ide — types shared between the host and client halves.
 *
 * The `ide` settings namespace carries a request/result envelope (JSON
 * strings) plus the resolved workspace binding. Only types live here;
 * they are erased at build time on both sides.
 */

/** One client → host request. Serialized into `reqJson` as JSON. */
export interface IdeReq {
  reqId: string;
  op: string;
  payload?: Record<string, unknown>;
}

/** One host → client answer. Serialized into `resultJson` as JSON. */
export interface IdeResult {
  reqId: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** Directory entry returned by `fs.list`. */
export interface FsEntry {
  name: string;
  /** Absolute path on disk (jailed to the workspace root). */
  path: string;
  kind: "file" | "dir";
}

/** File read result returned by `fs.read`. */
export interface FsReadData {
  path: string;
  text: string;
  truncated: boolean;
  binary: boolean;
}

/** Workspace binding resolved by the host. */
export interface ResolveData {
  cwd: string;
  title: string;
}

/** Shape of the `ide` settings namespace document (mirror of host schema). */
export interface IdeDoc {
  sessionId: string;
  cwd: string;
  title: string;
  reqJson: string;
  resultJson: string;
  note: string;
}

/** One changed path row from `git status --porcelain`. */
export interface GitStatusRow {
  path: string;
  xy: string;
}

/** Status of one git repo (workspace root or a nested `.git` directory). */
export interface GitRepoStatus {
  root: string;
  branch: string;
  entries: GitStatusRow[];
}
