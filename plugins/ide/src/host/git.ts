/**
 * dsh-ide — host-side git operations.
 *
 * Thin, whitelisted wrappers around git.exe. All commands run with `-C root`
 * (never shell), args arrays only. Git log output is parsed into commit rows
 * the client renders as a graph.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const execFileAsync = promisify(execFile);

export interface GitCommit {
  hash: string;
  /** Parent hashes, oldest-first row order; empty for the root commit. */
  parents: string[];
  /** Raw `%D` decorations, e.g. "HEAD -> main, origin/main" ("" when none). */
  decorations: string;
  author: string;
  /** Unix timestamp seconds. */
  ts: number;
  subject: string;
}

export interface GitLogData {
  commits: GitCommit[];
  /** Short sha of HEAD. */
  head: string;
}

const MAX_BYTES = 8 * 1024 * 1024;

async function git(root: string, args: string[], timeoutMs = 15000): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
      maxBuffer: MAX_BYTES,
      timeout: timeoutMs,
      windowsHide: true,
    });
    return stdout;
  } catch (err) {
    const e = err as { message?: string; stderr?: string };
    const detail = (e.stderr || e.message || "").toString().trim();
    throw new Error(`git ${args[0]} failed: ${detail || "unknown error"}`);
  }
}

/**
 * Full-history log, oldest first (parent-before-child), ready to replay into
 * a commit graph. Field separator is \x1f; one commit per line.
 */
export async function gitLog(root: string, count = 120): Promise<GitLogData> {
  const out = await git(root, [
    "log",
    "--all",
    "--reverse",
    "--topo-order",
    `--max-count=${count}`,
    "--format=%H%x1f%P%x1f%D%x1f%an%x1f%at%x1f%s",
  ]);
  const commits: GitCommit[] = [];
  let head = "";
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [hash = "", parentsRaw = "", decorations = "", author = "", tsRaw = "", subject = ""] = line.split("\x1f");
    commits.push({
      hash,
      parents: parentsRaw ? parentsRaw.split(" ") : [],
      decorations,
      author,
      ts: Number(tsRaw) || 0,
      subject,
    });
  }
  // HEAD short hash for the status line.
  try {
    head = (await git(root, ["rev-parse", "--short", "HEAD"])).trim();
  } catch {
    head = "";
  }
  return { commits, head };
}

/** One changed path row from `git status --porcelain`. */
export interface GitStatusEntry {
  /** Working-tree relative path (dir entries end with "/"). */
  path: string;
  /** Two-letter porcelain code (e.g. "M ", "A ", " D", "??"). */
  xy: string;
}

export interface GitRepoStatus {
  root: string;
  branch: string;
  entries: GitStatusEntry[];
}

const SKIP_DIRS = new Set([".git", "node_modules", "target", "dist", ".idea"]);

/** Discover git repos under a workspace root (root itself + nested dirs that
 *  contain a `.git` entry; bounded walk to stay cheap on big trees). */
export async function discoverGitRepos(workspaceRoot: string): Promise<string[]> {
  const repos: string[] = [];
  const seen = new Set<string>();
  const hasGit = async (dir: string): Promise<boolean> => {
    try {
      const names = await readdir(dir, { withFileTypes: true });
      return names.some((d) => d.name === ".git");
    } catch {
      return false;
    }
  };
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (seen.size > 2000) return;
    const isRepo = await hasGit(dir);
    if (isRepo && repos.indexOf(dir) < 0) repos.push(dir);
    // Do not walk inside a nested repo (git owns its internals); the
    // workspace root itself is always descended so repos nested under a
    // top-level repo are still found.
    if (isRepo && dir !== workspaceRoot) return;
    if (depth >= 4) return;
    let entries: { name: string; isDir: boolean }[] = [];
    try {
      entries = (await readdir(dir, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && !SKIP_DIRS.has(d.name))
        .map((d) => ({ name: d.name, isDir: true }));
    } catch {
      return;
    }
    for (const e of entries) {
      if (seen.size > 2000) return;
      const child = join(dir, e.name);
      seen.add(child);
      await walk(child, depth + 1);
    }
  };
  await walk(workspaceRoot, 0);
  return repos;
}

/** Aggregated `git status` for the workspace root and any nested repos.
 *  `onStage` reports progress (used to diagnose hangs). */
export async function gitStatusAll(
  workspaceRoot: string,
  onStage?: (stage: string, data: unknown) => void
): Promise<GitRepoStatus[]> {
  onStage?.("discover-start", workspaceRoot);
  const roots = await discoverGitRepos(workspaceRoot);
  onStage?.("discover-done", { roots: roots.length });
  const out: GitRepoStatus[] = [];
  for (const root of roots) {
    onStage?.("repo-start", root);
    let raw = "";
    try {
      raw = await git(
        root,
        ["status", "--porcelain=v1", "-z", "--untracked-files=normal", "--ignored=matching"],
        30000
      );
    } catch {
      onStage?.("repo-error", root);
      continue; // not a usable repo after all
    }
    const entries: GitStatusEntry[] = [];
    for (const rec of raw.split("\0")) {
      if (!rec || rec.length < 4) continue;
      const xy = rec.slice(0, 2);
      const path = rec.slice(3).replace(/^"|"$/g, "");
      if (path) entries.push({ path, xy });
    }
    let branch = "";
    try {
      branch = (await git(root, ["branch", "--show-current"])).trim();
    } catch {
      branch = "";
    }
    onStage?.("repo-done", { root, n: entries.length });
    out.push({ root, branch, entries });
  }
  return out;
}

