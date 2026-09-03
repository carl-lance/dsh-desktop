/**
 * dsh-ide — workspace file tree (right panel "文件").
 *
 * - Lists children of the workspace root directly; directories expand lazily.
 * - Refresh (reloadTick) re-reads already-loaded directories but KEEPS the
 *   expanded/collapsed state; only a workspace root change resets it.
 * - Move-by-drag uses a pointer-based implementation (mousedown + 5px
 *   threshold + drop target resolution on mouseup) — HTML5 drag & drop proved
 *   unreliable inside this WebView2 host.
 * - Rows carry data-* attributes for the workbench right-click menus and for
 *   git badges (workspace root + nested .git repos).
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import type { FsEntry, GitRepoStatus } from "../shared/types";
import { call } from "./ideApi";

interface Props {
  root: string;
  onOpen: (entry: FsEntry) => void;
  /** Aggregated git status for the workspace (null = none yet). */
  statuses: GitRepoStatus[] | null;
  /** Selected directory path (toolbar "new" targets it). */
  onSelectDir: (dirPath: string) => void;
  /** Expanded directory paths (controlled by the workbench so the state can
   *  be cached per workspace). */
  expandedPaths: string[];
  onExpandedChange: (paths: string[]) => void;
  /** Bumped by the workbench after file ops / fs events to refresh. */
  reloadTick: number;
  /** Move a file/folder into a target directory (drag & drop). */
  onMove: (fromPath: string, targetDir: string) => void;
}

const DIR_ICON = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <path d="M1.8 3.4h4.1l1.2 1.4h7.1v7.6a1.6 1.6 0 0 1-1.6 1.6H3.4a1.6 1.6 0 0 1-1.6-1.6V3.4Z" />
  </svg>
);
const FILE_ICON = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <path d="M3 1.8h6.4L13 5.4v8.8H3V1.8Z" />
    <path d="M9.2 1.8v3.8H13" />
  </svg>
);
const CHEVRON = (
  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <path d="m6 3.5 4.5 4.5L6 12.5" />
  </svg>
);

/** Text colour for a change code: ? untracked=dark red, A added=green,
 *  M modified=blue. */
function codeColor(code: string): string {
  switch (code) {
    case "A":
      return "#2ea043";
    case "M":
      return "#1a66d8";
    case "?":
    default:
      return "#b3261e";
  }
}

/** Effective badge code for a porcelain XY pair, or null (show normally). */
function codeFor(xy: string): "A" | "M" | "?" | null {
  if (xy.startsWith("??")) return "?";
  if (/A/.test(xy)) return "A"; // staged or worktree added
  if (/M/.test(xy)) return "M"; // staged or worktree modified
  return null;
}

function separator(p: string): string {
  return p.endsWith("/") || p.endsWith("\\") ? p : p + "\\";
}

function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i > 0 ? p.slice(0, i) : p;
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

interface DragSession {
  from: string;
  x0: number;
  y0: number;
  active: boolean;
  moved: boolean;
}

