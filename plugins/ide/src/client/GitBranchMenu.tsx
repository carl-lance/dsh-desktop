/**
 * dsh-ide — branch management dropdown (WebStorm-style).
 *
 * Non-git workspaces show “加入 VCS 管理” (dialog-first init). Git
 * workspaces show the current branch + quick actions (更新/提交/推送) and the
 * full local/remote branch list. Right-clicking a branch opens:
 * 对比 / 检出 / 重命名 / 删除 — all wired to real git operations.
 */

import { useEffect, useRef, useState, type ReactElement } from "react";
import { call, useIdeDoc, emitIdeBus } from "./ideApi";
import { InitGitDialog } from "./InitGitDialog";
import { CompareDialog } from "./CompareDialog";
import { CheckoutDialog } from "./CheckoutDialog";
import { Spinner } from "./Spinner";
import { maskStyle } from "./overlay";

interface Props {
  onNotify: (message: string) => void;
}

interface BranchRow {
  name: string;
  remote: boolean;
  current: boolean;
}

const BRANCH_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="6" cy="5" r="2.2" />
    <circle cx="18" cy="7" r="2.2" />
    <circle cx="6" cy="19" r="2.2" />
    <path d="M6 7.2v9.6" />
    <path d="M18 9.2a9 9 0 0 1-9 9" />
  </svg>
);
const CHEVRON_DOWN = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);
const CHECK_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const PULL_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="6" cy="6" r="2.2" />
    <circle cx="6" cy="18" r="2.2" />
    <circle cx="18" cy="18" r="2.2" />
    <path d="M6 8.2v7.6" />
    <path d="M18 15.8V10a4 4 0 0 0-4-4h-3" />
    <path d="m11 6 3-3 3 3" />
  </svg>
);
const COMMIT_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 3v6M12 15v6" />
  </svg>
);
const PUSH_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="6" cy="6" r="2.2" />
    <circle cx="6" cy="18" r="2.2" />
    <circle cx="18" cy="18" r="2.2" />
    <path d="M6 8.2v7.6" />
    <path d="M18 15.8V10a4 4 0 0 0-4-4h-3" />
    <path d="m11 6-3 3M11 6l3 3" />
  </svg>
);

const REMOTE_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
  </svg>
);

function shortOf(name: string): string {
  return name.includes("/") ? name.slice(name.indexOf("/") + 1) : name;
}