/** Nice short form of a porcelain code for tree badges. */
export function statusBadge(xy: string): { code: string; dirty: boolean } {
  if (xy.startsWith("??")) return { code: "?", dirty: true };
  const i = xy.indexOf(" ") === 0 ? 1 : 0;
  const ch = xy.charAt(i);
  if (ch === " ") return { code: "", dirty: false };
  return { code: ch, dirty: true };
}

/** `git add` one working-tree path (relative to the repo root). */
export async function gitAdd(root: string, relPath: string): Promise<{ added: string }> {
  const clean = relPath.replace(/^[\\/]+/, "");
  if (!clean) throw new Error("empty add path");
  await git(root, ["add", "--", clean]);
  return { added: clean };
}

/** `git add` several working-tree paths at once. */
export async function gitAddMany(root: string, relPaths: string[]): Promise<{ added: number }> {
  const clean = relPaths
    .map((p) => p.replace(/^[\\/]+/, ""))
    .filter((p) => !!p);
  if (clean.length === 0) throw new Error("no paths to add");
  await git(root, ["add", "--", ...clean]);
  return { added: clean.length };
}

/** Initialize a git repository at a directory, optionally with a branch name. */
export async function gitInit(root: string, branch?: string): Promise<{ root: string; branch: string }> {
  const name = branch?.trim() || "main";
  await git(root, ["init", "-b", name]);
  return { root, branch: name };
}

/** One branch row for the branch dropdown. */
export interface GitBranchRow {
  name: string;
  remote: boolean;
  current: boolean;
}

/** List local + remote branches of a repo. */
export async function gitBranches(root: string): Promise<{ current: string; branches: GitBranchRow[] }> {
  let raw = "";
  try {
    raw = await git(root, ["for-each-ref", "--format=%(refname)%09%(HEAD)", "refs/heads", "refs/remotes"]);
  } catch {
    raw = "";
  }
  const branches: GitBranchRow[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const [ref, headMark] = line.split("\t");
    if (!ref) continue;
    const remote = ref.startsWith("refs/remotes/");
    const name = remote ? ref.slice("refs/remotes/".length) : ref.slice("refs/heads/".length);
    if (!name || name.endsWith("/HEAD")) continue;
    branches.push({ name, remote, current: !remote && headMark === "*" });
  }
  branches.sort((a, b) => {
    if (a.remote !== b.remote) return a.remote ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  let current = "";
  try {
    current = (await git(root, ["branch", "--show-current"])).trim();
  } catch {
    current = "";
  }
  return { current, branches };
}

/** One pending (unpushed / ahead) commit for the push dialog. */
export interface PendingCommit {
  hash: string;
  short: string;
  author: string;
  ts: number;
  subject: string;
}

/** Commits ahead of the remote (for the current branch). */
export async function gitPendingCommits(root: string): Promise<{ commits: PendingCommit[]; range: string }> {
  let range = "@{upstream}..HEAD";
  try {
    await git(root, ["rev-parse", "--verify", "@{upstream}"], 8000);
  } catch {
    range = "--not";
  }
  const args = range === "--not"
    ? ["log", "--not", "--remotes", "--format=%H%x1f%an%x1f%at%x1f%s"]
    : ["log", range, "--format=%H%x1f%an%x1f%at%x1f%s"];
  const commits: PendingCommit[] = [];
  try {
    const out = await git(root, args);
    for (const line of out.split("\n")) {
      if (!line) continue;
      const [hash, author, tsRaw, subject] = line.split("\x1f");
      commits.push({ hash, short: hash.slice(0, 7), author, ts: Number(tsRaw) || 0, subject: subject ?? "" });
    }
  } catch {
    /* no commits / no repo */
  }
  return { commits, range: range === "--not" ? "未推送提交" : "upstream..HEAD" };
}

export interface CommitFileRow {
  xy: string;
  path: string;
}

/** Files + full message of one commit (for the push dialog right pane). */
export async function gitCommitFiles(root: string, hash: string): Promise<{ message: string; files: CommitFileRow[] }> {
  let out = "";
  try {
    out = await git(root, ["show", "--name-status", "--format=%B", hash]);
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : "show failed");
  }
  const nl = out.indexOf("\n");
  const message = nl >= 0 ? out.slice(0, nl) : out;
  const files: CommitFileRow[] = [];
  for (const line of out.split("\n").slice(nl >= 0 ? 1 : 0)) {
    if (!line) continue;
    if (/^\s*$/.test(line)) continue;
    const m = /^([MADRCU?!]|R\d+|C\d+)\t(.+)$/.exec(line.trim());
    if (!m) continue;
    let path = m[2];
    if (m[1].startsWith("R") || m[1].startsWith("C")) {
      const parts = path.split("\t");
      path = parts[parts.length - 1]; // target of rename/copy
    }
    files.push({ xy: m[1].charAt(0), path: path.replace(/^"|"$/g, "") });
  }
  return { message: message.trim(), files };
}

