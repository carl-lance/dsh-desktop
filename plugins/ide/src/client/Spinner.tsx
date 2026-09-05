/**
 * dsh-ide — tiny inline loading spinner (rotating arc, currentColor).
 */

import type { ReactElement } from "react";

export function Spinner({ size = 12 }: { size?: number }): ReactElement {
  return (
    <>
      <style>{`@keyframes dshIdeSpin{to{transform:rotate(360deg)}}`}</style>
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        aria-hidden="true"
        style={{ animation: "dshIdeSpin .9s linear infinite", flex: "none" }}
      >
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2.2" opacity="0.25" />
        <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    </>
  );
}
