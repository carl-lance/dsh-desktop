/**
 * dsh-ide — 对比弹窗（右键分支 → 对比）。
 *
 * 两栏提交列表：选中分支独有（领先当前）/ 当前独有；点任一提交在下方
 * 查看它改动的文件与提交信息。底部可一键“检出该分支”（转交确认流程）。
 */

import { useEffect, useState, type ReactElement } from "react";
import { call } from "./ideApi";
import { ChangeTree, type ChangeLeaf } from "./ChangeTree";
import { Spinner } from "./Spinner";
import { maskStyle } from "./overlay";

interface Props {
  repoRoot: string;
  /** Full branch ref (may include remote prefix, e.g. origin/dev). */
  name: string;
  current: string;
  remote: boolean;
  onClose: () => void;
  onNotify: (message: string) => void;
  onCheckout: (name: string, remote: boolean) => void;
}

interface PendingCommit {
  hash: string;
  short: string;
  author: string;
  ts: number;
  subject: string;
}

interface CommitDetail {
  message: string;
  files: Array<{ xy: string; path: string }>;
}

interface CompareData {
  branch: string;
  ahead: PendingCommit[];
  behind: PendingCommit[];
}

interface Sel {
  side: "ahead" | "behind";
  hash: string;
}

function fmt(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function codeLetter(xy: string): string {
  if (xy.startsWith("??")) return "?";
  return xy.charAt(0) || "";
}

function displayOf(name: string): string {
  return name.includes("/") ? name.slice(name.indexOf("/") + 1) : name;
}

const smallBtn = (
  text: string,
  onClick: () => void,
  opts: { kind?: "primary" | "cancel" | "danger"; busy?: boolean; disabled?: boolean } = {}
): ReactElement => {
  const kind = opts.kind ?? "cancel";
  const style =
    kind === "primary"
      ? { border: "none", background: "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.1))", color: "var(--dsw-alias-label-primary, #0f1115)" }
      : kind === "danger"
        ? { border: "1px solid var(--dsw-alias-border-danger, rgba(196,60,45,.35))", background: "var(--dsw-specific-danger-bg, rgba(196,60,45,.12))", color: "var(--dsw-alias-danger, #c43c2d)" }
        : { border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))", background: "transparent", color: "var(--dsw-alias-label-primary, #0f1115)" };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={opts.disabled || opts.busy}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 16px",
        fontSize: 12.5,
        cursor: opts.disabled || opts.busy ? "not-allowed" : "pointer",
        borderRadius: 8,
        fontFamily: "inherit",
        opacity: opts.disabled ? 0.45 : 1,
        ...style,
      }}
    >
      {opts.busy ? <Spinner size={12} /> : null}
      {text}
    </button>
  );
};

