/**
 * Shared types used by both halves.
 *
 * These are TYPE-ONLY: both bundles import them with `import type`, so they
 * are erased at compile time and never become runtime requires. Keeping the
 * shapes here (instead of duplicating them in host and client) means a field
 * change is a one-line edit.
 */

/** Transport kinds supported by `@deepseek-ai/dsh-mcp-client`. */
export type ServerTransport = "stdio" | "streamable-http";

/** One server row as stored in the settings document. */
export interface ServerRow {
  id: string;
  serverName: string;
  transport: ServerTransport;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  url: string;
  headers: Record<string, string>;
  toolCallTimeoutMs: number;
  failOnStartupError: boolean;
}

/** Host-owned mount status projection, written back for the UI to render. */
export interface RuntimeStatus {
  state: "mounted" | "error";
  error?: string;
}

/** The full `mcp` settings namespace value. */
export interface McpSettings {
  servers: ServerRow[];
  runtimeStatus: Record<string, RuntimeStatus>;
}

/** One entry of the reserved `settings-exposure` namespace (rc.6 hosts). */
export interface ExposureSettings {
  extra: string[];
}
