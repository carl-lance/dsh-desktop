/**
 * Localization dictionaries for dsh-ide.
 *
 * zh is the key-set source of truth; en is checked complete against it.
 * The key type is derived from zh so a missing translation is a type error.
 */

const zh = {
  "nav": "IDE",
  "open": "打开 IDE",
  "close": "关闭 IDE",
  "placeholder.title": "IDE",
  "placeholder.body": "Phase 0 浮层壳已就位：shell.overlay 全屏层 + 头部按钮 + 右上角关闭。\nGit、文件浏览 + Monaco、工作区终端按开发计划分阶段填充。",
} as const;

export type LocaleKey = keyof typeof zh;

const en: Record<LocaleKey, string> = {
  "nav": "IDE",
  "open": "Open IDE",
  "close": "Close IDE",
  "placeholder.title": "IDE",
  "placeholder.body": "Phase 0 floating shell ready: shell.overlay fullscreen layer + header action + top-right close.\nGit, file explorer + Monaco, and the workspace terminal land in later phases per the dev plan.",
};

/** Dictionaries to hand to `ctx.locale.register(NS, ...)`. */
export const dictionaries = { zh, en };
