/**
 * dsh-ide — IDE floating panel, docked right of the sidebar.
 *
 * Registered into `shell.overlay` (frame-wide floating layer). Renders
 * nothing while closed; when open it fills the frame from the right edge of
 * the sidebar onward (center + details columns, including the composer), so
 * the sidebar keeps working and the panel follows sidebar collapse/expand/
 * resize live (ResizeObserver on the frame's grid columns).
 *
 * The overlay layer is click-through by default; this entry opts back into
 * pointer events via `pointerEvents: "auto"` on its root. The chrome bar
 * shows the resolved workspace title; the body is the workbench.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ideStore } from "./ideStore";
import { useIdeDoc, onIdeBus } from "./ideApi";
import { Workbench } from "./Workbench";
import { GitBranchMenu } from "./GitBranchMenu";
import { CommitDialog } from "./CommitDialog";
import { PushDialog } from "./PushDialog";

export interface IdeOverlayProps {
  [key: string]: unknown;
}

const CLOSE_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <path d="m4 4 8 8M12 4l-8 8" />
  </svg>
);

export function IdeOverlay(_props: IdeOverlayProps): JSX.Element | null {
  const isOpen = useSyncExternalStore(ideStore.subscribe, ideStore.isOpen);
  const doc = useIdeDoc();
  const [left, setLeft] = useState(0);
  const rootInnerRef = useRef<HTMLDivElement | null>(null);
  const [note, setNote] = useState("");
  const [commitOpen, setCommitOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);

  useEffect(() => onIdeBus("open-commit", () => setCommitOpen(true)), []);
  useEffect(() => onIdeBus("open-push", () => setPushOpen(true)), []);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(""), 2600);
    return () => clearTimeout(t);
  }, [note]);

  // Escape closes the panel.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") ideStore.close();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [isOpen]);

  // Track the frame's grid columns so the panel hugs the sidebar. Driven by a
  // per-frame rAF loop (reads the live animated offsetLeft), so the panel
  // tracks sidebar collapse/expand/resize with no added transition lag.
  useEffect(() => {
    if (!isOpen) return;
    const overlay = document.querySelector("[data-shell-overlay]");
    const frame = overlay && overlay.parentElement;
    let raf = 0;
    const tick = (): void => {
      if (frame) {
        const center = frame.children[1] as HTMLElement | undefined;
        const anchor = (center || frame.firstElementChild) as HTMLElement | undefined;
        const next = anchor ? anchor.offsetLeft || 0 : 0;
        setLeft((prev) => (prev === next ? prev : next));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isOpen]);

  // When hidden, release focus so keystrokes don't land in the hidden editor.
  useEffect(() => {
    if (isOpen) return;
    const el = document.activeElement as HTMLElement | null;
    if (el && rootInnerRef.current && rootInnerRef.current.contains(el)) el.blur();
  }, [isOpen]);

  return (
    <div
      ref={rootInnerRef}
      data-ide-overlay="1"
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        right: 0,
        left,
        zIndex: 10,
        // Hidden (not unmounted) when closed so the workbench keeps all
        // state; display:none guarantees nothing paints or intercepts.
        display: isOpen ? "flex" : "none",
        flexDirection: "column",
        background: "var(--dsw-alias-bg-base, #fff)",
        color: "var(--dsw-alias-label-primary, #0f1115)",
        fontFamily: 'var(--ds-font-family-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif)',
      }}
    >
      {/* IDE chrome bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))",
          flex: "none",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: ".02em", whiteSpace: "nowrap" }}>
          {doc.title ? `IDE · ${doc.title}` : "IDE"}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "var(--dsw-alias-label-tertiary, #81858c)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={doc.cwd}
        >
          {doc.cwd}
        </span>
        <div style={{ flex: 1 }} />
        <GitBranchMenu onNotify={setNote} />
        <button
          type="button"
          title="关闭"
          aria-label="关闭 IDE"
          onClick={() => ideStore.close()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            color: "var(--dsw-alias-label-secondary, #61666b)",
            background: "transparent",
            flex: "none",
          }}
        >
          {CLOSE_ICON}
        </button>
      </div>

      {/* IDE workbench */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Workbench />
      </div>

      {/* transient toast (kept off the chrome bar so it never shifts layout) */}
      {note && (
        <div
          style={{
            position: "absolute",
            bottom: 14,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 400,
            padding: "6px 12px",
            borderRadius: 8,
            fontSize: 12,
            whiteSpace: "nowrap",
            background: "var(--dsw-specific-info-bg, rgba(30,110,220,.1))",
            color: "var(--dsw-alias-label-primary, #0f1115)",
            boxShadow: "0 4px 16px rgba(0,0,0,.12)",
            pointerEvents: "none",
          }}
        >
          {note}
        </div>
      )}

      {/* commit dialog (branch menu → 提交) */}
      {commitOpen && <CommitDialog onClose={() => setCommitOpen(false)} onNotify={setNote} />}

      {/* push dialog (branch menu → 推送) */}
      {pushOpen && <PushDialog onClose={() => setPushOpen(false)} onNotify={setNote} />}
    </div>
  );
}