export function GitBranchMenu({ onNotify }: Props): ReactElement {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [repoRoot, setRepoRoot] = useState("");
  const [hasGit, setHasGit] = useState<boolean | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; name: string; remote: boolean; current: boolean } | null>(null);
  const [initOpen, setInitOpen] = useState(false);
  const [compareFor, setCompareFor] = useState<{ name: string; remote: boolean } | null>(null);
  const [checkoutFor, setCheckoutFor] = useState<{ name: string; remote: boolean } | null>(null);
  const [renameFor, setRenameFor] = useState<{ name: string; remote: boolean } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [delFor, setDelFor] = useState<{ name: string; remote: boolean } | null>(null);
  const [createFor, setCreateFor] = useState<{ name: string; remote: boolean } | null>(null);
  const [createName, setCreateName] = useState("");
  const [createCheckout, setCreateCheckout] = useState(true);
  const [busy, setBusy] = useState("");
  const [hasRemote, setHasRemote] = useState(true);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [remoteName, setRemoteName] = useState("origin");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const doc = useIdeDoc();

  const changed = (): void => emitIdeBus("git.changed");

  async function probeGit(): Promise<void> {
    try {
      const repos = (await call("git.all")) as Array<{ root: string; branch: string }>;
      const ok = !!repos[0]?.branch;
      setHasGit(ok);
      if (ok) {
        const root = repos[0].root;
        setCurrent(repos[0].branch);
        setRepoRoot(root);
        try {
          const remotes = (await call("git.remotes", { repo: root })) as string[];
          setHasRemote(remotes.length > 0);
        } catch {
          setHasRemote(false);
        }
      } else {
        setHasRemote(false);
      }
    } catch {
      setHasGit(false);
      setHasRemote(false);
    }
  }

  async function refreshBranches(): Promise<void> {
    try {
      const r = (await call("git.branches")) as { current: string; branches: BranchRow[] };
      setCurrent(r.current);
      setBranches(r.branches);
    } catch {
      setBranches([]);
    }
  }

  async function afterGitAction(): Promise<void> {
    changed();
    void probeGit();
    void refreshBranches();
  }

  useEffect(() => {
    if (!doc.cwd) {
      setHasGit(null);
      return;
    }
    void probeGit();
    const id = setInterval(() => void probeGit(), 6000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.cwd]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    void refreshBranches();
  }, [open]);

  // Outside-click / Escape close.
  useEffect(() => {
    if (!open && !ctx) return;
    const close = (e: MouseEvent): void => {
      const t = e.target as Node | null;
      if (rootRef.current && rootRef.current.contains(t)) {
        if ((e.target as Element)?.closest?.("[data-ide-branch-ctx]")) return;
        if ((e.target as Element)?.closest?.("[data-ide-branch-name]")) return;
        return;
      }
      setOpen(false);
      setCtx(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setCtx(null);
        setOpen(false);
        setRenameFor(null);
        setDelFor(null);
      }
    };
    window.addEventListener("mousedown", close, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, ctx]);

  // Branch right-click must not reach the shell menu.
  useEffect(() => {
    if (!open) return;
    const onContext = (e: MouseEvent): void => {
      const t = e.target as Element | null;
      if (!t || !rootRef.current || !rootRef.current.contains(t)) return;
      e.preventDefault();
      e.stopPropagation();
      const row = t.closest("[data-ide-branch-name]") as HTMLElement | null;
      if (row) {
        setCtx({
          x: e.clientX,
          y: e.clientY,
          name: row.getAttribute("data-ide-branch-name") ?? "",
          remote: row.getAttribute("data-ide-branch-remote") === "1",
          current: row.getAttribute("data-ide-branch-current") === "1",
        });
      }
    };
    window.addEventListener("contextmenu", onContext, true);
    return () => window.removeEventListener("contextmenu", onContext, true);
  }, [open]);

  if (hasGit === null) return <span style={{ display: "inline-flex", width: 60 }} />;

  if (!hasGit) {
    return (
      <>
        <button
          type="button"
          title="当前工作区未纳入 git 管理"
          onClick={() => setInitOpen(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 8px",
            border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))",
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 12,
            color: "var(--dsw-alias-label-primary, #0f1115)",
            background: "var(--dsw-alias-bg-layer-1, #fafafa)",
            fontFamily: "inherit",
            whiteSpace: "nowrap",
          }}
        >
          加入 VCS 管理
        </button>
        {initOpen && doc.cwd && (
          <InitGitDialog
            root={doc.cwd}
            onClose={() => setInitOpen(false)}
            onNotify={onNotify}
            onDone={(n, b) => {
              setHasGit(true);
              setInitOpen(false);
              setCurrent(b);
              onNotify(`已初始化 ${b} 并加入 ${n} 个文件`);
              void refreshBranches();
              void probeGit();
            }}
          />
        )}
      </>
    );
  }

  const act = (what: string): void => {
    setCtx(null);
    if (what === "设置远程") {
      setOpen(false);
      setRemoteOpen(true);
      return;
    }
    if (what === "提交") {
      setOpen(false);
      emitIdeBus("open-commit");
      return;
    }
    if (what === "推送") {
      setOpen(false);
      emitIdeBus("open-push");
      return;
    }
    if (what === "更新") {
      setBusy("更新");
      call("git.pull", { repo: repoRoot })
        .then((r) => {
          const out = (r as { output?: string }).output;
          onNotify(out ? `更新完成\n${out}` : "更新完成");
        })
        .catch((err) => onNotify(err instanceof Error ? err.message : String(err)))
        .finally(() => {
          setBusy("");
          void afterGitAction();
        });
    }
  };

  const branchCtxAction = (kind: "对比" | "检出" | "重命名" | "删除"): void => {
    const n = ctx?.name ?? "";
    const remote = ctx?.remote ?? false;
    setOpen(false);
    setCtx(null);
    if (!n) return;
    if (kind === "重命名") {
      setRenameFor({ name: n, remote });
      setRenameValue(shortOf(n));
      return;
    }
    if (kind === "删除") {
      setDelFor({ name: n, remote });
      return;
    }
    if (kind === "对比") {
      setCompareFor({ name: n, remote });
      return;
    }
    if (kind === "检出") {
      setCheckoutFor({ name: n, remote });
      return;
    }
  };

  const doRename = async (): Promise<void> => {
    if (!renameFor) return;
    const to = renameValue.trim();
    if (!to) return;
    setBusy("重命名");
    try {
      await call("git.branchRename", { repo: repoRoot, from: renameFor.name, to });
      onNotify(`分支已重命名为 ${to}`);
      setRenameFor(null);
      void afterGitAction();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };

  const doDelete = async (): Promise<void> => {
    if (!delFor) return;
    setBusy("删除");
    try {
      await call("git.branchDelete", { repo: repoRoot, name: delFor.name, remote: delFor.remote });
      onNotify(`已删除分支 ${delFor.name}`);
      setDelFor(null);
      void afterGitAction();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };

  const doAddRemote = async (): Promise<void> => {
    if (!repoRoot) return;
    setBusy("设置远程");
    try {
      await call("git.remoteAdd", { repo: repoRoot, name: remoteName, url: remoteUrl });
      onNotify(`已添加远程 ${remoteName.trim()}。现在可以更新/推送，首次推送会自动建立上游（push -u）`);
      setRemoteOpen(false);
      setRemoteName("origin");
      setRemoteUrl("");
      void afterGitAction();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };

  const doCreateBranch = async (): Promise<void> => {
    if (!createFor) return;
    const n = createName.trim();
    if (!n) return;
    setBusy("新建分支");
    try {
      await call("git.branchCreate", { repo: repoRoot, name: n, from: createFor.name });
      if (createCheckout) {
        await call("git.checkout", { repo: repoRoot, name: n });
        onNotify(`已创建并检出分支 ${n}（基于 ${createFor.name}）`);
      } else {
        onNotify(`已创建分支 ${n}（基于 ${createFor.name}）`);
      }
      setCreateFor(null);
      void afterGitAction();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };

  const quickRow: Array<{ label: string; icon: ReactElement }> = hasRemote
    ? [
        { label: "更新", icon: PULL_ICON },
        { label: "提交", icon: COMMIT_ICON },
        { label: "推送", icon: PUSH_ICON },
      ]
    : [
        { label: "设置远程", icon: REMOTE_ICON },
        { label: "提交", icon: COMMIT_ICON },
      ];

  const q = query.trim().toLowerCase();
  const filteredBranches = q
    ? branches.filter((b) => b.name.toLowerCase().includes(q) || shortOf(b.name).toLowerCase().includes(q))
    : branches;

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-flex", zIndex: 120 }}>
      <button
        type="button"
        title="分支管理"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))",
          borderRadius: 8,
          cursor: "pointer",
          fontSize: 12,
          color: "var(--dsw-alias-label-primary, #0f1115)",
          background: open ? "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))" : "var(--dsw-alias-bg-layer-1, #fafafa)",
          fontFamily: "inherit",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ display: "inline-flex", color: "var(--dsw-alias-label-tertiary, #81858c)" }}>{BRANCH_ICON}</span>
        <span style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", display: "inline-flex", alignItems: "center", gap: 5 }}>
          {busy ? (
            <>
              <Spinner size={11} />
              {busy}…
            </>
          ) : (
            current || "分支"
          )}
        </span>
        <span style={{ display: "inline-flex", color: "var(--dsw-alias-label-tertiary, #81858c)" }}>{CHEVRON_DOWN}</span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 200,
            boxSizing: "border-box",
            width: 250,
            padding: 4,
            borderRadius: 10,
            border: "1px solid var(--dsw-alias-border-inverted, rgba(0,0,0,.08))",
            background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #fff))",
            boxShadow: "0 10px 28px rgba(0,0,0,.16)",
            fontSize: 13,
            color: "var(--dsw-alias-label-primary, #0f1115)",
            display: "flex",
            flexDirection: "column",
            maxHeight: 380,
          }}
        >
          <div style={{ display: "flex", gap: 2, padding: "2px 2px 4px", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))", marginBottom: 4 }}>
            {quickRow.map((a) => {
              const isBusy = busy === a.label;
              return (
                <button
                  key={a.label}
                  type="button"
                  disabled={busy !== "" && !isBusy}
                  onClick={() => act(a.label)}
                  style={{
                    flex: 1,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 5,
                    padding: "4px 0",
                    fontSize: 12,
                    border: "none",
                    borderRadius: 6,
                    cursor: busy !== "" && !isBusy ? "not-allowed" : "pointer",
                    opacity: busy !== "" && !isBusy ? 0.55 : 1,
                    background: "transparent",
                    color: "var(--dsw-alias-label-secondary, #61666b)",
                  }}
                  onMouseEnter={(e) => {
                    if (busy === "") e.currentTarget.style.background = "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.07))";
                  }}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ display: "inline-flex" }}>{isBusy ? <Spinner size={12} /> : a.icon}</span>
                  {a.label}
                </button>
              );
            })}
          </div>

          <div style={{ overflowY: "auto", minHeight: 60 }}>
            {branches.length === 0 ? (
              <div style={{ padding: "8px 10px", color: "var(--dsw-alias-label-tertiary, #81858c)", fontSize: 12 }}>加载分支…</div>
            ) : (
              <>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`搜索分支…（${branches.length}）`}
                  aria-label="按名称搜索分支"
                  style={{
                    boxSizing: "border-box",
                    width: "calc(100% - 12px)",
                    margin: "0 6px 4px",
                    padding: "4px 8px",
                    fontSize: 12,
                    borderRadius: 6,
                    border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))",
                    background: "var(--dsw-alias-bg-base, #fff)",
                    color: "var(--dsw-alias-label-primary, #0f1115)",
                  }}
                />
                {filteredBranches.length === 0 ? (
                  <div style={{ padding: "8px 10px", color: "var(--dsw-alias-label-tertiary, #81858c)", fontSize: 12 }}>没有匹配的分支</div>
                ) : (
                  filteredBranches.map((b) => (
                <div
                  key={b.name}
                  role="menuitem"
                  title="右键：对比 / 检出 / 重命名 / 删除"
                  data-ide-branch-name={b.name}
                  data-ide-branch-remote={b.remote ? "1" : "0"}
                  data-ide-branch-current={b.current ? "1" : "0"}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 8px",
                    borderRadius: 6,
                    cursor: "context-menu",
                    color: "var(--dsw-alias-label-primary, #0f1115)",
                    background: b.current ? "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))" : "transparent",
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.07))")}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = b.current ? "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))" : "transparent";
                  }}
                >
                  <span style={{ display: "inline-flex", flex: "none", width: 14, justifyContent: "center", color: b.current ? "var(--dsw-alias-label-primary, #0f1115)" : "transparent" }}>
                    {b.current ? CHECK_ICON : ""}
                  </span>
                  <span style={{ display: "inline-flex", flex: "none", color: "var(--dsw-alias-label-tertiary, #81858c)" }}>{BRANCH_ICON}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{b.name}</span>
                  {b.remote && <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--dsw-alias-label-tertiary, #81858c)", flex: "none" }}>远程</span>}
                </div>
                  ))
                )}
              </>
            )}
          </div>
        </div>
      )}

      {ctx && (
        <div
          data-ide-branch-ctx="1"
          style={{
            position: "fixed",
            left: Math.min(ctx.x, window.innerWidth - 190),
            top: Math.min(ctx.y, window.innerHeight - 200),
            zIndex: 400,
            minWidth: 168,
            padding: 4,
            borderRadius: 10,
            border: "1px solid var(--dsw-alias-border-inverted, rgba(0,0,0,.08))",
            background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #fff))",
            boxShadow: "0 10px 28px rgba(0,0,0,.16)",
            fontSize: 13,
            color: "var(--dsw-alias-label-primary, #0f1115)",
          }}
        >
          <div style={{ padding: "4px 10px 6px", fontSize: 11, color: "var(--dsw-alias-label-tertiary, #81858c)", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {ctx.remote ? "远程分支" : "分支"} · {ctx.name}
            {ctx.current ? "（当前）" : ""}
          </div>
          {(
            [
              { label: "对比", fn: () => branchCtxAction("对比"), disabled: ctx.current },
              { label: "检出", fn: () => branchCtxAction("检出"), disabled: false },
              {
                label: "新建分支（基于此）",
                fn: () => {
                  setCreateFor({ name: ctx.name, remote: ctx.remote });
                  setCreateName("");
                  setCreateCheckout(true);
                },
                disabled: false,
              },
              { label: "重命名", fn: () => branchCtxAction("重命名"), disabled: false },
              { label: "删除", fn: () => branchCtxAction("删除"), danger: true, disabled: false },
            ]
          ).map((it) => (
            <button
              key={it.label}
              type="button"
              disabled={it.disabled}
              title={it.disabled ? "当前分支，无需对比" : undefined}
              onClick={it.fn}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 10px",
                border: "none",
                borderRadius: 6,
                cursor: it.disabled ? "not-allowed" : "pointer",
                fontSize: 13,
                opacity: it.disabled ? 0.45 : 1,
                background: "transparent",
                color: it.danger ? "var(--dsw-alias-danger, #c43c2d)" : "var(--dsw-alias-label-primary, #0f1115)",
              }}
              onMouseEnter={(e) => {
                if (!it.disabled) e.currentTarget.style.background = "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.07))";
              }}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}

      {/* rename dialog */}
      {renameFor && (
        <div
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRenameFor(null);
          }}
          style={maskStyle(420)}
        >
          <div style={{ width: 340, padding: 16, borderRadius: 12, background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #fff))", boxShadow: "0 16px 48px rgba(0,0,0,.18)", color: "var(--dsw-alias-label-primary, #0f1115)" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
              {renameFor.remote ? "远程分支不支持重命名" : `重命名分支 ${renameFor.name}`}
            </div>
            {renameFor.remote ? (
              <div style={{ fontSize: 12.5, color: "var(--dsw-alias-label-secondary, #61666b)", margin: "8px 0" }}>
                远程分支需先检出为本地再重命名。
              </div>
            ) : (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void doRename();
                  if (e.key === "Escape") setRenameFor(null);
                }}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  margin: "10px 0 4px",
                  padding: "6px 8px",
                  fontSize: 12.5,
                  borderRadius: 8,
                  border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14))",
                  background: "var(--dsw-alias-bg-base, #fff)",
                  color: "var(--dsw-alias-label-primary, #0f1115)",
                }}
              />
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button type="button" onClick={() => setRenameFor(null)} style={{ padding: "5px 14px", fontSize: 12.5, cursor: "pointer", border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))", borderRadius: 8, background: "transparent", color: "var(--dsw-alias-label-primary, #0f1115)" }}>
                取消
              </button>
              {!renameFor.remote && (
                <button type="button" onClick={() => void doRename()} disabled={busy === "重命名"} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 16px", fontSize: 12.5, cursor: busy === "重命名" ? "not-allowed" : "pointer", border: "none", borderRadius: 8, background: "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.1))", color: "var(--dsw-alias-label-primary, #0f1115)", opacity: busy === "重命名" ? 0.6 : 1 }}>
                  {busy === "重命名" ? <Spinner size={12} /> : null}
                  重命名
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* delete dialog */}
      {delFor && (
        <div
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDelFor(null);
          }}
          style={maskStyle(420)}
        >
          <div style={{ width: 360, padding: 16, borderRadius: 12, background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #fff))", boxShadow: "0 16px 48px rgba(0,0,0,.18)", color: "var(--dsw-alias-label-primary, #0f1115)" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>删除分支</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.7, color: "var(--dsw-alias-label-secondary, #61666b)", wordBreak: "break-all" }}>
              确定删除{delFor.remote ? "远程分支" : "本地分支"}「{delFor.name}」？{delFor.remote ? "" : "（仅已合并的分支可删，未合并需在命令行强制）"}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button type="button" onClick={() => setDelFor(null)} style={{ padding: "5px 14px", fontSize: 12.5, cursor: "pointer", border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))", borderRadius: 8, background: "transparent", color: "var(--dsw-alias-label-primary, #0f1115)" }}>
                取消
              </button>
              <button
                type="button"
                onClick={() => void doDelete()}
                disabled={busy === "删除"}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 16px", fontSize: 12.5, cursor: busy === "删除" ? "not-allowed" : "pointer", border: "1px solid var(--dsw-alias-border-danger, rgba(196,60,45,.35))", borderRadius: 8, background: "var(--dsw-specific-danger-bg, rgba(196,60,45,.12))", color: "var(--dsw-alias-danger, #c43c2d)", opacity: busy === "删除" ? 0.6 : 1 }}
              >
                {busy === "删除" ? <Spinner size={12} /> : null}
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* add-remote dialog */}
      {remoteOpen && repoRoot && (
        <div
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRemoteOpen(false);
          }}
          style={maskStyle(440)}
        >
          <div style={{ width: 420, maxWidth: "92vw", padding: 16, borderRadius: 12, background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #fff))", boxShadow: "0 16px 48px rgba(0,0,0,.18)", color: "var(--dsw-alias-label-primary, #0f1115)" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>设置远程</div>
            <div style={{ fontSize: 12, lineHeight: 1.7, color: "var(--dsw-alias-label-secondary, #61666b)", marginBottom: 12 }}>
              仓库还没有远程（remote），添加后即可 更新 / 推送。首次推送会自动执行 push -u 建立上游跟踪。
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input
                value={remoteName}
                onChange={(e) => setRemoteName(e.target.value)}
                placeholder="origin"
                aria-label="远程名"
                style={{ width: 100, boxSizing: "border-box", padding: "6px 8px", fontSize: 12.5, borderRadius: 8, border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14))", background: "var(--dsw-alias-bg-base, #fff)", color: "var(--dsw-alias-label-primary, #0f1115)" }}
              />
              <input
                autoFocus
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void doAddRemote();
                  if (e.key === "Escape") setRemoteOpen(false);
                }}
                placeholder="https://github.com/user/repo.git"
                aria-label="远程地址"
                style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "6px 8px", fontSize: 12.5, borderRadius: 8, border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14))", background: "var(--dsw-alias-bg-base, #fff)", color: "var(--dsw-alias-label-primary, #0f1115)" }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={() => setRemoteOpen(false)} style={{ padding: "5px 14px", fontSize: 12.5, cursor: "pointer", border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))", borderRadius: 8, background: "transparent", color: "var(--dsw-alias-label-primary, #0f1115)" }}>
                取消
              </button>
              <button
                type="button"
                onClick={() => void doAddRemote()}
                disabled={!remoteUrl.trim() || busy === "设置远程"}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 16px", fontSize: 12.5, cursor: !remoteUrl.trim() || busy === "设置远程" ? "not-allowed" : "pointer", border: "none", borderRadius: 8, background: "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.1))", color: "var(--dsw-alias-label-primary, #0f1115)", opacity: !remoteUrl.trim() || busy === "设置远程" ? 0.55 : 1 }}
              >
                {busy === "设置远程" ? <Spinner size={12} /> : null}
                {busy === "设置远程" ? "添加中…" : "添加远程"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* create-branch dialog */}
      {createFor && repoRoot && (
        <div
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCreateFor(null);
          }}
          style={maskStyle(420)}
        >
          <div style={{ width: 400, maxWidth: "92vw", padding: 16, borderRadius: 12, background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #fff))", boxShadow: "0 16px 48px rgba(0,0,0,.18)", color: "var(--dsw-alias-label-primary, #0f1115)" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>新建分支</div>
            <div style={{ fontSize: 12, lineHeight: 1.7, color: "var(--dsw-alias-label-secondary, #61666b)", marginBottom: 12, wordBreak: "break-all" }}>
              基于 <b>{createFor.name}</b>
              {createFor.remote ? "（远程引用，不会自动跟踪；检出后可用 push -u 建立）" : ""} 创建本地分支。
            </div>
            <input
              autoFocus
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void doCreateBranch();
                if (e.key === "Escape") setCreateFor(null);
              }}
              placeholder="新分支名（如 feat/xxx）"
              aria-label="新分支名"
              style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: 12.5, borderRadius: 8, border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14))", background: "var(--dsw-alias-bg-base, #fff)", color: "var(--dsw-alias-label-primary, #0f1115)" }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 12.5, cursor: "pointer", color: "var(--dsw-alias-label-secondary, #61666b)" }}>
              <input type="checkbox" checked={createCheckout} onChange={(e) => setCreateCheckout(e.target.checked)} style={{ margin: 0 }} />
              创建后立即检出
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button type="button" onClick={() => setCreateFor(null)} style={{ padding: "5px 14px", fontSize: 12.5, cursor: "pointer", border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))", borderRadius: 8, background: "transparent", color: "var(--dsw-alias-label-primary, #0f1115)" }}>
                取消
              </button>
              <button
                type="button"
                disabled={!createName.trim() || busy === "新建分支"}
                onClick={() => void doCreateBranch()}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 16px", fontSize: 12.5, cursor: !createName.trim() || busy === "新建分支" ? "not-allowed" : "pointer", border: "none", borderRadius: 8, background: "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.1))", color: "var(--dsw-alias-label-primary, #0f1115)", opacity: !createName.trim() || busy === "新建分支" ? 0.55 : 1 }}
              >
                {busy === "新建分支" ? <Spinner size={12} /> : null}
                {busy === "新建分支" ? "创建中…" : "创建"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* compare dialog */}
      {compareFor && repoRoot && (
        <CompareDialog
          repoRoot={repoRoot}
          name={compareFor.name}
          current={current}
          remote={compareFor.remote}
          onClose={() => setCompareFor(null)}
          onNotify={onNotify}
          onCheckout={(n, remote) => {
            setCompareFor(null);
            setCheckoutFor({ name: n, remote });
          }}
        />
      )}

      {/* checkout confirm dialog */}
      {checkoutFor && repoRoot && (
        <CheckoutDialog
          repoRoot={repoRoot}
          name={checkoutFor.name}
          remote={checkoutFor.remote}
          onClose={() => setCheckoutFor(null)}
          onNotify={onNotify}
          onDone={() => {
            setCheckoutFor(null);
            void afterGitAction();
          }}
        />
      )}
    </div>
  );
}
