/**
 * dsh-ide — host half entry.
 *
 * Runs inside the DeepSeek Harness Node host. Registers the `ide` settings
 * namespace and executes client requests (serialized, one at a time):
 *
 *   resolve   { sessionId }  → resolve workspace root → project cwd/title
 *   fs.list   { path? }      → directory entries under the resolved root
 *   fs.read   { path }       → text file contents (capped, jailed)
 *
 * Every reply lands back in the namespace `resultJson` with the client's
 * `reqId`, so the webview can match it without any custom RPC.
 */

import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NS, IdeSchema } from "./schema";
import { listDir, readFileText, writeFileText, renameEntry, removeEntry, makeDir } from "./fsops";
import { resolveWorkspace } from "./workspace";
import { gitLog, gitStatusAll, gitAdd, gitAddMany, gitBranches, gitPendingBranches, gitCommitFiles, gitInit, gitCommit, gitPull, gitPush, gitPushBranch, gitCheckout, gitCheckoutForce, gitCheckoutSmart, gitBranchRename, gitBranchCreate, gitBranchDelete, gitCompareDetail, gitRestore, gitStashPush, gitStashList, gitStashPop, gitStashDrop, gitCommitRevert, gitDiffList, gitDiffDetail, gitIgnoreAdd, gitRemotes, gitRemoteAdd } from "./git";
import { startWorkspaceWatcher, type FsEventInfo } from "./watcher";
import { createTerminalManager, type TerminalManager } from "./terminal";
import type { IdeReq, IdeResult, IdeDoc } from "../shared/types";

/** Cordis plugin name used by loader diagnostics. */
export const name = "dsh-ide";

/** Services required by this plugin. */
export const inject = ["settings"];

/** One host op at a time; errors never escape the queue. */
function makeQueue(log: (m: string) => void) {
  let tail: Promise<void> = Promise.resolve();
  return (fn: () => Promise<void>): void => {
    tail = tail.then(fn).catch((e) => log(String(e)));
  };
}

export function apply(ctx: any): void {
  ctx.inject(["settings"], (settingsCtx: any) => {
    const log = (m: string): void => {
      try {
        settingsCtx.logger?.warn(`dsh-ide: ${m}`);
      } catch {
        /* no logger */
      }
    };
    const scope = settingsCtx.settings.register(settingsNamespace(NS), IdeSchema);
    const home: string = process.env.DSH_HOME ?? "";
    const doc = (): IdeDoc => (scope.get() as IdeDoc) ?? ({} as IdeDoc);
    const run = makeQueue(log);
    const terminals: TerminalManager = createTerminalManager(log);

    // Workspace watcher: (re)started whenever the resolved cwd changes.
    let stopWatch: (() => void) | null = null;
    let watchedCwd = "";
    const ensureWatcher = (cwd: string): void => {
      if (!cwd || cwd === watchedCwd) return;
      if (stopWatch) {
        stopWatch();
        stopWatch = null;
      }
      watchedCwd = cwd;
      // Terminals belong to a workspace; switching away closes theirs.
      terminals.killForWorkspace(cwd);
      let fsRev = Number((scope.get() as { fsRev?: unknown }).fsRev ?? 0);
      const events: FsEventInfo[] = [];
      const writeWatchDiag = (extra: Record<string, unknown>): void => {
        if (!home) return;
        writeFile(
          join(home, "dsh-ide-watch.json"),
          JSON.stringify({ kind: "watch", cwd, fsRev, ...extra }, null, 2),
          "utf8"
        ).catch(() => undefined);
      };
      writeWatchDiag({ started: true, at: Date.now() });
      stopWatch = startWorkspaceWatcher(cwd, (batch) => {
        fsRev += 1;
        events.push(...batch);
        if (events.length > 50) events.splice(0, events.length - 50);
        writeWatchDiag({
          at: Date.now(),
          batch: batch.slice(-10).map((e) => ({ t: e.type, p: e.path })),
        });
        settingsCtx.settings
          .update(NS, {
            fsRev,
            fsEvents: JSON.stringify(events.slice(-20).map((e) => ({ t: e.type, p: e.path }))),
          })
          .catch(() => undefined);
      });
      log(`watching ${cwd}`);
    };
    settingsCtx.effect(
      () => () => {
        if (stopWatch) {
          stopWatch();
          stopWatch = null;
        }
        terminals.dispose();
      },
      "dsh-ide: watcher teardown"
    );
    // The namespace cwd survives restarts (settings persist), so the client
    // may never re-issue `resolve` — start watching as soon as a cwd exists.
    const bootCwd = doc().cwd;
    if (bootCwd) ensureWatcher(bootCwd);

    let lastReqJson = "";

    const handleReq = (reqJson: string): void => {
      if (!reqJson || reqJson === lastReqJson) return;
      lastReqJson = reqJson;
      let req: IdeReq;
      try {
        req = JSON.parse(reqJson) as IdeReq;
      } catch {
        return;
      }
      if (!req.reqId || !req.op) return;
      run(async () => {
        const result: IdeResult = { reqId: req.reqId, ok: false };
        const extra: Partial<IdeDoc> = {};
        try {
          const data = await dispatch(req, () => doc().cwd ?? "", home, terminals);
          result.ok = true;
          result.data = data;
          if (req.op === "resolve" && data && typeof data === "object") {
            const d = data as { cwd: string; title: string; sessionId: string };
            extra.cwd = d.cwd;
            extra.title = d.title;
            extra.sessionId = d.sessionId;
            log(`root=${d.cwd}`);
            ensureWatcher(d.cwd);
          }
        } catch (e) {
          result.error = e instanceof Error ? e.message : String(e);
          log(`op ${req.op} failed: ${result.error}`);
          if (home) {
            // Failure diagnostic: lets the webview-less loop read the exact
            // error after a user reproduces a failing op (e.g. pull / 搁置).
            const slim = (v: unknown): unknown =>
              typeof v === "string" && v.length > 400 ? v.slice(0, 400) + "…(截断)" : v;
            const payload: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(req.payload ?? {})) payload[k] = slim(v);
            writeFile(
              join(home, "dsh-ide-opfail.json"),
              JSON.stringify(
                {
                  at: Date.now(),
                  op: req.op,
                  cwd: doc().cwd ?? "",
                  payload,
                  error: result.error,
                  stack: e instanceof Error ? (e.stack ?? "").split("\n").slice(0, 8).join("\n") : "",
                },
                null,
                2
              ),
              "utf8"
            ).catch(() => undefined);
          }
        }
        await settingsCtx.settings.update(NS, {
          resultJson: JSON.stringify(result),
          note: "",
          ...extra,
        });
      });
    };

    const off = scope.watch(() => handleReq(doc().reqJson ?? ""));
    settingsCtx.effect(() => off, "dsh-ide: namespace watch");
    if (!home) {
      settingsCtx.settings
        .update(NS, { note: "DSH_HOME not set — workspace resolution unavailable" })
        .catch(() => undefined);
    }
  });
}

