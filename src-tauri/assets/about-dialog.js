/**
 * dsh-desktop — injected "About" dialog.
 *
 * Injected as a WebView2 initialization script (see ABOUT_DIALOG_SCRIPT in
 * src/lib.rs) and opened from the titlebar's caption menu:
 * `assets/caption-menu.js` calls `window.__dshDesktopAbout.show()`.
 *
 * Styling mirrors `assets/quit-confirm.js` — the same mask and blurred
 * backdrop (`--dsw-alias-bg-mask-1`, `--dsw-mask-blur`), the same rounded card
 * on `--dsw-alias-bg-layer-2` with `--dsw-shadow-lv3`, and the same outline
 * button (`--dsw-alias-border-l2`) — so the two dialogs read as one system.
 * Tokens resolve on the dsh page (light/dark via `body[data-ds-dark-theme]`);
 * light-theme fallbacks cover the loading page.
 *
 * The card is built on the first `show()` rather than at injection time: an
 * initialization script runs before the document root exists, and a dialog
 * nobody opened should not cost the loading page anything.
 *
 * The version line comes from `window.__dshAppVersion`, prepended by Rust from
 * `env!("CARGO_PKG_VERSION")` (see src/lib.rs), so Cargo.toml stays the single
 * source and the dialog needs no IPC round-trip or extra permission.
 *
 * Self-contained and idempotent.
 */
(function () {
  if (window.__dshDesktopAbout) return;

  var STYLE_ID = 'dsh-desktop-about-style';

  /* ---------- styles ---------- */
  var CSS = `
#dsh-desktop-about-overlay{position:fixed;inset:0;z-index:2147483647;display:none;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.24));-webkit-backdrop-filter:var(--dsw-mask-blur,blur(2px));backdrop-filter:var(--dsw-mask-blur,blur(2px))}
#dsh-desktop-about-overlay.dsh-desktop-about-open{display:flex}
#dsh-desktop-about-card{position:relative;display:flex;flex-direction:column;gap:20px;box-sizing:border-box;width:min(440px,100%);max-height:calc(100vh - 48px);padding:24px;overflow:hidden;border:1px solid var(--dsw-alias-border-inverted,rgba(0,0,0,.06));border-radius:24px;background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:var(--dsw-shadow-lv3,0 0 1px 0 rgba(0,0,0,.2),0 0 4px 0 rgba(0,0,0,.02),0 12px 32px 0 rgba(0,0,0,.08));color:var(--dsw-alias-label-primary,#0f1115);font-family:var(--ds-font-family-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif)}
#dsh-desktop-about-title{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary,#0f1115)}
#dsh-desktop-about-body{display:flex;flex-direction:column;gap:8px;color:var(--dsw-alias-label-secondary,#61666b);font-size:14px;line-height:22px}
#dsh-desktop-about-body p{margin:0}
#dsh-desktop-about-version{color:var(--dsw-alias-label-primary,#0f1115)}
#dsh-desktop-about-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
#dsh-desktop-about-close{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;min-width:72px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:18px;background:transparent;color:var(--dsw-alias-label-primary,#0f1115);cursor:pointer;font-size:14px;line-height:22px;font-family:inherit}
#dsh-desktop-about-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.08))}
#dsh-desktop-about-close:active{background:var(--dsw-alias-interactive-bg-active,rgba(0,0,0,.14))}
#dsh-desktop-about-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:2px}
`;

  var overlay = null;

  /* ---------- inject style + markup once, on first open ---------- */
  function build() {
    var style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = CSS;

    overlay = document.createElement('div');
    overlay.id = 'dsh-desktop-about-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'dsh-desktop-about-title');
    overlay.innerHTML =
      '<div id="dsh-desktop-about-card">' +
        '<h2 id="dsh-desktop-about-title">关于 DeepSeek Harness</h2>' +
        '<div id="dsh-desktop-about-body">' +
          '<p id="dsh-desktop-about-version"></p>' +
          '<p>DeepSeek Harness 的桌面客户端：Tauri 外壳 + 内置 Node 运行时。</p>' +
        '</div>' +
        '<div id="dsh-desktop-about-actions">' +
          '<button id="dsh-desktop-about-close" type="button">关闭</button>' +
        '</div>' +
      '</div>';

    // Queried from the overlay, never from `document`: at this point the card
    // is still detached, so `getElementById` would return null and the first
    // open would throw right here — before the overlay is ever appended, which
    // is what made the dialog appear not to open at all.
    var version = overlay.querySelector('#dsh-desktop-about-version');
    if (window.__dshAppVersion) {
      version.textContent = '版本 ' + window.__dshAppVersion;
    } else if (version.parentNode) {
      version.parentNode.removeChild(version);
    }

    /* ---------- actions ---------- */
    overlay.querySelector('#dsh-desktop-about-close')
      .addEventListener('click', function () { hide(); });
    // Same dismissal rules as the quit dialog: the mask itself, and Escape.
    overlay.addEventListener('mousedown', function (event) {
      if (event.target === overlay) hide();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') hide();
    });

    (document.body || document.documentElement).appendChild(overlay);
  }

  /* ---------- public api ---------- */
  function show() {
    if (!overlay) build();
    overlay.classList.add('dsh-desktop-about-open');
    var close = overlay.querySelector('#dsh-desktop-about-close');
    if (close) close.focus();
  }

  function hide() {
    if (overlay) overlay.classList.remove('dsh-desktop-about-open');
  }

  window.__dshDesktopAbout = { show: show, hide: hide };
})();
