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
 *   4. This script also publishes a slot at the LEFT end of that row: an empty
 *      `#dsh-desktop-caption-slot` as the row's FIRST child, so the row's
 *      `align-items: stretch` gives it the row height and the drag layer's
 *      `flex: 1 1 auto` pins it to the left end. The offset is a margin of the
 *      frontend's own `--dsh-windows-menu-start` (48px while the sidebar is
 *      expanded, 84px once collapsed, when New Session is pinned at 48–76px
 *      too). The caption menu bar (帮助 → 关于) is mounted into it — see
 *      `mountCaptionMenu`, and `assets/caption-menu.js` for the bar itself —
 *      but only AFTER the frontend has rendered AND settled: both that variable
 *      and the controls the offset clears belong to the frontend, so mounting
 *      earlier would park the menu at the 48px fallback, on top of New Session
 *      once the sidebar is collapsed, and would also put it on the
 *      backend-startup page or across a skeleton screen.
 *      See `whenCaptionLayoutReady`. That margin is only ever written when the
 *      variable is missing AND measuring the pinned controls beats the 48px
 *      fallback: writing the fallback itself would outrank the variable and
 *      freeze the offset at the expanded value until some resize re-ran it. The
 *      slot paints no background of its own, so further chrome may be appended
 *      after the bar.
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
  var SLOT_ID = 'dsh-desktop-caption-slot';
  // Slot offset used when the frontend declares no --dsh-windows-menu-start:
  // 48px clears the sidebar toggle, which the frontend pins at 12-40px.
  var SLOT_START_FALLBACK = 48;
  // Gap kept between the frontend's pinned controls and the slot.
  var SLOT_GAP = 8;
  // The dsh AppFrame's overlay layer, rendered unconditionally on every page of
  // the frontend and used by the official desktop preload to gate its own
  // window menu (docs/TITLEBAR-ANALYSIS.md, §1.9). `#root > *` covers a build
  // that renames it, since React's mount point is what the two share. The
  // startup page (frontend/index.html) has neither, which is exactly the point.
  var READY_SELECTOR = '[data-shell-overlay],#root > *';
  // Readiness is a gate, not a race. The frame proves the caption row exists; it
  // does not prove the page has arrived — a first commit is often a skeleton, and
  // mounting into that puts the menu on screen ahead of the content it belongs
  // to. So the menu waits for that frame to stop changing too: this many frames
  // in a row without a mutation (≈133ms), and at most this long in total, since a
  // page that streams or ticks would otherwise never report quiet.
  var READY_QUIET_FRAMES = 8;
  var READY_QUIET_BUDGET_MS = 1200;

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
/* This row is our chrome, never OS decoration, and saying so is what keeps the
   Windows system menu away. wry turns WebView2's non-client region support on
   for every window (webview2/mod.rs -> SetIsNonClientRegionSupportEnabled(true)),
   which makes the frontend's Electron-era -webkit-app-region: drag real: the
   rectangle it marks becomes non-client area, and a right-click there is handled
   as a caption right-click, raising 还原/移动/大小/最小化/最大化/关闭. No page
   listener ever sees it — the click never becomes a DOM event — so neither the
   injected scripts nor data-tauri-drag-region can suppress it. Declaring no-drag
   here carves the row back out of that rectangle. Dragging is unaffected: it
   runs through .dsh-tb-drag and Tauri's own drag script. */
