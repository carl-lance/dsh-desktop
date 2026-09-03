/**
 * dsh-ide — Monaco adapter implementing the editor surface (IEditor).
 *
 * Replaces the earlier CodeMirror adapter behind the same contract, so the
 * EditorGroup / workbench layers are untouched. 60+ monarch languages come
 * from the bundled basic-languages contribution; no language-service workers
 * are used (semantics can be enabled later in self-hosted mode).
 */

import type * as monacoNs from "monaco-editor/editor/editor.api";
import { monaco, ensureMonacoTheme } from "./monacoHost";
import type { IEditor, IEditorHost, ITextDocument } from "./types";
import { call } from "../ideApi";

export interface CreateMonacoEditorInput {
  document: ITextDocument;
  initialContent: string;
  host: HTMLDivElement;
  callbacks: IEditorHost;
  /** Buffer starts dirty (restored unsaved content from the workspace cache). */
  initialDirty?: boolean;
}

const MONO_FONT =
  'var(--ds-font-family-mono, Consolas, "SF Mono", Menlo, "Courier New", monospace)';

/** Create one editor surface for an open document. */
export function createMonacoEditor(input: CreateMonacoEditorInput): { editor: IEditor; instance: monacoNs.editor.IStandaloneCodeEditor } {
  const { document: doc, initialContent, host, callbacks } = input;
  ensureMonacoTheme();

  const instance = monaco.editor.create(host, {
    value: initialContent,
    ...(doc.languageId ? { language: doc.languageId } : {}),
    readOnly: doc.isReadonly,
    theme: "dsh-ide",
    fontFamily: MONO_FONT,
    fontSize: 12.5,
    lineHeight: 20,
    minimap: { enabled: true },
    automaticLayout: true,
    scrollBeyondLastLine: false,
    wordWrap: "off",
    folding: true,
    renderLineHighlight: "all",
    glyphMargin: false,
    lineNumbersMinChars: 3,
    overviewRulerLanes: 0,
    padding: { top: 10, bottom: 16 },
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  });

  let dirty = !!input.initialDirty;
  let suppressing = false;
  const contentSub = instance.onDidChangeModelContent(() => {
    if (suppressing) return;
    if (!dirty) {
      dirty = true;
      callbacks.onDirtyChange(doc, true);
    }
  });

  const save = async (): Promise<void> => {
    try {
      await call("fs.write", { path: doc.uri, text: instance.getValue() });
      if (dirty) {
        dirty = false;
        callbacks.onDirtyChange(doc, false);
      } else {
        callbacks.onDirtyChange(doc, false);
      }
      callbacks.onSaved(doc);
    } catch (err) {
      callbacks.onError(err instanceof Error ? err.message : String(err));
    }
  };

  // Cmd/Ctrl+S → save. Monaco's standalone editor has no public command
  // removal API, so bind a native keydown on the editor DOM instead.
  const domNode = instance.getDomNode();
  const onKeyDown = (e: KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      void save();
    }
  };
  domNode.addEventListener("keydown", onKeyDown, true);

  const editor: IEditor = {
    uri: doc.uri,
    fileName: doc.fileName,
    languageId: doc.languageId,
    isReadonly: doc.isReadonly,
    truncated: doc.truncated,
    getText: () => instance.getValue(),
    save,
    isDirty: () => dirty,
    reloadText: (text: string): boolean => {
      if (dirty || doc.isReadonly) return false;
      if (instance.getValue() === text) return false; // nothing changed — keep cursor
      const selection = instance.getSelection();
      const scrollTop = instance.getScrollTop();
      const scrollLeft = instance.getScrollLeft();
      suppressing = true;
      instance.setValue(text);
      suppressing = false;
      if (selection) {
        try {
          instance.setSelection(selection);
        } catch {
          /* stale selection */
        }
      }
      instance.setScrollTop(scrollTop);
      instance.setScrollLeft(scrollLeft);
      markDirty(false);
      return true;
    },
    focus: () => instance.focus(),
    dispose: () => {
      contentSub.dispose();
      domNode.removeEventListener("keydown", onKeyDown, true);
      const model = instance.getModel();
      instance.dispose();
      model?.dispose();
    },
  };

  // Diagnostics: report DOM facts to the host after layout settles, so
  // CSS/layout problems can be diagnosed without looking at the UI.
  try {
    setTimeout(() => {
      try {
        const styleTags = document.head ? document.head.querySelectorAll("style").length : -1;
        const mcTags = document.head ? document.head.querySelectorAll("style[data-mc]").length : -1;
        const monacoNode = domNode;
        const ta = monacoNode ? monacoNode.querySelector("textarea") : null;
        const margin = monacoNode ? monacoNode.querySelector(".margin") : null;
        const hr = input.host.getBoundingClientRect();
        void call("ui.diag", {
          kind: "editor-open",
          uri: doc.uri,
          languageId: doc.languageId,
          hostSize: { w: Math.round(hr.width), h: Math.round(hr.height) },
          styleTags,
          mcStyleTags: mcTags,
          lines: instance.getModel()?.getLineCount() ?? -1,
          registeredLanguages: (() => {
            try {
              const langs = monaco.languages.getLanguages();
              return { count: langs.length, ids: langs.map((l) => l.id).sort().join(",") };
            } catch {
              return { count: -1, ids: "" };
            }
          })(),
          hasMonacoNode: !!monacoNode,
          textarea: ta
            ? (() => {
                const cs = getComputedStyle(ta);
                const r = ta.getBoundingClientRect();
                return {
                  display: cs.display,
                  position: cs.position,
                  opacity: cs.opacity,
                  w: Math.round(r.width),
                  h: Math.round(r.height),
                  resize: cs.resize,
                };
              })()
            : null,
          margin: margin
            ? { w: margin.getBoundingClientRect().width, display: getComputedStyle(margin).display }
            : null,
        }).catch(() => undefined);
      } catch {
        /* diag is best-effort */
      }
    }, 1200);
  } catch {
    /* diag is best-effort */
  }

  return { editor, instance };
}
