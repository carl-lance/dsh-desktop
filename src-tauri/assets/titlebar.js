/**
 * dsh-desktop — custom window titlebar (Windows caption replacement).
 *
 * Injected as a WebView2 initialization script (see TITLEBAR_SCRIPT in
 * src/lib.rs), so it runs on EVERY page load, including reloads.
 *
 * How it fits together with the dsh frontend:
 *
 *   1. The Rust window is created with `decorations(false)`, so the native
 *      Windows caption is gone. There are no system min/max/close buttons.
 *   2. Setting `html[data-windows-titlebar]` switches the dsh frontend into its
 *      own Windows-caption layout: `AppFrame` reserves
 *      `--dsh-windows-titlebar-height` above every column, paints a strip of
 *      `--dsw-specific-sidebar-fill` there, rounds the content's top-left
 *      corner, and shifts the sidebar controls / overlays down. That CSS ships
 *      with the dsh runtime (verified present in the bundled
 *      `dsh-client-ui-layout` build) — this script does NOT reimplement it.
 *   3. This script paints the caption's own layer on top of that reserved
 *      strip: a drag area spanning the row, plus three self-drawn window
 *      controls on the right. The row carries no text — the dsh sidebar
 *      controls the frontend pins into it (sidebar toggle, New Session) stay
 *      visible because this layer sets no z-index, so their own stacking wins.
 *
 * Dragging: the dsh strip uses `-webkit-app-region: drag`, which is an
 * Electron mechanism that WebView2 does not honour. Tauri's equivalent is the
 * `data-tauri-drag-region` attribute, handled by an event-delegating script
 * the window plugin injects. A bare/`"true"` value only counts a direct hit on
 * the marked element, so the drag layer here uses `"deep"` (any descendant
 * drags). `<button>` elements block dragging on their own, so the three
 * controls need no opt-out.
 *
 * Window state: `is_maximized` decides the middle button's glyph. It is
 * re-read on resize (a maximize always resizes the webview) and once on mount.
 * Fullscreen is driven by the Rust-emitted `dsh-desktop://fullscreen` event,
 * mirroring the official desktop client: in fullscreen the OS drops the
 * caption, so the reserved height must go back to zero and this layer hides.
 *
 * Idempotent: safe if the script is somehow evaluated twice.
 */
