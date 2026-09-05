/**
 * dsh-ide — the workbench body.
 *
 * Owns: right-click handling for the whole IDE surface (tabs / file tree /
 * panels), tab & fs context menus, name-input / confirm dialogs, the file
 * panel toolbar (new file / folder), git status aggregation (root + nested
 * repos) feeding the file tree badges, and the EditorGroup + right panels.
 *
 * Right-click strategy: the shell's injected menu listens on `document` in
 * the capture phase, so this component blocks at `window` capture (the only
 * point that runs before document) and routes the click: editor area →
 * suppressed; tab strip / file tree → our own menus.
 */

import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import { useIdeDoc, call, ideStatus, openForSession, onIdeBus, emitIdeBus } from "./ideApi";
import { ideStore } from "./ideStore";
import { FileTree } from "./FileTree";
import { GitHistory } from "./GitHistory";
import { EditorGroup, type EditorGroupHandle, type EditorTabSnapshot } from "./editor/EditorGroup";
import { TerminalPanel } from "./TerminalPanel";
import { maskStyle } from "./overlay";
import type { FsEntry, GitRepoStatus } from "../shared/types";

type PanelId = "files" | "git";

const PANEL_DEFAULT_W = 280;

const FILES_ICON = (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <path d="M1.8 3.4h4.1l1.2 1.4h7.1v7.6a1.6 1.6 0 0 1-1.6 1.6H3.4a1.6 1.6 0 0 1-1.6-1.6V3.4Z" />
    <path d="M2.8 10.2h10.4" opacity=".5" />
  </svg>
);
const GIT_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="6" cy="5" r="2.2" />
    <circle cx="18" cy="7" r="2.2" />
    <circle cx="6" cy="19" r="2.2" />
    <path d="M6 7.2v9.6" />
    <path d="M18 9.2a9 9 0 0 1-9 9" />
  </svg>
);
const TERM_ICON = (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <rect x="1.6" y="2.4" width="12.8" height="11.2" rx="1.6" />
    <path d="m5 6 2.4 2L5 10" />
    <path d="M9.6 10h2.4" />
  </svg>
);
const NEW_FILE_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M12 12v6M9 15h6" />
  </svg>
);
const NEW_DIR_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    <path d="M12 10v6M9 13h6" />
  </svg>
);

interface MenuState {
  x: number;
  y: number;
  kind: "tab" | "fs";
  tabId?: string;
  tabDirty?: boolean;
  tabIsFile?: boolean;
  fsPath?: string;
  fsIsDir?: boolean;
  fsCode?: string;
  fsRepo?: string;
}

interface InputDialog {
  title: string;
  label: string;
  initial: string;
  action: string;
  onSubmit: (value: string) => Promise<void> | void;
}

interface ConfirmDialog {
  title: string;
  message: string;
  action: string;
  onConfirm: () => Promise<void> | void;
}