async function dispatch(req: IdeReq, root: () => string, home: string, terminals: TerminalManager): Promise<unknown> {
  const payload = req.payload ?? {};
  switch (req.op) {
    case "resolve": {
      if (!home) throw new Error("DSH_HOME not set");
      const sessionId = String(payload.sessionId ?? "");
      const binding = await resolveWorkspace(home, sessionId);
      return { cwd: binding.cwd, title: binding.title, sessionId, home };
    }
    case "fs.list": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      const dir = payload.path ? String(payload.path) : cwd;
      return { dir, entries: await listDir(cwd, dir) };
    }
    case "fs.read": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      const path = String(payload.path ?? "");
      if (!path) throw new Error("missing path");
      return await readFileText(cwd, path);
    }
    case "fs.write": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      const path = String(payload.path ?? "");
      const text = String(payload.text ?? "");
      if (!path) throw new Error("missing path");
      return await writeFileText(cwd, path, text);
    }
    case "fs.rename": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      const from = String(payload.from ?? "");
      const to = String(payload.to ?? "");
      if (!from || !to) throw new Error("fs.rename needs from+to");
      return await renameEntry(cwd, from, to);
    }
    case "fs.rm": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      const path = String(payload.path ?? "");
      if (!path) throw new Error("fs.rm needs path");
      return await removeEntry(cwd, path);
    }
    case "fs.mkdir": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      const path = String(payload.path ?? "");
      if (!path) throw new Error("fs.mkdir needs path");
      return await makeDir(cwd, path);
    }
    case "session.diag": {
      if (!home) throw new Error("DSH_HOME not set");
      const file = join(home, "dsh-ide-session.json");
      await writeFile(file, JSON.stringify(payload, null, 2), "utf8");
      return { saved: true };
    }
    case "git.init": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      const branch = String(payload.branch ?? "main").trim() || "main";
      return await gitInit(cwd, branch);
    }
    case "git.addMany": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      const repo = String(payload.repo ?? "") || cwd;
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      const files = Array.isArray(payload.files) ? (payload.files as string[]) : [];
      const rels = files
        .filter((f) => f.startsWith(repo + "\\") || f.startsWith(repo + "/") || f === repo)
        .map((f) => f.slice(repo.length).replace(/^[\\/]+/, ""));
      return await gitAddMany(repo, rels);
    }
    case "git.add": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      const repo = String(payload.repo ?? "");
      const file = String(payload.file ?? "");
      if (!repo || !file) throw new Error("git.add needs repo+file");
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) {
        throw new Error("repo outside workspace");
      }
      if (!file.startsWith(repo + "\\") && !file.startsWith(repo + "/") && file !== repo) {
        throw new Error("file outside repo");
      }
      const rel = file.slice(repo.length).replace(/^[\\/]+/, "").replace(/[\\/]+$/, "");
      return await gitAdd(repo, rel);
    }
    case "git.branches": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      let repo = String(payload.repo ?? "");
      if (!repo) repo = cwd;
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) {
        throw new Error("repo outside workspace");
      }
      return await gitBranches(repo);
    }
    case "git.pendingBranches": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      let repo = String(payload.repo ?? "") || cwd;
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitPendingBranches(repo);
    }
    case "git.pushBranch": {
      const cwd = root();
      const repo = String(payload.repo ?? "") || cwd;
      const branch = String(payload.branch ?? "");
      if (!branch) throw new Error("git.pushBranch needs branch");
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitPushBranch(repo, branch);
    }
    case "git.commitFiles": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      let repo = String(payload.repo ?? "") || cwd;
      const hash = String(payload.hash ?? "");
      if (!hash) throw new Error("missing hash");
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitCommitFiles(repo, hash);
    }
    case "git.all": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      const t0 = Date.now();
      const writeDiag = (extra: Record<string, unknown>): void => {
        if (!home) return;
        writeFile(
          join(home, "dsh-ide-gitall.json"),
          JSON.stringify({ at: t0, cwd, elapsedMs: Date.now() - t0, ...extra }, null, 2),
          "utf8"
        ).catch(() => undefined);
      };
      try {
        writeDiag({ stage: "started" });
        const repos = await gitStatusAll(cwd, (stage, data) => {
          writeDiag({ stage, data: data as Record<string, unknown> });
        });
        writeDiag({ ok: true, repoCount: repos.length, repos: repos.map((r) => ({ root: r.root, n: r.entries.length })) });
        return repos;
      } catch (err) {
        writeDiag({ ok: false, error: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    }
    case "git.commit": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      const repo = String(payload.repo ?? "") || cwd;
      const message = String(payload.message ?? "");
      if (!message.trim()) throw new Error("commit message is empty");
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitCommit(repo, message);
    }
    case "git.pull": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      const repo = String(payload.repo ?? "") || cwd;
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitPull(repo);
    }
    case "git.push": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      const repo = String(payload.repo ?? "") || cwd;
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitPush(repo);
    }
    case "git.checkout": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      const repo = String(payload.repo ?? "") || cwd;
      const name = String(payload.name ?? "");
      if (!name) throw new Error("git.checkout needs name");
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitCheckout(repo, name);
    }
    case "git.checkoutForce": {
      const cwd = root();
      const repo = String(payload.repo ?? "") || cwd;
      const name = String(payload.name ?? "");
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitCheckoutForce(repo, name);
    }
    case "git.checkoutSmart": {
      const cwd = root();
      const repo = String(payload.repo ?? "") || cwd;
      const name = String(payload.name ?? "");
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitCheckoutSmart(repo, name);
    }
    case "git.branchRename": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      const repo = String(payload.repo ?? "") || cwd;
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitBranchRename(repo, String(payload.from ?? ""), String(payload.to ?? ""));
    }
    case "git.branchCreate": {
      const cwd = root();
      const repo = String(payload.repo ?? "") || cwd;
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitBranchCreate(repo, String(payload.name ?? ""), payload.from ? String(payload.from) : undefined);
    }
    case "git.branchDelete": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      const repo = String(payload.repo ?? "") || cwd;
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitBranchDelete(repo, String(payload.name ?? ""), payload.remote === true);
    }
    case "git.compareDetail": {
      const cwd = root();
      const repo = String(payload.repo ?? "") || cwd;
      const name = String(payload.name ?? "");
      if (!name) throw new Error("git.compareDetail needs name");
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitCompareDetail(repo, name);
    }
    case "git.restore": {
      const cwd = root();
      const repo = String(payload.repo ?? "") || cwd;
      const file = String(payload.file ?? "");
      if (!file) throw new Error("git.restore needs file");
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitRestore(repo, file.slice(repo.length), payload.staged === true);
    }
    case "git.stashPush": {
      const cwd = root();
      const repo = String(payload.repo ?? "") || cwd;
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      const files = Array.isArray(payload.files) ? (payload.files as string[]) : [];
      const rels = files
        .filter((f) => f.startsWith(repo + "\\") || f.startsWith(repo + "/") || f === repo)
        .map((f) => f.slice(repo.length).replace(/^[\\/]+/, ""));
      return await gitStashPush(repo, rels, String(payload.message ?? ""), payload.addUntracked === true);
    }
    case "git.stashList": {
      const cwd = root();
      const repo = String(payload.repo ?? "") || cwd;
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitStashList(repo);
    }
    case "git.stashPop": {
      const cwd = root();
      const repo = String(payload.repo ?? "") || cwd;
      const ref = String(payload.ref ?? "");
      if (!ref) throw new Error("git.stashPop needs ref");
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitStashPop(repo, ref);
    }
    case "git.stashDrop": {
      const cwd = root();
      const repo = String(payload.repo ?? "") || cwd;
      const ref = String(payload.ref ?? "");
      if (!ref) throw new Error("git.stashDrop needs ref");
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitStashDrop(repo, ref);
    }
    case "git.remotes": {
      const cwd = root();
      const repo = String(payload.repo ?? "") || cwd;
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitRemotes(repo);
    }
    case "git.remoteAdd": {
      const cwd = root();
      const repo = String(payload.repo ?? "") || cwd;
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitRemoteAdd(repo, String(payload.name ?? ""), String(payload.url ?? ""));
    }
    case "git.commitRevert": {
      const cwd = root();
      const repo = String(payload.repo ?? "") || cwd;
      const hash = String(payload.hash ?? "");
      if (!hash) throw new Error("git.commitRevert needs hash");
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitCommitRevert(repo, hash);
    }
    case "git.diffList": {
      const cwd = root();
      const repo = String(payload.repo ?? "") || cwd;
      const hash = String(payload.hash ?? "");
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitDiffList(repo, hash);
    }
    case "git.diffDetail": {
      const cwd = root();
      const repo = String(payload.repo ?? "") || cwd;
      const hash = String(payload.hash ?? "");
      const path = String(payload.path ?? "");
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitDiffDetail(repo, hash, path);
    }
    case "git.ignore": {
      const cwd = root();
      const repo = String(payload.repo ?? "") || cwd;
      const file = String(payload.file ?? "");
      if (!file) throw new Error("git.ignore needs file");
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitIgnoreAdd(repo, file.slice(repo.length), payload.isDir === true);
    }
    case "git.log": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      const branch = typeof payload.branch === "string" ? payload.branch.trim() : "";
      return await gitLog(cwd, Number(payload.count) || 120, branch ? "branch" : payload.scope === "head" ? "head" : "all", branch);
    }
    case "term.open": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      const cols = Number(payload.cols) > 0 ? Number(payload.cols) : undefined;
      const rows = Number(payload.rows) > 0 ? Number(payload.rows) : undefined;
      const shellPref = ["cmd", "pwsh", "powershell"].includes(String(payload.shell)) ? (String(payload.shell) as "cmd" | "pwsh" | "powershell") : undefined;
      return await terminals.open(cwd, { cols: cols ?? 80, rows: rows ?? 24 }, shellPref);
    }
    case "term.resize": {
      const id = String(payload.id ?? "");
      const cols = Number(payload.cols) || 80;
      const rows = Number(payload.rows) || 24;
      if (!id) throw new Error("term.resize needs id");
      return { ok: terminals.resize(id, cols, rows) };
    }
    case "term.kill": {
      const id = String(payload.id ?? "");
      if (!id) throw new Error("term.kill needs id");
      return { ok: terminals.kill(id) };
    }
    case "ui.diag": {
      if (!home) throw new Error("DSH_HOME not set");
      // Diagnostics from the webview (editor DOM facts) are persisted to a
      // file so they can be read back without visual access to the UI.
      const file = join(home, "dsh-ide-diag.json");
      await writeFile(file, JSON.stringify(payload, null, 2), "utf8");
      return { saved: true };
    }
    case "drag.diag": {
      if (!home) throw new Error("DSH_HOME not set");
      const file = join(home, "dsh-ide-drag.json");
      await writeFile(file, JSON.stringify(payload, null, 2), "utf8");
      return { saved: true };
    }
    default:
      throw new Error(`unknown op: ${req.op}`);
  }
}