export function CompareDialog({ repoRoot, name, current, remote, onClose, onNotify, onCheckout }: Props): ReactElement {
  const [data, setData] = useState<CompareData | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    call("git.compareDetail", { repo: repoRoot, name })
      .then((r) => {
        if (!alive) return;
        const d = r as CompareData;
        setData(d);
        const first = d.ahead[0] ?? d.behind[0];
        if (first) {
          setSel({ side: d.ahead[0] ? "ahead" : "behind", hash: first.hash });
        }
      })
      .catch(() => {
        if (alive) {
          setData({ branch: name, ahead: [], behind: [] });
        }
      });
    return () => {
      alive = false;
    };
  }, [repoRoot, name]);

  useEffect(() => {
    if (!sel) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetailLoading(true);
    call("git.commitFiles", { repo: repoRoot, hash: sel.hash })
      .then((r) => {
        if (alive) {
          setDetail(r as CommitDetail);
          setDetailLoading(false);
        }
      })
      .catch(() => {
        if (alive) {
          setDetail(null);
          setDetailLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [sel, repoRoot]);

  const leaves: ChangeLeaf[] = detail
    ? detail.files.map((f, i) => ({
        key: `${sel?.hash ?? ""}_${i}`,
        code: codeLetter(f.xy),
        path: f.path.replace(/\\/g, "/").replace(/^"|"$/g, ""),
      }))
    : [];

  const col = (side: "ahead" | "behind", title: string, items: PendingCommit[]): ReactElement => (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "6px 10px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #81858c)", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))", flex: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {title}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {items.length === 0 ? (
          <div style={{ padding: 12, fontSize: 12, color: "var(--dsw-alias-label-secondary, #61666b)" }}>（无）</div>
        ) : (
          items.map((c) => {
            const active = sel?.side === side && sel.hash === c.hash;
            return (
              <button
                key={c.hash}
                type="button"
                onClick={() => setSel({ side, hash: c.hash })}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "6px 10px",
                  border: "none",
                  cursor: "pointer",
                  borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.05))",
                  background: active ? "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.08))" : "transparent",
                  fontFamily: "inherit",
                }}
              >
                <div style={{ fontSize: 11, fontFamily: "var(--ds-font-family-mono, Consolas, monospace)", color: "var(--dsw-alias-label-tertiary, #81858c)" }}>
                  {c.short} · {fmt(c.ts)} · {c.author}
                </div>
                <div style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--dsw-alias-label-primary, #0f1115)" }}>{c.subject}</div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={maskStyle(460)}
    >
      <div style={{ width: 900, maxWidth: "94vw", height: 620, maxHeight: "88vh", display: "flex", flexDirection: "column", padding: 14, borderRadius: 14, background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #fff))", boxShadow: "0 18px 56px rgba(0,0,0,.2)", color: "var(--dsw-alias-label-primary, #0f1115)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flex: "none" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>对比</span>
          <span style={{ fontSize: 12, color: "var(--dsw-alias-label-secondary, #61666b)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {current || "当前"} ↔ {name}
            {remote ? "（远程）" : ""}
          </span>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            style={{ marginLeft: "auto", width: 26, height: 26, border: "none", borderRadius: 6, cursor: "pointer", background: "transparent", color: "var(--dsw-alias-label-secondary, #61666b)", fontSize: 15, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {!data ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 12.5, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>
            <Spinner size={14} /> 加载对比…
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 10, flex: 1, minHeight: 0, marginBottom: 10 }}>
              {col("ahead", `${name} 独有（领先 ${data.ahead.length}）`, data.ahead)}
              {col("behind", `${current || "当前"} 独有（落后 ${data.behind.length}）`, data.behind)}
            </div>

            <div style={{ flex: "none", display: "flex", flexDirection: "column", border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))", borderRadius: 10, overflow: "hidden", maxHeight: 210 }}>
              <div style={{ padding: "6px 10px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #81858c)", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))", flex: "none" }}>
                选中提交的改动{sel ? ` · ${sel.hash.slice(0, 7)}` : ""}
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "4px 0" }}>
                {detailLoading ? (
                  <div style={{ padding: 12, fontSize: 12, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>加载文件…</div>
                ) : !sel ? (
                  <div style={{ padding: 12, fontSize: 12, color: "var(--dsw-alias-label-secondary, #61666b)" }}>（点左侧提交查看改动）</div>
                ) : (
                  <>
                    {leaves.length === 0 ? (
                      <div style={{ padding: 12, fontSize: 12, color: "var(--dsw-alias-label-secondary, #61666b)" }}>（无文件改动）</div>
                    ) : (
                      <ChangeTree leaves={leaves} />
                    )}
                    <div style={{ padding: "2px 12px 10px", fontSize: 12.5, color: "var(--dsw-alias-label-secondary, #61666b)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {detail?.message || ""}
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10, flex: "none" }}>
          {smallBtn("关闭", onClose, { kind: "cancel" })}
          {smallBtn("检出该分支", () => onCheckout(name, remote), { kind: "primary", disabled: !data })}
        </div>
      </div>
    </div>
  );
}