function joinPath(parent: string, name: string): string {
  return parent.replace(/[\\/]+$/, "") + "\\" + name;
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function dirName(p: string): string {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i > 0 ? p.slice(0, i) : p;
}

/** Per-workspace cached state (webview localStorage). */
interface WsCache {
  cwd: string;
  panel: PanelId | null;
  selectedDir: string;
  expanded: string[];
  tabs: EditorTabSnapshot[];
  activeUri: string | null;
  /** Right function-panel width (px). */
  panelW?: number;
  /** Bottom terminal share of the workbench height. */
  termRatio?: number;
}

function wsCacheKey(cwd: string): string {
  return `dsh-ide:ws:${encodeURIComponent(cwd)}`;
}

function readWsCache(cwd: string): WsCache | null {
  try {
    const raw = window.localStorage.getItem(wsCacheKey(cwd));
    if (!raw) return null;
    const o = JSON.parse(raw) as WsCache;
    if (o && Array.isArray(o.tabs)) return o;
    return null;
  } catch {
    return null;
  }
}

function writeWsCache(cwd: string, cache: WsCache): void {
  try {
    // Cap stored editor bytes so a huge session cannot blow localStorage.
    const MAX_BYTES = 2 * 1024 * 1024;
    const tabs = cache.tabs;
    let total = 0;
    const capped = tabs.filter((t) => {
      const bytes = (t.content || "").length * 2;
      total += bytes;
      return total <= MAX_BYTES;
    });
    if (capped.length !== tabs.length) {
      // Drop any over-budget tail silently (kept in memory for the session).
    }
    window.localStorage.setItem(wsCacheKey(cwd), JSON.stringify({ ...cache, tabs: capped }));
  } catch {
    /* storage full/unavailable — in-memory state still works */
  }
}

export function Workbench(): ReactElement {
  const doc = useIdeDoc();
  const status = ideStatus();
  const editorRef = useRef<EditorGroupHandle | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [panel, setPanel] = useState<PanelId | null>("files");
  const [toast, setToast] = useState("");
  const [statuses, setStatuses] = useState<GitRepoStatus[] | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [selectedDir, setSelectedDir] = useState("");
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [input, setInput] = useState<InputDialog | null>(null);
  const [confirm, setConfirm] = useState<ConfirmDialog | null>(null);
  const [termVisible, setTermVisible] = useState(false);
  const [termRatio, setTermRatio] = useState(0.32); // bottom share of the workbench height
  const [mainColH, setMainColH] = useState(400);
  const [dividerHover, setDividerHover] = useState(false);
  const [termDragging, setTermDragging] = useState(false);
  const splitRatioRef = useRef(0.32);
  const [panelW, setPanelW] = useState(PANEL_DEFAULT_W);
  const [panelDividerHover, setPanelDividerHover] = useState(false);
  const [panelDragging, setPanelDragging] = useState(false);
  /** Floating guide rendered in the outer container at a recorded coordinate. */
  const [guide, setGuide] = useState<{ axis: "x" | "y"; pos: number } | null>(null);

  const root = doc.cwd || "";
  // Per-workspace UI state (open editors are cached separately via the
  // EditorGroup snapshot; this keeps the rest of the chrome state).
  const [expandedPaths, setExpandedPaths] = useState<string[]>([]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Track the workbench height (full-width bottom terminal keeps its share).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setMainColH(el.clientHeight));
    ro.observe(el);
    setMainColH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // mdd-note style divider drag: rAF-throttled mousemove, direct DOM sizing
  // while dragging, commit the ratio on mouseup.
  function startDividerDrag(e: React.MouseEvent<HTMLDivElement>): void {
    e.preventDefault();
    const container = rootRef.current;
    const term = container ? (container.querySelector("[data-ide-term]") as HTMLElement | null) : null;
    if (!container || !term) return;
    splitRatioRef.current = termRatio;
    setTermDragging(true);
    let raf = -1;
    const move = (ev: MouseEvent): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = container.getBoundingClientRect();
        const usable = Math.max(100, rect.height - 6);
        const h = Math.min(rect.height * 0.75, Math.max(100, rect.bottom - ev.clientY));
        term.style.height = `${Math.round(h)}px`;
        splitRatioRef.current = Math.min(0.75, Math.max(0.1, h / usable));
        setGuide({ axis: "y", pos: Math.round(rect.height - h) });
      });
    };
    const up = (): void => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setTermDragging(false);
      setGuide(null);
      setTermRatio(splitRatioRef.current);
      void writeWsCache(root, { ...buildSnapshot(), termRatio: splitRatioRef.current });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // Right function-panel width drag (same pattern; commits px width).
  function startPanelDrag(e: React.MouseEvent<HTMLDivElement>): void {
    e.preventDefault();
    const rootEl = rootRef.current;
    const el = rootEl ? (rootEl.querySelector("[data-ide-right-panel]") as HTMLElement | null) : null;
    if (!rootEl || !el) return;
    const startBoundary = e.currentTarget.getBoundingClientRect().right;
    const startW = panelW;
    const clamp = (w: number): number => Math.round(Math.min(Math.max(w, 180), rootEl.clientWidth * 0.62));
    let cur = startW;
    setPanelDragging(true);
    const move = (ev: MouseEvent): void => {
      cur = clamp(startW + (startBoundary - ev.clientX));
      el.style.width = `${cur}px`;
      setGuide({ axis: "x", pos: Math.round(ev.clientX - rootEl.getBoundingClientRect().left) });
    };
    const up = (): void => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setPanelDragging(false);
      setGuide(null);
      setPanelW(cur);
      void writeWsCache(root, { ...buildSnapshot(), panelW: cur });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // --- per-workspace state engine ---
  const prevRootRef = useRef("");
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const selectedDirRef = useRef(selectedDir);
  selectedDirRef.current = selectedDir;
  const expandedRef2 = useRef(expandedPaths);
  expandedRef2.current = expandedPaths;
  const termRatioRef = useRef(termRatio);
  termRatioRef.current = termRatio;
  const panelWRef = useRef(panelW);
  panelWRef.current = panelW;

  const buildSnapshot = (): WsCache => {
    const g = editorRef.current;
    const snap = g ? g.snapshot() : { tabs: [] as EditorTabSnapshot[], activeUri: null };
    return {
      cwd: root,
      panel: panelRef.current,
      selectedDir: selectedDirRef.current || root,
      expanded: expandedRef2.current,
      tabs: snap.tabs,
      activeUri: snap.activeUri,
      panelW: panelWRef.current,
      termRatio: termRatioRef.current,
    };
  };

  // On workspace root change: cache the outgoing workspace (editors are still
  // the old ones at this point), then restore the incoming workspace's state.
  useEffect(() => {
    if (!root) {
      prevRootRef.current = "";
      return;
    }
    const prev = prevRootRef.current;
    prevRootRef.current = root;
    if (prev && prev !== root) {
      writeWsCache(prev, buildSnapshot());
    }
    const cached = readWsCache(root);
    if (editorRef.current) {
      editorRef.current.restore(
        cached ? { tabs: cached.tabs, activeUri: cached.activeUri ?? (cached.tabs.length ? cached.tabs[0].uri : null) } : { tabs: [], activeUri: null }
      );
    }
    setSelectedDir(cached?.selectedDir || root);
    setExpandedPaths(cached?.expanded ?? []);
    setPanel(cached?.panel ?? "files");
    setPanelW(cached?.panelW ?? PANEL_DEFAULT_W);
    setTermRatio(cached?.termRatio ?? 0.32);
    splitRatioRef.current = cached?.termRatio ?? 0.32;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  // Keep the current workspace's cache fresh (debounced) and on page hide.
  useEffect(() => {
    if (!root) return;
    const id = setInterval(() => writeWsCache(root, buildSnapshot()), 1500);
    const onHide = (): void => writeWsCache(root, buildSnapshot());
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(id);
      window.removeEventListener("pagehide", onHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  // Global-context probe: while the workbench lives, watch window top-level
  // keys that look session/workspace related and report when their shape or
  // content changes (helps find what the host updates on session switch).
  const isOverlayOpen = useSyncExternalStore(ideStore.subscribe, ideStore.isOpen);
  const lastGlobalsJson = useRef("");
  useEffect(() => {
    if (!isOverlayOpen) return;
    const digest = (): string => {
      const hits: Array<{ k: string; t: string; keys?: string[]; sample?: string }> = [];
      try {
        for (const k of Object.getOwnPropertyNames(window)) {
          if (!/^(__|dsh|session|conversation|workspace|active|store|api)/i.test(k)) continue;
          const v = (window as unknown as Record<string, unknown>)[k];
          if (v == null || (typeof v !== "object" && typeof v !== "function")) continue;
          const rec: { k: string; t: string; keys?: string[]; sample?: string } = { k, t: typeof v };
          let keys: string[] = [];
          try {
            keys = Object.keys(v as object).slice(0, 24);
          } catch {
            keys = [];
          }
          rec.keys = keys;
          if (/session|active|conversation|workspace/i.test(keys.join(","))) {
            try {
              const s = JSON.stringify(v);
              if (s.length < 2400) rec.sample = s;
            } catch {
              /* non-serializable */
            }
          }
          hits.push(rec);
        }
      } catch {
        /* ignore */
      }
      return JSON.stringify(hits);
    };
    const id = setInterval(() => {
      const json = digest();
      if (json !== lastGlobalsJson.current) {
        lastGlobalsJson.current = json;
        void call("ui.diag", { kind: "globals-change", at: Date.now(), hits: JSON.parse(json) }).catch(() => undefined);
      }
    }, 2000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOverlayOpen]);

  // Host workspace follow-up via DOM: each session's header renders our IDE
  // button with data-ide-header-session. While the overlay is open, poll the
  // visible header button; when the session id changes the host switched
  // conversations → rebind to that session (its cwd then swaps the cache).
  const lastHeaderSession = useRef("");
  useEffect(() => {
    if (!isOverlayOpen) return;
    const readVisible = (): string => {
      try {
        const all = Array.from(document.querySelectorAll("[data-ide-header-session]"));
        const vis = all.filter((el) => (el as HTMLElement).offsetParent !== null || (el as HTMLElement).getClientRects().length > 0);
        const el = vis[0] ?? all[0];
        return el ? (el.getAttribute("data-ide-header-session") ?? "") : "";
      } catch {
        return "";
      }
    };
    lastHeaderSession.current = readVisible();
    const id = setInterval(() => {
      if (!isOverlayOpen) return;
      const sid = readVisible();
      if (!sid || sid === lastHeaderSession.current) return;
      lastHeaderSession.current = sid;
      void openForSession(sid);
    }, 300);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOverlayOpen]);

  // The overlay is display:none while closed; when shown again Monaco must be
  // re-measured (it was created/hidden with different dimensions).
  useEffect(() => {
    if (!isOverlayOpen) return;
    const raf = requestAnimationFrame(() => {
      editorRef.current?.relayout();
    });
    return () => cancelAnimationFrame(raf);
  }, [isOverlayOpen]);

  // Chrome "提交" → modal, "推送" → modal are handled in IdeOverlay. Git ops
  // performed elsewhere (branch menu / dialogs) notify us to refresh.
  useEffect(() => onIdeBus("git.changed", () => setReloadTick((x) => x + 1)), []);

  // Filesystem changes pushed by the host watcher (fsRev bumps): debounce,
  // then refresh the tree + git badges and reload open clean documents.
  const prevFsRev = useRef<number>(0);
  useEffect(() => {
    const rev = Number(doc.fsRev ?? 0);
    if (rev === prevFsRev.current) {
      if (prevFsRev.current === 0 && rev > 0) prevFsRev.current = rev;
      return;
    }
    prevFsRev.current = rev;
    if (rev === 0) return;
    const t = setTimeout(() => {
      setReloadTick((x) => x + 1);
      void editorRef.current?.syncFromDisk().then((skipped) => {
        if (skipped.length > 0) notify(`${skipped.length} 个文件在磁盘有改动但有未保存修改，已跳过自动重载`);
      });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.fsRev]);

  // Aggregate git status (workspace root + nested .git repos): on open,
  // after file ops / fs events, and on a periodic poll (git state can change
  // without any fs event reaching us — e.g. staging/committing elsewhere).
  const statusBusy = useRef(false);
  async function loadStatuses(quiet: boolean): Promise<void> {
    if (!root || statusBusy.current) return;
    statusBusy.current = true;
    try {
      const repos = (await call("git.all")) as GitRepoStatus[];
      setStatuses(repos);
      if (!quiet) {
        void call("ui.diag", {
          kind: "git-check",
          root,
          repoCount: repos.length,
          repos: repos.map((s) => ({ root: s.root, branch: s.branch, entryCount: s.entries.length })),
        }).catch(() => undefined);
      }
    } catch (err) {
      setStatuses(null);
      if (!quiet) {
        void call("ui.diag", { kind: "git-check", root, error: err instanceof Error ? err.message : String(err) }).catch(() => undefined);
      }
    } finally {
      statusBusy.current = false;
    }
  }
  useEffect(() => {
    if (!root) return;
    void loadStatuses(false);
    const id = setInterval(() => void loadStatuses(true), 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, reloadTick]);

  function notify(message: string): void {
    setToast(message);
  }

  function bump(): void {
    setReloadTick((t) => t + 1);
  }

  function openEntryFs(e: FsEntry): void {
    if (e.kind !== "file") return;
    void openFileByPath(e.path, e.name);
  }

  async function openFileByPath(path: string, title: string): Promise<void> {
    try {
      const r = (await call("fs.read", { path })) as { text: string; truncated: boolean };
      editorRef.current?.openDocument({ uri: path, content: r.text, truncated: r.truncated });
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  }

  function togglePanel(id: PanelId): void {
    setPanel((p) => (p === id ? null : id));
  }

  function toggleTerminal(): void {
    setTermVisible((v) => !v);
  }

  // Git rail icon is only shown once the workspace is a git repo; auto-leave
  // the git panel when a workspace switch lands on a non-repo workspace.
  const gitAvailable = statuses === null || statuses.length > 0;
  useEffect(() => {
    if (!gitAvailable && panel === "git") setPanel("files");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gitAvailable, panel]);

  /* ---------------- right-click routing (window capture = before the shell
     injected menu on document) ---------------- */
  useEffect(() => {
    const host = rootRef.current;
    if (!host) return;
    const onContext = (e: MouseEvent): void => {
      const t = e.target as Element | null;
      if (!t || !host.contains(t)) return;
      e.preventDefault();
      e.stopPropagation();
      const tab = t.closest("[data-ide-tab-id]") as HTMLElement | null;
      if (tab) {
        setMenu({
          x: e.clientX,
          y: e.clientY,
          kind: "tab",
          tabId: tab.getAttribute("data-ide-tab-id") ?? "",
          tabDirty: tab.getAttribute("data-ide-tab-dirty") === "1",
          tabIsFile: tab.getAttribute("data-ide-tab-kind") === "document",
        });
        return;
      }
      const fsEl = t.closest("[data-ide-fs-path]") as HTMLElement | null;
      if (fsEl) {
        setMenu({
          x: e.clientX,
          y: e.clientY,
          kind: "fs",
          fsPath: fsEl.getAttribute("data-ide-fs-path") ?? "",
          fsIsDir: fsEl.getAttribute("data-ide-fs-kind") === "dir",
          fsCode: fsEl.getAttribute("data-ide-fs-code") ?? "",
          fsRepo: fsEl.getAttribute("data-ide-fs-repo") ?? "",
        });
        return;
      }
      // editor area / empty chrome: no menu (still blocks the shell menu)
    };
    window.addEventListener("contextmenu", onContext, true);
    return () => window.removeEventListener("contextmenu", onContext, true);
  }, []);

  /* ---------------- file operations ---------------- */
  function newEntry(isDir: boolean): void {
    const base = selectedDir || root;
    setInput({
      title: isDir ? "新建文件夹" : "新建文件",
      label: isDir ? "文件夹名" : "文件名",
      initial: "",
      action: isDir ? "创建" : "创建",
      onSubmit: async (name) => {
        const clean = name.trim();
        if (!clean) return;
        const target = joinPath(base, clean);
        if (isDir) {
          await call("fs.mkdir", { path: target });
        } else {
          await call("fs.write", { path: target, text: "" });
        }
        bump();
        if (!isDir) await openFileByPath(target, clean);
      },
    });
  }

  function renameEntry(path: string, isDir: boolean): void {
    setInput({
      title: isDir ? "重命名文件夹" : "重命名文件",
      label: "新名称",
      initial: baseName(path),
      action: "重命名",
      onSubmit: async (name) => {
        const clean = name.trim();
        if (!clean || clean === baseName(path)) return;
        await call("fs.rename", { from: path, to: joinPath(dirName(path), clean) });
        bump();
      },
    });
  }

  function removeEntry(path: string, isDir: boolean): void {
    setConfirm({
      title: isDir ? "删除文件夹" : "删除文件",
      message: `确定删除“${path}”？${isDir ? "目录将连同内容一起删除，不可恢复。" : ""}`,
      action: "删除",
      onConfirm: async () => {
        await call("fs.rm", { path });
        bump();
      },
    });
  }

  /** Drag & drop move — confirm before renaming across the tree. */
  function moveEntry(fromPath: string, targetDir: string): void {
    const name = baseName(fromPath);
    const dest = joinPath(targetDir, name);
    if (dest === fromPath) {
      notify(`“${name}”已经在目标位置`);
      return;
    }
    if (targetDir === fromPath || targetDir.startsWith(fromPath + "\\") || targetDir.startsWith(fromPath + "/")) {
      notify("不能把文件夹移动到它自身内部");
      return;
    }
    setConfirm({
      title: "移动文件",
      message: `将 “${fromPath}” 移动到\n“${dest}”？`,
      action: "移动",
      onConfirm: async () => {
        await call("fs.rename", { from: fromPath, to: dest });
        bump();
      },
    });
  }

  function runFsMenu(item: "addVcs" | "newFile" | "newDir" | "rename" | "delete" | "restore" | "unstage" | "ignore" | "copyPath"): void {
    const p = menu?.fsPath ?? "";
    const isDir = menu?.fsIsDir ?? false;
    const repo = menu?.fsRepo ?? "";
    setMenu(null);

    const gitOp = async (op: string, payload: Record<string, unknown>, okMsg: string): Promise<void> => {
      try {
        await call(op, payload);
        notify(okMsg);
        emitIdeBus("git.changed");
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err));
      }
    };

    if (item === "addVcs") {
      if (!p || !repo) return;
      void gitOp("git.add", { repo, file: p }, `已加入 VCS：${baseName(p)}`);
    } else if (item === "restore" || item === "unstage") {
      if (!p || !repo) return;
      void gitOp("git.restore", { repo, file: p, staged: item === "unstage" }, item === "unstage" ? `已取消暂存：${baseName(p)}` : `已回滚：${baseName(p)}`);
    } else if (item === "ignore") {
      if (!p || !repo) return;
      void gitOp("git.ignore", { repo, file: p, isDir }, `已加入忽略列表：${baseName(p)}`);
    } else if (item === "copyPath") {
      if (!p) return;
      void navigator.clipboard?.writeText(p).then(() => notify("路径已复制")).catch(() => notify("复制失败"));
    } else if (item === "newFile" || item === "newDir") {
      const base = isDir ? p : dirName(p);
      setSelectedDir(base);
      newEntry(item === "newDir");
    } else if (item === "rename") {
      renameEntry(p, isDir);
    } else if (item === "delete") {
      removeEntry(p, isDir);
    }
  }

  /** File/folder context menu items, built from the current fs menu target. */
  function fsMenuItems(): MenuItem[] {
    const items: MenuItem[] = [];
    const p = menu?.fsPath ?? "";
    const isDir = menu?.fsIsDir ?? false;
    const code = menu?.fsCode ?? "";
    const repo = menu?.fsRepo ?? "";

    if (!isDir && repo && code === "?") {
      items.push({ label: "加入 VCS", run: () => runFsMenu("addVcs") });
    }
    if (!isDir && repo && (code === "M" || code === "A")) {
      items.push({ label: "取消暂存", run: () => runFsMenu("unstage") });
      items.push({ label: "回滚（放弃更改）", run: () => runFsMenu("restore"), danger: true });
    }
    if (repo) {
      items.push({ label: "加入忽略列表", run: () => runFsMenu("ignore") });
    }
    if (isDir) {
      items.push({ label: "新建文件", run: () => runFsMenu("newFile") });
      items.push({ label: "新建文件夹", run: () => runFsMenu("newDir") });
    }
    if (!isDir) {
      items.push({ label: "复制路径", run: () => runFsMenu("copyPath") });
    }
    items.push({ label: "重命名", run: () => runFsMenu("rename") });
    items.push({ label: "删除", run: () => runFsMenu("delete"), danger: true });
    void p;
    return items;
  }

  /* ---------------- tab menu ---------------- */
  function runTabMenu(action: "save" | "close" | "closeOthers" | "closeAll"): void {
    const id = menu?.tabId ?? "";
    setMenu(null);
    const g = editorRef.current;
    if (!g) return;
    if (action === "save") g.saveTab(id);
    else if (action === "close") g.close(id);
    else if (action === "closeOthers") g.closeOthers(id);
    else g.closeAll();
  }

  /** Tab context menu items (right-click on an editor tab). */
  function tabMenuItems(): MenuItem[] {
    const dirty = menu?.tabDirty ?? false;
    const isFile = menu?.tabIsFile ?? false;
    const items: MenuItem[] = [];
    if (dirty && isFile) items.push({ label: "保存", run: () => runTabMenu("save") });
    items.push({ label: "关闭", run: () => runTabMenu("close") });
    items.push({ label: "关闭其他", run: () => runTabMenu("closeOthers") });
    items.push({ label: "关闭所有", run: () => runTabMenu("closeAll") });
    return items;
  }

  /* ---------------- render ---------------- */
  const bottomH = Math.max(100, Math.min(Math.round((mainColH - 6) * termRatio), Math.round(mainColH * 0.75)));
  return (
    <div
      ref={rootRef}
      style={{
        display: "flex", flexDirection: "row", height: "100%", minWidth: 0, position: "relative",
        overflow: "hidden",
      }}
    >
      {/* main column: editors */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          height: termVisible ? `calc(100% - ${bottomH}px)` : "100%",
          overflow: "hidden",
        }}
      >
        <div data-ide-editor style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            {root ? (
              <EditorGroup ref={editorRef} onNotify={notify} />
            ) : (
              <EmptyState root={root} status={status} note={doc.note} onRetry={() => void call("resolve", { sessionId: doc.sessionId })} />
            )}
          </div>
        </div>
      </div>

      {/* right function panel (width draggable) */}
      {panel && (
        <>
          <div
            onMouseDown={startPanelDrag}
            onMouseEnter={() => {
              setPanelDividerHover(true);
              const r = rootRef.current;
              const el = r ? (r.querySelector("[data-ide-right-panel]") as HTMLElement | null) : null;
              if (r && el) setGuide({ axis: "x", pos: el.getBoundingClientRect().left - r.getBoundingClientRect().left });
            }}
            onMouseLeave={() => {
              setPanelDividerHover(false);
              if (!panelDragging) setGuide(null);
            }}
            title="拖动调整面板宽度"
            style={{
              width: 10,
              flex: "none",
              cursor: "col-resize",
              position: "relative",
              alignSelf: "flex-start",
              height: termVisible ? `calc(100% - ${bottomH}px)` : "100%",
              zIndex: 3,
            }}
          ></div>
          <div
            data-ide-right-panel
            style={{
              width: panelW,
              flex: "none",
              borderLeft: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))",
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              background: "var(--dsw-alias-bg-base, #fff)",
              height: termVisible ? `calc(100% - ${bottomH}px)` : "100%",
            }}
          >
          <div
            style={{
              padding: "6px 10px", fontSize: 12, fontWeight: 600, letterSpacing: ".02em", flex: "none",
              borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))",
              color: "var(--dsw-alias-label-primary, #0f1115)",
            }}
          >
            {panel === "files" ? "文件" : "Git"}
          </div>

          {panel === "files" && (
            <div
              style={{
                display: "flex", gap: 4, padding: "4px 8px", flex: "none", justifyContent: "flex-end",
                borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))",
              }}
            >
              <IconTooltipBtn title="新建文件" onClick={() => newEntry(false)}>
                {NEW_FILE_ICON}
              </IconTooltipBtn>
              <IconTooltipBtn title="新建文件夹" onClick={() => newEntry(true)}>
                {NEW_DIR_ICON}
              </IconTooltipBtn>
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            {panel === "files" ? (
              root ? (
                <FileTree
                  root={root}
                  onOpen={openEntryFs}
                  statuses={statuses}
                  onSelectDir={setSelectedDir}
                  expandedPaths={expandedPaths}
                  onExpandedChange={setExpandedPaths}
                  reloadTick={reloadTick}
                  onMove={moveEntry}
                />
              ) : (
                <EmptyState root={root} status={status} note={doc.note} onRetry={() => void call("resolve", { sessionId: doc.sessionId })} />
              )
            ) : root ? (
              <GitHistory root={root} refreshTick={reloadTick} />
            ) : (
              <div style={{ padding: 12, fontSize: 12.5, color: "var(--dsw-alias-label-secondary, #61666b)" }}>等待工作区…</div>
            )}
          </div>
          </div>
        </>
      )}

      {/* right-most icon rail */}
      <div
        style={{
          width: 40, flex: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
          paddingTop: 6, borderLeft: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))",
          background: "var(--dsw-alias-bg-layer-1, #fafafa)",
        }}
      >
        {(
          [
            { id: "files" as PanelId, icon: FILES_ICON, tip: "文件" },
            ...(gitAvailable ? [{ id: "git" as PanelId, icon: GIT_ICON, tip: "Git" }] : []),
          ]
        ).map((b) => (
          <button
            key={b.id}
            type="button"
            title={b.tip}
            aria-label={b.tip}
            aria-pressed={panel === b.id}
            onClick={() => togglePanel(b.id)}
            style={{
              width: 32, height: 32, border: "none", borderRadius: 8, cursor: "pointer", display: "inline-flex",
              alignItems: "center", justifyContent: "center", flex: "none",
              color: panel === b.id ? "var(--dsw-alias-label-primary, #0f1115)" : "var(--dsw-alias-label-tertiary, #81858c)",
              background: panel === b.id ? "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.08))" : "transparent",
            }}
          >
            {b.icon}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          title={termVisible ? "隐藏终端面板" : "显示终端面板"}
          aria-label="终端面板"
          aria-pressed={termVisible}
          onClick={toggleTerminal}
          style={{
            width: 32, height: 32, border: "none", borderRadius: 8, cursor: "pointer", display: "inline-flex",
            alignItems: "center", justifyContent: "center", flex: "none", marginBottom: 8,
            color: termVisible ? "var(--dsw-alias-label-primary, #0f1115)" : "var(--dsw-alias-label-tertiary, #81858c)",
            background: termVisible ? "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.08))" : "transparent",
          }}
        >
          {TERM_ICON}
        </button>
      </div>

      {/* context menu */}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.kind === "tab" ? tabMenuItems() : fsMenuItems()}
          onClose={() => setMenu(null)}
        />
      )}

      {/* dialogs */}
      {input && (
        <InputDialogBox
          title={input.title}
          label={input.label}
          initial={input.initial}
          action={input.action}
          onCancel={() => setInput(null)}
          onSubmit={async (value) => {
            try {
              await input.onSubmit(value);
              setInput(null);
            } catch (err) {
              notify(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      )}
      {confirm && (
        <ConfirmDialogBox
          title={confirm.title}
          message={confirm.message}
          action={confirm.action}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              await confirm.onConfirm();
              setConfirm(null);
            } catch (err) {
              notify(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      )}

      {/* toast */}
      {toast && (
        <div
          style={{
            position: "absolute", bottom: termVisible ? bottomH + 14 : 12, left: "50%", transform: "translateX(-50%)",
            padding: "6px 12px", borderRadius: 8, fontSize: 12, whiteSpace: "nowrap", zIndex: 80,
            background: "var(--dsw-specific-info-bg, rgba(30,110,220,.1))",
            color: "var(--dsw-alias-label-primary, #0f1115)", boxShadow: "0 4px 16px rgba(0,0,0,.12)",
          }}
        >
          {toast}
        </div>
      )}

      {/* floating divider guide (rendered in the outer container, hover/drag) */}
      {guide && (
        <div
          style={{
            position: "absolute",
            zIndex: 70,
            pointerEvents: "none",
            borderRadius: 2,
            background: "rgba(64,150,255,.6)",
            ...(guide.axis === "y"
              ? { left: 0, right: 40, top: guide.pos - 1, height: 3 }
              : { top: 0, bottom: termVisible ? bottomH : 0, left: guide.pos - 1, width: 3 }),
          }}
        />
      )}

      {termVisible && (
        <div
          onMouseDown={startDividerDrag}
          onMouseEnter={() => {
            setDividerHover(true);
            const r = rootRef.current;
            const wrap = r ? (r.querySelector("[data-ide-term]") as HTMLElement | null) : null;
            if (r && wrap) setGuide({ axis: "y", pos: wrap.getBoundingClientRect().top - r.getBoundingClientRect().top });
          }}
          onMouseLeave={() => {
            setDividerHover(false);
            if (!termDragging) setGuide(null);
          }}
          title="拖动调整高度"
          style={{
            position: "absolute",
            left: 0,
            right: 40,
            bottom: `${Math.max(0, bottomH - 5)}px`,
            height: 10,
            zIndex: 62,
            cursor: "row-resize",
          }}
        />
      )}

      {/* terminal bottom panel — full-width row under every column */}
      <div
        data-ide-term
        style={{
          display: termVisible ? "block" : "none",
          position: "absolute",
          left: 0,
          right: 40,
          bottom: 0,
          height: termVisible ? bottomH : 0,
          borderTop: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10))",
          borderRight: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))",
          background: "var(--dsw-alias-bg-base, #fff)",
          overflow: "hidden",
          zIndex: 30,
        }}
      >
        <div style={{ position: "absolute", top: 1, left: 0, right: 0, bottom: 0 }}>
          <TerminalPanel visible={termVisible} workspaceKey={root} />
        </div>
      </div>
    </div>
  );
}

interface MenuItem {
  label: string;
  run: () => void;
  danger?: boolean;
}

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }): ReactElement {
  useEffect(() => {
    const close = (e: MouseEvent): void => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest("[data-ide-menu]")) return;
      onClose();
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", close, true);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("keydown", esc, true);
    };
  }, [onClose]);

  return (
    <div
      data-ide-menu="1"
      style={{
        position: "fixed",
        left: Math.min(x, window.innerWidth - 170),
        top: Math.min(y, window.innerHeight - items.length * 30 - 16),
        zIndex: 90,
        minWidth: 160,
        padding: 4,
        borderRadius: 10,
        border: "1px solid var(--dsw-alias-border-inverted, rgba(0,0,0,.08))",
        background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #fff))",
        boxShadow: "0 8px 24px rgba(0,0,0,.12)",
        fontSize: 13,
        color: "var(--dsw-alias-label-primary, #0f1115)",
      }}
    >
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          onClick={() => {
            onClose();
            it.run();
          }}
          style={{
            display: "block", width: "100%", textAlign: "left", padding: "6px 10px",
            border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13,
            background: "transparent",
            color: it.danger ? "var(--dsw-alias-danger, #c43c2d)" : "var(--dsw-alias-label-primary, #0f1115)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.07))")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function InputDialogBox({
  title,
  label,
  initial,
  action,
  onCancel,
  onSubmit,
}: {
  title: string;
  label: string;
  initial: string;
  action: string;
  onCancel: () => void;
  onSubmit: (value: string) => Promise<void>;
}): ReactElement {
  const [value, setValue] = useState(initial);
  return (
    <DialogShell onCancel={onCancel}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{title}</div>
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void onSubmit(value);
          if (e.key === "Escape") onCancel();
        }}
        style={{
          width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: 13,
          border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14))", borderRadius: 8,
          background: "var(--dsw-alias-bg-base, #fff)",
          color: "var(--dsw-alias-label-primary, #0f1115)",
          outline: "none",
        }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <DialogButton onClick={onCancel}>取消</DialogButton>
        <DialogButton primary onClick={() => void onSubmit(value)}>
          {action}
        </DialogButton>
      </div>
    </DialogShell>
  );
}

