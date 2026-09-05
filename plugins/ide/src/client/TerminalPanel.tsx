/**
 * dsh-ide — bottom terminal panel (VSCode-style).
 *
 * Owns its own terminal tab strip. Each tab is a live TerminalPane; all panes
 * stay mounted (hidden when inactive) so processes keep running while you
 * switch tabs. The tab row's right side carries the shell picker and the
 * “new terminal” button — the rail icon only toggles this panel's visibility.
 */

import { useEffect, useRef, useState, type ReactElement } from "react";
import { TerminalPane, type TerminalPaneApi, type ShellPref } from "./TerminalPane";
import { maskStyle } from "./overlay";

interface Props {
  visible: boolean;
  /** Workspace root — switching kills/hides the old workspace's terminals. */
  workspaceKey: string;
}

interface TermTab {
  id: string;
  title: string;
  shell: ShellPref;
}

const SHELL_LABELS: Array<{ value: ShellPref; label: string; disabled?: boolean }> = [
  { value: "cmd", label: "命令提示符" },
  { value: "pwsh", label: "PowerShell 7（暂禁用）", disabled: true },
  { value: "powershell", label: "Windows PowerShell（暂禁用）", disabled: true },
];

const SHELL_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.6" y="4" width="18.8" height="16" rx="2" />
    <path d="m7 9 3.4 3L7 15" />
    <path d="M13.4 15h3.6" />
  </svg>
);
const CHEVRON_DOWN = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

