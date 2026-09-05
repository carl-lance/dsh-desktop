/**
 * dsh-ide — 推送弹窗（WebStorm 风格，按分支分组）。
 *
 * 列出仓库里所有“有未推送提交”的本地分支（组头 = 分支名 + 上游/说明 +
 * 领先数，当前分支在最前），选中任一提交可看它改动的文件树与信息；
 * 底部“推送”按钮推送当前选中的分支（首次无上游会自动 push -u）。
 */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { call, emitIdeBus } from "./ideApi";
import { ChangeTree, type ChangeLeaf } from "./ChangeTree";
import { Spinner } from "./Spinner";
import { maskStyle } from "./overlay";

interface Props {
  onClose: () => void;
  onNotify: (message: string) => void;
}

interface PendingCommit {
  hash: string;
  short: string;
  author: string;
  ts: number;
  subject: string;
}

interface PendingBranchRow {
  branch: string;
  upstream: string;
  current: boolean;
  newBranch: boolean;
  commits: PendingCommit[];
}

interface CommitDetail {
  message: string;
  files: Array<{ xy: string; path: string }>;
}

function shortDate(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function codeLetter(xy: string): string {
  if (xy.startsWith("??")) return "?";
  return xy.charAt(0) || "";
}

function repoName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).pop() ?? root;
}

