/**
 * mcp-client reconciler.
 *
 * Turns the `servers` array of the settings namespace into live
 * `@deepseek-ai/dsh-mcp-client` plugin instances and keeps them in sync:
 *   - rows removed from settings → instance disposed
 *   - rows whose config changed → remounted
 *   - new rows → mounted
 *
 * The reconciler is a small class so it can be unit-tested in isolation and
 * reused by other plugins that manage dynamic plugin instances.
 */

import * as mcpClient from "@deepseek-ai/dsh-mcp-client";
import type { ServerRow, RuntimeStatus } from "../shared/types";

/** The mcp-client bridge as a mountable cordis plugin object. */
const mcpClientPlugin = {
  name: mcpClient.name,
  inject: mcpClient.inject,
  apply: mcpClient.apply,
  Config: mcpClient.Config
};

/** Structural equality over the JSON-shaped resolved configs. */
function sameConfig(left: object, right: object): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Narrow one stored row to the mcp-client `Config` union member it selects. */
export function toMcpConfig(server: ServerRow) {
  if (server.transport === "stdio") {
    return {
      transport: "stdio" as const,
      serverName: server.serverName,
      command: server.command,
      args: server.args ?? [],
      env: server.env ?? {},
      cwd: server.cwd ?? "",
      toolCallTimeoutMs: server.toolCallTimeoutMs ?? 60000,
      failOnStartupError: server.failOnStartupError ?? false
    };
  }
  return {
    transport: "streamable-http" as const,
    serverName: server.serverName,
    url: server.url,
    headers: server.headers ?? {},
    toolCallTimeoutMs: server.toolCallTimeoutMs ?? 60000,
    failOnStartupError: server.failOnStartupError ?? false
  };
}

/** Minimal surface the reconciler needs from the cordis context. */
export interface ReconcilerCtx {
  plugin(plugin: unknown, config: unknown): { then(onOk?: unknown, onErr?: unknown): unknown; dispose(): unknown };
  logger: { warn(message: string): void; error(message: string): void };
}

/**
 * Owns the mounted fibers for one namespace scope.
 *
 * @param ctx       cordis context (for mounting plugins)
 * @param readServers  current `servers` array (re-read each reconcile pass)
 * @param publishStatus  persist the host-owned status projection
 */
export class Reconciler {
  private fibers = new Map<string, {
    fiber: { then(onOk?: unknown, onErr?: unknown): unknown; dispose(): unknown };
    config: object;
    status: RuntimeStatus;
  }>();

  constructor(
    private readonly ctx: ReconcilerCtx,
    private readonly readServers: () => ServerRow[],
    private readonly publishStatus: (status: Record<string, RuntimeStatus>) => void
  ) {}

  /** One pass: drop removed rows, remount changed rows, mount new rows. */
  reconcile(): void {
    const servers = this.readServers();
    const status: Record<string, RuntimeStatus> = {};

    // Remove rows that disappeared.
    for (const [id, record] of this.fibers) {
      if (!servers.some((server) => server.id === id)) {
        this.disposeFiber(record.fiber);
        this.fibers.delete(id);
      }
    }

    // Mount / remount the rest.
    for (const server of servers) {
      const config = toMcpConfig(server);
      const existing = this.fibers.get(server.id);
      if (existing !== undefined && sameConfig(existing.config, config)) {
        status[server.id] = existing.status;
        continue;
      }
      if (existing !== undefined) this.disposeFiber(existing.fiber);
      const fiber = this.ctx.plugin(mcpClientPlugin, config);
      // cordis fibers are thenables with only `then`; capture rejections so a
      // failed instance never trips the host's fail-loud boot guard.
      fiber.then(undefined, (error: unknown) => {
        this.ctx.logger.error(`plugin-template(${config.serverName}): instance failed: ${String(error)}`);
        const current = this.fibers.get(server.id);
        if (current !== undefined && current.fiber === fiber) {
          current.status = { state: "error", error: String(error) };
          this.publishStatus(this.statusSnapshot());
        }
      });
      this.fibers.set(server.id, { fiber, config, status: { state: "mounted" } });
      status[server.id] = { state: "mounted" };
    }

    this.publishStatus(status);
  }

  /** Tear every mounted instance down (plugin disposal / HMR reload). */
  dispose(): void {
    for (const record of this.fibers.values()) this.disposeFiber(record.fiber);
    this.fibers.clear();
  }

  private disposeFiber(fiber: { dispose(): unknown }): void {
    try {
      fiber.dispose();
    } catch (error) {
      this.ctx.logger.warn(`plugin-template: dispose failed: ${String(error)}`);
    }
  }

  private statusSnapshot(): Record<string, RuntimeStatus> {
    const status: Record<string, RuntimeStatus> = {};
    for (const [id, record] of this.fibers) status[id] = record.status;
    return status;
  }
}
