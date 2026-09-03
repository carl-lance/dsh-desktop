/**
 * dsh-desktop — injected context menu (right-click).
 *
 * Injected as a WebView2 initialization script (see CONTEXT_MENU_SCRIPT in
 * src/lib.rs), so it runs on EVERY page load — including reloads — and the
 * menu survives the 刷新 item.
 *
 * Clipboard strategy: the webview is created with `enable_clipboard_access()`
 * (wry auto-allows the WebView2 CLIPBOARD_READ permission), so
 * `navigator.clipboard.readText()` works from JS for paste-availability
 * detection. Writes prefer `document.execCommand('copy'/'cut')` (no permission
 * needed, most reliable in WebView2) with `navigator.clipboard.writeText` as
 * fallback.
 *
 * Menu items are always visible and gray out (disabled, opacity .4) when not
 * applicable. Items: 剪切 / 复制 / 粘贴 / 全选 │ 刷新.
 *
 * State is fully snapshotted at right-click time; the target element is held
 * by direct reference (`state.target`, no DOM marker) so menu rendering can
 * never invalidate it. Actions check `isConnected` before touching the node.
 * Failures are recorded in `window.__dshCtxLastError` and logged to console.
 */
(function () {
  if (window.__dshCtxMenuInstalled) return;
  window.__dshCtxMenuInstalled = true;

  window.__dshCtxLastError = null;

  /* ---------- styles (mirrors dsh menu component) ---------- */
  var CSS = `
.dsh-ctx-menu{box-sizing:border-box;position:fixed;z-index:2147483647;min-width:163px;padding:4px;display:flex;flex-direction:column;gap:0;border:1px solid var(--dsw-alias-border-inverted,rgba(0,0,0,.06));border-radius:12px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#fff));box-shadow:var(--dsw-shadow-lv3,0 0 1px 0 rgba(0,0,0,.2),0 0 4px 0 rgba(0,0,0,.02),0 12px 32px 0 rgba(0,0,0,.08));color:var(--dsw-alias-label-primary,#0f1115);font-family:var(--ds-font-family-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif)}
.dsh-ctx-item{display:flex;align-items:center;gap:8px;width:100%;min-height:40px;padding:8px 10px;border:none;border-radius:10px;background:transparent;cursor:pointer;font-size:14px;line-height:22px;color:inherit;text-align:left;font-family:inherit}
.dsh-ctx-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.08))}
.dsh-ctx-item:disabled{opacity:.4;cursor:not-allowed}
.dsh-ctx-icon{display:inline-flex;flex:none;width:16px;height:16px;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary,#81858c)}
.dsh-ctx-sep{height:1px;margin:4px 2px;background:var(--dsw-alias-border-l1,rgba(0,0,0,.04))}
`;

  /* ---------- state snapshot (taken at right-click time) ---------- */
  var state = {
    editable: false,     // right-click landed on input/textarea/contenteditable
    editableEmpty: false,// editable target has no text
    editableSel: null,   // { text, start, end } for input/textarea selections
    pageSel: '',         // window selection text (non-editable pages)
    target: null,        // direct reference to the editable element (or null)
    range: null,         // saved Range clone for contenteditable
    caretStart: -1,      // caret for input/textarea
    caretEnd: -1,
    clipboardText: '',   // clipboard text (async, '' = empty/unreadable)
    externalLink: null,  // resolved external URL when right-click landed on a link
  };

  var MENU_ID = 'dsh-desktop-ctx-menu';
  var STYLE_ID = 'dsh-desktop-ctx-style';

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isEditable(el) {
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true);
  }
  function editableSelection(el) {
    if (el.selectionStart == null || el.selectionEnd == null) return null;
    if (el.selectionEnd <= el.selectionStart) return null;
    return { text: el.value.substring(el.selectionStart, el.selectionEnd), start: el.selectionStart, end: el.selectionEnd };
  }
  function resolveExternalLink(a) {
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#' || /^javascript:/i.test(href)) return null;
    var url;
    try { url = new URL(href, location.href); } catch (e) { return null; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    var h = url.hostname;
    if (h === '127.0.0.1' || h === 'localhost' || h === 'tauri.localhost') return null;
    return url.href;
  }
  function reportError(err) {
    window.__dshCtxLastError = String((err && (err.stack || err.message)) || err);
    if (window.console) console.error('[dsh-ctx]', err);
  }
  function readClipboardText() {
    if (navigator.clipboard && navigator.clipboard.readText) {
      return new Promise(function (resolve) {
        var done = false;
        var timer = setTimeout(function () { if (!done) { done = true; resolve(''); } }, 300);
        navigator.clipboard.readText().then(
          function (t) { if (!done) { done = true; clearTimeout(timer); resolve(typeof t === 'string' ? t : ''); } },
          function (err) { if (!done) { done = true; clearTimeout(timer); resolve(''); } if (window.console) console.warn('[dsh-ctx] clipboard read failed', err); }
        );
      });
    }
    return Promise.resolve('');
  }
  function legacyWrite(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:2em;height:2em;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
    return ok;
  }
  function writeText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return legacyWrite(text); }
      );
    }
    return Promise.resolve(legacyWrite(text));
  }
  function fireInput(el, inputType, data) {
    try {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: inputType, data: data }));
    } catch (e) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  function focusEditableWithCaret(el) {
    el.focus();
    if (el.setSelectionRange && state.caretStart >= 0) {
      try { el.setSelectionRange(state.caretStart, state.caretEnd); } catch (e) { /* ignore */ }
    } else if (state.range) {
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(state.range.cloneRange());
    }
  }
  function clearSelection() {
    var sel = window.getSelection();
    if (sel && sel.removeAllRanges) sel.removeAllRanges();
  }
  function targetAlive() {
    return !!(state.target && state.target.isConnected);
  }

  /* ---------- actions ---------- */
  function doCut() {
    if (!state.editableSel || !targetAlive()) return;
    var el = state.target;
    focusEditableWithCaret(el);
    var ok = false;
    try { ok = document.execCommand('cut'); } catch (e) { /* ignore */ }
    if (!ok) {
      writeText(state.editableSel.text).then(function () {
        if (!targetAlive()) return;
        try {
          el.setRangeText('', state.editableSel.start, state.editableSel.end);
          fireInput(el, 'deleteContentBackward');
        } catch (e) { /* ignore */ }
      });
    }
    clearSelection();
    hideMenu();
  }
  function doCopy() {
    if (state.editableSel && targetAlive()) {
      focusEditableWithCaret(state.target);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
      if (!ok) writeText(state.editableSel.text);
    } else if (state.pageSel) {
      var ok2 = false;
      try { ok2 = document.execCommand('copy'); } catch (e) { /* ignore */ }
      if (!ok2) writeText(state.pageSel);
    }
    clearSelection();
    hideMenu();
  }
  function doPaste() {
    if (!state.clipboardText || !state.editable || !targetAlive()) return;
    var el = state.target;
    focusEditableWithCaret(el);
    if (el.setSelectionRange) {
      try {
        el.setRangeText(
          state.clipboardText,
          state.caretStart >= 0 ? state.caretStart : el.selectionStart,
          state.caretStart >= 0 ? state.caretEnd : el.selectionEnd,
          'end'
        );
        fireInput(el, 'insertText', state.clipboardText);
      } catch (e) {
        reportError(e);
        try { document.execCommand('insertText', false, state.clipboardText); } catch (e2) { reportError(e2); }
      }
    } else {
      try { document.execCommand('insertText', false, state.clipboardText); } catch (e) { reportError(e); }
    }
    hideMenu();
  }
  function doSelectAll() {
    if (targetAlive()) {
      var el = state.target;
      if (el.select) {
        el.focus();
        el.select();
      } else if (el.isContentEditable) {
        var sel = window.getSelection();
        var r = document.createRange();
        r.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    } else {
      document.execCommand('selectAll');
    }
    hideMenu();
  }
  function doReload() {
    hideMenu();
    location.reload();
  }
  function doOpenLink() {
    if (!state.externalLink) return;
    var opener = window.__dshOpenExternal;
    if (opener) {
      opener(state.externalLink);
    } else {
      var invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
      if (invoke) invoke('open_url', { url: state.externalLink }).catch(function (err) { reportError(err); });
    }
    hideMenu();
  }
  function doOpenConsole() {
    var invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
    if (invoke) invoke('open_devtools').catch(function (err) { reportError(err); });
    hideMenu();
  }

  /* ---------- menu DOM ---------- */
  var menu, style;
  function ensureDom() {
    style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = CSS;
    menu = document.getElementById(MENU_ID);
    if (!menu) {
      menu = document.createElement('div');
      menu.id = MENU_ID;
      menu.className = 'dsh-ctx-menu';
      menu.setAttribute('role', 'menu');
      menu.style.display = 'none';
      (document.body || document.documentElement).appendChild(menu);
      document.addEventListener('mousedown', function (e) {
        if (menu.style.display !== 'none' && !menu.contains(e.target)) hideMenu();
      }, true);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') hideMenu();
      }, true);
      window.addEventListener('blur', hideMenu);
      window.addEventListener('scroll', hideMenu, true);
      window.addEventListener('resize', hideMenu);
    }
  }

  function iconSvg(name) {
    var paths = {
      cut: '<circle cx="5" cy="5" r="2"/><circle cx="5" cy="11" r="2"/><path d="m7.2 6.4 6-4.4M7.2 9.6 13.2 14"/>',
      copy: '<rect x="5.5" y="5.5" width="7" height="7" rx="1.5"/><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/>',
      paste: '<path d="M5.5 3h5"/><rect x="3.5" y="3.5" width="9" height="10.5" rx="1.5"/><path d="M5.8 7.5h4.4M5.8 10h4.4"/>',
      selectall: '<rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/><path d="M5 6.5h6M5 9.5h6"/>',
      reload: '<path d="M13.8 8a5.8 5.8 0 1 1-1.7-4.1"/><path d="M13.8 1.8V4.9h-3.1"/>',
      openlink: '<path d="M10 2.5h3.5V6"/><path d="m13.5 2.5-6 6"/><path d="M8.5 5.5h-3a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h5a2 2 0 0 0 2-2v-3"/>',
      console: '<path d="M3.5 4.5 7 8 3.5 11.5"/><path d="M9.5 11.5H13"/>',
    };
    return '<span class="dsh-ctx-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[name] + '</svg></span>';
  }

  /* Menu state is decided purely from the snapshot — no DOM access here,
     so rendering can never invalidate the captured target. */
  var ITEMS = [
    { id: 'cut', label: '剪切', icon: 'cut',
      enabled: function () { return !!(state.editableSel); },
      run: doCut },
    { id: 'copy', label: '复制', icon: 'copy',
      enabled: function () { return !!(state.editableSel || state.pageSel); },
      run: doCopy },
    { id: 'paste', label: '粘贴', icon: 'paste',
      enabled: function () { return !!(state.editable && state.clipboardText); },
      run: doPaste },
    { id: 'selectall', label: '全选', icon: 'selectall',
      enabled: function () { return !state.editable || !state.editableEmpty; },
      run: doSelectAll },
    { id: 'sep' },
    { id: 'reload', label: '刷新', icon: 'reload',
      enabled: function () { return true; },
      run: doReload },
    { id: 'console', label: '打开控制台', icon: 'console',
      enabled: function () { return true; },
      run: doOpenConsole },
  ];

  /* 打开外链 sits on top only when the right-click landed on an external link. */
  function buildItems() {
    if (!state.externalLink) return ITEMS;
    return [
      { id: 'openlink', label: '打开外链', icon: 'openlink',
        enabled: function () { return true; },
        run: doOpenLink },
      { id: 'sep' },
    ].concat(ITEMS);
  }

  function renderMenu(x, y) {
    ensureDom();
    menu.innerHTML = '';
    buildItems().forEach(function (item) {
      if (item.id === 'sep') {
        var sep = document.createElement('div');
        sep.className = 'dsh-ctx-sep';
        menu.appendChild(sep);
        return;
      }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dsh-ctx-item';
      btn.setAttribute('role', 'menuitem');
      btn.disabled = !item.enabled();
      btn.innerHTML = iconSvg(item.icon) + '<span class="dsh-ctx-label">' + esc(item.label) + '</span>';
      if (!btn.disabled) {
        btn.addEventListener('click', function () {
          try { item.run(); } catch (err) { reportError(err); }
        });
      }
      menu.appendChild(btn);
    });
    menu.style.display = 'flex';
    menu.style.left = '0px';
    menu.style.top = '0px';
    var mw = menu.offsetWidth;
    var mh = menu.offsetHeight;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    menu.style.left = (x + mw > vw ? vw - mw - 8 : x) + 'px';
    menu.style.top = (y + mh > vh ? vh - mh - 8 : y) + 'px';
  }

  function hideMenu() {
    if (menu) menu.style.display = 'none';
  }

  /* ---------- right-click interception (capture phase wins over page handlers) ---------- */
  document.addEventListener('contextmenu', function (e) {
    var target = e.target;
    var editable = isEditable(target);

    state.editable = editable;
    state.editableEmpty = editable && target.value != null ? target.value.length === 0 : false;
    state.editableSel = editable ? editableSelection(target) : null;
    state.pageSel = editable ? '' : (window.getSelection() ? window.getSelection().toString() : '');
    state.target = editable ? target : null;
    state.range = null;
    state.caretStart = -1;
    state.caretEnd = -1;
    state.clipboardText = '';
    var linkAnchor = target && target.closest ? target.closest('a[href]') : null;
    state.externalLink = linkAnchor ? resolveExternalLink(linkAnchor) : null;

    if (editable) {
      if (target.selectionStart != null) {
        state.caretStart = target.selectionStart;
        state.caretEnd = target.selectionEnd;
      } else if (window.getSelection && window.getSelection().rangeCount > 0) {
        state.range = window.getSelection().getRangeAt(0).cloneRange();
      }
    }

    e.preventDefault();
    e.stopPropagation();

    readClipboardText().then(function (text) {
      state.clipboardText = text;
      renderMenu(e.clientX, e.clientY);
    });
  }, true);
})();
