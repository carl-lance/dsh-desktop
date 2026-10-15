/**
 * dsh-desktop — caption menus for the custom titlebar.
 *
 * Injected as a WebView2 initialization script (see CAPTION_MENU_SCRIPT in
 * src/lib.rs), BEFORE titlebar.js, which mounts it into the caption slot:
 * `window.__dshDesktopCaptionMenu.mount(slot)` — and only once the dsh frontend
 * has rendered, because the offset the bar sits behind belongs to that frontend
 * (see `whenCaptionLayoutReady` in titlebar.js). The backend-startup page
 * therefore shows no menu bar at all. Keeping that decision on the titlebar's
 * side is deliberate: it is where the caption geometry already lives, and this
 * file needs to know nothing about it.
 *
 * Split from titlebar.js on purpose: titlebar.js owns the caption band itself
 * (drag layer, window controls, reserved height), this file owns the menu bar
 * that sits at the band's left end.
 *
 * Where it lands: `#dsh-desktop-caption-slot`, the row's FIRST child and a
 * SIBLING of the drag layer — anything inside `.dsh-tb-drag`
 * (`data-tauri-drag-region="deep"`) drags the window instead of receiving
 * clicks. Neither the slot nor this layer sets a z-index, so an open panel
 * raises itself to 1200 and still clears the dsh frontend's own overlays
 * (1100).
 *
 * Adding a menu is one MENUS entry (label + entries), each entry a label plus
 * `run`. Bar, trigger, panel and items all render from the CSS below, so a new
 * menu needs no styling and no Rust change. An entry that opens a dialog
 * should reach for that dialog's own global — see `openAbout` — so a missing
 * dialog degrades to a warning instead of breaking the bar.
 *
 * Behaviour follows the Windows menu bar: clicking a trigger toggles its
 * panel, ArrowUp/ArrowDown walk the items, Escape closes and hands focus back
 * to the trigger, and a click anywhere outside closes. A mousedown inside the
 * bar is deliberately ignored by the outside-click handler, so a trigger click
 * toggles instead of closing and immediately reopening.
 *
 * Pointer traffic on the bar stops at the bar. It is window chrome, not page
 * content: a click on 帮助 must not read as a click on page whitespace (that
 * closes the frontend's sidebars and popovers), and a right-click must raise no
 * menu at all — neither the webview's default one (reload, save as, inspect),
 * whose panel would cover the caption row it was invoked from, nor the one the
 * injected context-menu.js builds. Two places do that swallowing, and it takes
 * both: `mousedown`/`pointerdown` are stopped on the document in the capture
 * phase, the only point early enough to beat the handlers the frontend delegates
 * on its root container, while `click`/`contextmenu` are stopped on the bar
 * itself, since stopping those earlier would cut the bar's own handlers short.
 *
 * Runs on every page load, so it must stay idempotent.
 */
