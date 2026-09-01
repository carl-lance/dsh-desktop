/**
 * dsh-desktop — external links open in the system default browser.
 *
 * Injected as a WebView2 initialization script (see EXTERNAL_LINKS_SCRIPT in
 * src/lib.rs). Intercepts left-clicks on <a> elements whose target origin is
 * NOT the app itself (127.0.0.1/localhost) and hands the URL to the Rust
 * `open_url` command, which opens the system default browser.
 *
 * Why: letting the webview navigate to external sites replaces the harness UI
 * inside the app window (bad UX, phishing risk); window.open / target=_blank
 * requests are silently swallowed by the runtime. Opening in the system
 * browser is the desktop convention.
 *
 * Modifier clicks (ctrl/cmd/shift) are left alone — they surface as new-window
 * requests, which the Rust on_new_window handler routes to the browser too.
 * Same-origin links (SPA routes, app links) pass through untouched.
 */
(function () {
  if (window.__dshExternalLinksInstalled) return;
  window.__dshExternalLinksInstalled = true;

  function isLocal(url) {
    var h = url.hostname;
    return h === '127.0.0.1' || h === 'localhost' || h === 'tauri.localhost';
  }

  function openExternal(url) {
    var invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
    if (invoke) {
      invoke('open_url', { url: url }).catch(function (err) {
        if (window.console) console.error('[dsh-links] open_url failed', err);
      });
    } else if (window.console) {
      console.warn('[dsh-links] Tauri IPC unavailable, cannot open', url);
    }
  }

  document.addEventListener('click', function (e) {
    // plain left clicks only; modifier clicks route through new-window handling
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#' || /^javascript:/i.test(href)) return;

    var url;
    try { url = new URL(href, location.href); } catch (err) { return; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (isLocal(url)) return; // app-internal links/routes pass through

    e.preventDefault();
    e.stopPropagation();
    openExternal(url.href);
  }, true);

  // Shared with the injected context menu (context-menu.js): its "打开外链"
  // item calls this instead of duplicating the IPC call.
  window.__dshOpenExternal = openExternal;
})();
