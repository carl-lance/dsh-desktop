/**
 * dsh-ide — 检出确认弹窗（右键分支 → 检出）。
 *
 * 描述按目标分支实际情况显示（区分“本地已存在→直接切换”/“需创建本地跟踪
 * 分支”/“已在当前分支→无需检出”）。工作区有未提交改动时列出改动文件树：
 *  - 智能检出：本地改动 stash → 切分支 → stash pop 自动带回；pop 冲突时
 *    stash 条目保留（可去“搁置”页恢复），冲突留在工作区。
 *  - 强制检出：丢弃全部未提交改动（两次点击确认）。
 */

import { useEffect, useRef, useState, type ReactElement } from "react";
import { call } from "./ideApi";
import { ChangeTree, type ChangeLeaf } from "./ChangeTree";
import { Spinner } from "./Spinner";
import { maskStyle } from "./overlay";

interface Props {
  repoRoot: string;
  /** Full branch ref (may include remote prefix, e.g. origin/dev). */
  name: string;
  remote: boolean;
  onClose: () => void;
  onNotify: (message: string) => void;
  /** Called after a successful checkout with the resulting branch name. */
  onDone: (branch: string) => void;
}

interface FileRow {
  path: string;
  code: string;
}

function shortOf(name: string): string {
  return name.includes("/") ? name.slice(name.indexOf("/") + 1) : name;
}

function letterOf(xy: string): string {
  if (xy.startsWith("??")) return "?";
  const c = xy.charAt(0) === " " ? xy.charAt(1) : xy.charAt(0);
  return c || "?";
}

