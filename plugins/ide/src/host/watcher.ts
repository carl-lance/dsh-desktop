/**
 * dsh-ide — workspace file watcher (host side).
 *
 * Uses `fs.watch` recursively (supported on Windows). Events are filtered
 * (ignored dirs, temp files), debounced (~300ms), then surfaced through a
 * callback — the host bumps the `ide` namespace `fsRev` so the webview can
 * refresh the tree, git badges and open editors.
 */

import { watch, type FSWatcher } from "node:fs";

const IGNORE_RE = /(^|[\\/])(\.git|node_modules|target|dist|\.idea)([\\/]|$)/i;
const IGNORE_NAME = /(~$|\.swp$|^\.#|^#.*#$)/i;
const MS_DEBOUNCE = 300;

export interface FsEventInfo {
  type: string;
  path: string;
  at: number;
}

export function startWorkspaceWatcher(root: string, onBatch: (events: FsEventInfo[]) => void): () => void {
  let watcher: FSWatcher | null = null;
  let timer: NodeJS.Timeout | null = null;
  const pending: FsEventInfo[] = [];

  const flush = (): void => {
    timer = null;
    if (pending.length > 0) {
      const batch = pending.splice(0, pending.length);
      onBatch(batch);
    }
  };

  const queue = (type: string, file: string): void => {
    if (type === "rename" || type === "change") {
      const norm = file.replace(/\\/g, "/");
      if (!norm) return;
      if (IGNORE_RE.test("/" + norm) || IGNORE_NAME.test(file)) return;
      pending.push({ type, path: file, at: Date.now() });
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, MS_DEBOUNCE);
    }
  };

  try {
    watcher = watch(root, { recursive: true }, (eventType, filename) => {
      queue(String(eventType), String(filename ?? ""));
    });
  } catch {
    // Recursive watch unavailable → fall back to a shallow watcher.
    try {
      watcher = watch(root, (eventType, filename) => {
        queue(String(eventType), String(filename ?? ""));
      });
    } catch {
      watcher = null;
    }
  }

  return () => {
    if (timer) clearTimeout(timer);
    if (watcher) {
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
    }
  };
}
