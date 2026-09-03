/**
 * dsh-ide — 推送弹窗（WebStorm 风格左右分区）。
 *
 * 左：当前分支待推送（ahead）提交列表；选中一条提交后：
 * 右：该提交改动的文件树（ChangeTree），文件树下方显示提交信息（完整
 * message + 作者/时间）。推送动作后端接入前为占位。
 */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { call } from "./ideApi";
import { ChangeTree, type ChangeLeaf } from "./ChangeTree";

interface Props {
  onClose: () => void;
  onNotify: (message: string) => void;
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

function shortDate(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function codeLetter(xy: string): string {
  if (xy.startsWith("??")) return "?";
  return xy.charAt(0) || "";
}

export function PushDialog({ onClose, onNotify }: Props): ReactElement {
  const [commits, setCommits] = useState<PendingCommit[]>([]);
  const [range, setRange] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    call("git.pending")
      .then((r) => {
        if (!alive) return;
        const c = r as { commits: PendingCommit[]; range: string };
        setCommits(c.commits);
        setRange(c.range);
        if (c.commits.length > 0) setSelected(c.commits[0].hash);
        setLoading(false);
      })
      .catch(() => {
        if (alive) {
          setCommits([]);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetailLoading(true);
    call("git.commitFiles", { hash: selected })
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
  }, [selected]);

  const leaves = useMemo<ChangeLeaf[]>(() => {
    if (!detail) return [];
    return detail.files.map((f, i) => ({
      key: `${selected}_${i}`,
      code: codeLetter(f.xy),
      path: f.path.replace(/\\/g, "/").replace(/^"|"$/g, ""),
    }));
  }, [detail, selected]);

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
          width: 780,
          maxWidth: "94vw",
          height: 560,
          maxHeight: "86vh",
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
          <span style={{ fontSize: 14, fontWeight: 600 }}>推送</span>
          <span style={{ fontSize: 11, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>{range}</span>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            style={{ marginLeft: "auto", width: 26, height: 26, border: "none", borderRadius: 6, cursor: "pointer", background: "transparent", color: "var(--dsw-alias-label-secondary, #61666b)" }}
          >
            ✕
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 10 }}>
          {/* left: pending commits */}
          <div style={{ width: 240, flex: "none", display: "flex", flexDirection: "column", border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "6px 10px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #81858c)", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))", flex: "none" }}>
              待推送提交（{commits.length}）
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              {loading ? (
                <div style={{ padding: 12, fontSize: 12, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>加载…</div>
              ) : commits.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: "var(--dsw-alias-label-secondary, #61666b)" }}>没有待推送的提交</div>
              ) : (
                commits.map((c) => {
                  const active = c.hash === selected;
                  return (
                    <button
                      key={c.hash}
                      type="button"
                      onClick={() => setSelected(c.hash)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "6px 10px",
                        border: "none",
                        cursor: "pointer",
                        borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.05))",
                        background: active ? "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.08))" : "transparent",
                      }}
                    >
                      <div style={{ fontSize: 11, fontFamily: "var(--ds-font-family-mono, Consolas, monospace)", color: "var(--dsw-alias-label-tertiary, #81858c)" }}>
                        {c.short} · {shortDate(c.ts)}
                      </div>
                      <div style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--dsw-alias-label-primary, #0f1115)" }}>
                        {c.subject}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* right: changed file tree + commit info */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "6px 10px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #81858c)", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))", flex: "none" }}>
              改动文件{selected ? ` · ${selected.slice(0, 7)}` : ""}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "4px 0" }}>
              {detailLoading ? (
                <div style={{ padding: 12, fontSize: 12, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>加载文件…</div>
              ) : !detail || leaves.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: "var(--dsw-alias-label-secondary, #61666b)" }}>（无文件改动）</div>
              ) : (
                <ChangeTree leaves={leaves} />
              )}
            </div>
            <div style={{ borderTop: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))", padding: "8px 10px", flex: "none" }}>
              <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 110, overflow: "auto" }}>
                {detail?.message || "（选择左侧提交查看信息）"}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12, flex: "none" }}>
          <button type="button" onClick={onClose} style={{ padding: "6px 14px", fontSize: 12.5, cursor: "pointer", border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))", borderRadius: 8, background: "transparent", color: "var(--dsw-alias-label-primary, #0f1115)" }}>
            取消
          </button>
          <button
            type="button"
            disabled={commits.length === 0}
            onClick={() => onNotify("推送（后端接入中）")}
            style={{ padding: "6px 16px", fontSize: 12.5, cursor: commits.length === 0 ? "not-allowed" : "pointer", border: "none", borderRadius: 8, background: "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.1))", color: "var(--dsw-alias-label-primary, #0f1115)", opacity: commits.length === 0 ? 0.5 : 1 }}
          >
            推送
          </button>
        </div>
      </div>
    </div>
  );
}
