/**
 * dsh-ide — VSCode-style editor group.
 *
 * Owns the editor-area tab strip and the live editor surfaces:
 *   - documents open as tabs (dirty dot, close on the tab, Cmd/Ctrl+S save)
 *   - non-document pane kinds (terminal / diff) use the same tab strip and
 *     are placeholders until their milestones
 *   - all panes stay mounted (hidden with display:none) so unsaved edits
 *     survive tab switches
 *
 * The group is controlled imperatively through `EditorGroupHandle` so the
 * workbench shell (file tree, rail, git panel) stays UI-agnostic.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactElement,
} from "react";
import type { ITextDocument } from "./types";
import { createTextDocument, type OpenDocumentInput } from "./document";
import { createMonacoEditor } from "./monacoEditor";
import { call } from "../ideApi";

export type PaneKind = "document" | "terminal" | "diff";

interface PaneState {
  id: string;
  kind: PaneKind;
  title: string;
  document: ITextDocument | null;
  initialContent: string;
  dirty: boolean;
}

interface PaneSaver {
  save(): Promise<void>;
  reloadText(text: string): boolean;
  isDirty(): boolean;
  getText(): string;
  layout(): void;
  uri: string;
  title: string;
  truncated: boolean;
}

/** Serializable tab used for per-workspace state caching. */
export interface EditorTabSnapshot {
  uri: string;
  title: string;
  truncated: boolean;
  content: string;
  dirty: boolean;
}

export interface EditorGroupSnapshot {
  tabs: EditorTabSnapshot[];
  activeUri: string | null;
}

export interface EditorGroupHandle {
  /** Open (or focus) a text document tab; reads nothing — caller supplies content. */
  openDocument(input: OpenDocumentInput): void;
  openPane(kind: "terminal" | "diff", title: string): void;
  close(id: string): void;
  closeAll(): void;
  /** Close every other tab (dirty ones stay open, with a toast). */
  closeOthers(id: string): void;
  /** Save a specific tab (only file tabs have a save implementation). */
  saveTab(id: string): void;
  /** Re-read every open, non-dirty document from disk after external file
   *  changes (the file watcher bumped fsRev). Returns skipped dirty names. */
  syncFromDisk(): Promise<string[]>;
  /** Re-measure all open editors (after the overlay is shown again). */
  relayout(): void;
  /** Snapshot open documents for per-workspace state caching. */
  snapshot(): EditorGroupSnapshot;
  /** Replace all panes with the restored documents (per-workspace switch). */
  restore(snap: EditorGroupSnapshot): void;
}

export interface EditorGroupProps {
  onNotify(message: string): void;
}

const CLOSE_ICON = (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <path d="m4 4 8 8M12 4l-8 8" />
  </svg>
);