export function FileTree({
  root,
  onOpen,
  statuses,
  onSelectDir,
  expandedPaths,
  onExpandedChange,
  reloadTick,
  onMove,
}: Props): ReactElement {
  const [byDir, setByDir] = useState<Record<string, FsEntry[]>>({});
  const [busyDir, setBusyDir] = useState<string | null>(null);
  const [failed, setFailed] = useState("");
  const [dropping, setDropping] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const chipRef = useRef<HTMLDivElement | null>(null);
  const posRef = useRef({ x: 0, y: 0 });
  const targetRef = useRef<string | null>(null);

  const byDirRef = useRef(byDir);
  byDirRef.current = byDir;
  const rootRefCur = useRef(root);
  rootRefCur.current = root;
  const dragRef = useRef<DragSession>({ from: "", x0: 0, y0: 0, active: false, moved: false });
  const suppressClickUntil = useRef(0);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  // Workspace (root) change → full reset + load root, then load any dirs that
  // were restored as expanded so their children are present immediately.
  useEffect(() => {
    setByDir({});
    setFailed("");
    if (root) {
      void loadDir(root);
      for (const d of expandedPaths) {
        if (d && d !== root) void loadDir(d);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  // When the workbench restores an expanded set (workspace switch), load any
  // dirs that are not loaded yet.
  useEffect(() => {
    if (!root) return;
    for (const d of expandedPaths) {
      if (d && !byDirRef.current[d] && d !== root) void loadDir(d);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedPaths]);

  // Refresh: re-read every directory that is currently loaded (root included)
  // while keeping expansion state. Initial mount (reloadTick 0) is skipped.
  useEffect(() => {
    if (!reloadTick || !root) return;
    const dirs = [root, ...Object.keys(byDirRef.current)].filter((d, i, a) => a.indexOf(d) === i);
    setFailed("");
    for (const d of dirs) void loadDir(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick]);

  async function loadDir(dir: string): Promise<void> {
    setBusyDir(dir);
    try {
      const r: { entries: FsEntry[] } = await call("fs.list", { path: dir });
      setByDir((m) => ({ ...m, [dir]: r.entries }));
      setFailed("");
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyDir((b) => (b === dir ? null : b));
    }
  }

  function toggleDir(dir: string): void {
    const open = expandedPaths.includes(dir);
    const next = open ? expandedPaths.filter((d) => d !== dir) : [...expandedPaths, dir];
    onExpandedChange(next);
    if (!open && !byDir[dir]) void loadDir(dir);
  }

  /** Resolve drop target directory under a screen point (null = not droppable). */
  function resolveTargetAt(cx: number, cy: number): string | null {
    const el = document.elementFromPoint(cx, cy) as HTMLElement | null;
    if (!el || !el.closest("[data-ide-tree]")) return null;
    const dirRow = el.closest('[data-ide-fs-kind="dir"]') as HTMLElement | null;
    if (dirRow) return dirRow.getAttribute("data-ide-fs-path");
    const fileRow = el.closest('[data-ide-fs-kind="file"]') as HTMLElement | null;
    if (fileRow) {
      const p = fileRow.getAttribute("data-ide-fs-path") ?? "";
      return p ? dirname(p) : rootRefCur.current;
    }
    return rootRefCur.current;
  }

  // Pointer drag session: window-level move/up listeners, threshold 5px.
  useEffect(() => {
    const onMoveWin = (e: MouseEvent): void => {
      const d = dragRef.current;
      if (!d.active) return;
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 5) {
        d.moved = true;
        setDropping(true);
      }
      if (!d.moved) return;
      posRef.current = { x: e.clientX + 12, y: e.clientY + 14 };
      if (chipRef.current) {
        chipRef.current.style.left = `${posRef.current.x}px`;
        chipRef.current.style.top = `${posRef.current.y}px`;
      }
      const dir = resolveTargetAt(e.clientX, e.clientY);
      if (dir !== targetRef.current) {
        targetRef.current = dir;
        setDropTarget(dir);
      }
    };
    const onUpWin = (e: MouseEvent): void => {
      const d = dragRef.current;
      if (!d.active) return;
      d.active = false;
      const didMove = d.moved;
      setDropping(false);
      const dir = didMove ? targetRef.current ?? resolveTargetAt(e.clientX, e.clientY) : null;
      targetRef.current = null;
      setDropTarget(null);
      if (didMove) {
        if (dir && d.from) onMoveRef.current(d.from, dir);
        // Only a real drag should suppress the click that follows.
        suppressClickUntil.current = Date.now() + 600;
      }
    };
    window.addEventListener("mousemove", onMoveWin);
    window.addEventListener("mouseup", onUpWin);
    return () => {
      window.removeEventListener("mousemove", onMoveWin);
      window.removeEventListener("mouseup", onUpWin);
    };
  }, []);

  function beginDrag(e: React.MouseEvent, path: string): void {
    if (e.button !== 0) return;
    dragRef.current = { from: path, x0: e.clientX, y0: e.clientY, active: true, moved: false };
  }

  function clickAllowed(): boolean {
    if (Date.now() < suppressClickUntil.current) return false;
    return true;
  }

  function decorFor(absPath: string): { code: string; dirty: boolean; ignored: boolean; repo: string } {
    if (!statuses || statuses.length === 0) return { code: "", dirty: false, ignored: false, repo: "" };
    let best: { root: string; entries: GitRepoStatus["entries"] } | null = null;
    for (const s of statuses) {
      const r = s.root.replace(/[\\/]+$/, "");
      if (absPath === r || absPath.startsWith(r + "\\") || absPath.startsWith(r + "/")) {
        if (!best || best.root.length < r.length) best = { root: r, entries: s.entries };
      }
    }
    if (!best) return { code: "", dirty: false, ignored: false, repo: "" };
    const repo = best.root;
    const none = { code: "", dirty: false, ignored: false, repo };
    const norm = absPath
      .slice(repo.length)
      .replace(/^[\\/]+/, "")
      .replace(/\\/g, "/")
      .replace(/\/+$/, "");
    const normPath = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "");
    const isSelfOrUnder = (p: string): boolean => p !== "" && (norm === p || norm.startsWith(p + "/"));

    const codeOf = (xy: string): string => codeFor(xy) ?? "";

    const exact = best.entries.find((e) => normPath(e.path) === norm);
    if (exact) {
      if (exact.xy.startsWith("!!")) return { ...none, ignored: true };
      const c = codeOf(exact.xy);
      return c ? { ...none, code: c, dirty: true } : none;
    }
    const ancestor = best.entries.find((e) => isSelfOrUnder(normPath(e.path)));
    if (ancestor) {
      if (ancestor.xy.startsWith("!!")) return { ...none, ignored: true };
      const c = codeOf(ancestor.xy);
      return c ? { ...none, code: c, dirty: true } : none;
    }
    return none;
  }

  const rootEntries = byDir[root] ?? [];

  if (!root) {
    return <div data-ide-tree="1" style={{ padding: "8px 10px", color: "var(--dsw-alias-label-tertiary, #81858c)" }}>等待工作区…</div>;
  }
  if (failed && rootEntries.length === 0 && Object.keys(byDir).length === 0) {
    return (
      <div data-ide-tree="1" style={{ padding: "8px 10px", color: "var(--dsw-alias-label-secondary, #61666b)" }}>
        {failed}
        <button type="button" onClick={() => void loadDir(root)} style={{ display: "block", marginTop: 8, padding: "4px 10px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
          重试
        </button>
      </div>
    );
  }
  if (busyDir === root && rootEntries.length === 0) {
    return <div data-ide-tree="1" style={{ padding: "8px 10px", color: "var(--dsw-alias-label-tertiary, #81858c)" }}>加载中…</div>;
  }

  return (
    <div
      data-ide-tree="1"
      style={{ fontSize: 12.5, lineHeight: 1.9, userSelect: "none", paddingBottom: 8, minHeight: "100%" }}
    >
      {rootEntries.length === 0 ? (
        <div style={{ padding: "8px 10px", color: "var(--dsw-alias-label-tertiary, #81858c)" }}>（空目录）</div>
      ) : (
        renderEntries(rootEntries, 0)
      )}
      {dropping && (
        <div
          ref={chipRef}
          style={{
            position: "fixed",
            left: posRef.current.x,
            top: posRef.current.y,
            zIndex: 95,
            pointerEvents: "none",
            padding: "3px 8px",
            borderRadius: 6,
            fontSize: 12,
            whiteSpace: "nowrap",
            background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #fff))",
            border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))",
            boxShadow: "0 4px 12px rgba(0,0,0,.12)",
            color: "var(--dsw-alias-label-primary, #0f1115)",
          }}
        >
          {dropTarget ? `移动到 ${dropTarget === rootRefCur.current ? "工作区根" : baseName(dropTarget)}` : "移动到…"}
        </div>
      )}
    </div>
  );

  function renderEntries(entries: FsEntry[], depth: number): ReactElement {
    return (
      <>
        {entries.map((e) => {
          const dec = decorFor(e.path);
          return e.kind === "dir" ? (
            <DirNode key={e.path} entry={e} depth={depth} />
          ) : (
            <Row
              key={e.path}
              depth={depth}
              icon={FILE_ICON}
              label={e.name}
              badge={dec}
              fsPath={e.path}
              fsKind="file"
              fsGitCode={dec.code}
              fsGitRepo={dec.repo}
              onMouseDown={(ev) => beginDrag(ev, e.path)}
              onClick={() => {
                if (!clickAllowed()) return;
                onSelectDir(dirname(e.path));
                onOpen(e);
              }}
            />
          );
        })}
      </>
    );
  }

  function DirNode({ entry, depth }: { entry: FsEntry; depth: number }): ReactElement {
    const open = expandedPaths.includes(entry.path);
    const dec = decorFor(entry.path);
    return (
      <div>
        <Row
          depth={depth}
          icon={open ? <span style={{ display: "inline-flex", transform: "rotate(90deg)" }}>{CHEVRON}</span> : CHEVRON}
          label={entry.name}
          dim
          badge={dec}
          fsPath={entry.path}
          fsKind="dir"
          fsGitCode={dec.code}
          fsGitRepo={dec.repo}
          highlight={dropping && dropTarget === entry.path}
          onMouseDown={(ev) => beginDrag(ev, entry.path)}
          onClick={() => {
            if (!clickAllowed()) return;
            onSelectDir(entry.path);
            toggleDir(entry.path);
          }}
        />
        {open &&
          (busyDir === entry.path && !byDir[entry.path] ? (
            <Row depth={depth + 1} label="加载中…" dim />
          ) : (
            renderEntries(byDir[entry.path] ?? [], depth + 1)
          ))}
      </div>
    );
  }
}

interface RowProps {
  depth: number;
  icon?: ReactElement;
  label: string;
  dim?: boolean;
  badge?: { code: string; dirty: boolean; ignored?: boolean; repo?: string };
  fsPath?: string;
  fsKind?: "file" | "dir";
  fsGitCode?: string;
  fsGitRepo?: string;
  highlight?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
  onClick?: () => void;
}

function Row({ depth, icon, label, dim, badge, fsPath, fsKind, fsGitCode, fsGitRepo, highlight, onMouseDown, onClick }: RowProps): ReactElement {
  const attrs: { [key: string]: string } = {};
  if (fsPath) {
    attrs["data-ide-fs-path"] = fsPath;
    attrs["data-ide-fs-kind"] = fsKind ?? "file";
  }
  if (fsGitCode) attrs["data-ide-fs-code"] = fsGitCode;
  if (fsGitRepo) attrs["data-ide-fs-repo"] = fsGitRepo;
  // No status icons: state is expressed by the row text colour.
  let color = dim ? "var(--dsw-alias-label-tertiary, #81858c)" : "var(--dsw-alias-label-primary, #0f1115)";
  if (badge?.ignored) color = "var(--dsw-alias-label-tertiary, #9b9b9b)";
  else if (badge?.code) color = codeColor(badge.code);
  const style: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    paddingRight: 10,
    paddingLeft: 8 + depth * 14,
    cursor: onClick ? "pointer" : "default",
    color,
    whiteSpace: "nowrap",
    borderRadius: 6,
    background: highlight ? "rgba(64,150,255,.16)" : undefined,
  };
  return (
    <div
      role="button"
      tabIndex={0}
      data-ide-fs-row="1"
      onMouseDown={onMouseDown}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" && onClick) onClick();
      }}
      style={style}
      {...attrs}
    >
      <span style={{ display: "inline-flex", flex: "none", width: 12, justifyContent: "center", color: "var(--dsw-alias-label-tertiary, #81858c)" }}>
        {icon}
      </span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
    </div>
  );
}
