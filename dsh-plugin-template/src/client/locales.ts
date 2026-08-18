/**
 * Localization dictionaries.
 *
 * zh is the key-set source of truth; en is checked complete against it.
 * The key type is derived from zh so a missing translation is a type error.
 */

const zh = {
  "nav": "MCP",
  "add": "添加服务器",
  "edit": "编辑 JSON",
  "delete": "删除",
  "delete.confirm": "确定删除服务器“{name}”吗？已注册的工具将立即卸载。",
  "cancel": "取消",
  "save": "保存并挂载",
  "catalog": "服务器",
  "empty": "还没有配置 MCP 服务器。",
  "unavailable": "设置命名空间不可用，无法读写 MCP 配置。",
  "loading": "正在读取 MCP 配置…",
  "status.mounted": "已挂载",
  "status.error": "挂载失败",
  "status.unknown": "未知",
  "json.label": "服务器配置（JSON）",
  "json.hint": "粘贴一个 JSON 数组（或单个对象）。字段与 dsh-mcp-client 的 Config 一致：serverName、transport（stdio/streamable-http）、command/args/env/cwd 或 url/headers、toolCallTimeoutMs、failOnStartupError。",
  "json.error.parse": "JSON 解析失败：{msg}",
  "json.error.shape": "配置应为 JSON 数组（或单个对象）。",
  "json.error.serverName": "第 {i} 项缺少 serverName。",
  "json.error.pattern": "serverName “{name}” 非法：仅允许字母、数字、下划线和中划线，最长 32 字符。",
  "json.error.duplicate": "serverName “{name}” 重复。",
  "json.error.transport": "第 {i} 项 transport 必须是 stdio 或 streamable-http。",
  "json.error.command": "第 {i} 项（stdio）缺少 command。",
  "json.error.url": "第 {i} 项（streamable-http）缺少 url。",
  "json.error.urlFormat": "第 {i} 项 url 必须以 http:// 或 https:// 开头。",
  "json.error.args": "第 {i} 项 args 必须是字符串数组。",
  "json.error.env": "第 {i} 项 env 必须是对象。",
  "json.error.headers": "第 {i} 项 headers 必须是对象。",
  "json.error.timeout": "第 {i} 项 toolCallTimeoutMs 必须是正整数。"
} as const;

export type LocaleKey = keyof typeof zh;

const en: Record<LocaleKey, string> = {
  "nav": "MCP",
  "add": "Add server",
  "edit": "Edit JSON",
  "delete": "Delete",
  "delete.confirm": "Delete server \"{name}\"? Its registered tools will be unmounted immediately.",
  "cancel": "Cancel",
  "save": "Save & mount",
  "catalog": "Servers",
  "empty": "No MCP servers configured yet.",
  "unavailable": "The settings namespace is unavailable; MCP configuration cannot be read or written.",
  "loading": "Reading MCP configuration…",
  "status.mounted": "Mounted",
  "status.error": "Mount failed",
  "status.unknown": "Unknown",
  "json.label": "Server config (JSON)",
  "json.hint": "Paste a JSON array (or a single object). Fields match dsh-mcp-client Config: serverName, transport (stdio/streamable-http), command/args/env/cwd or url/headers, toolCallTimeoutMs, failOnStartupError.",
  "json.error.parse": "Invalid JSON: {msg}",
  "json.error.shape": "Config must be a JSON array (or a single object).",
  "json.error.serverName": "Item {i} is missing serverName.",
  "json.error.pattern": "serverName \"{name}\" is invalid: only letters, digits, underscore and hyphen, up to 32 characters.",
  "json.error.duplicate": "serverName \"{name}\" is duplicated.",
  "json.error.transport": "Item {i} transport must be stdio or streamable-http.",
  "json.error.command": "Item {i} (stdio) is missing command.",
  "json.error.url": "Item {i} (streamable-http) is missing url.",
  "json.error.urlFormat": "Item {i} url must start with http:// or https://.",
  "json.error.args": "Item {i} args must be an array of strings.",
  "json.error.env": "Item {i} env must be an object.",
  "json.error.headers": "Item {i} headers must be an object.",
  "json.error.timeout": "Item {i} toolCallTimeoutMs must be a positive integer."
};

/** Dictionaries to hand to `ctx.locale.register(NS, ...)`. */
export const dictionaries = { zh, en };
