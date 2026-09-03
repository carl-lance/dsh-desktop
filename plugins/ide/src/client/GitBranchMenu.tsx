/**
 * dsh-ide — branch management dropdown (WebStorm-style), UI layer.
 *
 * Popover shows: quick actions (更新 / 提交 / 推送) and the full branch list
 * (local + remote). Right-clicking a branch opens a context menu with
 * 对比 / 检出 / 重命名 / 删除. Backend git ops are wired in the next
 * milestone — actions currently report "backend pending".
 */

import { useEffect, useRef, useState, type ReactElement } from "react";
import { call, useIdeDoc, emitIdeBus } from "./ideApi";
import { InitGitDialog } from "./InitGitDialog";

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
    <path d="m8.5 8.5-2.5 3-2.5-3" opacity="0" />
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

const PENDING = "（后端接入中）";

export function GitBranchMenu({ onNotify }: Props): ReactElement {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [hasGit, setHasGit] = useState<boolean | null>(null); // null = probing
  const [ctx, setCtx] = useState<{ x: number; y: number; name: string; remote: boolean } | null>(null);
  const [initOpen, setInitOpen] = useState(false);
  const [initBusy, setInitBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const doc = useIdeDoc();

  async function probeGit(): Promise<void> {
    try {
      const repos = (await call("git.all")) as Array<{ branch: string }>;
      const ok = !!repos[0]?.branch;
      setHasGit(ok);
      if (ok) setCurrent(repos[0].branch);
    } catch {
      setHasGit(false);
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

  // Show only in git workspaces; probe on workspace change + background refresh.
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
    void refreshBranches();
  }, [open]);

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
      }
    };
    window.addEventListener("mousedown", close, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, ctx]);

  // Branch right-click must NOT reach the shell's global context menu: block
  // at window capture (before the document-level injected handler) and open
  // our own branch menu instead.
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
          title="当前工作区未纳入 git 管理 — 点击选择文件并初始化"
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
            onDone={(n, branchName) => {
              setHasGit(true);
              setInitOpen(false);
              setCurrent(branchName);
              onNotify(`已初始化 ${branchName} 并加入 ${n} 个文件`);
              void refreshBranches();
            }}
          />
        )}
      </>
    );
  }

  const act = (what: string, on?: string): void => {
    setOpen(false);
    setCtx(null);
    if (what === "提交") {
      emitIdeBus("open-commit");
      return;
    }
    if (what === "推送") {
      emitIdeBus("open-push");
      return;
    }
    onNotify(`${what}${on ? ` · ${on}` : ""} ${PENDING}`);
  };

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
        <span style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}>{current || "分支"}</span>
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
          {/* quick actions */}
          <div style={{ display: "flex", gap: 2, padding: "2px 2px 4px", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))", marginBottom: 4 }}>
            {(
              [
                { label: "更新", icon: PULL_ICON },
                { label: "提交", icon: COMMIT_ICON },
                { label: "推送", icon: PUSH_ICON },
              ] as const
            ).map((a) => (
              <button
                key={a.label}
                type="button"
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
                  cursor: "pointer",
                  background: "transparent",
                  color: "var(--dsw-alias-label-secondary, #61666b)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.07))")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ display: "inline-flex" }}>{a.icon}</span>
                {a.label}
              </button>
            ))}
          </div>

          {/* all branches */}
          <div style={{ overflowY: "auto", minHeight: 60 }}>
            {branches.length === 0 ? (
              <div style={{ padding: "8px 10px", color: "var(--dsw-alias-label-tertiary, #81858c)", fontSize: 12 }}>加载分支…</div>
            ) : (
              branches.map((b) => (
                <div
                  key={b.name}
                  role="menuitem"
                  title="右键：对比 / 检出 / 重命名 / 删除"
                  data-ide-branch-name={b.name}
                  data-ide-branch-remote={b.remote ? "1" : "0"}
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
          </div>
        </div>
      )}

      {/* branch context menu (right-click) */}
      {ctx && (
        <div
          data-ide-branch-ctx="1"
          style={{
            position: "fixed",
            left: Math.min(ctx.x, window.innerWidth - 190),
            top: Math.min(ctx.y, window.innerHeight - 170),
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
          </div>
          {(["对比", "检出", "重命名", "删除"] as const).map((it) => (
            <button
              key={it}
              type="button"
              onClick={() => act(it, ctx.name)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 10px",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 13,
                background: "transparent",
                color: it === "删除" ? "var(--dsw-alias-danger, #c43c2d)" : "var(--dsw-alias-label-primary, #0f1115)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.07))")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {it}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