export function CheckoutDialog({ repoRoot, name, remote, onClose, onNotify, onDone }: Props): ReactElement {
  const [current, setCurrent] = useState("");
  const [localExists, setLocalExists] = useState<boolean | null>(null);
  const [dirty, setDirty] = useState<number | null>(null);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [busy, setBusy] = useState("");
  const [forceArmed, setForceArmed] = useState(false);
  const armTimer = useRef<number | null>(null);

  const targetShort = remote ? shortOf(name) : name;
  // Remote branch whose local counterpart is the branch we are already on.
  const noopTarget = remote && localExists === true && targetShort === current;

  useEffect(() => {
    let alive = true;
    (async () => {
      let cur = "";
      let local: boolean | null = null;
      let n: number | null = null;
      let rows: FileRow[] = [];
      try {
        const b = (await call("git.branches", { repo: repoRoot })) as { current: string; branches: Array<{ name: string; remote: boolean }> };
        cur = b.current;
        local = b.branches.some((r) => !r.remote && r.name === targetShort);
      } catch {
        cur = "";
        local = null;
      }
      try {
        const repos = (await call("git.all")) as Array<{ root: string; entries: Array<{ path: string; xy: string }> }>;
        const repo = repos.find((r) => r.root === repoRoot);
        const entries = (repo?.entries ?? []).filter((e) => !e.xy.startsWith("!!"));
        n = entries.length;
        rows = entries
          .map((e) => ({
            path: e.path.replace(/^"|"$/g, "").replace(/[\\/]+$/, ""),
            code: letterOf(e.xy),
          }))
          .filter((r) => !!r.path);
      } catch {
        n = null;
        rows = [];
      }
      if (!alive) return;
      setCurrent(cur);
      setLocalExists(local);
      setDirty(n);
      setFiles(rows);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoRoot, name, remote, targetShort]);

  useEffect(
    () => () => {
      if (armTimer.current !== null) window.clearTimeout(armTimer.current);
    },
    []
  );

  const armForce = (): void => {
    if (forceArmed) {
      void doForce();
      return;
    }
    setForceArmed(true);
    if (armTimer.current !== null) window.clearTimeout(armTimer.current);
    armTimer.current = window.setTimeout(() => setForceArmed(false), 4000);
  };

  const doPlain = async (): Promise<void> => {
    setBusy("检出");
    try {
      const res = (await call("git.checkout", { repo: repoRoot, name })) as { branch: string };
      onNotify(`已检出 ${res.branch || name}`);
      onDone(res.branch || name);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };

  const doSmart = async (): Promise<void> => {
    setBusy("智能检出");
    try {
      const res = (await call("git.checkoutSmart", { repo: repoRoot, name })) as {
        branch: string;
        conflict: boolean;
        label: string;
        note: string;
      };
      if (res.conflict) {
        onNotify(`已检出 ${res.branch || targetShort}，但把改动带回去时有冲突，已在工作区留冲突标记；原改动已存为搁置「${res.label}」，可随时恢复。`);
      } else {
        onNotify(`已检出 ${res.branch || targetShort}，本地改动已自动带过去`);
      }
      onDone(res.branch || targetShort);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };

  const doForce = async (): Promise<void> => {
    setBusy("强制检出");
    try {
      const res = (await call("git.checkoutForce", { repo: repoRoot, name })) as { branch: string };
      onNotify(`已强制检出 ${res.branch || targetShort}（未提交改动已丢弃）`);
      onDone(res.branch || targetShort);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
      setForceArmed(false);
    }
  };

  const leaves: ChangeLeaf[] = files.map((f, i) => ({
    key: `${f.path}_${i}`,
    code: f.code,
    path: f.path.replace(/\\/g, "/"),
  }));

  const btn = (
    text: string,
    onClick: () => void,
    opts: { kind?: "primary" | "cancel" | "danger"; armed?: boolean; busyKey?: string; disabled?: boolean } = {}
  ): ReactElement => {
    const spinning = !!opts.busyKey && busy === opts.busyKey;
    const disabled = opts.disabled || (busy !== "" && !spinning);
    const style =
      opts.kind === "cancel"
        ? { border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))", background: "transparent", color: "var(--dsw-alias-label-primary, #0f1115)" }
        : opts.kind === "danger"
          ? { border: "none", background: opts.armed ? "rgba(196,60,45,.22)" : "var(--dsw-specific-danger-bg, rgba(196,60,45,.12))", color: "var(--dsw-alias-danger, #c43c2d)" }
          : { border: "none", background: "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.1))", color: "var(--dsw-alias-label-primary, #0f1115)" };
    return (
      <button
        type="button"
        disabled={disabled || spinning}
        onClick={onClick}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 16px",
          fontSize: 12.5,
          cursor: disabled || spinning ? "not-allowed" : "pointer",
          borderRadius: 8,
          fontFamily: "inherit",
          whiteSpace: "nowrap",
          opacity: disabled ? 0.5 : 1,
          ...style,
        }}
      >
        {spinning ? <Spinner size={12} /> : null}
        {text}
      </button>
    );
  };

  const dirtyMode = dirty !== null && dirty > 0;

  const targetDesc = (): ReactElement => {
    if (!remote) {
      return (
        <>
          将从 <b>{current || "…"}</b> 切换到 <b>{name}</b>
        </>
      );
    }
    if (localExists === null) {
      return (
        <>
          将从 <b>{current || "…"}</b> 切换到远程 <b>{name}</b>…
        </>
      );
    }
    if (noopTarget) {
      return (
        <>
          <b>{name}</b> 对应的本地分支就是当前所在的 <b>{targetShort}</b>，无需切换
        </>
      );
    }
    if (localExists) {
      return (
        <>
          将从 <b>{current || "…"}</b> 切换到本地分支 <b>{targetShort}</b>（它跟踪 <b>{name}</b>）
        </>
      );
    }
    return (
      <>
        将从 <b>{current || "…"}</b> 切换到 <b>{name}</b>，并新建本地跟踪分支 <b>{targetShort}</b>
      </>
    );
  };

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={maskStyle(440)}
    >
      <div style={{ width: 460, maxWidth: "94vw", maxHeight: "86vh", display: "flex", flexDirection: "column", padding: 16, borderRadius: 12, background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #fff))", boxShadow: "0 16px 48px rgba(0,0,0,.18)", color: "var(--dsw-alias-label-primary, #0f1115)" }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>切换分支</div>
        <div style={{ fontSize: 13, lineHeight: 1.8, wordBreak: "break-all" }}>{targetDesc()}</div>

        {noopTarget ? (
          <div style={{ fontSize: 12, margin: "10px 0", padding: "8px 10px", borderRadius: 8, background: "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05))", color: "var(--dsw-alias-label-secondary, #61666b)" }}>
            不需要执行检出操作。
          </div>
        ) : dirty === null ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--dsw-alias-label-tertiary, #81858c)", margin: "10px 0" }}>
            <Spinner size={11} /> 检查工作区…
          </div>
        ) : !dirtyMode ? (
          <div style={{ fontSize: 12, margin: "10px 0", padding: "8px 10px", borderRadius: 8, background: "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05))", color: "var(--dsw-alias-label-secondary, #61666b)" }}>
            工作区干净，可直接检出。
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12, lineHeight: 1.6, margin: "8px 0", color: "var(--dsw-alias-danger, #c43c2d)" }}>
              检出前需要处理 <b>{dirty}</b> 个未提交改动：
            </div>
            <div style={{ flex: "none", display: "flex", flexDirection: "column", border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "5px 10px", fontSize: 11.5, color: "var(--dsw-alias-label-tertiary, #81858c)", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))", flex: "none" }}>
                未提交改动（{files.length}）
              </div>
              <div style={{ maxHeight: 170, overflow: "auto", padding: "3px 0" }}>
                <ChangeTree leaves={leaves} />
              </div>
            </div>
            <div style={{ fontSize: 11.5, lineHeight: 1.6, marginTop: 8, color: "var(--dsw-alias-label-tertiary, #81858c)" }}>
              智能检出：改动会先 stash、切分支后自动带回；若带回冲突，改动保留为搁置，可随时恢复。
              <br />
              强制检出：直接丢弃全部未提交改动（需点两次确认）。
            </div>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14, flex: "none" }}>
          {noopTarget ? (
            btn("关闭", onClose, { kind: "primary" })
          ) : (
            <>
              {btn("取消", onClose, { kind: "cancel", disabled: busy !== "" })}
              {!dirtyMode ? (
                btn(busy === "检出" ? "检出中…" : "检出", () => void doPlain(), { kind: "primary", busyKey: "检出" })
              ) : (
                <>
                  {btn(busy === "智能检出" ? "智能检出中…" : "智能检出", () => void doSmart(), { kind: "primary", busyKey: "智能检出" })}
                  {btn(forceArmed ? "确认丢弃改动并检出" : "强制检出", armForce, { kind: "danger", armed: forceArmed, busyKey: "强制检出" })}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
