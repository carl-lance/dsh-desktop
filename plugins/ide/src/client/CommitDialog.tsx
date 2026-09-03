/**
 * dsh-ide — 提交弹窗（dsh 风格模态框）。
 *
 * Opened from the branch menu "提交". Fetches the aggregated git status and
 * shows the change file tree (checkable), a commit message area and
 * 提交 / 提交并推送 buttons. Buttons are UI-first until the git backend is
 * wired.
 */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { GitRepoStatus } from "../shared/types";
import { call } from "./ideApi";
import { ChangeTree } from "./ChangeTree";

interface Props {
  onClose: () => void;
  onNotify: (message: string) => void;
}

interface Row {
  key: string;
  repoRoot: string;
  rel: string;
  code: "A" | "M" | "?";
}

function statusColor(code: string): string {
  switch (code) {
    case "A":
      return "#2ea043";
    case "M":
      return "#1a66d8";
    default:
      return "#b3261e";
  }
}

function codeFor(xy: string): "A" | "M" | "?" | "" {
  if (xy.startsWith("??")) return "?";
  if (/A/.test(xy)) return "A";
  if (/M/.test(xy)) return "M";
  return "";
}

const sep = "\\";

export function CommitDialog({ onClose, onNotify }: Props): ReactElement {
  const [statuses, setStatuses] = useState<GitRepoStatus[] | null>(null);
  const [message, setMessage] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    call("git.all")
      .then((r) => {
        if (alive) setStatuses(r as GitRepoStatus[]);
      })
      .catch(() => {
        if (alive) setStatuses([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (!statuses) return out;
    for (const s of statuses) {
      for (const e of s.entries) {
        if (e.xy.startsWith("!!")) continue;
        const code = codeFor(e.xy);
        if (!code) continue;
        const rel = e.path.replace(/^"|"$/g, "").replace(/[\\/]+$/, "");
        if (!rel) continue;
        out.push({ key: `${s.root}\u0000${rel}`, repoRoot: s.root, rel, code });
      }
    }
    return out.sort((a, b) => a.rel.localeCompare(b.rel));
  }, [statuses]);

  const multiRepo = new Set(rows.map((r) => r.repoRoot)).size > 1;
  const allPicked = rows.length > 0 && rows.every((r) => picked[r.key] !== false);
  const count = rows.filter((r) => picked[r.key] !== false).length;

  const toggleAll = (): void => {
    const next: Record<string, boolean> = {};
    if (!allPicked) for (const r of rows) next[r.key] = true;
    setPicked(next);
  };

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        background: "rgba(0,0,0,.22)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: 560,
          maxWidth: "92vw",
          maxHeight: "82vh",
          display: "flex",
          flexDirection: "column",
          padding: 16,
          borderRadius: 14,
          background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #fff))",
          boxShadow: "0 18px 56px rgba(0,0,0,.2)",
          color: "var(--dsw-alias-label-primary, #0f1115)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flex: "none" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>提交</span>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            style={{
              marginLeft: "auto",
              width: 26,
              height: 26,
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              background: "transparent",
              color: "var(--dsw-alias-label-secondary, #61666b)",
              fontSize: 15,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0 8px", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))", flex: "none" }}>
          <button
            type="button"
            onClick={toggleAll}
            style={{ fontSize: 12, cursor: "pointer", border: "none", borderRadius: 6, padding: "3px 10px", background: "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.07))", color: "var(--dsw-alias-label-primary, #0f1115)" }}
          >
            {allPicked ? "全不选" : "全选"}
          </button>
          <span style={{ fontSize: 11, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>
            已选 {count} / {rows.length}
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: "auto", margin: "8px 0" }}>
          {!statuses ? (
            <div style={{ padding: 12, fontSize: 12.5, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>加载变更…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12.5, color: "var(--dsw-alias-label-secondary, #61666b)" }}>没有待提交的变更。</div>
          ) : (
            <ChangeTree
              checkable
              checked={picked}
              onToggle={(key) => setPicked((m) => ({ ...m, [key]: m[key] === false }))}
              leaves={rows.map((r) => ({
                key: r.key,
                code: r.code,
                path: `${multiRepo ? (r.repoRoot.split(/[\\/]/).filter(Boolean).pop() ?? "repo") + "/" : ""}${r.rel.replace(/\\/g, "/")}`,
              }))}
            />
          )}
        </div>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="提交说明…"
          rows={2}
          style={{
            width: "100%",
            boxSizing: "border-box",
            resize: "vertical",
            padding: "6px 8px",
            fontSize: 12.5,
            borderRadius: 8,
            border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14))",
            background: "var(--dsw-alias-bg-base, #fff)",
            color: "var(--dsw-alias-label-primary, #0f1115)",
            fontFamily: "inherit",
            flex: "none",
          }}
        />

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10, flex: "none" }}>
          <button type="button" onClick={onClose} style={{ padding: "6px 14px", fontSize: 12.5, cursor: "pointer", border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))", borderRadius: 8, background: "transparent", color: "var(--dsw-alias-label-primary, #0f1115)" }}>
            取消
          </button>
          <button
            type="button"
            disabled={count === 0 || !message.trim()}
            onClick={() => onNotify("提交（后端接入中）")}
            style={{ padding: "6px 14px", fontSize: 12.5, cursor: count === 0 || !message.trim() ? "not-allowed" : "pointer", border: "none", borderRadius: 8, background: "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.1))", color: "var(--dsw-alias-label-primary, #0f1115)", opacity: count === 0 || !message.trim() ? 0.5 : 1 }}
          >
            提交
          </button>
          <button
            type="button"
            disabled={count === 0 || !message.trim()}
            onClick={() => onNotify("提交并推送（后端接入中）")}
            style={{ padding: "6px 14px", fontSize: 12.5, cursor: count === 0 || !message.trim() ? "not-allowed" : "pointer", border: "none", borderRadius: 8, background: "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.1))", color: "var(--dsw-alias-label-primary, #0f1115)", opacity: count === 0 || !message.trim() ? 0.5 : 1 }}
          >
            提交并推送
          </button>
        </div>
      </div>
    </div>
  );
}