(function () {
  if (window.__dshDesktopCaptionMenu) return;

  var STYLE_ID = 'dsh-desktop-caption-menu-style';

  /* ---------- styles ---------- */
  // Tokens come from the dsh design system and resolve on the dsh page
  // (light/dark via `body[data-ds-dark-theme]`); light-theme fallbacks cover
  // the loading page. The panel is the only raised element: z-index 1200 sits
  // above the frontend's own 1100 overlays, and `top: 100%` lands flush with
  // the caption row's bottom edge because `.dsh-cm-menu` stretches to the row
  // height (the slot's align-items: stretch). The bar's 2px bottom margin is
  // therefore also what holds the open panel that far off that edge, instead
  // of letting it sit on the band's bottom border.
  // `-webkit-app-region: no-drag` on the bar and its panel is the one that
  // actually kills the OS system menu (see the note in titlebar.js): these are
  // rectangles the frontend's own caption rules leave as non-client area, where
  // a right-click is Windows' caption right-click and produces no DOM event at
  // all. The bar covers its triggers and the injected context menu; the panel
  // declares it too because it hangs below the row.
  var CSS = `
.dsh-cm-bar{position:relative;display:flex;align-items:center;gap:2px;margin-bottom:2px;-webkit-app-region:no-drag}
.dsh-cm-menu{position:relative;display:flex;align-items:center}
.dsh-cm-trigger{display:inline-flex;align-items:center;height:26px;padding:0 10px;border:none;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:20px;cursor:default}
.dsh-cm-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.dsh-cm-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-active,rgba(0,0,0,.12))}
.dsh-cm-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:-2px}
.dsh-cm-panel{position:absolute;top:100%;left:0;z-index:1200;-webkit-app-region:no-drag;display:none;min-width:200px;padding:4px;border:1px solid var(--dsw-alias-border-inverted,rgba(0,0,0,.06));border-radius:10px;background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:var(--dsw-shadow-lv3,0 0 1px 0 rgba(0,0,0,.2),0 0 4px 0 rgba(0,0,0,.02),0 12px 32px 0 rgba(0,0,0,.08))}
.dsh-cm-panel.dsh-cm-open{display:block}
.dsh-cm-entry{display:flex;align-items:center;width:100%;height:32px;padding:0 10px;border:none;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:default}
.dsh-cm-entry:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.dsh-cm-entry:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:-2px}
`;

  /* ---------- dialogs this bar can open ---------- */
  // The About card lives in its own script (assets/about-dialog.js) so this
  // file stays about the menu bar. Reached through a global: if that script is
  // absent, the item warns instead of taking the whole bar down with it.
  function openAbout() {
    var about = window.__dshDesktopAbout;
    if (about && about.show) {
      about.show();
      return;
    }
    if (window.console) console.warn('[dsh-caption-menu] about dialog unavailable');
  }

  /* ---------- menus ---------- */
  // Add a menu here — { label, entries: [{ label, run }] } — and nothing else:
  // the bar is rebuilt from this list on mount.
  var MENUS = [
    {
      label: '帮助',
      entries: [{ label: '关于 DeepSeek Harness', run: openAbout }],
    },
  ];

  /* ---------- state ---------- */
  // The menu whose panel is open, or null. Only one panel is ever open.
  var openMenu = null;
  var listenersBound = false;

  var entriesOf = function (panel) {
    return Array.prototype.slice.call(panel.querySelectorAll('.dsh-cm-entry'));
  };

  function open(menu) {
    if (openMenu && openMenu !== menu) close();
    var panel = menu.querySelector('.dsh-cm-panel');
    var trigger = menu.querySelector('.dsh-cm-trigger');
    panel.classList.add('dsh-cm-open');
    trigger.setAttribute('aria-expanded', 'true');
    openMenu = menu;
    // Focus the first item so the panel is keyboard-reachable; :focus-visible
    // keeps that focus invisible for mouse users.
    var items = entriesOf(panel);
    if (items.length) items[0].focus();
  }

  function close() {
    if (!openMenu) return;
    var panel = openMenu.querySelector('.dsh-cm-panel');
    var trigger = openMenu.querySelector('.dsh-cm-trigger');
    if (panel) panel.classList.remove('dsh-cm-open');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    openMenu = null;
  }

  function toggle(menu) {
    if (openMenu === menu) close();
    else open(menu);
  }

  /* ---------- input ---------- */
  // Right-clicks on the bar raise nothing: the webview's default menu is
  // prevented, and the page's own — including the injected context-menu.js —
  // never sees the event. Bound to the bar itself (see mount), not to the
  // document: the rest of the window keeps whatever the page wants there.
  function onBarContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  // Stops a click on a trigger, a panel item or the bar's own gutter from
  // reaching the click handlers the frontend delegates on its root container.
  function onBarClick(event) {
    event.stopPropagation();
  }

  function inBar(target) {
    return !!(target && target.closest && target.closest('.dsh-cm-bar'));
  }

  // Capture phase, on the document: this script is injected before any page
  // script, so this is the first listener a caption click meets — and the only
  // point early enough to stop it ahead of the frontend's delegated handlers,
  // which sit on a root container the bar is inside. Swallowing these two here
  // is safe precisely because nothing in the bar listens for them: the triggers
  // act on `click`.
  //
  // Outside the bar this is the outside-click rule instead: a mousedown
  // anywhere else closes the open panel. A mousedown inside does not, so
  // clicking a trigger toggles rather than closing and immediately reopening.
  function onDocumentMouseDown(event) {
    if (inBar(event.target)) {
      event.stopPropagation();
      return;
    }
    if (openMenu) close();
  }

  function onDocumentKeyDown(event) {
    if (!openMenu || event.key !== 'Escape') return;
    var trigger = openMenu.querySelector('.dsh-cm-trigger');
    close();
    if (trigger) trigger.focus();
  }

  function onPanelKeyDown(event) {
    var items = entriesOf(event.currentTarget);
    if (!items.length) return;
    var index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1) % items.length].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length].focus();
    }
  }

  /* ---------- dom ---------- */
  function buildMenu(spec) {
    var menu = document.createElement('div');
    menu.className = 'dsh-cm-menu';

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'dsh-cm-trigger';
    trigger.textContent = spec.label;
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', 'false');

    var panel = document.createElement('div');
    panel.className = 'dsh-cm-panel';
    panel.setAttribute('role', 'menu');
    panel.setAttribute('aria-label', spec.label);

    spec.entries.forEach(function (entry) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'dsh-cm-entry';
      item.setAttribute('role', 'menuitem');
      // textContent, never innerHTML: menu labels stay data, not markup.
      item.textContent = entry.label;
      item.addEventListener('click', function () {
        // Closed first: the action may open a dialog that wants the focus.
        close();
        if (entry.run) entry.run();
      });
      panel.appendChild(item);
    });

    trigger.addEventListener('click', function () { toggle(menu); });
    trigger.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        open(menu);
      }
    });
    panel.addEventListener('keydown', onPanelKeyDown);

    menu.appendChild(trigger);
    menu.appendChild(panel);
    return menu;
  }

  function injectStyle() {
    var style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = CSS;
  }

  /* ---------- public api ---------- */
  /**
   * Build the menu bar inside the titlebar's caption slot. Called by
   * titlebar.js once that slot exists AND the frontend has rendered, because an
   * initialization script runs before the document root does: this file only
   * defines the API at injection time and leaves every DOM write to this call.
   * @param {HTMLElement} slot - the caption slot (`#dsh-desktop-caption-slot`).
   */
  function mount(slot) {
    if (!slot) return;
    injectStyle();
    close();

    // Rebuilt from MENUS, so a second mount (a rebuilt titlebar) replaces the
    // previous bar instead of stacking a duplicate.
    var existing = slot.querySelector('.dsh-cm-bar');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    var bar = document.createElement('div');
    bar.className = 'dsh-cm-bar';
    // One listener each on the bar covers trigger, panel and items — they all
    // bubble here — and both are rebuilt with the bar, so nothing needs
    // unbinding. Stopping the events here is the second half of the swallowing
    // described at the top of this file.
    bar.addEventListener('contextmenu', onBarContextMenu);
    bar.addEventListener('click', onBarClick);
    MENUS.forEach(function (spec) { bar.appendChild(buildMenu(spec)); });
    slot.appendChild(bar);

    // Bound once, for the same reason. pointerdown as well as mousedown: the
    // frontend may listen for either, and a click on the caption band produces
    // both — the handler is idempotent, so seeing an event twice is harmless.
    if (!listenersBound) {
      listenersBound = true;
      document.addEventListener('mousedown', onDocumentMouseDown, true);
      document.addEventListener('pointerdown', onDocumentMouseDown, true);
      document.addEventListener('keydown', onDocumentKeyDown, true);
    }
  }

  window.__dshDesktopCaptionMenu = { mount: mount, close: close };
})();