function ShellPicker({
  value,
  onChange,
  labels,
}: {
  value: ShellPref;
  onChange: (v: ShellPref) => void;
  labels: typeof SHELL_LABELS;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", close, true);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-flex", zIndex: 60 }}>
      <button
        type="button"
        title="新建终端使用的程序"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "3px 7px",
          border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12))",
          borderRadius: 6,
          cursor: "pointer",
          fontSize: 11.5,
          color: "var(--dsw-alias-label-primary, #0f1115)",
          background: open ? "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))" : "var(--dsw-alias-bg-base, #fff)",
          fontFamily: "inherit",
        }}
      >
        <span style={{ display: "inline-flex", color: "var(--dsw-alias-label-tertiary, #81858c)" }}>{SHELL_ICON}</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }}>{labels.find((l) => l.value === value)?.label ?? value}</span>
        <span style={{ display: "inline-flex", color: "var(--dsw-alias-label-tertiary, #81858c)" }}>{CHEVRON_DOWN}</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            zIndex: 80,
            minWidth: 190,
            padding: 4,
            borderRadius: 10,
            border: "1px solid var(--dsw-alias-border-inverted, rgba(0,0,0,.08))",
            background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #fff))",
            boxShadow: "0 10px 28px rgba(0,0,0,.16)",
            fontSize: 12.5,
            color: "var(--dsw-alias-label-primary, #0f1115)",
          }}
        >
          {labels.map((s) => (
            <button
              key={s.value}
              type="button"
              disabled={s.disabled}
              onClick={() => {
                onChange(s.value);
                setOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 10px",
                border: "none",
                borderRadius: 6,
                cursor: s.disabled ? "not-allowed" : "pointer",
                background: "transparent",
                fontSize: 12.5,
                color: s.disabled ? "var(--dsw-alias-label-tertiary, #b9bdc4)" : s.value === value ? "var(--dsw-alias-label-primary, #0f1115)" : "var(--dsw-alias-label-secondary, #61666b)",
              }}
              onMouseEnter={(e) => {
                if (!s.disabled) e.currentTarget.style.background = "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.07))";
              }}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {s.value === value && !s.disabled ? "✓ " : ""}
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const PLUS_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const CLOSE_ICON = (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <path d="m4 4 8 8M12 4l-8 8" />
  </svg>
);

export function TerminalPanel({ visible, workspaceKey }: Props): ReactElement {
  const [tabs, setTabs] = useState<TermTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [shellPref, setShellPref] = useState<ShellPref>("cmd");
  const [confirm, setConfirm] = useState<{ id: string; title: string } | null>(null);
  const seq = useRef(0);
  const regs = useRef<Record<string, TerminalPaneApi>>({});
  const prevWs = useRef<string | null>(null);

  // Workspace switched: tear down this workspace's terminals (host also kills
  // the old sessions) and start the new workspace's terminal set fresh.
  useEffect(() => {
    if (prevWs.current === workspaceKey) return;
    prevWs.current = workspaceKey;
    for (const id of Object.keys(regs.current)) {
      try {
        regs.current[id]?.kill();
      } catch {
        /* ignore */
      }
    }
    regs.current = {};
    setTabs([]);
    setActiveId(null);
    setConfirm(null);
    seq.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceKey]);

  function newTerminal(): void {
    seq.current += 1;
    const id = `term:${seq.current}`;
    const tab: TermTab = { id, title: `终端 ${seq.current}`, shell: shellPref };
    setTabs((ts) => [...ts, tab]);
    setActiveId(id);
  }

  function doClose(id: string): void {
    setTabs((ts) => ts.filter((t) => t.id !== id));
    setActiveId((a) => {
      if (a !== id) return a;
      const rest = tabs.filter((t) => t.id !== id);
      return rest[rest.length - 1]?.id ?? null;
    });
  }

  function requestClose(id: string): void {
    const api = regs.current[id];
    if (api && api.running) {
      const tab = tabs.find((t) => t.id === id);
      setConfirm({ id, title: tab?.title ?? "" });
      return;
    }
    doClose(id);
  }

  function confirmKill(): void {
    const id = confirm?.id ?? "";
    try {
      regs.current[id]?.kill();
    } catch {
      /* ignore */
    }
    delete regs.current[id];
    doClose(id);
    setConfirm(null);
  }

  return (
    <div
      style={{
        display: visible ? "flex" : "none",
        flexDirection: "column",
        height: "100%",
        minWidth: 0,
        background: "var(--dsw-alias-bg-base, #fff)",
      }}
    >
      {/* tab strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flex: "none",
          borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))",
          background: "var(--dsw-alias-bg-layer-1, #fafafa)",
          padding: "2px 6px",
          gap: 2,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 2, overflowX: "auto", flex: 1 }}>
          {tabs.map((t) => (
            <div
              key={t.id}
              onClick={() => setActiveId(t.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                flex: "none",
                maxWidth: 180,
                padding: "4px 6px 4px 10px",
                cursor: "pointer",
                fontSize: 12,
                borderRadius: "6px 6px 0 0",
                color: t.id === activeId ? "var(--dsw-alias-label-primary, #0f1115)" : "var(--dsw-alias-label-tertiary, #81858c)",
                background: t.id === activeId ? "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))" : "transparent",
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
              <span
                role="button"
                aria-label="关闭"
                onClick={(ev) => {
                  ev.stopPropagation();
                  requestClose(t.id);
                }}
                style={{ display: "inline-flex", cursor: "pointer", padding: 2 }}
              >
                {CLOSE_ICON}
              </span>
            </div>
          ))}
          {tabs.length === 0 && (
            <span style={{ fontSize: 12, color: "var(--dsw-alias-label-tertiary, #81858c)", padding: "4px 8px" }}>终端</span>
          )}
        </div>

        {/* shell picker + new */}
        <ShellPicker
          value={shellPref}
          onChange={(v) => {
            if (v !== "cmd") return; // ps flavours disabled for now
            setShellPref(v);
          }}
          labels={SHELL_LABELS}
        />
        <button
          type="button"
          title="新建终端"
          aria-label="新建终端"
          onClick={newTerminal}
          style={{
            flex: "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            color: "var(--dsw-alias-label-secondary, #61666b)",
            background: "transparent",
          }}
        >
          {PLUS_ICON}
        </button>
      </div>

      {/* panes */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {tabs.length === 0 ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>
            点右上 ＋ 新建终端
          </div>
        ) : (
          tabs.map((t) => (
            <div
              key={t.id}
              style={{
                position: "absolute",
                inset: 0,
                zIndex: t.id === activeId ? 2 : 1,
                visibility: t.id === activeId ? "visible" : "hidden",
                background: "#ffffff",
              }}
            >
              <TerminalPane
                shell={t.shell}
                onRegister={(api) => {
                  regs.current[t.id] = api;
                }}
              />
            </div>
          ))
        )}
      </div>

      {/* running confirm */}
      {confirm && (
        <div
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConfirm(null);
          }}
          style={maskStyle(340)}
        >
          <div
            style={{
              width: 360,
              padding: 16,
              borderRadius: 12,
              background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #fff))",
              boxShadow: "0 16px 48px rgba(0,0,0,.18)",
              color: "var(--dsw-alias-label-primary, #0f1115)",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>终端仍在运行</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.7, color: "var(--dsw-alias-label-secondary, #61666b)" }}>
              “{confirm.title}”有正在运行的进程。确定终止并关闭吗？
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button type="button" onClick={() => setConfirm(null)} style={{ padding: "5px 14px", fontSize: 12.5, cursor: "pointer", border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))", borderRadius: 8, background: "transparent", color: "var(--dsw-alias-label-primary, #0f1115)" }}>
                取消
              </button>
              <button type="button" onClick={confirmKill} style={{ padding: "5px 16px", fontSize: 12.5, cursor: "pointer", border: "1px solid var(--dsw-alias-border-danger, rgba(196,60,45,.35))", borderRadius: 8, background: "var(--dsw-specific-danger-bg, rgba(196,60,45,.12))", color: "var(--dsw-alias-danger, #c43c2d)" }}>
                终止并关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
