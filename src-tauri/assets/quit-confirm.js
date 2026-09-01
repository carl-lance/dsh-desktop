/**
 * dsh-desktop — injected quit-confirmation dialog.
 *
 * Embedded into the binary via `include_str!` (see QUIT_CONFIRM_SCRIPT in
 * src/lib.rs) and eval'd into the webview when a window close is requested.
 *
 * Styling mirrors the dsh design system: mask + blurred backdrop
 * (`--dsw-alias-bg-mask-1`, `--dsw-mask-blur`), rounded card on
 * `--dsw-alias-bg-layer-2` with `--dsw-shadow-lv3`, outline cancel button
 * (`--dsw-alias-border-l2`) and a danger-red confirm button
 * (`--dsw-alias-state-error-primary`). Tokens resolve on the dsh page
 * (light/dark via `body[data-ds-dark-theme]`); light-theme fallbacks cover
 * the loading page. Self-contained and idempotent.
 *
 * Extend by editing the CSS block and the DOM/actions below — no Rust changes
 * needed unless you add new IPC commands.
 */
(function () {
  if (window.__dshDesktopQuit) { window.__dshDesktopQuit.show(); return; }

  /* ---------- styles ---------- */
  var CSS = `
#dsh-desktop-quit-overlay{position:fixed;inset:0;z-index:2147483647;display:none;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.24));-webkit-backdrop-filter:var(--dsw-mask-blur,blur(2px));backdrop-filter:var(--dsw-mask-blur,blur(2px))}
#dsh-desktop-quit-overlay.dsh-desktop-quit-open{display:flex}
#dsh-desktop-quit-dialog{position:relative;display:flex;flex-direction:column;gap:20px;box-sizing:border-box;width:min(440px,100%);max-height:calc(100vh - 48px);padding:24px;overflow:hidden;border:1px solid var(--dsw-alias-border-inverted,rgba(0,0,0,.06));border-radius:24px;background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:var(--dsw-shadow-lv3,0 0 1px 0 rgba(0,0,0,.2),0 0 4px 0 rgba(0,0,0,.02),0 12px 32px 0 rgba(0,0,0,.08));color:var(--dsw-alias-label-primary,#0f1115);font-family:var(--ds-font-family-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif)}
#dsh-desktop-quit-title{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary,#0f1115)}
#dsh-desktop-quit-warning{display:flex;align-items:flex-start;gap:10px;color:var(--dsw-alias-label-secondary,#61666b);font-size:14px;line-height:22px}
#dsh-desktop-quit-warning p{margin:0}
#dsh-desktop-quit-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
#dsh-desktop-quit-cancel,#dsh-desktop-quit-confirm{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;min-width:72px;padding:0 14px;border:none;border-radius:18px;cursor:pointer;font-size:14px;line-height:22px;font-family:inherit}
#dsh-desktop-quit-cancel{border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));background:transparent;color:var(--dsw-alias-label-primary,#0f1115)}
#dsh-desktop-quit-cancel:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.08))}
#dsh-desktop-quit-cancel:active{background:var(--dsw-alias-interactive-bg-active,rgba(0,0,0,.14))}
#dsh-desktop-quit-confirm{min-width:136px;background:var(--dsw-alias-state-error-primary,#ec1313);color:var(--dsw-alias-label-primary-foreground,#fff)}
#dsh-desktop-quit-confirm:hover{background:var(--dsw-static-red-500,#ef4444)}
#dsh-desktop-quit-confirm:active{background:var(--dsw-static-red-600,#ec1313)}
#dsh-desktop-quit-cancel:focus-visible,#dsh-desktop-quit-confirm:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:2px}
`;

  /* ---------- helpers ---------- */
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* ---------- inject style + markup once ---------- */
  var style = document.getElementById('dsh-desktop-quit-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'dsh-desktop-quit-style';
    (document.head || document.documentElement).appendChild(style);
  }
  style.textContent = CSS;

  var overlay = document.getElementById('dsh-desktop-quit-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'dsh-desktop-quit-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', esc('确认退出'));
    overlay.innerHTML =
      '<div id="dsh-desktop-quit-dialog">' +
        '<h2 id="dsh-desktop-quit-title">' + esc('退出 DeepSeek Harness？') + '</h2>' +
        '<div id="dsh-desktop-quit-warning">' +
          '<p>' + esc('确定要关闭应用吗？正在进行的任务将被中断。') + '</p>' +
        '</div>' +
        '<div id="dsh-desktop-quit-actions">' +
          '<button id="dsh-desktop-quit-cancel" type="button">' + esc('取消') + '</button>' +
          '<button id="dsh-desktop-quit-confirm" type="button">' + esc('退出') + '</button>' +
        '</div>' +
      '</div>';
    (document.body || document.documentElement).appendChild(overlay);

    /* ---------- actions ---------- */
    document.getElementById('dsh-desktop-quit-cancel').addEventListener('click', function () {
      window.__dshDesktopQuit.hide();
    });
    document.getElementById('dsh-desktop-quit-confirm').addEventListener('click', function () {
      var invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
      if (invoke) {
        invoke('quit_app').catch(function () { window.close(); });
      } else {
        window.close();
      }
    });
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) { window.__dshDesktopQuit.hide(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { window.__dshDesktopQuit.hide(); }
    });
  }

  /* ---------- public api ---------- */
  window.__dshDesktopQuit = {
    show: function () {
      overlay.classList.add('dsh-desktop-quit-open');
      var cancel = document.getElementById('dsh-desktop-quit-cancel');
      if (cancel) { cancel.focus(); }
    },
    hide: function () { overlay.classList.remove('dsh-desktop-quit-open'); }
  };
  window.__dshDesktopQuit.show();
})();
