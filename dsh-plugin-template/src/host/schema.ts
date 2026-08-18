/**
 * Settings namespace schemas.
 *
 * Schemastery schemas both validate the stored document and serialize to the
 * wire for the browser settings scope, so the client sees exactly the shape
 * declared here.
 */

import z from "@deepseek-ai/schemastery";

/** Durable settings namespace owned by this plugin. */
export const NS = "mcp";

/** Reserved exposure-declaration namespace (rc.6 hosts read this list; rc.7+
 *  exposes every registered namespace natively and ignores it). */
export const EXPOSURE_NS = "settings-exposure";

/** Same contract as the MCP client bridge's `serverName`. */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** One server row as stored in the settings document. */
export const ServerConfigSchema = z.object({
  id: z.string().required(),
  serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
  transport: z.union([z.const("stdio"), z.const("streamable-http")]).required(),
  command: z.string().default(""),
  args: z.array(String).default([]),
  env: z.dict(String).default({}),
  cwd: z.string().default(""),
  url: z.string().default(""),
  headers: z.dict(String).default({}),
  toolCallTimeoutMs: z.number().min(1).default(60000),
  failOnStartupError: z.boolean().default(false)
});

/** Host-owned projection so the UI can render a mount badge without RPC. */
export const RuntimeStatusSchema = z.object({
  state: z.union([z.const("mounted"), z.const("error")]).required(),
  error: z.string()
});

/** The full namespace value: user-owned servers + host-owned status. */
export const McpSettingsSchema = z.object({
  servers: z.array(ServerConfigSchema).default([]),
  runtimeStatus: z.dict(RuntimeStatusSchema).default({})
});

/** The reserved exposure list: any plugin lists its Web-exposed namespaces. */
export const ExposureSchema = z.object({
  extra: z.array(String).default([])
});
