window.__ModuleLoader__.load({
	id: "dsh-plugin-floatpanel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var inject = [];
function mount() {
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
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(0,0,0,0.045);font-size:13px;font-weight:600;color:#111;";
  const barTitle = document.createElement("span");
  barTitle.textContent = "DSH \u60AC\u6D6E\u7A97";
  const close = document.createElement("button");
  close.textContent = "\xD7";
  close.title = "\u5173\u95ED\u60AC\u6D6E\u7A97";
  close.setAttribute("aria-label", "\u5173\u95ED\u60AC\u6D6E\u7A97");
  close.style.cssText = "border:none;background:transparent;cursor:pointer;font-size:16px;line-height:1;color:#666;padding:0 4px;border-radius:4px;";
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
  const body = document.createElement("div");
  body.style.cssText = "padding:12px;font-size:13px;color:#333;line-height:1.6;";
  const dot = document.createElement("span");
  dot.style.cssText = "display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;margin-right:6px;vertical-align:middle;";
  const status = document.createElement("span");
  status.textContent = "\u63D2\u4EF6\u8FD0\u884C\u6B63\u5E38";
  body.appendChild(dot);
  body.appendChild(status);
  const footer = document.createElement("div");
  footer.style.cssText = "padding:6px 12px;font-size:11px;color:#888;border-top:1px solid rgba(0,0,0,0.06);";
  footer.textContent = "dsh-plugin-floatpanel v0.1.0";
  el.appendChild(bar);
  el.appendChild(body);
  el.appendChild(footer);
  (document.body || document.documentElement).appendChild(el);
  return {
    el,
    remove() {
      el.remove();
    }
  };
}
function apply(ctx) {
  ctx.effect(() => {
    const handle = mount();
    return () => handle.remove();
  }, "floatpanel: mount/unmount");
}

		return module.exports;
	}
});
