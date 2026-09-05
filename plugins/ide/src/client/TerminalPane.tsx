/**
 * dsh-ide — terminal pane (xterm.js + host WS/node-pty).
 *
 * Mounted inside an EditorGroup "terminal" tab. Opens a pty session via the
 * settings channel, then talks to the host's loopback WS. Reports
 * running/kill state so the tab-close flow can confirm terminating a running
 * process.
 */

import { useEffect, useRef, type ReactElement } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { call } from "./ideApi";

export interface TerminalPaneApi {
  running: boolean;
  kill: () => void;
}

export type ShellPref = "cmd" | "pwsh" | "powershell";

interface Props {
  onRegister: (api: TerminalPaneApi) => void;
  /** Shell program for this session (host resolves the path). */
  shell?: ShellPref;
}

const FONT = 'var(--ds-font-family-mono, Consolas, "SF Mono", Menlo, monospace)';

export function TerminalPane({ onRegister, shell }: Props): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    void shell;
    let disposed = false;
    let ws: WebSocket | null = null;
    let term: Terminal | null = null;
    let killedByUi = false;
    let sessionId = "";
    let lastSentDims = "";
    let resizePending: ReturnType<typeof setTimeout> | null = null;

    const report = (running: boolean): void => onRegister({ running, kill: () => {
      killedByUi = true;
      if (sessionId) void call("term.kill", { id: sessionId }).catch(() => undefined);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    } });

    // Hide the xterm viewport scrollbar entirely — a terminal scrolls with
    // the mouse wheel / Shift+PgUp+PgDn, no visible bar (wheel still works).
    if (!document.querySelector("style[data-dsh-term-noscroll]")) {
      const st = document.createElement("style");
      st.setAttribute("data-dsh-term-noscroll", "");
      st.textContent =
        ".dsh-term .xterm-viewport{scrollbar-width:none;}" +
        ".dsh-term .xterm-viewport::-webkit-scrollbar{width:0;height:0;display:none;}";
      (document.head || document.documentElement).appendChild(st);
    }
    term = new Terminal({
      fontSize: 12.5,
      fontFamily: FONT,
      lineHeight: 1.35,
      cursorBlink: true,
      convertEol: true,
      scrollback: 10000,
      theme: {
        background: "#ffffff",
        foreground: "#0f1115",
        cursor: "#0f1115",
        cursorAccent: "#ffffff",
        selectionBackground: "rgba(64,150,255,.25)",
        selectionInactiveBackground: "rgba(64,150,255,.12)",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    report(true);

    const pushResize = (): void => {
      if (!sessionId || !term) return;
      const dims = { cols: term.cols, rows: term.rows };
      const key = `${dims.cols}x${dims.rows}`;
      if (key === lastSentDims) return;
      if (resizePending) clearTimeout(resizePending);
      resizePending = setTimeout(() => {
        lastSentDims = key;
        void call("term.resize", { id: sessionId, cols: dims.cols, rows: dims.rows }).catch(() => undefined);
      }, 180);
    };

    const doFit = (): void => {
      try {
        fit.fit();
        pushResize();
      } catch {
        /* ignore */
      }
    };
    doFit();
    const ro = new ResizeObserver(() => doFit());
    ro.observe(host);

    const initialDims = term ? { cols: Math.max(20, term.cols), rows: Math.max(5, term.rows) } : { cols: 80, rows: 24 };
    lastSentDims = `${initialDims.cols}x${initialDims.rows}`;
    const openPayload = shell ? { ...initialDims, shell } : initialDims;
    void call("term.open", openPayload)
      .then((r) => {
        if (disposed) return;
        const info = r as { id: string; port: number; token: string };
        sessionId = info.id;
        ws = new WebSocket(`ws://127.0.0.1:${info.port}?token=${encodeURIComponent(info.token)}&id=${encodeURIComponent(info.id)}`);
        ws.onopen = () => {
          term?.focus();
        };
        ws.onmessage = (ev) => {
          if (!disposed && typeof ev.data === "string") term?.write(ev.data);
        };
        ws.onclose = () => {
          if (!disposed) {
            report(false);
            term?.write("\r\n\x1b[33m[会话已结束]\x1b[0m\r\n");
          }
        };
      })
      .catch((err) => {
        if (!disposed) {
          report(false);
          term?.write(`\r\n\x1b[31m[终端启动失败] ${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`);
        }
      });

    const dataSub = term.onData((d) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(d);
    });
    const resizeSub = term.onResize(() => {
      pushResize();
    });

    // Copy / paste: Ctrl/Cmd+C copies when there is a selection (otherwise
    // it falls through as SIGINT); Ctrl/Cmd+V and Shift+Insert paste.
    const sendText = (text: string): void => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(text);
    };
    const pasteFromClipboard = (): void => {
      if (navigator.clipboard?.readText) {
        void navigator.clipboard
          .readText()
          .then((t) => {
            if (t) sendText(t);
          })
          .catch(() => undefined);
      }
    };
    const keyHandler = (e: KeyboardEvent): boolean | undefined => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "c" || e.key === "C")) {
        if (term?.hasSelection()) {
          const sel = term.getSelection();
          if (sel && navigator.clipboard?.writeText) void navigator.clipboard.writeText(sel).catch(() => undefined);
          return false;
        }
        return true; // no selection → pass Ctrl+C to the process
      }
      if (mod && (e.key === "v" || e.key === "V")) {
        e.preventDefault();
        pasteFromClipboard();
        return false;
      }
      if (e.shiftKey && e.key === "Insert") {
        e.preventDefault();
        pasteFromClipboard();
        return false;
      }
      return true;
    };
    term.attachCustomKeyEventHandler(keyHandler);

    return () => {
      disposed = true;
      ro.disconnect();
      dataSub.dispose();
      resizeSub.dispose();
      if (resizePending) clearTimeout(resizePending);
      onRegister(null);
      if (sessionId && !killedByUi) void call("term.kill", { id: sessionId }).catch(() => undefined);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      term?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={hostRef}
      className="dsh-term"
      style={{ position: "absolute", inset: 0, background: "#ffffff", padding: 6, boxSizing: "border-box" }}
    />
  );
}
