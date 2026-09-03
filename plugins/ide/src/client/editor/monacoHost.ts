/**
 * dsh-ide — Monaco host (single place that knows where monaco comes from).
 *
 * Bundled mode: monaco ESM is compiled into the plugin client bundle. We
 * import the editor API + a curated set of editor features + the monarch
 * basic-languages contribution (60+ languages, no language-service workers,
 * no static assets).
 *
 * Migration seam: switching to self-hosted mode later only touches this file
 * (load monaco from the host static server + AMD loader and point
 * MonacoEnvironment.baseUrl/getWorker there); nothing above imports monaco
 * directly.
 */

import * as monaco from "monaco-editor/editor/editor.api";

// Editor features (subset, paths verified against monaco-editor 0.56 esm).
import "monaco-editor/editor/contrib/find/browser/findController";
import "monaco-editor/editor/contrib/clipboard/browser/clipboard";
import "monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching";
import "monaco-editor/editor/contrib/folding/browser/folding";
import "monaco-editor/editor/contrib/comment/browser/comment";
import "monaco-editor/editor/contrib/indentation/browser/indentation";
import "monaco-editor/editor/contrib/format/browser/formatActions";
import "monaco-editor/editor/contrib/linesOperations/browser/linesOperations";
import "monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter";
import "monaco-editor/editor/contrib/links/browser/links";
import "monaco-editor/editor/contrib/contextmenu/browser/contextmenu";
import "monaco-editor/editor/contrib/gotoError/browser/gotoError";
import "monaco-editor/basic-languages/monaco.contribution";
// json (like css/html/ts) ships outside basic-languages via the language
// contribution; import it so .json files get monarch highlighting. Its
// worker-backed validation features stay idle behind the stub worker.
import "monaco-editor/language/json/monaco.contribution";

let themed = false;

/**
 * We bundle monaco with esbuild (no static assets, no language-service
 * workers). Without MonacoEnvironment, monaco tries to derive worker URLs via
 * `new URL(..., import.meta.url)` — which is unavailable in the bundled CJS
 * client — logging "Could not create web worker(s)" / "Invalid URL" on every
 * editor. Hand it a harmless stub worker so nothing is ever fetched.
 */
function ensureWorkerStub(): void {
  const g = globalThis as { MonacoEnvironment?: { getWorker?: unknown } };
  if (!g.MonacoEnvironment) g.MonacoEnvironment = {};
  if (!g.MonacoEnvironment.getWorker) {
    g.MonacoEnvironment.getWorker = (): Worker | null => {
      try {
        const code = "self.onmessage = function () {};";
        return new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
      } catch {
        return null;
      }
    };
  }
}
ensureWorkerStub();

/** Register the dsh-skin light theme once (reads CSS custom properties). */
export function ensureMonacoTheme(): void {
  if (themed) return;
  themed = true;
  const css = (name: string, fallback: string): string => {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch {
      return fallback;
    }
  };
  monaco.editor.defineTheme("dsh-ide", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": css("--dsw-alias-bg-base", "#ffffff"),
      "editor.foreground": css("--dsw-alias-label-primary", "#0f1115"),
      "editorLineNumber.foreground": css("--dsw-alias-label-tertiary", "#81858c"),
      "editorLineNumber.activeForeground": css("--dsw-alias-label-primary", "#0f1115"),
      "editor.lineHighlightBackground": css("--dsw-alias-interactive-bg-hover", "#0000000f"),
      "editor.selectionBackground": "#5a96ff38",
      "editor.inactiveSelectionBackground": "#5a96ff1f",
      "editorWidget.background": css("--dsw-alias-bg-layer-2", "#ffffff"),
      "editorWidget.border": css("--dsw-alias-border-l1", "#00000012"),
      "editor.findMatchBackground": "#ffdc5a66",
      "scrollbarSlider.background": "#0000002e",
      "scrollbarSlider.hoverBackground": "#00000040",
    },
  });
}

export { monaco };
