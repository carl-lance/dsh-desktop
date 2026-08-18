/**
 * Stylesheet for the section UI, aligned with the plugin-inventory list look.
 *
 * Injected once into <head> with a `data-plugin-css` marker so HMR bookkeeping
 * and re-mounts stay idempotent (same pattern as official bundles).
 */

const css = [
  ".mcp-section{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:14px;display:flex}",
  ".mcp-heading h3,.mcp-status,.mcp-failure p{margin:0}",
  ".mcp-status,.mcp-failure{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}",
  ".mcp-toolbar{justify-content:flex-end;align-items:center;gap:8px;display:flex}",
  ".mcp-cards{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:10px;margin:0;padding:0;list-style:none;display:grid}",
  ".mcp-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;min-width:0;overflow:hidden}",
  ".mcp-card[data-open=true]{border-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-shadow-lv1)}",
  ".mcp-cardContent{box-sizing:border-box;width:100%;min-height:52px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;justify-content:space-between;align-items:center;gap:12px;padding:12px 14px;display:flex}",
  ".mcp-cardContent:hover,.mcp-card[data-open=true]>.mcp-cardContent{background:var(--dsw-alias-interactive-bg-hover)}",
  ".mcp-cardTitle{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:14px;font-weight:600;line-height:20px;overflow:hidden}",
  ".mcp-cardTrailing{color:var(--dsw-alias-label-tertiary);flex:none;align-items:center;gap:7px;display:inline-flex}",
  ".mcp-statusDot{background:var(--dsw-alias-label-tertiary);border-radius:999px;flex:none;width:7px;height:7px;display:inline-block}",
  ".mcp-statusDot[data-phase=active]{background:var(--dsw-alias-state-success-primary)}",
  ".mcp-statusDot[data-phase=failed]{background:var(--dsw-alias-state-error-primary)}",
  ".mcp-tag{background:var(--dsw-alias-bg-layer-1);min-height:20px;color:var(--dsw-alias-label-secondary);white-space:nowrap;border-radius:5px;align-items:center;padding:1px 6px;font-size:11px;line-height:16px;display:inline-flex}",
  ".mcp-chevron{color:var(--dsw-alias-label-tertiary);flex:none}",
  ".mcp-card[data-open=true] .mcp-chevron{transform:rotate(180deg)}",
  ".mcp-cardDetails{border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);padding:10px 14px 12px}",
  ".mcp-entryValue{overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;display:block}",
  ".mcp-actions{justify-content:flex-end;align-items:center;gap:6px;margin-top:10px;display:flex}",
  ".mcp-editor{box-sizing:border-box;width:100%;min-height:180px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;border-radius:8px;outline:none;padding:10px 12px;resize:vertical;tab-size:2}",
  ".mcp-errorText{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;white-space:pre-wrap}",
  ".mcp-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
  ".mcp-editorBlock{flex-direction:column;gap:8px;display:flex}",
  ".mcp-heading{align-items:baseline;gap:7px;padding:0 2px;display:flex}",
  ".mcp-heading h3{font-size:13px;font-weight:600;line-height:20px}",
  ".mcp-heading span{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:12px;line-height:18px}",
  "@media (width<=680px){.mcp-cards{grid-template-columns:minmax(0,1fr)}}"
].join("");

const TAG_ID = "dsh-plugin-template/Section.module.css";

/** Inject the stylesheet once (idempotent). */
export function injectStyles(): void {
  if (typeof document === "undefined") return;
  if (document.querySelector(`style[data-plugin-css="${TAG_ID}"]`) !== null) return;
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-plugin-template";
  tag.dataset.pluginCss = TAG_ID;
  tag.textContent = css;
  document.head.appendChild(tag);
}
