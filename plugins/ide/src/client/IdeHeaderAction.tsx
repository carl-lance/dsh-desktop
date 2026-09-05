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

/** IDE entry icon — two-tone “code window” (supplied artwork, drawn inline). */
const IDE_ICON = (
  <svg width="24" height="24" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path
      d="M880 112H144c-17.7 0-32 14.3-32 32v736c0 17.7 14.3 32 32 32h736c17.7 0 32-14.3 32-32V144c0-17.7-14.3-32-32-32z m-40 728H184V184h656v656z"
      fill="#333333"
    />
    <path
      d="M184 840h656V184H184v656z m339.5-223h185c4.1 0 7.5 3.6 7.5 8v48c0 4.4-3.4 8-7.5 8h-185c-4.1 0-7.5-3.6-7.5-8v-48c0-4.4 3.4-8 7.5-8zM308 610.3c0-2.3 1.1-4.6 2.9-6.1L420.7 512l-109.8-92.2a7.63 7.63 0 0 1-2.9-6.1V351c0-6.8 7.9-10.5 13.1-6.1l192 160.9c3.9 3.2 3.9 9.1 0 12.3l-192 161c-5.2 4.4-13.1 0.7-13.1-6.1v-62.7z"
      fill="#E6E6E6"
    />
    <path
      d="M321.1 679.1l192-161c3.9-3.2 3.9-9.1 0-12.3l-192-160.9A7.95 7.95 0 0 0 308 351v62.7c0 2.4 1 4.6 2.9 6.1L420.7 512l-109.8 92.2a8.1 8.1 0 0 0-2.9 6.1V673c0 6.8 7.9 10.5 13.1 6.1zM516 673c0 4.4 3.4 8 7.5 8h185c4.1 0 7.5-3.6 7.5-8v-48c0-4.4-3.4-8-7.5-8h-185c-4.1 0-7.5 3.6-7.5 8v48z"
      fill="#333333"
    />
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
