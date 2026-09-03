/**
 * dsh-ide — session header action: toggles the fullscreen IDE overlay.
 *
 * Registered into `conversation.session.header.actions` (list slot). The
 * entry component IS the button, like the official job-list action.
 */

import { useSyncExternalStore } from "react";
import { ideStore } from "./ideStore";

export interface IdeHeaderActionProps {
  /** Framework session kit (injected by the slot owner). */
  sessionId?: string;
  /** Bound locale function for this entry's namespace. */
  t?: (key: string) => string;
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

export function IdeHeaderAction(_props: IdeHeaderActionProps): JSX.Element {
  const isOpen = useSyncExternalStore(ideStore.subscribe, ideStore.isOpen);
  return (
    <button
      type="button"
      title="IDE"
      aria-label="IDE"
      aria-pressed={isOpen}
      onClick={() => ideStore.toggle()}
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
