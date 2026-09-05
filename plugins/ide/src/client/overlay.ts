/**
 * dsh-ide — shared frosted-glass dialog scrim, matching the dsh design
 * language (translucent mask + backdrop blur). Dialogs use it as their fixed
 * backdrop; the card itself keeps the theme surface color.
 */

import type { CSSProperties } from "react";

export function maskStyle(zIndex: number): CSSProperties {
  return {
    position: "fixed",
    inset: 0,
    zIndex,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--dsw-alias-bg-mask-2, rgba(0,0,0,.16))",
    backdropFilter: "var(--dsw-mask-blur, blur(2px))",
    WebkitBackdropFilter: "var(--dsw-mask-blur, blur(2px))",
  };
}
