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
import { gitLog, gitStatusAll, gitAdd, gitAddMany, gitBranches, gitPendingCommits, gitCommitFiles, gitInit } from "./git";
import { startWorkspaceWatcher, type FsEventInfo } from "./watcher";
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
          const data = await dispatch(req, () => doc().cwd ?? "", home);
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

async function dispatch(req: IdeReq, root: () => string, home: string): Promise<unknown> {
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
    case "git.pending": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      let repo = String(payload.repo ?? "") || cwd;
      if (repo !== cwd && !repo.startsWith(cwd + "\\") && !repo.startsWith(cwd + "/")) throw new Error("repo outside workspace");
      return await gitPendingCommits(repo);
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
    case "git.log": {
      const cwd = root();
      if (!cwd) throw new Error("no workspace root — call resolve first");
      return await gitLog(cwd, Number(payload.count) || 120);
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