(function () {
  if (window.__dshTitlebarInstalled) return;
  window.__dshTitlebarInstalled = true;

  /* ---------- geometry ---------- */
  // Must match WINDOWS_TITLEBAR_HEIGHT in the official desktop client; the dsh
  // frontend reads it from the CSS variable, so this is the single source.
  var HEIGHT = 40;
  var STYLE_ID = 'dsh-desktop-titlebar-style';
  var ROOT_ID = 'dsh-desktop-titlebar';

  /* ---------- ipc ---------- */
  function invoke(command, args) {
    var internals = window.__TAURI_INTERNALS__;
    if (internals && internals.invoke) return internals.invoke(command, args);
    if (window.console) console.warn('[dsh-titlebar] Tauri IPC unavailable, cannot run', command);
    return Promise.resolve();
  }

  /* ---------- styles ---------- */
  // This layer paints no background of its own: the strip under the caption is
  // already filled by the dsh frontend's own Windows-caption rule
  // (`[data-windows-titlebar] .frame::before` → `--dsw-specific-sidebar-fill`),
  // so a second fill here would only risk drifting from the page palette.
  // Text colour still comes from the dsh tokens so the control glyphs track
  // light/dark. The row carries no title text; `.dsh-tb-drag` is a bare drag
  // surface, so the sidebar controls the frontend pins into this row (at
  // left:12px and left:48px) are left unobstructed.
  var CSS = `
#${ROOT_ID}{position:fixed;top:0;left:0;right:0;height:var(--dsh-windows-titlebar-height,40px);display:flex;align-items:stretch;justify-content:space-between;background:transparent;color:var(--dsw-alias-label-primary,#0f1115);font-family:var(--ds-font-family-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif);user-select:none;-webkit-user-select:none}
#${ROOT_ID}[data-fullscreen]{display:none}
.dsh-tb-drag{flex:1 1 auto;min-width:0;overflow:hidden}
.dsh-tb-controls{flex:0 0 auto;display:flex;align-items:stretch}
.dsh-tb-btn{display:inline-flex;align-items:center;justify-content:center;width:46px;height:100%;padding:0;border:none;border-radius:0;background:transparent;cursor:default;color:inherit;font:inherit}
.dsh-tb-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.dsh-tb-btn:active{background:var(--dsw-alias-interactive-bg-active,rgba(0,0,0,.12))}
.dsh-tb-btn[data-role=close]:hover{background:#c42b1c;color:#fff}
.dsh-tb-btn[data-role=close]:active{background:#b1271a;color:#fff}
.dsh-tb-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:-2px}
.dsh-tb-btn svg{display:block;pointer-events:none}
/* A modal mask must dim this caption too. The dsh frontend reserves the caption
   height for masks (--dsh-frame-chrome-top) because in its own Windows build the
   caption is OS-drawn and cannot be covered by page content; leaving it out keeps
   the caption bright above a dimmed page, which reads as a rendering fault.
   This caption is ordinary page content and sits under the mask, so the mask
   starts at the top instead. Only dsh-client-ui-settings-general consumes this
   variable (its .mask backdrop), and fullscreen already resolves it to 0.
   !important is required: the frontend declares the same property on the same
   element, so an unforced declaration loses to whichever sheet is applied later. */
html[data-windows-titlebar]{--dsh-frame-chrome-top:0px !important}
`;

  /* ---------- caption glyphs (Windows metrics: 10px glyph, 1px stroke) ---------- */
  function svg(inner) {
    return '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" '
      + 'stroke-width="1" aria-hidden="true">' + inner + '</svg>';
  }
  var GLYPH = {
    minimize: '<path d="M0 5.5h10"/>',
    maximize: '<rect x="0.5" y="0.5" width="9" height="9"/>',
    restore: '<rect x="0.5" y="2.5" width="7" height="7"/>'
      + '<path d="M2.5 2.5V0.5h7v7h-2"/>',
    close: '<path d="m0.5 0.5 9 9M9.5 0.5l-9 9"/>',
  };

  var BUTTONS = [
    { role: 'minimize', label: '最小化', glyph: 'minimize' },
    { role: 'maximize', label: '最大化', glyph: 'maximize' },
    { role: 'close', label: '关闭', glyph: 'close' },
  ];

  /* ---------- dom ---------- */
  var root = null;
  var maximizeBtn = null;

  function build() {
    var style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = CSS;

    root = document.getElementById(ROOT_ID);
    if (root) return;

    root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('role', 'banner');

    // Drag layer. Buttons block dragging themselves, so they live outside it.
    // It carries no text of its own: the caption band shows only the dsh
    // sidebar controls (which the frontend pins into this row) and the window
    // controls on the right.
    var drag = document.createElement('div');
    drag.className = 'dsh-tb-drag';
    drag.setAttribute('data-tauri-drag-region', 'deep');

    var controls = document.createElement('div');
    controls.className = 'dsh-tb-controls';
    BUTTONS.forEach(function (spec) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dsh-tb-btn';
      btn.dataset.role = spec.role;
      btn.title = spec.label;
      btn.setAttribute('aria-label', spec.label);
      btn.innerHTML = svg(GLYPH[spec.glyph]);
      btn.addEventListener('click', function () { onClick(spec.role); });
      controls.appendChild(btn);
      if (spec.role === 'maximize') maximizeBtn = btn;
    });

    root.appendChild(drag);
    root.appendChild(controls);
    (document.body || document.documentElement).appendChild(root);
  }

  /* ---------- actions ---------- */
  // A toggle round-trips through IPC, so a fast double click can start a second
  // toggle before the first finishes and leave the window where it started.
  // `maximizePending` drops those repeat clicks.
  var maximizePending = false;

  function onClick(role) {
    if (role === 'minimize') return void invoke('window_minimize');
    if (role === 'maximize') return void toggleMaximize();
    // close goes through Rust, which routes it into the existing
    // CloseRequested handler so the dsh-styled confirmation dialog still runs.
    if (role === 'close') return void invoke('window_close');
  }

  function toggleMaximize() {
    if (maximizePending) return;
    maximizePending = true;
    invoke('window_toggle_maximize')
      .then(syncMaximized)
      .catch(reportIpcFailure('window_toggle_maximize'))
      // Cleared in a finally-style step so a failed invoke cannot leave the
      // button permanently unresponsive.
      .then(function () { maximizePending = false; });
  }

  /**
   * Repaint the middle glyph from the window's real maximized state. Reading
   * the truth (instead of toggling a local flag) keeps the glyph correct when
   * the user snaps or maximizes the window through Windows itself.
   */
  function syncMaximized() {
    if (!maximizeBtn) return Promise.resolve();
    return invoke('window_is_maximized').then(function (maximized) {
      var on = maximized === true;
      maximizeBtn.innerHTML = svg(on ? GLYPH.restore : GLYPH.maximize);
      var label = on ? '向下还原' : '最大化';
      maximizeBtn.title = label;
      maximizeBtn.setAttribute('aria-label', label);
    }).catch(reportIpcFailure('window_is_maximized'));
  }

  /**
   * Build a rejection handler for a titlebar IPC call. Failures leave the
   * window usable (the caption keeps its last glyph) but must not become
   * unhandled rejections, so they are logged once with the command name.
   * @param {string} command - IPC command that failed, for the log line.
   * @returns {(error: unknown) => void} handler suitable for `.catch`.
   */
  function reportIpcFailure(command) {
    return function (error) {
      if (window.console) console.warn('[dsh-titlebar] ' + command + ' failed', error);
    };
  }

  // Resizing fires every frame while an edge is dragged, and the maximized
  // state cannot change during a drag, so coalesce bursts into one query.
  var syncTimer = 0;
  function scheduleSyncMaximized() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      syncTimer = 0;
      syncMaximized();
    }, 150);
  }

  /* ---------- frontend caption switch + fullscreen ---------- */
  function markCaption() {
    var el = document.documentElement;
    el.dataset.windowsTitlebar = '';
    el.style.setProperty('--dsh-windows-titlebar-height', HEIGHT + 'px');
  }

  // Fullscreen removes the caption; release the reserved strip so overlays and
  // the frame reach the screen edge (matches the dsh frontend's own
  // `[data-windows-titlebar][data-fullscreen]` rule).
  function applyFullscreen(fullscreen) {
    var el = document.documentElement;
    if (fullscreen) {
      el.dataset.fullscreen = 'true';
      el.style.setProperty('--dsh-windows-titlebar-height', '0px');
      if (root) root.dataset.fullscreen = '';
    } else {
      delete el.dataset.fullscreen;
      el.style.setProperty('--dsh-windows-titlebar-height', HEIGHT + 'px');
      if (root) delete root.dataset.fullscreen;
    }
    if (!fullscreen) syncMaximized();
  }

  function listenFullscreen() {
    var internals = window.__TAURI_INTERNALS__;
    if (!internals || !internals.invoke) return;
    // The public @tauri-apps/api JS is not loaded for a remote page, so
    // subscribe the low-level way: mint a callback id, then hand it to the
    // event plugin's `listen` command (core:event:default allows it).
    try {
      var handlerId = internals.transformCallback(function (event) {
        var payload = event && event.payload;
        applyFullscreen(payload === true);
      });
      internals.invoke('plugin:event|listen', {
        event: 'dsh-desktop://fullscreen',
        target: { kind: 'Any' },
        handler: handlerId,
      });
    } catch (error) {
      if (window.console) console.warn('[dsh-titlebar] fullscreen listener failed', error);
    }
  }

  /* ---------- boot ---------- */
  function install() {
    markCaption();
    build();
    syncMaximized();
    listenFullscreen();
    // Coalesced: an edge drag fires resize many times per second.
    window.addEventListener('resize', scheduleSyncMaximized);
  }

  // The initialization script runs before the document root exists.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
