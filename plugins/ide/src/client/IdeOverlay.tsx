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
 * pointer events via `pointerEvents: "auto"` on its root.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ideStore } from "./ideStore";

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
  const [left, setLeft] = useState(0);

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
        // Frame children order is sidebar, center, details (layout code is
        // stable in the pinned runtime); the center column's offsetLeft is
        // the sidebar's live width (expanded or compact rail).
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

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        right: 0,
        left,
        zIndex: 10,
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        background: "var(--dsw-alias-bg-base, #fff)",
        color: "var(--dsw-alias-label-primary, #0f1115)",
        fontFamily: 'var(--ds-font-family-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif)',
      }}
    >
      {/* IDE chrome bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "10px 14px",
          borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))",
          flex: "none",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: ".02em" }}>IDE</span>
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
          }}
        >
          {CLOSE_ICON}
        </button>
      </div>

      {/* IDE surface (Phase 0 placeholder) */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ maxWidth: 560, padding: 24, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>IDE</div>
          <div style={{ fontSize: 13, lineHeight: 20, color: "var(--dsw-alias-label-secondary, #61666b)" }}>
            Phase 0 浮层壳已就位：紧贴侧栏、随侧栏宽度自动伸缩；侧栏功能保留。
            Git、文件浏览 + Monaco、工作区终端按开发计划分阶段填充。
          </div>
        </div>
      </div>
    </div>
  );
}
