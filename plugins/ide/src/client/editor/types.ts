/**
 * dsh-ide — VSCode-inspired editor contracts (subset).
 *
 * Only what the workbench needs: a text document model, a language id, and
 * the editor surface lifecycle. Concrete Monaco behaviour lives in
 * monacoEditor.ts / monacoHost.ts; nothing above this layer touches Monaco.
 */

/**
 * Language of a document. Values are Monaco monarch language ids (from the
 * bundled basic-languages set, e.g. "typescript", "cpp", "python");
 * "" means plain text (no highlighting).
 */
export type LanguageId = string;

/** An open text document (VSCode `TextDocument` subset). */
export interface ITextDocument {
  /** Absolute path on disk — the document's identity. */
  readonly uri: string;
  /** Basename shown on the tab. */
  readonly fileName: string;
  /** Derived language for highlighting ("" = plain text). */
  readonly languageId: LanguageId;
  /** True when the pane may not be edited (truncated preview). */
  readonly isReadonly: boolean;
  /** True when the file was truncated at load (>512KB). */
  readonly truncated: boolean;
}

/** Callbacks an editor surface reports to its owner. */
export interface IEditorHost {
  onDirtyChange(document: ITextDocument, dirty: boolean): void;
  onSaved(document: ITextDocument): void;
  onError(message: string): void;
}

/** A live editor surface (VSCode `IEditor` subset). */
export interface IEditor extends ITextDocument {
  /** Current content of the buffer. */
  getText(): string;
  /** Persist the buffer through the host `fs.write` op. */
  save(): Promise<void>;
  /** True while the buffer has unsaved edits. */
  isDirty(): boolean;
  /** Replace buffer content from disk if clean; returns false (skipped) when
   *  the document has unsaved edits. */
  reloadText(text: string): boolean;
  /** Give the surface keyboard focus. */
  focus(): void;
  /** Tear the surface down. */
  dispose(): void;
}
