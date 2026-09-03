/**
 * dsh-ide — session header action: toggles the fullscreen IDE overlay.
 *
 * Registered into `conversation.session.header.utilities`. On open it binds
 * the session the button belongs to (props.sessionId) and asks the host to
 * resolve the workspace root before the workbench mounts.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";
import { ideStore } from "./ideStore";
import { openForSession, call } from "./ideApi";

export interface IdeHeaderActionProps {
  /** Framework session kit (injected by the slot owner). */
  sessionId?: string;
  [key: string]: unknown;
}

/** 16px terminal/editor glyph, drawn inline (no primitive dependency). */
const IDE_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 4.5 2.5 8 5 11.5" />
    <path d="M8.5 11.5H13.5" />
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
  </svg>
);

export function IdeHeaderAction(props: IdeHeaderActionProps): JSX.Element {
  const isOpen = useSyncExternalStore(ideStore.subscribe, ideStore.isOpen);
  const sessionId = typeof props.sessionId === "string" ? props.sessionId : "";
  const prevSession = useRef<string | null>(null);

  // Probe: does the slot owner re-render us with a new sessionId when the
  // host switches conversation/workspace?
  useEffect(() => {
    const prev = prevSession.current;
    prevSession.current = sessionId;
    if (prev === null && sessionId === "") return;
    if (prev !== sessionId) {
      void call("session.diag", {
        at: Date.now(),
        prevSession: prev,
        sessionId,
        overlayOpen: ideStore.isOpen(),
      }).catch(() => undefined);
    }
  }, [sessionId]);

  return (
    <button
      type="button"
      title="IDE"
      aria-label="IDE"
      aria-pressed={isOpen}
      data-ide-header-session={sessionId}
      onClick={() => {
        if (!ideStore.isOpen()) {
          void openForSession(typeof props.sessionId === "string" ? props.sessionId : "");
        }
        ideStore.toggle();
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        border: "none",
        borderRadius: 8,
        cursor: "pointer",
        color: isOpen ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-tertiary)",
        background: isOpen ? "var(--dsw-alias-interactive-bg-hover)" : "transparent",
      }}
    >
      {IDE_ICON}
    </button>
  );
}