#${ROOT_ID}{position:fixed;top:0;left:0;right:0;height:var(--dsh-windows-titlebar-height,40px);display:flex;align-items:stretch;justify-content:space-between;background:transparent;color:var(--dsw-alias-label-primary,#0f1115);font-family:var(--ds-font-family-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif);user-select:none;-webkit-user-select:none;-webkit-app-region:no-drag}
#${ROOT_ID}[data-fullscreen]{display:none}
.dsh-tb-drag{flex:1 1 auto;min-width:0;overflow:hidden}
.dsh-tb-controls{flex:0 0 auto;display:flex;align-items:stretch;-webkit-app-region:no-drag}
.dsh-tb-btn{display:inline-flex;align-items:center;justify-content:center;width:46px;height:100%;padding:0;border:none;border-radius:0;background:transparent;cursor:default;color:inherit;font:inherit}
.dsh-tb-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.dsh-tb-btn:active{background:var(--dsw-alias-interactive-bg-active,rgba(0,0,0,.12))}
.dsh-tb-btn[data-role=close]:hover{background:#c42b1c;color:#fff}
.dsh-tb-btn[data-role=close]:active{background:#b1271a;color:#fff}
.dsh-tb-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:-2px}
.dsh-tb-btn svg{display:block;pointer-events:none}
/* Left-end slot for the caption menus: the row's first child, so the row's
   align-items:stretch gives it the full row height and the drag layer's
   flex:1 1 auto keeps it pinned to the left end. It has no position, width or
   height of its own, paints no background, and carries no z-index on purpose,
   so the menu panel mounted here still rises above the frontend's own overlays
   (the panel raises itself to 1200, they sit at 1100). The offset is never a
   constant: the
   frontend pins its sidebar controls into this same row (toggle at 12-40px,
   New Session at 48-76px once collapsed), so this margin follows that state
   through the frontend's own --dsh-windows-menu-start. */
#${SLOT_ID}{display:flex;align-items:stretch;margin-left:var(--dsh-windows-menu-start,${SLOT_START_FALLBACK}px)}
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
  // Host at the left end of the caption row. This script only decides WHERE
  // chrome may live and mounts the caption menu into it (mountCaptionMenu);
  // what that menu contains is `assets/caption-menu.js`'s business.
  var captionSlot = null;

  function build() {
    var style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = CSS;

    root = document.getElementById(ROOT_ID);
    captionSlot = document.getElementById(SLOT_ID);
    if (root) return;

    root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('role', 'banner');

    var slot = document.createElement('div');
    slot.id = SLOT_ID;
    captionSlot = slot;

    // Drag layer. Buttons block dragging themselves, so they live outside it.
    // It carries no text of its own: the caption band shows only the dsh
    // sidebar controls (which the frontend pins into this row) and the window
    // controls on the right.
    var drag = document.createElement('div');
    drag.className = 'dsh-tb-drag';
    drag.setAttribute('data-tauri-drag-region', 'deep');
    // Double-click to maximize is timed here (see onDragLayerMouseDown).
    // Bound on the drag layer itself: Tauri's drag script listens on the
    // document in the bubble phase, so a target-phase listener runs first and
    // can keep the second press away from `start_dragging`.
    drag.addEventListener('mousedown', onDragLayerMouseDown);

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
    // First child of the row, and a SIBLING of the drag layer: everything
    // inside .dsh-tb-drag (data-tauri-drag-region="deep") drags the window
    // instead of receiving clicks, so the slot must never live in there.
    root.insertBefore(slot, drag);
    (document.body || document.documentElement).appendChild(root);
  }

  /* ---------- caption slot offset ---------- */
  // The frontend already publishes the offset as --dsh-windows-menu-start on
  // <html>: undefined while the sidebar is expanded (48px fallback) and 84px
  // once it is collapsed. That variable is the contract, because whoever moves
  // those buttons maintains it, so it wins and the stylesheet needs no help.
  // The measured path below only exists for a build that declares no variable.
  //
  // Which is why the inline margin is written only when it has to be. An inline
  // margin outranks the stylesheet's var(), so parking the 48px fallback there
  // before the frontend has declared anything would freeze the slot at the
  // expanded offset: the menu would sit on the sidebar controls the collapsed
  // state pins into the same row, and nothing short of a resize would re-run
  // this to hand the offset back. Measuring first and staying out of the way
  // while the measurement says the fallback is enough keeps the variable in
  // charge whenever it decides to show up.
  var slotStartOverride = '';

  function syncCaptionSlot() {
    if (!captionSlot) return;
    var declared = '';
    try {
      declared = getComputedStyle(document.documentElement)
        .getPropertyValue('--dsh-windows-menu-start').trim();
    } catch (error) {
      declared = '';
    }
    // '' leaves the offset to the stylesheet, where the variable — or its 48px
    // fallback — decides. A margin, not an offset: the slot is laid out by the
    // row's flex flow, whose left edge is x=0.
    var next = '';
    if (!declared) {
      // The measurement is where the controls end, and the slot has to clear
      // that rather than touch it; and the fallback is already right whenever
      // nothing reaches past it, so the margin stays unwritten.
      var clear = measureCaptionControls() + SLOT_GAP;
      if (clear > SLOT_START_FALLBACK) next = clear + 'px';
    }
    if (slotStartOverride === next) return;
    slotStartOverride = next;
    if (next) captionSlot.style.marginLeft = next;
    else captionSlot.style.removeProperty('margin-left');
  }

  /**
   * Measure how far the frontend's own caption controls reach, for a build that
   * declares no --dsh-windows-menu-start. Deliberately geometric: the class
   * names in the dsh build are hashed and change between versions, while
   * "control sitting at the left end of the caption strip" is the stable
   * property. Sampling points along the strip's middle is far cheaper than
   * walking every node, and a point that lands on the frame or the sidebar
   * itself returns a box far wider than a control.
   * @returns {number} the right edge those controls reach, or 0 if none is there.
   */
  function measureCaptionControls() {
    var right = 0;
    var y = Math.round(HEIGHT / 2);
    for (var x = SLOT_GAP; x < 200; x += 4) {
      var hit = frontendHitAt(x, y);
      if (!hit) continue;
      var control = (hit.closest && hit.closest('button,[role="button"],a')) || hit;
      // A hit can land on a glyph inside the control (an icon is ~10px wide);
      // walk up until the box looks like a control rather than its glyph.
      for (var depth = 0; depth < 3; depth += 1) {
        var box = control.getBoundingClientRect();
        if (box.width >= 20 || !control.parentElement) break;
        control = control.parentElement;
      }
      var rect = control.getBoundingClientRect();
      if (rect.width > 120 || rect.right > 200) continue;
      if (rect.right > right) right = rect.right;
    }
    return right;
  }

  /**
   * Topmost element at (x, y) that belongs to the page rather than to this
   * script's own caption. A plain elementFromPoint cannot answer that: this
   * layer is fixed and appended last, so its drag strip covers the whole row and
   * every sample would come back as our own element. The full stack from
   * elementsFromPoint is what lets a sample see past it.
   * @param {number} x - viewport x.
   * @param {number} y - viewport y.
   * @returns {Element|null} the page's own element, or null if only ours is there.
   */
  function frontendHitAt(x, y) {
    var stack = document.elementsFromPoint
      ? document.elementsFromPoint(x, y)
      : [document.elementFromPoint(x, y)];
    for (var i = 0; i < stack.length; i += 1) {
      var node = stack[i];
      if (!node) continue;
      if (captionSlot && captionSlot.contains(node)) continue;
      if (root && root.contains(node)) continue;
      return node;
    }
    return null;
  }

  // The sidebar state is the frontend's to express — an attribute, a class, a
  // subtree that only exists in one of the two states, and the names it picks
  // change between builds — so nothing here is watched by name. Any structural
  // change re-reads the variable instead: that read is one computed style, and
  // syncCaptionSlot() only touches the DOM when the answer actually changed.
  // Missing this is what left the menu on top of the sidebar controls: the
  // offset had been measured while the frontend was still expanded, and nothing
  // after that asked again until a resize.
  //
  // Coalesced into a frame, because one React commit lands as a burst of
  // mutations and the offset only has to be right once they are all in.
  var slotSyncScheduled = false;

  function scheduleSyncCaptionSlot() {
    if (slotSyncScheduled) return;
    slotSyncScheduled = true;
    requestAnimationFrame(function () {
      slotSyncScheduled = false;
      syncCaptionSlot();
    });
  }

  function watchCaptionControls() {
    if (!document.documentElement || typeof MutationObserver === 'undefined') return;
    new MutationObserver(scheduleSyncCaptionSlot).observe(document.documentElement, {
      subtree: true,
      attributes: true,
    });
  }

  /* ---------- caption menus ---------- */
  // The bar at the left end of the row (帮助 → 关于) is a separate script —
  // `assets/caption-menu.js` — so this file stays about the caption band
  // itself: drag layer, window controls, reserved height. It is injected
  // BEFORE this script (CAPTION_MENU_SCRIPT in src/lib.rs), so its API is
  // already defined here; going through the global keeps a missing script a
  // warning instead of a titlebar failure.

  /**
   * Run `callback` once the frontend has rendered its frame AND settled, i.e.
   * once a painted page is on screen rather than the commit that merely created
   * it. The frame is the same signal the official desktop client waits on
   * (`[data-shell-overlay]`); the quiet window after it is what keeps this menu
   * off a skeleton screen, where it would otherwise appear ahead of the content
   * it belongs to.
   *
   * The offset is never guessed from our own constants: 48px is only right
   * while the sidebar is expanded, and 84px (the collapsed value) is what keeps
   * the menu clear of New Session, which the frontend pins at 48–76px.
   * @param {() => void} callback - runs on the frame after readiness.
   */
  function whenCaptionLayoutReady(callback) {
    var scheduled = false;
    function settle() {
      if (scheduled) return;
      scheduled = true;
      // Two frames: AppFrame settles its sidebar state in an effect, so the
      // first frame commits that second render and the second reads the layout
      // the frontend actually settled on.
      requestAnimationFrame(function () { requestAnimationFrame(callback); });
    }

    // Second gate: the frame's own DOM has to stop changing. Mutations are
    // delivered before the frame that follows them, so a frame whose callback
    // never ran is a frame the frontend did not repaint. Anything more precise
    // would mean naming the frontend's skeleton, and those names are its own.
    function awaitQuiet() {
      var changed = true;
      var quiet = 0;
      var deadline = Date.now() + READY_QUIET_BUDGET_MS;
      var observer = new MutationObserver(function () { changed = true; });
      observer.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, characterData: true,
      });
      function tick() {
        quiet = changed ? 0 : quiet + 1;
        changed = false;
        if (quiet >= READY_QUIET_FRAMES || Date.now() >= deadline) {
          observer.disconnect();
          settle();
          return;
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }

    if (document.querySelector(READY_SELECTOR)) return awaitQuiet();
    var observer = new MutationObserver(function () {
      if (!document.querySelector(READY_SELECTOR)) return;
      observer.disconnect();
      awaitQuiet();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function mountCaptionMenu() {
    if (!captionSlot) return;
    var menu = window.__dshDesktopCaptionMenu;
    if (!menu || !menu.mount) {
      if (window.console) console.warn('[dsh-titlebar] caption menu script unavailable');
      return;
    }
    menu.mount(captionSlot);
  }

  // The bar owns its open/closed state; this is the one place the titlebar
  // reaches into it. A panel left open would come back with the caption on the
  // way out of fullscreen, so it is closed alongside it.
  function closeCaptionMenu() {
    var menu = window.__dshDesktopCaptionMenu;
    if (menu && menu.close) menu.close();
  }

  /* ---------- actions ---------- */
  // A toggle round-trips through IPC, so a fast double click can start a second
  // toggle before the first finishes and leave the window where it started.
  // `maximizePending` drops those repeat clicks.
  var maximizePending = false;

  // Windows' own double-click window (GetDoubleClickTime) plus the handful of
  // pixels a real double click drifts.
  var DOUBLE_CLICK_MS = 500;
  var DOUBLE_CLICK_SLOP = 6;
  var lastPressAt = 0;
  var lastPressX = 0;
  var lastPressY = 0;

  /**
   * Second left press on the drag layer → maximize/restore.
   *
   * Not taken from `event.detail`, which is what Tauri's drag script keys its
   * own maximize branch on: that script cancels the default action of every
   * mousedown it handles, and Chromium restarts its click counter after a
   * cancelled press — so the second press still arrives as `detail === 1` and
   * the script only ever calls `start_dragging` again. Timing the presses is
   * the same rule Windows applies to a real caption.
   *
   * @param {MouseEvent} event - mousedown on `.dsh-tb-drag`.
   */
  function onDragLayerMouseDown(event) {
    if (event.button !== 0) return;
    var isDouble = event.timeStamp - lastPressAt <= DOUBLE_CLICK_MS
      && Math.abs(event.clientX - lastPressX) <= DOUBLE_CLICK_SLOP
      && Math.abs(event.clientY - lastPressY) <= DOUBLE_CLICK_SLOP;
    // Cleared after a pair, so a third press opens a new count instead of
    // reading as a second double click.
    lastPressAt = isDouble ? 0 : event.timeStamp;
    lastPressX = event.clientX;
    lastPressY = event.clientY;
    if (!isDouble) return;
    // Taken off the drag path: without this the same press would also start a
    // window move, which on a maximized window means a restore under the
    // cursor.
    event.preventDefault();
    event.stopPropagation();
    toggleMaximize();
  }

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
    // The caption goes away in fullscreen, so an open panel must not outlive
    // it and reappear with the bar afterwards.
    closeCaptionMenu();
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
    syncCaptionSlot();
    // Offset first, menus second: the bar is mounted already positioned, and
    // only once the frontend that owns that offset has rendered.
    whenCaptionLayoutReady(function () {
      syncCaptionSlot();
      mountCaptionMenu();
    });
    listenFullscreen();
    watchCaptionControls();
    // Coalesced: an edge drag fires resize many times per second.
    window.addEventListener('resize', onResize);
  }

  function onResize() {
    scheduleSyncMaximized();
    // The frontend's pinned controls can move on resize (collapsed width,
    // breakpoints); with its variable in place this is one computed-style read.
    scheduleSyncCaptionSlot();
  }

  // The initialization script runs before the document root exists.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