function ConfirmDialogBox({
  title,
  message,
  action,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  action: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}): ReactElement {
  return (
    <DialogShell onCancel={onCancel}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 12.5, lineHeight: 1.7, color: "var(--dsw-alias-label-secondary, #61666b)", wordBreak: "break-all", maxHeight: 160, overflow: "auto" }}>
        {message}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <DialogButton onClick={onCancel}>取消</DialogButton>
        <DialogButton danger onClick={() => void onConfirm()}>
          {action}
        </DialogButton>
      </div>
    </DialogShell>
  );
}

function DialogShell({ onCancel, children }: { onCancel: () => void; children: ReactElement | ReactElement[] }): ReactElement {
  useEffect(() => {
    const esc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [onCancel]);
  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      style={maskStyle(100)}
    >
      <div
        style={{
          width: 300, padding: 16, borderRadius: 12,
          background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #fff))",
          boxShadow: "0 16px 48px rgba(0,0,0,.18)",
          color: "var(--dsw-alias-label-primary, #0f1115)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function IconTooltipBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactElement;
}): ReactElement {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 26, height: 26, border: "none", borderRadius: 6, cursor: "pointer",
        color: "var(--dsw-alias-label-secondary, #61666b)",
        background: "transparent",
      }}
    >
      {children}
    </button>
  );
}