export const EditorGroup = forwardRef<EditorGroupHandle, EditorGroupProps>(function EditorGroup(
  { onNotify },
  ref
): ReactElement {
  const [panes, setPanes] = useState<PaneState[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const idSeq = useRef(0);
  const savers = useRef<Record<string, PaneSaver>>({});

  const nextId = (prefix: string): string => {
    idSeq.current += 1;
    return `${prefix}:${idSeq.current}`;
  };

  function activate(id: string): void {
    setActiveId(id);
  }

  function close(id: string): void {
    const pane = panes.find((p) => p.id === id);
    if (pane && pane.dirty) {
      onNotify(`“${pane.title}”有未保存修改：请先 Ctrl/Cmd+S 保存`);
      return;
    }
    setPanes((ps) => ps.filter((p) => p.id !== id));
    setActiveId((a) => {
      if (a !== id) return a;
      const rest = panes.filter((p) => p.id !== id);
      const prev = rest[rest.length - 1];
      return prev ? prev.id : null;
    });
  }

  useImperativeHandle(ref, () => ({
    openDocument(input: OpenDocumentInput): void {
      const uri = input.uri;
      const existing = panes.find((p) => p.document && p.document.uri === uri);
      if (existing) {
        setActiveId(existing.id);
        return;
      }
      const id = nextId("file");
      const pane: PaneState = {
        id,
        kind: "document",
        title: createTextDocument(input).fileName,
        document: createTextDocument(input),
        initialContent: input.content,
        dirty: false,
      };
      setPanes((ps) => [...ps, pane]);
      setActiveId(id);
    },
    openPane(kind, title): void {
      const id = nextId(kind);
      setPanes((ps) => [...ps, { id, kind, title, document: null, initialContent: "", dirty: false }]);
      setActiveId(id);
    },
    close(id): void {
      close(id);
    },
    closeAll(): void {
      setPanes((ps) => {
        const dirty = ps.filter((p) => p.dirty);
        if (dirty.length > 0) {
          onNotify(`有 ${dirty.length} 个未保存标签，已保留（请先保存再关闭全部）`);
        }
        const next = dirty.length > 0 ? dirty : [];
        if (next.length === 0) setActiveId(null);
        return next;
      });
    },
    closeOthers(id): void {
      setPanes((ps) => {
        const target = ps.find((p) => p.id === id);
        if (!target) return ps;
        const dirtyOthers = ps.filter((p) => p.id !== id && p.dirty);
        if (dirtyOthers.length > 0) {
          onNotify(`有 ${dirtyOthers.length} 个未保存标签，已保留`);
        }
        const next = ps.filter((p) => p.id === id || p.dirty);
        if (next.length === 0) setActiveId(null);
        else setActiveId(id);
        return next;
      });
    },
    saveTab(id): void {
      const s = savers.current[id];
      if (s) void s.save();
    },
    async syncFromDisk(): Promise<string[]> {
      const skipped: string[] = [];
      const entries = Object.entries(savers.current);
      for (const [id, api] of entries) {
        if (api.isDirty()) {
          skipped.push(api.uri.split(/[\\/]/).pop() ?? api.uri);
          continue;
        }
        try {
          const r = (await call("fs.read", { path: api.uri })) as { text: string };
          api.reloadText(r.text);
        } catch {
          /* keep the open buffer on read errors */
        }
        void id;
      }
      return skipped;
    },
    relayout(): void {
      for (const api of Object.values(savers.current)) {
        try {
          api.layout();
        } catch {
          /* ignore */
        }
      }
    },
    snapshot(): EditorGroupSnapshot {
      const tabs: EditorTabSnapshot[] = [];
      for (const p of panes) {
        if (p.kind !== "document" || !p.document) continue;
        const api = savers.current[p.id];
        tabs.push({
          uri: p.document.uri,
          title: p.document.fileName,
          truncated: p.document.truncated,
          content: api ? api.getText() : p.initialContent,
          dirty: p.dirty,
        });
      }
      const activePane = panes.find((p) => p.id === activeId && p.document);
      return { tabs, activeUri: activePane?.document?.uri ?? tabs[tabs.length - 1]?.uri ?? null };
    },
    restore(snap: EditorGroupSnapshot): void {
      const next: PaneState[] = snap.tabs.map((t) => ({
        id: nextId("file"),
        kind: "document",
        title: t.title,
        document: createTextDocument({ uri: t.uri, content: t.content, truncated: t.truncated }),
        initialContent: t.content,
        dirty: t.dirty,
      }));
      setPanes(next);
      const active = snap.activeUri ? next.find((p) => p.document && p.document.uri === snap.activeUri) : undefined;
      setActiveId(active ? active.id : next[next.length - 1]?.id ?? null);
    },
  }));

  const active = panes.find((p) => p.id === activeId) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
      {panes.length > 0 ? (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 2,
            padding: "4px 6px 0", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))",
            overflowX: "auto", flex: "none",
          }}
        >
          {panes.map((p) => (
            <div
              key={p.id}
              onClick={() => activate(p.id)}
              title={p.document ? p.document.uri : p.title}
              data-ide-tab-id={p.id}
              data-ide-tab-title={p.title}
              data-ide-tab-kind={p.kind}
              data-ide-tab-dirty={p.dirty ? "1" : "0"}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, flex: "none",
                maxWidth: 200, padding: "5px 6px 5px 10px", cursor: "pointer",
                borderRadius: "8px 8px 0 0", fontSize: 12, userSelect: "none",
                color: p.id === activeId ? "var(--dsw-alias-label-primary, #0f1115)" : "var(--dsw-alias-label-tertiary, #81858c)",
                background: p.id === activeId ? "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))" : "transparent",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</span>
              {p.dirty && (
                <span
                  style={{
                    width: 7, height: 7, borderRadius: "50%", flex: "none",
                    background: "var(--dsw-alias-label-secondary, #61666b)",
                  }}
                />
              )}
              <span
                role="button"
                aria-label="关闭"
                title={p.dirty ? "先保存再关闭" : "关闭"}
                onClick={(ev) => {
                  ev.stopPropagation();
                  close(p.id);
                }}
                style={{ display: "inline-flex", flex: "none", padding: 2, borderRadius: 4, cursor: "pointer" }}
              >
                {CLOSE_ICON}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            flex: "none", padding: "6px 12px",
            borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))",
            fontSize: 12, color: "var(--dsw-alias-label-tertiary, #81858c)",
          }}
        >
          点击右侧文件打开 · Ctrl/Cmd+S 保存
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {panes.map((p) => (
          <div
            key={p.id}
            style={{
              position: "absolute",
              inset: 0,
              // All panes stay mounted AND sized (Monaco/CM need real
              // dimensions); stacking via z-index keeps the active one on top.
              zIndex: p.id === activeId ? 2 : 1,
              visibility: p.id === activeId ? "visible" : "hidden",
              background: "var(--dsw-alias-bg-base, #fff)",
            }}
          >
            <PaneView
              pane={p}
              onRegister={(api) => {
                if (api) savers.current[p.id] = api;
                else delete savers.current[p.id];
              }}
              onDirty={(d) =>
                setPanes((ps) => ps.map((x) => (x.id === p.id && x.dirty !== d ? { ...x, dirty: d } : x)))
              }
              onSaved={() => {
                onNotify(`已保存 ${p.title}`);
              }}
              onError={(m) => onNotify(m)}
            />
          </div>
        ))}
      </div>
    </div>
  );
});

