/**
 * JSON config validation.
 *
 * The panel accepts a raw JSON array (or single object) of server configs and
 * normalizes them into `ServerRow` before anything is saved or mounted. All
 * checks are pure functions with no UI or I/O, so this module is trivially
 * unit-testable.
 */

import type { ServerRow } from "../shared/types";
import type { LocaleKey } from "./locales";

export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** Translates a locale key; the validator only reports messages. */
export type Translate = (key: LocaleKey) => string;

function generateId(): string {
  return `mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Validate and normalize one JSON item into a ServerRow.
 * Throws an Error with a localized message on the first problem found.
 */
export function normalizeServer(item: unknown, index: number, names: Set<string>, t: Translate): ServerRow {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new Error(t("json.error.serverName").replace("{i}", String(index + 1)));
  }
  const src = item as Record<string, unknown>;

  const serverName = String(src.serverName ?? "").trim();
  if (serverName === "") throw new Error(t("json.error.serverName").replace("{i}", String(index + 1)));
  if (!SERVER_NAME_PATTERN.test(serverName)) throw new Error(t("json.error.pattern").replace("{name}", serverName));
  if (names.has(serverName)) throw new Error(t("json.error.duplicate").replace("{name}", serverName));
  names.add(serverName);

  const transport = src.transport;
  if (transport !== "stdio" && transport !== "streamable-http") {
    throw new Error(t("json.error.transport").replace("{i}", String(index + 1)));
  }
  if (src.args !== undefined && (!Array.isArray(src.args) || src.args.some((a) => typeof a !== "string"))) {
    throw new Error(t("json.error.args").replace("{i}", String(index + 1)));
  }
  for (const key of ["env", "headers"] as const) {
    const value = src[key];
    if (value !== undefined && (typeof value !== "object" || value === null || Array.isArray(value))) {
      throw new Error(t(`json.error.${key}`).replace("{i}", String(index + 1)));
    }
  }
  if (src.toolCallTimeoutMs !== undefined && !(Number.isFinite(Number(src.toolCallTimeoutMs)) && Number(src.toolCallTimeoutMs) > 0)) {
    throw new Error(t("json.error.timeout").replace("{i}", String(index + 1)));
  }
  if (transport === "stdio" && String(src.command ?? "").trim() === "") {
    throw new Error(t("json.error.command").replace("{i}", String(index + 1)));
  }
  if (transport === "streamable-http") {
    const url = String(src.url ?? "").trim();
    if (url === "") throw new Error(t("json.error.url").replace("{i}", String(index + 1)));
    if (!/^https?:\/\//i.test(url)) throw new Error(t("json.error.urlFormat").replace("{i}", String(index + 1)));
  }

  return {
    id: typeof src.id === "string" && src.id !== "" ? src.id : generateId(),
    serverName,
    transport,
    command: String(src.command ?? ""),
    args: Array.isArray(src.args) ? (src.args as string[]).map(String) : [],
    env: typeof src.env === "object" && src.env !== null ? (src.env as Record<string, string>) : {},
    cwd: String(src.cwd ?? ""),
    url: String(src.url ?? ""),
    headers: typeof src.headers === "object" && src.headers !== null ? (src.headers as Record<string, string>) : {},
    toolCallTimeoutMs: Number(src.toolCallTimeoutMs) > 0 ? Number(src.toolCallTimeoutMs) : 60000,
    failOnStartupError: src.failOnStartupError === true
  };
}

/**
 * Parse raw JSON text into normalized rows.
 * Throws with a localized message on parse or shape errors.
 */
export function parseConfig(text: string, t: Translate): ServerRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(t("json.error.parse").replace("{msg}", (e as Error).message));
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(t("json.error.shape"));
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const names = new Set<string>();
  const rows: ServerRow[] = [];
  for (let i = 0; i < items.length; i++) {
    rows.push(normalizeServer(items[i], i, names, t));
  }
  return rows;
}