function DialogButton({
  children,
  primary,
  danger,
  onClick,
}: {
  children: string;
  primary?: boolean;
  danger?: boolean;
  onClick: () => void;
}): ReactElement {
  const bg = danger
    ? "var(--dsw-specific-danger-bg, rgba(196,60,45,.12))"
    : primary
      ? "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.1))"
      : "transparent";
  const fg = danger
    ? "var(--dsw-alias-danger, #c43c2d)"
    : "var(--dsw-alias-label-primary, #0f1115)";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "5px 14px", border: danger ? "1px solid var(--dsw-alias-border-danger, rgba(196,60,45,.35))" : "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))",
        borderRadius: 8, cursor: "pointer", fontSize: 12.5, background: bg, color: fg,
      }}
    >
      {children}
    </button>
  );
}

function EmptyState({ root, status, note, onRetry }: { root: string; status: string; note: string; onRetry: () => void }): ReactElement {
  if (root) {
    return (
      <div style={{ padding: 24, fontSize: 13, lineHeight: 1.8, color: "var(--dsw-alias-label-secondary, #61666b)" }}>
        工作区已就绪。在右侧 <b>文件</b> 面板打开文件，Ctrl/Cmd+S 保存。
      </div>
    );
  }
  if (status === "unavailable") {
    return (
      <div style={{ padding: 24, fontSize: 13, lineHeight: 1.8, color: "var(--dsw-alias-label-secondary, #61666b)" }}>
        设置命名空间不可用（settingsScope 未连接）。请检查 dev 实例日志中 dsh-ide 是否正常装入。
      </div>
    );
  }
  return (
    <div style={{ padding: 24, fontSize: 13, lineHeight: 1.8, color: "var(--dsw-alias-label-secondary, #61666b)" }}>
      {status === "loading" ? "正在解析工作区…" : note || "等待工作区解析…"}
      {!root && (
        <button type="button" onClick={onRetry} style={{ display: "block", marginTop: 10, padding: "5px 12px", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, background: "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.08))" }}>
          重新解析
        </button>
      )}
    </div>
  );
}