interface PaneViewProps {
  pane: PaneState;
  onRegister: (api: PaneSaver | null) => void;
  onDirty: (dirty: boolean) => void;
  onSaved: () => void;
  onError: (message: string) => void;
}

/** One pane surface: Monaco for documents, placeholder for others. */
function PaneView({ pane, onRegister, onDirty, onSaved, onError }: PaneViewProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (pane.kind !== "document" || !pane.document || !hostRef.current) return undefined;
    const { editor, instance } = createMonacoEditor({
      document: pane.document,
      initialContent: pane.initialContent,
      initialDirty: pane.dirty,
      host: hostRef.current,
      callbacks: {
        onDirtyChange: (_doc, d) => onDirty(d),
        onSaved: () => onSaved(),
        onError: (m) => onError(m),
      },
    });
    onRegister({
      uri: pane.document.uri,
      title: pane.document.fileName,
      truncated: pane.document.truncated,
      save: () => editor.save(),
      reloadText: (text) => editor.reloadText(text),
      isDirty: () => editor.isDirty(),
      getText: () => editor.getText(),
      layout: () => instance.layout(),
    });
    return () => {
      onRegister(null);
      editor.dispose();
    };
    // Mounted once per pane id; document/content are immutable for the pane's
    // lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (pane.kind === "document") {
    return (
      <div style={{ position: "relative", height: "100%" }}>
        <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
        {pane.document && pane.document.truncated && (
          <span
            title="只读预览（文件超过 512KB，已截断）"
            style={{
              position: "absolute", top: 6, right: 8, display: "inline-flex", alignItems: "center", gap: 4,
              padding: "3px 6px", borderRadius: 6, fontSize: 11, lineHeight: 1,
              color: "var(--dsw-alias-label-tertiary, #81858c)",
              background: "var(--dsw-alias-bg-layer-2, rgba(255,255,255,.85))",
              border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))",
              boxShadow: "0 1px 4px rgba(0,0,0,.06)", pointerEvents: "none",
            }}
          >
            截断只读
          </span>
        )}
      </div>
    );
  }
  return (
    <div style={{ padding: 16, fontSize: 12.5, color: "var(--dsw-alias-label-secondary, #61666b)" }}>
      {pane.kind === "terminal"
        ? "终端将在后续里程碑接入（xterm + node-pty）；关闭含运行进程的终端时会先确认/提供终止。"
        : "diff 标签将在 Git 变更里程碑接入（对 HEAD / 指定版本比较）。"}
    </div>
  );
}
