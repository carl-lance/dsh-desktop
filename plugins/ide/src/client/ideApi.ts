/**
 * dsh-ide — client-side bridge to the `ide` settings namespace.
 *
 * Bound once in the plugin entry (index.tsx) to the settingsScope service.
 * Exposes:
 *   useIdeDoc()   — reactive mirror of the namespace document (React hook)
 *   call(op,payload) — request/response envelope (reqId matched on resultJson)
 *   openForSession(sessionId) — bind a session and ask the host to resolve cwd
 *
 * The mirror keeps one stable object reference between controller updates so
 * useSyncExternalStore never loops.
 */

import { useSyncExternalStore } from "react";
import type { IdeDoc, IdeReq } from "../shared/types";

type Listener = () => void;

/** Cross-component UI events (e.g. chrome → workbench navigation). */
export type IdeBusEvent = "open-commit" | "open-push";

const busListeners = new Set<(ev: IdeBusEvent) => void>();

export function onIdeBus(ev: IdeBusEvent, fn: () => void): () => void {
  const handler = (e: IdeBusEvent): void => {
    if (e === ev) fn();
  };
  busListeners.add(handler);
  return () => busListeners.delete(handler);
}

export function emitIdeBus(ev: IdeBusEvent): void {
  busListeners.forEach((h) => h(ev));
}

const EMPTY: IdeDoc = {
  sessionId: "",
  cwd: "",
  title: "",
  reqJson: "",
  resultJson: "",
  note: "",
};

let controller: any = null;
let bound = false;
let status = "loading"; // "loading" | "ready" | "unavailable" | "error"
let docRef: IdeDoc = EMPTY;
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((l) => l());
}

/** Normalize the controller snapshot ({status,value} mirror or raw doc). */
function refresh(): void {
  if (!controller) return;
  try {
    const snap = controller.getSnapshot ? controller.getSnapshot() : null;
    const s = snap && typeof snap === "object" ? ((snap as { status?: string }).status ?? "") : "";
    const v = snap && typeof snap === "object" && "value" in snap ? (snap as { value?: unknown }).value : snap;
    status = s || (v && typeof v === "object" ? "ready" : "loading");
    docRef = v && typeof v === "object" ? (v as IdeDoc) : EMPTY;
  } catch {
    status = "error";
  }
  notify();
}

export function bindIde(settingsScope: any, ns: string): void {
  if (bound || !settingsScope) return;
  controller = settingsScope.bind({ namespace: ns });
  bound = true;
  if (controller && typeof controller.subscribe === "function") {
    controller.subscribe(refresh);
  }
  refresh();
}

export function ideStatus(): string {
  return status;
}

function sub(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getDoc(): IdeDoc {
  return docRef;
}

/** Reactive namespace document. */
export function useIdeDoc(): IdeDoc {
  useSyncExternalStore(sub, getDoc);
  return docRef;
}

/** One request/response round trip. Resolves with the host's data payload.
 *  Requests are serialized on the client: only one `reqJson` write is in
 *  flight at a time, so host replies can never be lost to an overwrite. */
let chain: Promise<void> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function call(op: string, payload?: Record<string, unknown>, timeoutMs = 20000): Promise<any> {
  return serialized(() => {
    if (!controller) return Promise.reject(new Error("ide api not bound yet"));
    const reqId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const req: IdeReq = { reqId, op, payload };
    return new Promise((resolve, reject) => {
      let done = false;
      const off = controller.subscribe(() => {
        if (done) return;
        const raw = getDoc().resultJson;
        if (!raw) return;
        try {
          const r = JSON.parse(raw) as { reqId: string; ok: boolean; data?: unknown; error?: string };
          if (r.reqId !== reqId) return;
          done = true;
          clearTimeout(timer);
          off();
          if (r.ok) resolve(r.data);
          else reject(new Error(r.error ?? `ide op failed: ${op}`));
        } catch {
          /* keep waiting */
        }
      });
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          off();
          reject(new Error(`ide op timeout: ${op}`));
        }
      }, timeoutMs);
      controller.set("reqJson", JSON.stringify(req));
    });
  });
}

/** Bind the session and resolve its workspace root (idempotent per session). */
export async function openForSession(sessionId: string): Promise<void> {
  if (!controller) return;
  if (getDoc().sessionId === sessionId && getDoc().cwd) return;
  controller.set("sessionId", sessionId ?? "");
  try {
    await call("resolve", { sessionId: sessionId ?? "" });
  } catch {
    /* surfaced by the UI through doc.note / status */
  }
}
