/**
 * dsh-plugin-floatpanel — browser half entry.
 *
 * Renders a floating widget pinned to the bottom-right corner of the dsh web
 * UI. Vanilla DOM on purpose: no shell-seed imports, so the client bundle
 * stays compatible across runtime versions and never depends on a specific
 * set of @deepseek-ai/dsh-client-* seeds.
 */

export const inject: string[] = [];

interface FloatPanelHandle {
  el: HTMLElement;
  remove(): void;
}

/** Append the floating panel to the page (bottom-right, fixed). */
function mount(): FloatPanelHandle {
  const el = document.createElement("div");
  el.setAttribute("data-floatpanel", "1");

  const s = el.style;
  s.position = "fixed";
  s.right = "16px";
  s.bottom = "16px";
  s.width = "264px";
  s.zIndex = "2147483000";
  s.background = "rgba(255,255,255,0.95)";
  s.backdropFilter = "blur(8px)";
  s.border = "1px solid rgba(0,0,0,0.12)";
  s.borderRadius = "12px";
  s.boxShadow = "0 8px 24px rgba(0,0,0,0.16)";
  s.fontFamily = "-apple-system, 'Segoe UI', system-ui, sans-serif";
  s.overflow = "hidden";
  s.userSelect = "none";
  s.colorScheme = "light";

  // --- title bar ---
  const bar = document.createElement("div");
  bar.style.cssText =
    "display:flex;align-items:center;justify-content:space-between;" +
    "padding:8px 12px;background:rgba(0,0,0,0.045);font-size:13px;font-weight:600;color:#111;";
  const barTitle = document.createElement("span");
  barTitle.textContent = "DSH 悬浮窗";
  const close = document.createElement("button");
  close.textContent = "\u00d7";
  close.title = "关闭悬浮窗";
  close.setAttribute("aria-label", "关闭悬浮窗");
  close.style.cssText =
    "border:none;background:transparent;cursor:pointer;font-size:16px;line-height:1;" +
    "color:#666;padding:0 4px;border-radius:4px;";
  close.addEventListener("mouseenter", () => {
    close.style.color = "#111";
  });
  close.addEventListener("mouseleave", () => {
    close.style.color = "#666";
  });
  close.addEventListener("click", () => {
    el.remove();
  });
  bar.appendChild(barTitle);
  bar.appendChild(close);

  // --- body ---
  const body = document.createElement("div");
  body.style.cssText = "padding:12px;font-size:13px;color:#333;line-height:1.6;";
  const dot = document.createElement("span");
  dot.style.cssText =
    "display:inline-block;width:8px;height:8px;border-radius:50%;" +
    "background:#22c55e;margin-right:6px;vertical-align:middle;";
  const status = document.createElement("span");
  status.textContent = "插件运行正常";
  body.appendChild(dot);
  body.appendChild(status);

  // --- footer ---
  const footer = document.createElement("div");
  footer.style.cssText =
    "padding:6px 12px;font-size:11px;color:#888;" +
    "border-top:1px solid rgba(0,0,0,0.06);";
  footer.textContent = "dsh-plugin-floatpanel v0.1.0";

  el.appendChild(bar);
  el.appendChild(body);
  el.appendChild(footer);

  (document.body || document.documentElement).appendChild(el);

  return {
    el,
    remove() {
      el.remove();
    },
  };
}

/**
 * Register the floating panel. `ctx.effect` runs the mount job on apply and
 * keeps the returned cleanup for teardown / profile HMR reload.
 */
export function apply(ctx: any): void {
  ctx.effect(() => {
    const handle = mount();
    return () => handle.remove();
  }, "floatpanel: mount/unmount");
}
