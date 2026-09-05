/**
 * dsh-ide — host-side git operations.
 *
 * Thin, whitelisted wrappers around git.exe. All commands run with `-C root`
 * (never shell), args arrays only. Git log output is parsed into commit rows
 * the client renders as a graph.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";

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
 * `scope`: "all" = every ref, "head" = current branch, "branch" = a named
 * revision (branch / remote-tracking ref / tag / hash) given in `branchName`.
 */
export async function gitLog(
  root: string,
  count = 120,
  scope: "all" | "head" | "branch" = "all",
  branchName = ""
): Promise<GitLogData> {
  const rev =
    scope === "all" ? ["--all"] : scope === "branch" && branchName.trim() ? [branchName.trim()] : [];
  const out = await git(root, [
    "log",
    ...rev,
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

/** Parse `git log` field-separator output into commit rows. */
function parsePending(out: string): PendingCommit[] {
  const commits: PendingCommit[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [hash = "", author = "", tsRaw = "", subject = ""] = line.split("\x1f");
    commits.push({ hash, short: hash.slice(0, 7), author, ts: Number(tsRaw) || 0, subject });
  }
  return commits;
}

/** Commits ahead of the remote (for the current branch). */
export async function gitPendingCommits(root: string): Promise<{ commits: PendingCommit[]; range: string; root: string }> {
  let range = "@{upstream}..HEAD";
  try {
    await git(root, ["rev-parse", "--verify", "@{upstream}"], 8000);
  } catch {
    range = "--not";
  }
  const args = range === "--not"
    ? ["log", "HEAD", "--not", "--remotes", "--format=%H%x1f%an%x1f%at%x1f%s"]
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
  return { commits, range: range === "--not" ? "未推送提交" : "upstream..HEAD", root };
}

/** One local branch that has unpushed commits (or is new on the remote). */
export interface PendingBranch {
  branch: string;
  /** Upstream label e.g. "origin/main", "（新分支）", or a hint. */
  upstream: string;
  current: boolean;
  /** True when the branch has no upstream and no same-name remote ref yet:
   *  pushing it would create the branch on the remote (IDEA-style). */
  newBranch: boolean;
  commits: PendingCommit[];
}

/** Unpushed branches grouped per local branch. Resolution per branch:
 *  1. configured upstream (`branch@{upstream}`) → commits ahead,
 *  2. else same-named remote-tracking ref → commits ahead,
 *  3. else if the repo has remotes → the branch is NEW on the remote (listed
 *     even with zero unique commits, IDEA-style),
 *  4. else (no remote at all) → commits not reachable from other local heads. */
export async function gitPendingBranches(root: string): Promise<{ rows: PendingBranch[]; root: string }> {
  const branches = (await git(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"], 15000))
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const current = (await git(root, ["branch", "--show-current"]).catch(() => "")).trim();
  const remotes = await gitRemotes(root);
  const remoteRefs = (await git(root, ["for-each-ref", "--format=%(refname)", "refs/remotes"], 15000).catch(() => ""))
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const rows: PendingBranch[] = [];
  for (const b of branches) {
    let upstream = "";
    try {
      upstream = (await git(root, ["rev-parse", "--abbrev-ref", `${b}@{upstream}`], 8000)).trim();
    } catch {
      upstream = "";
    }
    const short = b.includes("/") ? b.slice(b.indexOf("/") + 1) : b;
    const sameRemote = remoteRefs.find((r) => r.slice("refs/remotes/".length) === short);
    let base = "";
    if (upstream) {
      base = upstream;
    } else if (sameRemote) {
      base = sameRemote.slice("refs/".length);
    }
    let newBranch = false;
    let label = upstream || (sameRemote ? sameRemote.slice("refs/".length) : "");
    let commits: PendingCommit[] = [];
    if (base) {
      commits = parsePending(await git(root, ["log", b, "--not", base, "--format=%H%x1f%an%x1f%at%x1f%s"], 30000).catch(() => ""));
    } else if (remotes.length > 0) {
      // Never pushed: show as a branch that would be created on the remote.
      newBranch = true;
      label = `${remotes[0]}（新分支）`;
      const exclude = [...remoteRefs, ...branches.filter((o) => o !== b).map((o) => `refs/heads/${o}`)];
      commits = parsePending(await git(root, ["log", b, "--not", ...exclude, "--format=%H%x1f%an%x1f%at%x1f%s"], 30000).catch(() => ""));
    } else {
      // No remote at all: count commits not reachable from other local heads.
      label = "仓库无远程";
      const exclude = branches.filter((o) => o !== b).map((o) => `refs/heads/${o}`);
      commits = parsePending(await git(root, ["log", b, "--not", ...exclude, "--format=%H%x1f%an%x1f%at%x1f%s"], 30000).catch(() => ""));
    }
    if (commits.length === 0 && !newBranch) continue;
    rows.push({ branch: b, upstream: label, current: b === current, newBranch, commits });
  }
  rows.sort((a, b2) => (a.current === b2.current ? a.branch.localeCompare(b2.branch) : a.current ? -1 : 1));
  return { rows, root };
}

/** Push one local branch; auto `-u` when it has no upstream yet. */
export async function gitPushBranch(root: string, branchName: string): Promise<{ output: string; branch: string }> {
  const branch = branchName.trim();
  if (!branch) throw new Error("empty branch");
  const remotes = await gitRemotes(root);
  if (remotes.length === 0) {
    throw new Error("仓库未配置远程（remote），无法推送；请先点“设置远程”添加。");
  }
  let upstream = "";
  try {
    upstream = (await git(root, ["rev-parse", "--abbrev-ref", `${branch}@{upstream}`], 8000)).trim();
  } catch {
    upstream = "";
  }
  const remote = upstream ? upstream.slice(0, upstream.indexOf("/")) || remotes[0] : remotes[0];
  const args = upstream ? ["push", remote, branch] : ["push", "-u", remote, branch];
  const out = await git(root, args, 120000);
  return { output: out.trim().split("\n").slice(0, 40).join("\n"), branch };
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

/** Commit staged changes with a message (UTF-8 safe via temp file). */
export async function gitCommit(root: string, message: string): Promise<{ ok: true; hash?: string }> {
  const tmp = join(tmpdir(), `dsh-ide-commit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
  await writeFile(tmp, message + "\n", "utf8");
  try {
    await git(root, ["commit", "-F", tmp], 30000);
  } finally {
    await rm(tmp, { force: true }).catch(() => undefined);
  }
  let hash = "";
  try {
    hash = (await git(root, ["rev-parse", "--short", "HEAD"])).trim();
  } catch {
    hash = "";
  }
  return { ok: true, hash };
}

/** List remote names (`git remote`). */
export async function gitRemotes(root: string): Promise<string[]> {
  const out = await git(root, ["remote"], 8000).catch(() => "");
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Add a remote (`git remote add <name> <url>`). */
export async function gitRemoteAdd(root: string, name: string, url: string): Promise<{ name: string; url: string }> {
  const n = name.trim();
  const u = url.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(n)) throw new Error("远程名只能包含字母、数字、点、下划线、连字符");
  if (!u) throw new Error("远程地址不能为空");
  if (!/^(https?:\/\/|git@|ssh:\/\/|file:\/\/)/.test(u)) throw new Error("远程地址格式看起来不对（支持 https://…、git@host:path 等）");
  await git(root, ["remote", "add", n, u], 30000);
  return { name: n, url: u };
}

/** Pull (update) the current branch; falls back to `pull <remote> <branch>`
 *  when the branch has no upstream yet, with Chinese guidance when there is
 *  no remote at all. */
export async function gitPull(root: string): Promise<{ output: string }> {
  try {
    const out = await git(root, ["pull"], 120000);
    return { output: out.trim().split("\n").slice(0, 40).join("\n") };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/no tracking information|no upstream configured/i.test(msg)) throw err;
  }
  const remote = (await git(root, ["remote"], 8000).catch(() => "")).trim().split("\n")[0] ?? "";
  const branch = (await git(root, ["branch", "--show-current"], 8000).catch(() => "")).trim();
  if (remote && branch) {
    const out = await git(root, ["pull", remote, branch], 120000);
    return { output: out.trim().split("\n").slice(0, 40).join("\n") };
  }
  if (!remote) throw new Error("仓库未配置远程（remote），无法更新；配置远程后才能拉取。");
  throw new Error("当前不在分支上（游离 HEAD），无法更新。");
}

/** Push the current branch. When the branch has no upstream yet and a remote
 *  exists, auto-runs `git push -u <remote> <branch>` (establishes tracking),
 *  matching first-push UX. */
export async function gitPush(root: string): Promise<{ output: string }> {
  try {
    const out = await git(root, ["push"], 120000);
    return { output: out.trim().split("\n").slice(0, 40).join("\n") };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/No configured push destination|no upstream branch|does not appear to be a git repository|No such remote/i.test(msg)) {
      throw err;
    }
  }
  const remotes = await gitRemotes(root);
  if (remotes.length === 0) {
    throw new Error("仓库未配置远程（remote），无法推送；请先点“设置远程”添加。");
  }
  const branch = (await git(root, ["branch", "--show-current"], 8000).catch(() => "")).trim();
  if (!branch) throw new Error("当前不在分支上（游离 HEAD），无法推送。");
  const out = await git(root, ["push", "-u", remotes[0], branch], 120000);
  return { output: out.trim().split("\n").slice(0, 40).join("\n") };
}

/** Checkout a branch (remote names create a local tracking branch). */
export async function gitCheckout(root: string, branchName: string): Promise<{ branch: string }> {
  return switchBranch(root, branchName, false);
}

/**
 * Internal switch. `force` discards local tracked changes (`checkout -f`).
 * For a remote-tracking ref (prefix is a real remote):
 *  - if the short local branch already exists → switch to it (no re-create);
 *  - otherwise create it with `-b short --track name`.
 * Local branch names that merely contain "/" are left untouched.
 */
async function switchBranch(root: string, branchName: string, force: boolean): Promise<{ branch: string }> {
  const name = branchName.trim();
  if (!name) throw new Error("empty branch");
  const slash = name.indexOf("/");
  if (slash > 0) {
    const prefix = name.slice(0, slash);
    const short = name.slice(slash + 1);
    if (short && (await gitRemotes(root).catch(() => [])).includes(prefix)) {
      const localExists = await git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${short}`])
        .then(() => true)
        .catch(() => false);
      if (localExists) {
        await git(root, force ? ["checkout", "-f", short] : ["checkout", short], 60000);
        return { branch: short };
      }
      await git(root, force ? ["checkout", "-f", "-b", short, "--track", name] : ["checkout", "-b", short, "--track", name], 60000);
      return { branch: short };
    }
  }
  await git(root, force ? ["checkout", "-f", name] : ["checkout", name], 60000);
  return { branch: name };
}

/** 强制检出: discard local tracked changes, then switch (git checkout -f). */
export async function gitCheckoutForce(root: string, branchName: string): Promise<{ branch: string }> {
  return switchBranch(root, branchName, true);
}

/** 智能检出: stash local changes → switch → stash pop to bring them back.
 *  If the pop conflicts the stash entry is kept (recoverable in the 搁置 tab)
 *  and the conflict is reported in `note`. */
export async function gitCheckoutSmart(
  root: string,
  branchName: string
): Promise<{ branch: string; stashed: boolean; conflict: boolean; label: string; note: string }> {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  const label = `智能检出 ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  let stashed = false;
  try {
    await git(root, ["stash", "push", "-m", label], 60000);
    stashed = true;
  } catch {
    // Nothing tracked to stash (e.g. only untracked files) — switch directly.
  }
  const res = await switchBranch(root, branchName, false);
  let conflict = false;
  let note = "";
  if (stashed) {
    try {
      const out = await git(root, ["stash", "pop"], 60000);
      note = out.trim().split("\n").slice(0, 12).join("\n");
    } catch (err) {
      conflict = true;
      note = err instanceof Error ? err.message : String(err);
    }
  }
  return { branch: res.branch, stashed, conflict, label, note };
}

/** Rename a local branch (handles renaming the current branch). */
export async function gitBranchRename(root: string, from: string, to: string): Promise<{ to: string }> {
  const current = (await git(root, ["branch", "--show-current"])).trim();
  const target = to.trim();
  if (!target) throw new Error("empty name");
  if (current === from) {
    await git(root, ["branch", "-m", target]);
  } else {
    await git(root, ["branch", "-m", from, target]);
  }
  return { to: target };
}

/** Create a new local branch from an existing branch / ref (default: HEAD). */
export async function gitBranchCreate(root: string, name: string, from?: string): Promise<{ name: string; from: string }> {
  const n = name.trim();
  const base = (from ?? "").trim();
  if (!n) throw new Error("分支名不能为空");
  await git(root, ["check-ref-format", "--branch", n]).catch(() => {
    throw new Error("分支名不合法（不能含空格/控制符/.. 等）");
  });
  const args = ["branch", n];
  if (base) args.push(base);
  await git(root, args, 30000);
  return { name: n, from: base || "HEAD" };
}

/** Delete a branch (local `-d`, remote via `push origin --delete`). */
export async function gitBranchDelete(root: string, name: string, remote: boolean): Promise<{ deleted: string }> {
  if (remote && name.includes("/")) {
    const short = name.slice(name.indexOf("/") + 1);
    const remoteName = name.slice(0, name.indexOf("/"));
    await git(root, ["push", remoteName, "--delete", short], 60000);
    return { deleted: name };
  }
  try {
    await git(root, ["branch", "-d", name]);
  } catch (err) {
    throw new Error(`${err instanceof Error ? err.message : String(err)} — 若确需强制删除，请改用 -D 手动处理`);
  }
  return { deleted: name };
}

/** Ahead/behind of a branch relative to the current HEAD. */
export async function gitCompare(root: string, branchName: string): Promise<{ ahead: number; behind: number }> {
  const out = await git(root, ["rev-list", "--left-right", "--count", `HEAD...${branchName}`]);
  const m = /^\s*(\d+)\s+(\d+)/.exec(out);
  // left = behind (commits in HEAD not in branch), right = ahead
  return { ahead: m ? Number(m[2]) : 0, behind: m ? Number(m[1]) : 0 };
}

/** Commit lists for 对比: commits only in the branch (ahead of HEAD) and only
 *  in HEAD (behind), newest first. */
export async function gitCompareDetail(
  root: string,
  branchName: string
): Promise<{ branch: string; ahead: PendingCommit[]; behind: PendingCommit[] }> {
  const name = branchName.trim();
  if (!name) throw new Error("empty branch");
  let ahead: PendingCommit[] = [];
  let behind: PendingCommit[] = [];
  try {
    ahead = parsePending(await git(root, ["log", `HEAD..${name}`, "--format=%H%x1f%an%x1f%at%x1f%s"]));
  } catch {
    ahead = [];
  }
  try {
    behind = parsePending(await git(root, ["log", `${name}..HEAD`, "--format=%H%x1f%an%x1f%at%x1f%s"]));
  } catch {
    behind = [];
  }
  return { branch: name, ahead, behind };
}

/** Restore a working-tree file: `--staged` = unstage, otherwise discard edits. */
export async function gitRestore(root: string, relPath: string, staged: boolean): Promise<{ ok: true }> {
  const clean = relPath.replace(/^[\\/]+/, "").replace(/\\/g, "/");
  if (!clean) throw new Error("empty path");
  const args = staged ? ["restore", "--staged", "--", clean] : ["restore", "--", clean];
  await git(root, args);
  return { ok: true };
}

/** One 搁置 (shelved / git stash) entry for the shelf list. */
export interface GitStashEntry {
  /** Reflog selector usable in pop/drop, e.g. "stash@{0}". */
  ref: string;
  /** Full stash commit hash. */
  hash: string;
  /** Branch the stash was taken from ("" when unknown). */
  branch: string;
  /** Stash message (subject minus the "On <branch>:" prefix). */
  message: string;
}

/**
 * 搁置勾选的文件：`git stash push -m msg -- paths`. Untracked picks are
 * added first so `stash push` (no -u) removes them from the worktree too
 * without touching unrelated untracked files.
 */
export async function gitStashPush(
  root: string,
  relPaths: string[],
  message: string,
  addUntracked: boolean
): Promise<{ output: string; count: number }> {
  const clean = relPaths.map((p) => p.replace(/^[\\/]+/, "").replace(/\\/g, "/")).filter((p) => !!p);
  if (clean.length === 0 && !message.trim()) throw new Error("nothing to 搁置");
  if (clean.length > 0 && addUntracked) {
    await git(root, ["add", "--", ...clean], 60000);
  }
  const args: string[] = ["stash", "push"];
  if (message.trim()) args.push("-m", message.trim());
  if (clean.length > 0) args.push("--", ...clean);
  const out = await git(root, args, 60000);
  return { output: out.trim(), count: clean.length };
}

/** List stash entries (most recent first) with branch + message parsed. */
export async function gitStashList(root: string): Promise<GitStashEntry[]> {
  const out = await git(root, ["stash", "list", "--format=%H%x1f%gd%x1f%gs"]);
  const entries: GitStashEntry[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [hash = "", ref = "", subject = ""] = line.split("\x1f");
    if (!ref) continue;
    let branch = "";
    let message = subject;
    const m = /^On (.*?): (.*)$/.exec(subject);
    if (m) {
      branch = m[1];
      message = m[2];
    }
    entries.push({ ref, hash, branch, message });
  }
  return entries;
}

/** 恢复搁置: `git stash pop <ref>`. Conflicts keep the entry and surface text. */
export async function gitStashPop(root: string, ref: string): Promise<{ output: string }> {
  let stdout = "";
  let stderr = "";
  try {
    const res = await execFileAsync("git", ["-C", root, "stash", "pop", ref], {
      maxBuffer: MAX_BYTES,
      timeout: 60000,
      windowsHide: true,
    });
    stdout = res.stdout;
    stderr = res.stderr;
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    const detail = (err.stderr || err.message || "").toString().trim();
    throw new Error(`恢复搁置失败：${detail || "unknown error"}`);
  }
  const text = [stdout, stderr].map((s) => s.trim()).filter(Boolean).join("\n");
  return { output: text.split("\n").slice(0, 20).join("\n") };
}

/** 删除搁置 entry (`git stash drop`). */
export async function gitStashDrop(root: string, ref: string): Promise<{ output: string }> {
  const out = await git(root, ["stash", "drop", ref], 30000);
  return { output: out.trim() };
}

/** Detached checkout of an exact commit. */
export async function gitCheckoutHash(root: string, hash: string): Promise<{ hash: string }> {
  await git(root, ["checkout", hash.trim()], 60000);
  return { hash: hash.trim() };
}

/** 回滚（revert）一个在当前分支历史中的提交：生成一条反向提交。
 *  拒绝不在 HEAD 祖先链上的提交；合并提交用 `-m 1`。 */
export async function gitCommitRevert(root: string, hash: string): Promise<{ output: string; isMerge: boolean }> {
  const h = hash.trim();
  if (!h) throw new Error("empty hash");
  try {
    await git(root, ["merge-base", "--is-ancestor", h, "HEAD"], 15000);
  } catch {
    throw new Error("该提交不在当前分支历史中，无法回滚");
  }
  let isMerge = false;
  try {
    await git(root, ["rev-parse", "--verify", `${h}^2`], 8000);
    isMerge = true;
  } catch {
    isMerge = false;
  }
  const args = ["revert", "--no-edit"];
  if (isMerge) args.push("-m", "1");
  args.push(h);
  const out = await git(root, args, 120000);
  return { output: out.trim().split("\n").slice(0, 20).join("\n"), isMerge };
}

/** File-level diff between a commit and current HEAD (`git diff <hash> HEAD`,
 *  --name-status). Status is relative to 该提交 → HEAD. */
export async function gitDiffList(root: string, hash: string): Promise<{ files: Array<{ path: string; status: string }> }> {
  const h = hash.trim();
  if (!h) throw new Error("empty hash");
  const out = await git(root, ["diff", "--name-status", "--no-renames", h, "HEAD"], 30000);
  const files: Array<{ path: string; status: string }> = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const m = /^([MAD?])\s+(.+)$/.exec(line.trim());
    if (!m) continue;
    files.push({ status: m[1], path: m[2].replace(/^"|"$/g, "") });
  }
  return { files };
}

/** Unified diff of one file between a commit and current HEAD (capped). */
export async function gitDiffDetail(
  root: string,
  hash: string,
  relPath: string
): Promise<{ diff: string; truncated: boolean }> {
  const h = hash.trim();
  const clean = relPath.replace(/^[\\/]+/, "").replace(/\\/g, "/");
  if (!h || !clean) throw new Error("missing hash/path");
  const out = await git(root, ["diff", "-U3", h, "HEAD", "--", clean], 30000);
  const lines = out.split("\n");
  const MAX = 600;
  const truncated = lines.length > MAX;
  const body = truncated ? lines.slice(0, MAX).join("\n") + "\n…（差异过长已截断）" : out;
  return { diff: body, truncated };
}

/** Append a path rule to the repo's .gitignore. */
export async function gitIgnoreAdd(root: string, relPath: string, isDir: boolean): Promise<{ ok: true }> {
  const clean = relPath.replace(/^[\\/]+/, "").replace(/\\/g, "/").replace(/[\\/]+$/, "");
  if (!clean) throw new Error("empty path");
  const line = "/" + clean + (isDir ? "/" : "");
  const gi = join(root, ".gitignore");
  let current = "";
  try {
    current = await readFile(gi, "utf8");
  } catch {
    current = "";
  }
  if (current.split("\n").includes(line)) return { ok: true };
  await writeFile(gi, (current ? current.replace(/\s+$/, "") + "\n" : "") + line + "\n", "utf8");
  return { ok: true };
}

