/**
 * dsh-plugin-floatpanel — host half entry.
 *
 * UI-only plugin: the floating panel lives entirely in the webview client
 * half. This host module exists so the package loads as a valid dsh plugin
 * (cordis module); no services are injected and nothing is mounted here.
 */

export const name = "floatpanel";

export const inject: string[] = [];

export function apply(_ctx: any): void {
  // UI-only plugin; nothing to mount on the host side.
}
