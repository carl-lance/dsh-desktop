/**
 * dsh-ide — host-side terminal service.
 *
 * loopback-only HTTP+WS micro server + node-pty sessions. Each `open` mints a
 * one-time token; the webview connects `ws://127.0.0.1:<port>?token=&id=`.
 * Protocol: WS text = pty stdin; pty stdout → WS text. Resize/close happen
 * through explicit manager calls (client op) and on socket close / pty exit.
 */

import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import pty from "node-pty";

export interface TerminalSession {
  id: string;
  cwd: string;
  shell: string;
  pid: number;
  alive: boolean;
}

export interface OpenResult {
  id: string;
  port: number;
  token: string;
  shell: string;
}

export interface TermDims {
  cols: number;
  rows: number;
}

export type ShellPref = "cmd" | "pwsh" | "powershell";

function pickShell(pref?: ShellPref): string {
  const list: Array<[ShellPref, string]> = [
    ["cmd", join(process.env.windir || "C:\\Windows", "System32", "cmd.exe")],
    ["pwsh", join(process.env.ProgramFiles || "C:\\Program Files", "PowerShell", "7", "pwsh.exe")],
    ["powershell", join(process.env.windir || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")],
  ];
  if (pref) {
    const hit = list.find(([k]) => k === pref);
    if (hit && existsSync(hit[1])) return hit[1];
  }
  for (const [, p] of list) {
    if (existsSync(p)) return p;
  }
  return "cmd.exe";
}

export function createTerminalManager(log: (m: string) => void) {
  let server: Server | null = null;
  let wss: WebSocketServer | null = null;
  let serverReady: Promise<number> | null = null;
  const sessions = new Map<string, { p: pty.IPty; cwd: string; token: string }>();
  const sockets = new Map<string, WebSocket>();

  function ensureServer(): Promise<number> {
    if (serverReady) return serverReady;
    server = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const token = url.searchParams.get("token") || "";
      const id = url.searchParams.get("id") || "";
      const session = sessions.get(id);
      if (!session || session.token !== token) {
        socket.destroy();
        return;
      }
      wss!.handleUpgrade(req, socket, head, (ws) => {
        sockets.set(id, ws);
        ws.on("message", (data) => {
          try {
            session.p.write(String(data));
          } catch {
            /* process gone */
          }
        });
        ws.on("close", () => {
          sockets.delete(id);
          kill(id, false);
        });
      });
    });
    serverReady = new Promise<number>((resolve, reject) => {
      server!.on("listening", () => {
        const addr = server!.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
      server!.on("error", (err) => {
        reject(err);
        serverReady = null;
      });
      server!.listen(0, "127.0.0.1");
    });
    return serverReady;
  }

  async function open(cwd: string, dims?: TermDims, shellPref?: ShellPref): Promise<OpenResult> {
    const port = await ensureServer();
    const id = randomBytes(8).toString("hex");
    const token = randomBytes(16).toString("hex");
    const shell = pickShell(shellPref);
    const cols = Math.max(20, dims?.cols || 80);
    const rows = Math.max(5, dims?.rows || 24);
    let p: pty.IPty;
    try {
      p = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: { ...process.env, TERM: "xterm-256color" },
        useConpty: process.platform === "win32" ? true : undefined,
      });
    } catch (err) {
      throw new Error(`failed to start shell ${shell}: ${err instanceof Error ? err.message : String(err)}`);
    }
    sessions.set(id, { p, cwd, token });
    p.onData((data) => {
      const ws = sockets.get(id);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
    });
    p.onExit(() => {
      const ws = sockets.get(id);
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      sessions.delete(id);
      sockets.delete(id);
      log(`terminal ${id} exited`);
    });
    log(`terminal ${id} opened (${shell}, cwd ${cwd}, port ${port})`);
    return { id, port, token, shell };
  }

  function resize(id: string, cols: number, rows: number): boolean {
    const s = sessions.get(id);
    if (!s) return false;
    try {
      s.p.resize(Math.max(2, cols), Math.max(2, rows));
      return true;
    } catch {
      return false;
    }
  }

  function kill(id: string, notify = true): boolean {
    const s = sessions.get(id);
    if (!s) return false;
    try {
      s.p.kill();
    } catch {
      /* ignore */
    }
    sessions.delete(id);
    sockets.delete(id);
    if (notify) log(`terminal ${id} killed`);
    return true;
  }

  /** Kill sessions whose cwd belongs to a different workspace. */
  function killForWorkspace(cwd: string): number {
    let n = 0;
    for (const [id, s] of sessions) {
      if (s.cwd !== cwd) {
        kill(id);
        n++;
      }
    }
    return n;
  }

  function dispose(): void {
    for (const id of [...sessions.keys()]) kill(id, false);
    try {
      wss?.close();
      server?.close();
    } catch {
      /* ignore */
    }
    server = null;
    wss = null;
  }

  return { open, resize, kill, killForWorkspace, dispose };
}

export type TerminalManager = ReturnType<typeof createTerminalManager>;
