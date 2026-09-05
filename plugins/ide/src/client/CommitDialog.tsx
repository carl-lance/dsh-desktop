/**
 * dsh-ide — 提交 / 搁置 弹窗（WebStorm 提交窗口式）。
 *
 * 顶部页签：[更改 | 搁置]。
 *  更改页：勾选变更文件树 → 提交 / 提交并推送，或“搁置勾选”把选中改动
 *          收进搁置列表（git stash push -m，清出工作区）。
 *  搁置页：跨仓库的 stash 列表，每项可 恢复搁置（stash pop）/ 删除。
 * 底层全部走 host 的 git.stashPush / git.stashList / git.stashPop /
 * git.stashDrop，不引入 JetBrains 式 shelf 目录。
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { GitRepoStatus } from "../shared/types";
import { call, emitIdeBus } from "./ideApi";
import { ChangeTree } from "./ChangeTree";
import { Spinner } from "./Spinner";
import { maskStyle } from "./overlay";

interface Props {
  onClose: () => void;
  onNotify: (message: string) => void;
}

interface Row {
  key: string;
  repoRoot: string;
  rel: string;
  code: "A" | "M" | "D" | "?";
}

interface ShelfEntry {
  ref: string;
  hash: string;
  branch: string;
  message: string;
}

interface RepoShelf {
  repoRoot: string;
  entries: ShelfEntry[];
}

type Tab = "changes" | "shelf";

function codeFor(xy: string): "A" | "M" | "D" | "?" | "" {
  if (xy.startsWith("??")) return "?";
  if (/A/.test(xy)) return "A";
  if (/M/.test(xy)) return "M";
  if (/D/.test(xy)) return "D";
  return "";
}

function nowLabel(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `搁置 ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function repoName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).pop() ?? root;
}

function baseOf(rel: string): string {
  return rel.replace(/\//g, "\\");
}

const SHELF_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 4h16v5H4zM4 13h16v7H4zM4 11v1M20 11v1" />
  </svg>
);

export function CommitDialog({ onClose, onNotify }: Props): ReactElement {
  const [tab, setTab] = useState<Tab>("changes");
  const [statuses, setStatuses] = useState<GitRepoStatus[] | null>(null);
  const [message, setMessage] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [shelves, setShelves] = useState<RepoShelf[] | null>(null);
  const [busy, setBusy] = useState("");
  const [dropArm, setDropArm] = useState("");
  const armTimer = useRef<number | null>(null);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (!statuses) return out;
    for (const s of statuses) {
      for (const e of s.entries) {
        if (e.xy.startsWith("!!")) continue;
        const code = codeFor(e.xy);
        if (!code) continue;
        const rel = e.path.replace(/^"|"$/g, "").replace(/[\\/]+$/, "");
        if (!rel) continue;
        out.push({ key: `${s.root}\u0000${rel}`, repoRoot: s.root, rel, code });
      }
    }
    return out.sort((a, b) => a.rel.localeCompare(b.rel));
  }, [statuses]);

  const multiRepo = new Set(rows.map((r) => r.repoRoot)).size > 1;
  const allPicked = rows.length > 0 && rows.every((r) => picked[r.key] !== false);
  const count = rows.filter((r) => picked[r.key] !== false).length;
  const shelfTotal = shelves ? shelves.reduce((n, s) => n + s.entries.length, 0) : 0;

  // Load aggregated git status once on open.
  useEffect(() => {
    let alive = true;
    call("git.all")
      .then((r) => {
        if (alive) setStatuses(r as GitRepoStatus[]);
      })
      .catch(() => {
        if (alive) setStatuses([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Escape closes the whole dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Clear a pending drop confirmation when the dialog unmounts.
  useEffect(
    () => () => {
      if (armTimer.current !== null) window.clearTimeout(armTimer.current);
    },
    []
  );

  async function fetchShelves(roots: string[]): Promise<void> {
    setShelves(null);
    try {
      const lists = await Promise.all(
        roots.map(async (root) => ({
          repoRoot: root,
          entries: (await call("git.stashList", { repo: root }, 30000)) as ShelfEntry[],
        }))
      );
      setShelves(lists.filter((l) => l.entries.length > 0));
    } catch {
      setShelves([]);
    }
  }

  async function openShelf(): Promise<void> {
    setTab("shelf");
    if (shelves !== null) return;
    let roots: string[] | null = statuses ? statuses.map((s) => s.root) : null;
    if (!roots || roots.length === 0) {
      try {
        const repos = (await call("git.all")) as GitRepoStatus[];
        setStatuses(repos);
        roots = repos.map((s) => s.root);
      } catch {
        roots = [];
      }
    }
    void fetchShelves(roots);
  }

  /** Reload statuses (+ shelf list once it has been loaded once). */
  async function refreshAfterMutation(): Promise<void> {
    try {
      const repos = (await call("git.all")) as GitRepoStatus[];
      setStatuses(repos);
      if (shelves !== null) await fetchShelves(repos.map((s) => s.root));
    } catch {
      /* keep stale data on refresh failure */
    }
  }

  const toggleAll = (): void => {
    const next: Record<string, boolean> = {};
    if (!allPicked) for (const r of rows) next[r.key] = true;
    setPicked(next);
  };

  async function doCommit(push: boolean): Promise<void> {
    const msg = message.trim();
    if (!msg || count === 0) return;
    const busyKey = push ? "提交并推送" : "提交";
    setBusy(busyKey);
    try {
      const byRepo = new Map<string, string[]>();
      for (const r of rows) {
        if (picked[r.key] === false) continue;
        const abs = r.repoRoot.replace(/[\\/]+$/, "") + "\\" + baseOf(r.rel);
        const list = byRepo.get(r.repoRoot) ?? [];
        list.push(abs);
        byRepo.set(r.repoRoot, list);
      }
      const hashes: string[] = [];
      for (const [repo, files] of byRepo) {
        await call("git.addMany", { repo, files });
        const res = (await call("git.commit", { repo, message: msg })) as { hash?: string };
        if (res.hash) hashes.push(res.hash);
        if (push) {
          try {
            await call("git.push", { repo }, 120000);
          } catch (err) {
            throw new Error(`提交成功但推送失败：${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
      emitIdeBus("git.changed");
      onNotify(push ? `已提交并推送：${hashes.join(", ")}` : `已提交：${hashes.join(", ") || "完成"}`);
      onClose();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  async function doShelve(): Promise<void> {
    if (count === 0) return;
    setBusy("shelve");
    try {
      const byRepo = new Map<string, { files: string[]; untracked: boolean }>();
      for (const r of rows) {
        if (picked[r.key] === false) continue;
        const abs = r.repoRoot.replace(/[\\/]+$/, "") + "\\" + baseOf(r.rel);
        let g = byRepo.get(r.repoRoot);
        if (!g) {
          g = { files: [], untracked: false };
          byRepo.set(r.repoRoot, g);
        }
        g.files.push(abs);
        if (r.code === "?") g.untracked = true;
      }
      const label = nowLabel();
      let total = 0;
      for (const [repo, g] of byRepo) {
        const res = (await call(
          "git.stashPush",
          { repo, files: g.files, message: label, addUntracked: g.untracked },
          120000
        )) as { count?: number };
        total += res.count ?? g.files.length;
      }
      emitIdeBus("git.changed");
      onNotify(total > 0 ? `已搁置 ${total} 个文件到“搁置”页签，需要时点“恢复搁置”取回` : "没有可搁置的改动");
      await refreshAfterMutation();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  async function doRestore(repo: string, e: ShelfEntry): Promise<void> {
    const key = `pop:${repo}\u0000${e.ref}`;
    setBusy(key);
    try {
      const r = (await call("git.stashPop", { repo, ref: e.ref }, 120000)) as { output?: string };
      emitIdeBus("git.changed");
      onNotify(`已恢复搁置：${e.message || e.ref}${r.output ? `\n${r.output}` : ""}`);
      setTab("changes");
      await refreshAfterMutation();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  async function doDrop(repo: string, e: ShelfEntry): Promise<void> {
    if (dropArm !== e.ref) {
      setDropArm(e.ref);
      if (armTimer.current !== null) window.clearTimeout(armTimer.current);
      armTimer.current = window.setTimeout(() => setDropArm(""), 4000);
      return;
    }
    const key = `drop:${repo}\u0000${e.ref}`;
    setBusy(key);
    setDropArm("");
    try {
      await call("git.stashDrop", { repo, ref: e.ref }, 60000);
      onNotify(`已删除搁置：${e.message || e.ref}`);
      await refreshAfterMutation();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  const tabBtn = (t: Tab, label: string, active: boolean): ReactElement => (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => {
        if (t === "shelf") void openShelf();
        else setTab("changes");
      }}
      style={{
        padding: "4px 12px",
        fontSize: 12.5,
        border: "none",
        borderRadius: 8,
        cursor: "pointer",
        fontFamily: "inherit",
        background: active ? "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.08))" : "transparent",
        color: active ? "var(--dsw-alias-label-primary, #0f1115)" : "var(--dsw-alias-label-secondary, #61666b)",
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );

  const actionBtn = (
    text: string,
    onClick: () => void,
    opts: { disabled?: boolean; danger?: boolean; flex?: boolean; busyKey?: string } = {}
  ): ReactElement => {
    const spinning = !!opts.busyKey && busy === opts.busyKey;
    return (
      <button
        type="button"
        disabled={opts.disabled || spinning}
        onClick={onClick}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: "5px 12px",
          fontSize: 12.5,
          cursor: opts.disabled || spinning ? "not-allowed" : "pointer",
          border: "none",
          borderRadius: 8,
          fontFamily: "inherit",
          whiteSpace: "nowrap",
          opacity: opts.disabled || spinning ? 0.45 : 1,
          flex: opts.flex ? 1 : "none",
          background: opts.danger ? "rgba(209,36,47,.1)" : "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.08))",
          color: opts.danger ? "#d1242f" : "var(--dsw-alias-label-primary, #0f1115)",
        }}
      >
        {spinning ? <Spinner size={12} /> : null}
        {text}
      </button>
    );
  };

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={maskStyle(300)}
    >
      <div
        style={{
          width: 600,
          maxWidth: "94vw",
          maxHeight: "84vh",
          display: "flex",
          flexDirection: "column",
          padding: 14,
          borderRadius: 14,
          background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #fff))",
          boxShadow: "0 18px 56px rgba(0,0,0,.2)",
          color: "var(--dsw-alias-label-primary, #0f1115)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flex: "none" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>提交</span>
          <div style={{ marginLeft: 12, display: "inline-flex", gap: 2, background: "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05))", borderRadius: 9, padding: 2 }}>
            {tabBtn("changes", `更改${rows.length ? ` (${rows.length})` : ""}`, tab === "changes")}
            {tabBtn("shelf", `搁置${shelfTotal ? ` (${shelfTotal})` : ""}`, tab === "shelf")}
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            style={{
              marginLeft: "auto",
              width: 26,
              height: 26,
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              background: "transparent",
              color: "var(--dsw-alias-label-secondary, #61666b)",
              fontSize: 15,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {tab === "changes" ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0 8px", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))", flex: "none" }}>
              <button
                type="button"
                onClick={toggleAll}
                style={{ fontSize: 12, cursor: "pointer", border: "none", borderRadius: 6, padding: "3px 10px", background: "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.07))", color: "var(--dsw-alias-label-primary, #0f1115)" }}
              >
                {allPicked ? "全不选" : "全选"}
              </button>
              <span style={{ fontSize: 11, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>
                已选 {count} / {rows.length}
              </span>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: "auto", margin: "8px 0" }}>
              {!statuses ? (
                <div style={{ padding: 12, fontSize: 12.5, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>加载变更…</div>
              ) : rows.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12.5, color: "var(--dsw-alias-label-secondary, #61666b)" }}>没有待提交的变更。</div>
              ) : (
                <ChangeTree
                  checkable
                  checked={picked}
                  onToggle={(key) => setPicked((m) => ({ ...m, [key]: m[key] === false }))}
                  leaves={rows.map((r) => ({
                    key: r.key,
                    code: r.code,
                    path: `${multiRepo ? repoName(r.repoRoot) + "/" : ""}${r.rel.replace(/\\/g, "/")}`,
                  }))}
                />
              )}
            </div>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="提交说明…"
              rows={2}
              style={{
                width: "100%",
                boxSizing: "border-box",
                resize: "vertical",
                padding: "6px 8px",
                fontSize: 12.5,
                borderRadius: 8,
                border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14))",
                background: "var(--dsw-alias-bg-base, #fff)",
                color: "var(--dsw-alias-label-primary, #0f1115)",
                fontFamily: "inherit",
                flex: "none",
              }}
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10, flex: "none" }}>
              <span style={{ flex: 1, display: "flex", justifyContent: "flex-start" }}>
                {actionBtn(`搁置勾选${count ? ` (${count})` : ""}`, () => void doShelve(), { disabled: count === 0 || busy !== "", busyKey: "shelve" })}
              </span>
              {actionBtn("取消", onClose)}
              {actionBtn("提交", () => void doCommit(false), { disabled: count === 0 || !message.trim() || busy !== "", busyKey: "提交" })}
              {actionBtn("提交并推送", () => void doCommit(true), { disabled: count === 0 || !message.trim() || busy !== "", busyKey: "提交并推送" })}
            </div>
          </>
        ) : (
          <>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto", margin: "6px 0", paddingRight: 2 }}>
              {!shelves ? (
                <div style={{ padding: 12, fontSize: 12.5, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>加载搁置列表…</div>
              ) : shelfTotal === 0 ? (
                <div style={{ padding: 12, fontSize: 12.5, color: "var(--dsw-alias-label-secondary, #61666b)" }}>
                  没有搁置的更改。勾选文件后点“搁置勾选”，改动会收进这里并清出工作区；需要时点“恢复搁置”取回。
                </div>
              ) : (
                shelves.map((shelf) => (
                  <div key={shelf.repoRoot} style={{ marginBottom: 6 }}>
                    {shelves.length > 1 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", fontSize: 11, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>
                        {repoName(shelf.repoRoot)}
                      </div>
                    )}
                    {shelf.entries.map((e) => {
                      const disabled = busy !== "";
                      const armed = dropArm === e.ref;
                      const busyKey = `pop:${shelf.repoRoot}\u0000${e.ref}`;
                      const dropKey = `drop:${shelf.repoRoot}\u0000${e.ref}`;
                      return (
                        <div
                          key={e.ref}
                          title={e.hash}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "5px 6px",
                            borderRadius: 8,
                            borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.05))",
                          }}
                        >
                          <span style={{ display: "inline-flex", flex: "none", color: "var(--dsw-alias-label-tertiary, #81858c)" }}>{SHELF_ICON}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.message || "（无说明）"}</div>
                            <div style={{ fontSize: 11, color: "var(--dsw-alias-label-tertiary, #81858c)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {e.branch ? `分支 ${e.branch}` : ""}
                              {e.branch && e.ref ? " · " : ""}
                              {e.ref}
                            </div>
                          </div>
                          <span style={{ flex: "none", display: "inline-flex", gap: 6 }}>
                            {actionBtn(busy === busyKey ? "恢复中…" : "恢复搁置", () => void doRestore(shelf.repoRoot, e), { disabled })}
                            {actionBtn(armed ? "确认删除" : "删除", () => void doDrop(shelf.repoRoot, e), { disabled: disabled && !armed, danger: true })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8, flex: "none" }}>
              {actionBtn("关闭", onClose)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