export function PushDialog({ onClose, onNotify }: Props): ReactElement {
  const [rows, setRows] = useState<PendingBranchRow[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [repoRoot, setRepoRoot] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [activeBranch, setActiveBranch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function load(keepChecked?: Record<string, boolean>): Promise<void> {
    setLoading(true);
    try {
      let root = repoRoot;
      if (!root) {
        try {
          const repos = (await call("git.all")) as Array<{ root: string; branch: string }>;
          const repo = repos.find((r) => !!r.branch) ?? repos[0];
          root = repo?.root ?? "";
        } catch {
          root = "";
        }
        setRepoRoot(root);
      }
      const r = (await call("git.pendingBranches", { repo: root })) as { rows: PendingBranchRow[] };
      setRows(r.rows);
      const next: Record<string, boolean> = {};
      for (const g of r.rows) {
        // Keep prior per-branch choice when one is supplied, otherwise select all.
        next[g.branch] = keepChecked ? keepChecked[g.branch] !== false : true;
      }
      setChecked(next);
      setExpanded((prev) => {
        const s = new Set(prev);
        for (const g of r.rows) s.add(g.branch);
        return s;
      });
      const keep = keepChecked && r.rows.some((g) => g.commits.some((c) => c.hash === selected));
      const first = r.rows[0];
      if (first) {
        const sel = keep && keepChecked ? selected : first.commits[0]?.hash ?? null;
        setActiveBranch(first.branch);
        setSelected(sel);
      } else {
        setActiveBranch("");
        setSelected(null);
      }
    } catch {
      setRows([]);
      setChecked({});
      setActiveBranch("");
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetailLoading(true);
    call("git.commitFiles", { repo: repoRoot, hash: selected })
      .then((r) => {
        if (alive) {
          setDetail(r as CommitDetail);
          setDetailLoading(false);
        }
      })
      .catch(() => {
        if (alive) {
          setDetail(null);
          setDetailLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [selected, repoRoot]);

  const leaves = useMemo<ChangeLeaf[]>(() => {
    if (!detail) return [];
    return detail.files.map((f, i) => ({
      key: `${selected}_${i}`,
      code: codeLetter(f.xy),
      path: f.path.replace(/\\/g, "/").replace(/^"|"$/g, ""),
    }));
  }, [detail, selected]);

  const checkedBranches = rows.filter((g) => checked[g.branch] !== false).map((g) => g.branch);

  const doPush = async (): Promise<void> => {
    const list = checkedBranches;
    if (list.length === 0 || !repoRoot || busy === "推送") return;
    const wasChecked = { ...checked };
    setBusy("推送");
    const ok: string[] = [];
    const fail: string[] = [];
    for (const b of list) {
      try {
        const r = (await call("git.pushBranch", { repo: repoRoot, branch: b }, 120000)) as { output?: string };
        ok.push(b);
        if (r.output) ok[ok.length - 1] = `${b}：${r.output.split("\n").slice(0, 6).join("\n")}`;
      } catch (err) {
        fail.push(`${b}：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    emitIdeBus("git.changed");
    if (fail.length === 0) {
      onNotify(ok.length === 1 ? `已推送 ${ok[0]}` : `已推送 ${list.length} 个分支：${list.join(", ")}`);
    } else {
      onNotify(`完成：成功 ${ok.length}，失败 ${fail.length}\n${fail.join("\n")}`);
    }
    await load(wasChecked);
    setBusy("");
  };

  const totalCommits = rows.reduce((n, g) => n + g.commits.length, 0);

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={maskStyle(300)}
    >
      <div
        style={{
          width: 820,
          maxWidth: "94vw",
          height: 600,
          maxHeight: "86vh",
          display: "flex",
          flexDirection: "column",
          padding: 16,
          borderRadius: 14,
          background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #fff))",
          boxShadow: "0 18px 56px rgba(0,0,0,.2)",
          color: "var(--dsw-alias-label-primary, #0f1115)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flex: "none" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>推送</span>
          <span style={{ fontSize: 11, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>
            {repoRoot ? `${repoName(repoRoot)} · ` : ""}未推送分支 {rows.length} · 提交 {totalCommits}
          </span>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            style={{ marginLeft: "auto", width: 26, height: 26, border: "none", borderRadius: 6, cursor: "pointer", background: "transparent", color: "var(--dsw-alias-label-secondary, #61666b)", fontSize: 15, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 10 }}>
          {/* left: branches with unpushed commits */}
          <div style={{ width: 300, flex: "none", display: "flex", flexDirection: "column", border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "6px 10px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #81858c)", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))", flex: "none" }}>
              待推送分支（可勾选，点“推送已勾选”批量推送）
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              {loading ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: 12, fontSize: 12, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>
                  <Spinner size={12} /> 加载…
                </div>
              ) : rows.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: "var(--dsw-alias-label-secondary, #61666b)" }}>没有待推送的提交（各分支均已与远程一致）。</div>
              ) : (
                rows.map((g) => (
                  <div key={g.branch}>
                    <div style={{ display: "flex", alignItems: "center", background: activeBranch === g.branch ? "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.08))" : "transparent" }}>
                      <button
                        type="button"
                        aria-label={expanded.has(g.branch) ? "收起提交列表" : "展开提交列表"}
                        onClick={() =>
                          setExpanded((prev) => {
                            const s = new Set(prev);
                            if (s.has(g.branch)) s.delete(g.branch);
                            else s.add(g.branch);
                            return s;
                          })
                        }
                        style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--dsw-alias-label-tertiary, #81858c)", padding: "0 2px 0 6px", display: "inline-flex", flex: "none" }}
                      >
                        <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" style={{ transform: expanded.has(g.branch) ? "rotate(90deg)" : "none" }}>
                          <path d="m6 3.5 4.5 4.5L6 12.5" />
                        </svg>
                      </button>
                      <label style={{ display: "inline-flex", alignItems: "center", cursor: "pointer", flex: "none" }}>
                        <input
                          type="checkbox"
                          checked={checked[g.branch] !== false}
                          onChange={() => setChecked((m) => ({ ...m, [g.branch]: m[g.branch] === false }))}
                          style={{ margin: 0 }}
                          aria-label={`勾选推送 ${g.branch}`}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveBranch(g.branch);
                          const c0 = g.commits[0];
                          if (c0) setSelected(c0.hash);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          flex: 1,
                          minWidth: 0,
                          textAlign: "left",
                          padding: "6px 10px 6px 4px",
                          border: "none",
                          borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.05))",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          background: "transparent",
                          color: "var(--dsw-alias-label-primary, #0f1115)",
                        }}
                      >
                        <span style={{ flex: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600, fontSize: 12.5, maxWidth: 108 }}>
                          {g.branch}
                          {g.current ? "（当前）" : ""}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>
                          → {g.upstream}
                        </span>
                        <span style={{ flex: "none", fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>
                          {g.newBranch ? "新分支 · " : ""}
                          {g.commits.length} 个
                        </span>
                      </button>
                    </div>
                    {expanded.has(g.branch) && (
                      <div style={{ paddingLeft: 10, borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.05))" }}>
                      {g.commits.length === 0 ? (
                        <div style={{ padding: "3px 10px 5px 4px", fontSize: 11, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>
                          {g.newBranch ? "本地新分支：点推送会在远程创建" : "无独有提交"}
                        </div>
                      ) : (
                        g.commits.map((c) => {
                          const active = c.hash === selected;
                          return (
                            <button
                              key={c.hash}
                              type="button"
                              onClick={() => {
                                setActiveBranch(g.branch);
                                setSelected(c.hash);
                              }}
                              style={{
                                display: "block",
                                width: "100%",
                                textAlign: "left",
                                padding: "4px 10px 4px 4px",
                                border: "none",
                                cursor: "pointer",
                                fontFamily: "inherit",
                                background: active ? "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.08))" : "transparent",
                              }}
                            >
                              <div style={{ fontSize: 10.5, fontFamily: "var(--ds-font-family-mono, Consolas, monospace)", color: "var(--dsw-alias-label-tertiary, #81858c)" }}>
                                {c.short} · {shortDate(c.ts)}
                              </div>
                              <div style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--dsw-alias-label-primary, #0f1115)" }}>
                                {c.subject}
                              </div>
                            </button>
                          );
                        })
                      )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* right: changed files of the selected commit */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "6px 10px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #81858c)", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))", flex: "none" }}>
              改动文件{selected ? ` · ${selected.slice(0, 7)}` : ""}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "4px 0" }}>
              {detailLoading ? (
                <div style={{ padding: 12, fontSize: 12, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>加载文件…</div>
              ) : !detail || leaves.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: "var(--dsw-alias-label-secondary, #61666b)" }}>（无文件改动）</div>
              ) : (
                <ChangeTree leaves={leaves} />
              )}
            </div>
            <div style={{ borderTop: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))", padding: "8px 10px", flex: "none" }}>
              <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 110, overflow: "auto" }}>
                {detail?.message || "（选择左侧提交查看信息）"}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12, flex: "none" }}>
          <button type="button" onClick={onClose} style={{ padding: "6px 14px", fontSize: 12.5, cursor: "pointer", border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))", borderRadius: 8, background: "transparent", color: "var(--dsw-alias-label-primary, #0f1115)" }}>
            取消
          </button>
          <button
            type="button"
            disabled={rows.length === 0 || checkedBranches.length === 0 || busy === "推送"}
            onClick={() => void doPush()}
            title="推送所有已勾选的分支（新分支会自动 push -u 建远程）"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 16px", fontSize: 12.5, cursor: rows.length === 0 || checkedBranches.length === 0 || busy === "推送" ? "not-allowed" : "pointer", border: "none", borderRadius: 8, background: "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.1))", color: "var(--dsw-alias-label-primary, #0f1115)", opacity: rows.length === 0 || checkedBranches.length === 0 || busy === "推送" ? 0.5 : 1 }}
          >
            {busy === "推送" ? <Spinner size={12} /> : null}
            {busy === "推送" ? "推送中…" : `推送（${checkedBranches.length}）`}
          </button>
        </div>
      </div>
    </div>
  );
}
