# 类 Electron 标题栏 —— 官方实现对照与 Tauri 落地方案（仅分析，未改代码）

> 目标：把系统原生标题栏换成应用内自绘标题栏。
> 本文以 **DeepSeek 官方开源桌面端 `deepseek-ai/deepseek-harness` 的 `apps/desktop`**
> （Electron）为基准，对照本仓库（Tauri 2）给出可落地方案。
> 所有结论均对照真实源码核实，标注：✅ 已核实原文 / ⚠️ 需实测 / 🔲 待定取舍。

---

## 0. 关键结论（先说最重要的一件事）

### 0.1 官方 Electron 端**没有自绘标题栏**

它用的是 Electron 在 **Windows 上原生支持**的 `titleBarStyle: 'hidden'` + `titleBarOverlay`：
**标题栏整条由系统绘制（含最小化/最大化/关闭三个原生按钮），
页面只负责"把顶部 40px 让出来"并在这块空白上画自己的东西。**

这解释了为什么官方版在 Windows 上仍然有 Snap Layouts、正确的最大化边界、原生按钮悬停效果 ——
**因为那些按钮从头到尾就是系统的按钮，不是画出来的。**

**对 Tauri 的含义**：这条路在 Tauri 2 上**走不通**。`titleBarOverlay` 没有 Tauri 等价物
（Tauri 的 `title_bar_style` 是 macOS 专属，见 §2.2）。所以：
- 官方 = "保留原生按钮 + 自绘周边" → 零风险、零 Win32
- Tauri 想达到同样观感 = **必须自绘按钮** → 必须自己补拖拽、边缘缩放、Snap Layouts

**这是两条不同的技术路线，不是同一件事的两种写法。**

### 0.2 但有个大好消息：官方前端的让位布局，我们的 dev 运行时**已经有了** ✅

**实测结论**：`src-tauri/resources/dsh-runtime`（dev 实例用的那份，版本 **0.2.0-rc.2**）
里的客户端包里，`data-windows-titlebar` 让位规则**已全部就位**：

| 包 | 版本 | `data-windows-titlebar` 命中 |
|---|---|---|
| `dsh-client-ui-layout` | 0.2.0-rc.2 | **10** |
| `dsh-client-ui-sidebar` | 0.2.0-rc.2 | **20** |
| `dsh-client-ui-sidebar-right` | 0.2.0-rc.2 | **2** |
| `dsh-client-ui-settings-account` | 0.2.0-rc.2 | **1** |

即 §1.5 列出的每一处避让（主框架 padding、`:before` 拖拽区、侧栏按钮居中、
设置浮层、右侧全屏面板、圆角）**在 dev 运行时里都是现成的**。

**因此 Tauri 侧的工作量比预想小得多**：不需要改 dsh 前端，也不需要自己补 CSS，
只需打上 `data-windows-titlebar` + 高度变量，官方布局就接管让位。

⚠️ **但有两条必须注意**：
1. **必须以 dev 实例（端口 30080）为验证目标** —— 它用的是 0.2.0-rc.2。
2. **`Program Files` 里那个已安装版是 0.1.1-rc.2，没有这些规则**（实测 0 命中）。
   所以 release 构建若仍按 `^0.1.1-rc.2` 装运行时，会得到"打上标记也不让位"的结果。
   好在仓库的 `scripts/prepare-runtime.ps1:6` 已经钉了 **0.2.0-rc.2**，
   按脚本重跑一次即可对齐。

### 0.3 剩下的真活儿只有三块

| 能力 | 官方（Electron Windows） | Tauri 2 | 工作量 |
|---|---|---|---|
| 内容让位 / 拖拽区 / 圆角 / 浮层避让 | `data-windows-titlebar` CSS | ✅ **同一套，现成** | 0 |
| 拖拽 + 双击最大化 | `-webkit-app-region` | ✅ `data-tauri-drag-region`（框架自带） | 极小 |
| **三个窗口按钮** | 系统原生 | ❌ 必须自绘 | 半天 |
| **边缘缩放** | 系统边框 | ❌ 需 hit-test + `start_resize_dragging` | 半天 |
| **Snap Layouts** | 系统原生 | ❌ 需 Win32 子类化 | 脏活，可选 |

---

## 1. 官方 Electron 实现（源码原文）

### 1.1 窗口配置 —— `apps/desktop/src/main.ts:207-239`

```ts
function createWindow(preload: string, show = false, primary = false): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 520,
    minHeight: 600,
    show,
    ...(process.platform === 'win32' && primary ? {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: { height: WINDOWS_TITLEBAR_HEIGHT, color: chromeFallbackFill(),
        symbolColor: nativeTheme.shouldUseDarkColors ? '#f9fafb' : '#0f1115' },
    } : {}),
    // hiddenInset places traffic lights inside the sidebar; sidebar vibrancy
    // needs a transparent window background to show through the page.
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 16, y: 18 },
      vibrancy: 'sidebar' as const,
      visualEffectState: 'active' as const,
      backgroundColor: '#00000000',
    } : {}),
    webPreferences: { preload, nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, webviewTag: primary, devTools: true },
  })
```

要点：
- **Windows**：`titleBarStyle:'hidden'` + `titleBarOverlay`。`color` 是标题栏底色，`symbolColor` 是三个原生按钮符号的颜色。
- **macOS**：`hiddenInset` + `trafficLightPosition:{x:16,y:18}` + `vibrancy:'sidebar'` + 透明背景。
- **没有全平台统一的 `frame:false`**。Windows 上 `titleBarOverlay` 本身就是"隐藏系统标题栏、但保留系统按钮"。

### 1.2 标题栏高度是唯一的几何常量 —— `apps/desktop/src/windows-layout.ts`（全文 4 行）

```ts
/** Shared geometry for the Windows main-window caption. */
/** Windows application titlebar height in device-independent pixels. */
export const WINDOWS_TITLEBAR_HEIGHT = 40
```

### 1.3 主题同步：用 canvas 把 CSS 变量"量"成原生颜色 —— `apps/desktop/src/preload-windows.ts`

这是官方实现里最值得学的一段。标题栏由系统绘制，页面必须把**当前主题色**告诉主进程：

```ts
export function syncWindowsAppearance(): void {
  if (process.platform !== 'win32') return
  const mark = (): void => {
    const root = document.documentElement
    root.dataset.windowsTitlebar = ''                                    // ← 渲染层的开关
    root.style.setProperty('--dsh-windows-titlebar-height', `${WINDOWS_TITLEBAR_HEIGHT}px`)
  }
  // ...
  const probe = document.createElement('span')
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;'
    + 'background-color:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-primary)'
  document.body.append(probe)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const nativeColor = (color: string): string => {           // CSS 颜色 → rgba() 字面量
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = color
    context.fillRect(0, 0, 1, 1)
    const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
    return `rgba(${red}, ${green}, ${blue}, ${Number(alpha) / 255})`
  }
  const send = (): void => {
    const style = getComputedStyle(probe)
    const color = nativeColor(style.backgroundColor)         // 侧栏填充色
    const symbolColor = nativeColor(style.color)             // 标签主色
    const values = [root.lang, color, symbolColor]
    const current = JSON.stringify(values)
    if (current === previous) return                         // 去重，避免 IPC 抖动
    previous = current
    menu.update()
    ipcRenderer.send(DESKTOP_IPC.windowsAppearance, ...values)
  }
  const observer = new MutationObserver(send)
  observer.observe(root, { attributes: true, attributeFilter: ['lang'] })
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style'] })
  observer.observe(document.head, { childList: true, subtree: true, characterData: true })
  document.head.addEventListener('load', send, true)
  // ... pagehide 时 disconnect / dispose / remove
}
```

**为什么用 canvas**：`getComputedStyle().backgroundColor` 在自定义主题下可能是
`oklch()` / `color-mix()` 等新语法，主进程的 Electron API 只接受 `#rrggbb` / `rgb()` / `rgba()`。
用 1×1 canvas 把它**实际渲染一次再读回像素**，就把任意 CSS 颜色语法归一化成了原生可接受的字面量。✅

### 1.4 主进程侧接收并热更新 —— `apps/desktop/src/main.ts:1046-1057`

```ts
ipcMain.on(DESKTOP_IPC.windowsAppearance, (event, language: unknown, color: unknown, symbolColor: unknown) => {
  if (mainWindow === undefined || event.sender !== mainWindow.webContents
    || event.senderFrame !== mainWindow.webContents.mainFrame) return
  if (!event.senderFrame.url.startsWith(`${SCHEME}://app/`)) return     // 来源校验
  if (typeof language === 'string' && /^[a-zA-Z]+(?:-[a-zA-Z0-9]+)*$/u.test(language)) {
    windowsLanguage = language
  }
  // Empty colors precede client stylesheet installation; only CSS color values cross IPC.
  const validColor = (value: unknown): value is string => typeof value === 'string'
    && /^(?:#[\da-f]{3,8}|rgba?\([\d.,%\s]+\))$/iu.test(value)
  if (validColor(color) && validColor(symbolColor)) mainWindow.setTitleBarOverlay({ color, symbolColor })
})
```

注意 `senderFrame` 身份 + URL 前缀 + 颜色格式正则三重校验 —— 因为这条 IPC 来自渲染进程。
**Tauri 侧对应的机制是 capability + remote URL pattern**（本仓库已有 `remote-ipc.json` 先例）。

### 1.5 三条与标题栏相关的 IPC 通道（穷举核实）

标题栏相关通道只有三条，前缀统一 `dsh-desktop:`：

| 通道 | 方向 | 作用 |
|---|---|---|
| `dsh-desktop:windows-appearance` | 渲染 → 主 | 上报 `(language, color, symbolColor)`，主进程 `setTitleBarOverlay` |
| `dsh-desktop:window-fullscreen` | 主 → 渲染 | 推送全屏状态，落到 `html[data-fullscreen]` |
| `dsh-desktop:windows-menu` | 渲染 → 主 | 请求原生弹出菜单（应用/编辑），带 x/y 坐标 |

**关键反证**：`apps/desktop/src/ipc.ts` 全量 24 条通道里，
**不存在任何 `minimize` / `maximize` / `close` 窗口按钮通道**。
唯一的"关窗"是快捷键语义的 `shortcutsCloseWindow`。

这从协议层面**确证了官方没有自绘窗口按钮** —— 如果按钮是页面画的，就必须有对应的 IPC。
`grep` 全 `apps/desktop` 也找不到 `WM_NCHITTEST` / `HTMAXBUTTON` / 窗口子类化代码，
说明 Snap Layouts 完全是 `titleBarOverlay` 白拿的系统能力。

### 1.6 `frame: false` 在官方只用于子窗口

主窗口的 `createWindow` 里**没有** `frame: false`、**没有** `transparent`、
Windows 分支也**没有** `backgroundColor`。
`frame: false` 只出现在两处辅助窗口：

- `src/update-overlay.ts:27` 更新浮层
- `src/update-dialog.ts` 更新对话框（测试断言 `{ frame: false, transparent: true, ... }`）

另外 `backgroundMaterial: 'acrylic'` **只**用于 Windows 欢迎窗
（`src/welcome-window.ts:37`，配 `titleBarOverlay: { color: '#00000000', symbolColor: '#0F1115', height: 42 }`），
**主窗口不用 Mica/acrylic** —— 所以不能拿"官方用了 acrylic"来论证 Tauri 也该加窗口材质。

### 1.7 关闭即隐藏（影响我们对"退出确认"的设计）

`main.ts:1074-1085`：主窗口 `close` 事件里 `event.preventDefault()`，
**关闭只是隐藏窗口**，页面与 Host 继续运行，下次 show 恢复同一文档。
这与本仓库现有的"关闭弹确认框再真退出"语义**不同**，属于产品差异，不是标题栏问题，
但改标题栏时容易一起碰到，先记下来。

### 1.8 渲染侧：`data-windows-titlebar` 是唯一的布局开关

官方在 5 个包里都有对这个属性的分支，说明**"给标题栏让位"是横跨整个 UI 的改动**，不是加一条 bar 就完事。

**a) 主框架预留高度 + 画拖拽区** —— `packages/client/ui-layout/src/client/AppFrame.module.css:25-50`

```css
/* The Windows caption row remains outside every conversation and file panel. */
:global([data-windows-titlebar]) .frame {
  --dsh-windows-content-radius: 16px;
  box-sizing: border-box;
  padding-top: var(--dsh-windows-titlebar-height);      /* ← 内容整体下移 40px */
  background: var(--dsw-specific-sidebar-fill);          /* ← 与原生标题栏同色，视觉连成一片 */
}

:global([data-windows-titlebar]) .centerCol {
  background: var(--dsw-alias-bg-base);
  border-radius: var(--dsh-windows-content-radius) 0 0 0; /* 内容区左上 16px 圆角 */
  corner-shape: round;
}

:global([data-windows-titlebar]) .frame::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: var(--dsh-windows-titlebar-height);
  background: var(--dsw-specific-sidebar-fill);
  -webkit-app-region: drag;                              /* ← 整条 bar 可拖拽 */
}

:global([data-windows-titlebar]) .sidebarCol { border-right: none; }
```

**关键技巧**：`.frame` 用 `padding-top` 把内容推下去，再用 `::before` 伪元素在腾出来的
40px 上铺一块同色背景并声明 `-webkit-app-region: drag`。**因为原生标题栏和这块背景同色，
用户看到的是"一条完整的标题栏"**，分不清哪里是系统画的、哪里是页面画的。

**b) 其他包避让**（说明改动面）：

| 位置 | 处理 | 文件 |
|---|---|---|
| 侧栏开关/新建会话按钮 | 用 `top: calc((var(--dsh-windows-titlebar-height) - 28px) / 2)` 垂直居中到标题栏行内，并 `-webkit-app-region: no-drag` | `ui-sidebar/src/client/SidebarRoot.module.css:47,94` |
| 侧栏品牌区 | 移到标题栏下方，`--dsh-windows-menu-start` 传 84px 给桌面菜单定位 | `ui-sidebar/README.md:48` |
| 侧栏收起态轨道 | `data-windows-titlebar` 下直接取消（`collapsedWidth = 0`） | `AppFrame.tsx:168-170` |
| 浮层/全屏面板 | `--dsh-frame-top-clearance` / `--dsh-frame-overlay-top` 改为标题栏高度 | `AppFrame.module.css:93-108` |
| dockkit 浮动层 | `--dsh-dockkit-float-top: calc(var(--dsh-windows-titlebar-height) + 20px)` | `ui-dockkit/src/components/dockkit.module.css:742` |
| 设置/账户浮层 | `padding-top: var(--dsh-windows-titlebar-height)` | `ui-settings-account/src/client/PlatformOverlay.module.css:12-13` |
| 全屏面板 | 保持在标题栏下方 + 展开侧栏右侧 | `ui-sidebar-right/src/client/shell/SidebarRight.module.css:75-79` |

**c) 全屏状态要额外处理** —— `main.ts:244-254` 把 `isFullScreen()` 通过 IPC 推给页面，
落到 `html[data-fullscreen]`，CSS 再把标题栏高度清零：

```css
:global(html[data-windows-titlebar][data-fullscreen]) {
  --dsh-frame-overlay-top: 20px;
  --dsh-frame-chrome-top: 0px;
}
```

原因：全屏时系统标题栏（连同三个按钮）消失，页面必须把让出的 40px 还回来。

### 1.9 桌面菜单栏：挂在标题栏行内，但用 Shadow DOM 隔离

`apps/desktop/src/preload-menu.ts:10-27` 往标题栏那 40px 里插"应用 / 编辑"两个菜单按钮：

```ts
const host = document.createElement('div')
host.dataset.windowsMenu = ''
const shadow = host.attachShadow({ mode: 'open' })
style.textContent = `
  :host { position: fixed; top: 0; left: var(--dsh-windows-menu-start, 48px); z-index: 1100;
    height: var(--dsh-windows-titlebar-height); display: flex; align-items: center;
    font-family: var(--dsw-font-family); -webkit-app-region: no-drag; }   /* ← 从拖拽区里排除 */
  ...`
```

- `-webkit-app-region: no-drag` 让按钮可点（否则会被当成拖拽区）。
- `left: var(--dsh-windows-menu-start, 48px)` 由侧栏状态决定（展开 48px / 收起 84px）。
- 挂载时机：`if (document.querySelector('[data-shell-overlay]') === null) return`
  —— **等 AppFrame 渲染出来再挂**，用 MutationObserver 轮询。

### 1.10 macOS 走完全不同的另一套

`ui-layout/AppFrame.module.css:77-155` + `ui-sidebar/SidebarRoot.module.css:176`：
macOS 不用 `data-windows-titlebar`，而是 `html[data-platform='darwin']`，
靠 `vibrancy` 让侧栏半透明露出桌面，红绿灯由 `trafficLightPosition` 摆到侧栏内。
**两套平台分支互不复用**，`--dsh-frame-top-clearance` 在 macOS 是固定 48px。

---

## 2. Tauri 2 对照：哪些能照搬，哪些不能

### 2.1 能直接照搬的部分 ✅

| 官方做法 | Tauri 对应 | 说明 |
|---|---|---|
| `WINDOWS_TITLEBAR_HEIGHT = 40` 单一常量 | 同 | 纯几何常量，无关平台 |
| `data-windows-titlebar` + `--dsh-windows-titlebar-height` 布局开关 | 同 | 本仓库前端是 dsh 官方 Web UI，这些属性和 CSS **已经存在**（见 §2.3） |
| canvas 测色 → 归一化 rgba | 同 | 纯浏览器 API，与 Electron 无关 |
| 主题变化监听（MutationObserver on `data-ds-dark-theme`/`head`） | 同 | 同上 |
| `:before` 伪元素铺同色背景 + drag | 把 `-webkit-app-region: drag` 换成 `data-tauri-drag-region` | Tauri 的等价物，见 §2.4 |
| 全屏时清零标题栏高度 | 同 | `data-fullscreen` 状态改由 Tauri window 事件驱动 |
| 侧栏/浮层的避让规则 | 同 | 纯 CSS，前提是那套 CSS 已经在页面上生效 |
| Shadow DOM 隔离的桌面菜单 | 同 | 但菜单内容要自己实现（Tauri 无 Electron `Menu` 角色） |

### 2.2 不能照搬的核心：`titleBarOverlay` 在 Tauri 没有等价物 ❌

Electron 的 `titleBarStyle:'hidden'` + `titleBarOverlay` 是**系统级能力**：
系统标题栏被隐藏，但**三个原生按钮仍由 Windows 绘制并叠加在页面之上**，
连颜色都能通过 `setTitleBarOverlay({color, symbolColor})` 热更新。

Tauri 2.11.5 里最接近的 `title_bar_style` 是 **macOS 专属**：

```rust
// tauri-2.11.5/src/webview/webview_window.rs:723-742
#[cfg(target_os = "macos")]              // ← macOS only
pub fn title_bar_style(mut self, style: crate::TitleBarStyle) -> Self
```

`TitleBarStyle` 文档也写明 "on macOS"（`tauri-utils-2.9.3/src/lib.rs:161-180`）。

**因此 Tauri 侧只有一条路**：`decorations(false)` 全自绘 ——
即 Electron 的 `frame:false` 那条路，而**官方恰恰没有走这条路**。
所以官方在 Windows 上"白拿"的东西，Tauri 侧都要自己补：
原生按钮外观、Snap Layouts、边缘缩放、最大化边界、双击最大化。

### 2.3 版本落差：**必须在 dev 运行时（0.2.0-rc.2）上做，不要在旧安装版上做** ⚠️

这是最容易翻车的地方，因为同一台机器上两个运行时版本不一致。

已核实的版本对照：

| 对象 | 版本 | 是否含 `data-windows-titlebar` 布局 |
|---|---|---|
| **dev 实例**（`src-tauri/resources/dsh-runtime`，端口 30080） | **0.2.0-rc.2** | ✅ **有**（四个包共 33 处命中） |
| 本仓库构建脚本钉的版本（`scripts/prepare-runtime.ps1:6`） | **0.2.0-rc.2** | ✅ 一致 |
| `Program Files` 里的已安装版（端口 3080） | **0.1.1-rc.2** | ❌ **无**（实测 0 命中） |
| 官方开源仓库 master | 0.2.1-alpha.2 | ✅ 有 |

**注意 root `README.md:89` 写的是 `0.1.1-rc.6`，与构建脚本的 `0.2.0-rc.2` 不符** ——
README 这条已经过时，以 `scripts/prepare-runtime.ps1:6` 为准。

**结论**：
- 在 **dev 模式（30080）** 上做标题栏：官方让位 CSS 现成，可直接复用。✅
- 不要去比对 `Program Files` 那个 0.1.1-rc.2 安装版的行为 —— 它没有这些规则，
  会得出"打上标记也不让位"的错误结论（我最初就是这么判断错的）。
- **release 打包**时要确认 `resources/dsh-runtime` 是 0.2.x 那份（按脚本重跑 `npm run prepare:runtime`），
  否则装出来的包会缺少让位布局。

证据：直接检查已安装运行时的构建产物 ——
`@deepseek-ai/dsh-client-ui-layout/lib/client.js` 内联 CSS 中，
`data-windows-titlebar` 出现 **0 次**、`app-region` 出现 **0 次**。
该文件里的 `.frame` 规则仅为：

```css
.pI_x6G_frame{background:var(--dsw-alias-bg-base);height:100%;transition:...;
  grid-template-rows:100%;display:grid;position:relative;overflow:hidden}
```

对比 master 的 `AppFrame.module.css`（§1.5a）—— 多了 `.frame{padding-top:var(...)}`、
`::before{...;-webkit-app-region:drag}`、`.centerCol{border-radius:...}` 等整组规则。
而 **dev 运行时的 0.2.0-rc.2 已经把这些规则都装上了**（实测命中数见 §2.3 表格），
`dsh-client-ui-sidebar` 的 20 处让位规则也在。

**结论**：**在 dev 运行时（0.2.0-rc.2）上，官方让位 CSS 是现成的，直接复用即可。**
只需注意不要拿 `Program Files` 里的 0.1.1-rc.2 安装版做对照 —— 那份确实 0 命中，
会误导判断（我最初就因为查的是安装版而判断错了一次）。

### 2.4 自绘工作的实际边界

因为让位 CSS 现成，自绘工作只剩下**那 40px 里的内容**：

**要做：**
- 左侧：应用名/会话名，或留白（容器需 `data-tauri-drag-region` 才能拖）
- 右侧：三个自绘按钮（`<button>` 元素，天然阻断拖拽，无需额外处理）
- 按钮调 `invoke('plugin:window|minimize' / 'toggle_maximize' / 'close')`
- 最大化态图标切换（`is_maximized`，默认权限已放通）

**不用做**（官方 CSS 已覆盖）：
- 给主框架让出 40px（`[data-windows-titlebar] .frame{padding-top:...}`）
- 铺标题栏同色背景 + 拖拽区（`::before`）
- 侧栏按钮居中到标题栏行（`ui-sidebar` 20 处规则）
- 浮层/设置页/右侧全屏面板避让（`settings-account` 1 处 + `sidebar-right` 2 处）
- 内容区左上 16px 圆角

**仍需自己补的**：边缘缩放（§5 步骤 3）、Snap Layouts（可选）。

⚠️ **一个必须实测的点**：dev 运行时里 `app-region` 只命中 2 次
（`ui-layout` 里那 2 处属于 macOS/darwin 分支），
Windows 侧官方靠的是 `::before` 上的 `-webkit-app-region: drag` —— 那条**在 Electron 里生效**，
但**在 Tauri 的 WebView2 里不会自动生效**（Tauri 用自己的 `data-tauri-drag-region` 协议）。
所以：**官方 CSS 给的 `::before` 那块背景会照常画出来并让位，但拖拽必须我们自己再接一层**
（在标题栏容器上加 `data-tauri-drag-region`，或在 `::before` 覆盖的区域内挂一个透明拖拽层）。
这是复用官方 CSS 时唯一的"半成品"处，务必实测。

### 2.5 拖拽：Tauri 的等价物是 `data-tauri-drag-region` ✅

Tauri 的 window 插件会注入一份 `drag.js`（plugin init script，先于项目自己的脚本执行），
用**事件委托**识别 `data-tauri-drag-region`：

```rust
// tauri-2.11.5/src/window/plugin.rs:236-258
#[derive(Template)] #[default_template("./scripts/drag.js")]
struct Drag<'a> { os_name: &'a str }
Builder::new("window").js_init_script(init_script)
```

命中即 `invoke('plugin:window|start_dragging')`，**双击时 `invoke('plugin:window|internal_toggle_maximize')`**
（`tauri-2.11.5/src/window/scripts/drag.js:5-106`）。属性值语义：裸值/`"true"` = 只认自身，
`"deep"` = 整个子树可拖，`"false"` = 禁用；`button/a/input` 等可点击元素天然阻断拖拽。

**对应官方 `:before { -webkit-app-region: drag }` 的写法就是 `data-tauri-drag-region`。**
且 `internal_toggle_maximize` 在 `core:default` 里默认放通 → 双击最大化零配置。

### 2.6 权限：这是最容易漏的一步 ⚠️

`core:window` 的默认权限集**只含 getter + `allow-internal-toggle-maximize`**，
**不含** `start-dragging` / `start-resize-dragging` / `minimize` / `toggle-maximize` / `close`
（`tauri-2.11.5/build.rs:44-126`，这些命令第二列是 `false`）。

所以必须在 `src-tauri/capabilities/remote-ipc.json` 显式追加：

| 用途 | 权限标识 |
|---|---|
| 拖动窗口 | `core:window:allow-start-dragging` |
| 边缘缩放 | `core:window:allow-start-resize-dragging` |
| 最小化 | `core:window:allow-minimize` |
| 最大化切换 | `core:window:allow-toggle-maximize` |
| 查询最大化态 | 默认已放通 |

标识已从 `src-tauri/gen/schemas/acl-manifests.json`（156 条 window 权限）核实。
本仓库已有自建命令 + 自建 permission 的先例（`permissions/*.toml` 的 `quit_app`/`open_url`/`open_devtools`），
两条路都成立：直接用内置命令 + 加权限，或自建 `window_minimize()` 等命令。

**另一个已核实的好消息**：导航 URL 带 `?token=...`，但 `RemoteUrlPattern` 在 pattern 未写
pathname/search 时自动补 `*`（`tauri-utils-2.9.3/src/acl/mod.rs:284-298`），
所以现有 `remote-ipc.json` 里无 query 的地址**能命中带 token 的页面**，不会失配。

---

## 3. 差距清单：官方白拿 vs Tauri 要自己补

| 能力 | 官方 Electron（Windows） | Tauri 2（`decorations(false)`） |
|---|---|---|
| 三个窗口按钮 | **系统原生绘制**，`setTitleBarOverlay` 改色 | ❌ 必须自绘（图标、悬停、按下态） |
| Windows 11 Snap Layouts | ✅ 原生可用 | ❌ 需子类化窗口过程返回 `HTMAXBUTTON` |
| 标题栏拖拽 | `-webkit-app-region: drag` | ✅ `data-tauri-drag-region`（框架自带，等价） |
| 双击最大化 | 系统行为 | ✅ 框架自带（`internal_toggle_maximize`） |
| 边缘缩放 | 系统边框 | ❌ 需自绘 hit-test 区 + `start_resize_dragging` |
| 最大化不盖任务栏 | 系统处理 | ✅ tao 已处理 `WM_NCCALCSIZE`（用 `rcWork`） |
| 窗口圆角/阴影 | 系统 | ✅ `shadow(true)` → Win11 圆角 + 1px 白边 |
| 主题色同步 | `setTitleBarOverlay` 热更新 | ⚠️ 自绘按钮直接吃 CSS 变量，**反而更简单** |
| 全屏（无边框、无按钮） | 系统隐藏 | 同（自己隐藏自绘按钮即可） |
| 内容让位 | `data-windows-titlebar` CSS | ✅ **同一套 CSS，可复用** |

**结论**：Tauri 侧要补的核心只有三块 —— **窗口按钮、边缘缩放、Snap Layouts**。
其中前两块是纯体力活（各约半天），**Snap Layouts 是唯一脏活**。

---

## 4. 建议的落地路线

### 步骤 1：frameless + 复用官方让位 CSS（半天）

```rust
// src-tauri/src/lib.rs 窗口创建处
.decorations(false)
.shadow(true)                 // Win11 圆角 + 投影（tao 已处理 inset）
```

新增 `assets/titlebar.js` 作为第 4 个 `initialization_script`，做两件事：

```js
// 1) 打开官方前端的标题栏布局分支（复用官方全部让位 CSS）
const root = document.documentElement
root.dataset.windowsTitlebar = ''
root.style.setProperty('--dsh-windows-titlebar-height', '40px')

// 2) 在全屏态清零（对应官方 data-fullscreen 处理）
//    由 Rust 侧监听 window 事件后 eval 或 emit 驱动
```

**做完这一步，官方前端就会把 40px 让出来**，侧栏按钮、浮层、圆角、`:before` 背景全部自动正确。

⚠️ **但拖拽还差一半**：官方 `::before` 上写的是 `-webkit-app-region: drag`，
那是 Electron 的机制，**Tauri/WebView2 不认**。所以必须在标题栏区域**再接一层
Tauri 的拖拽协议** —— 例如自绘标题栏容器本身加 `data-tauri-drag-region`
（注意属性值语义：`"deep"` 才能让整个子树可拖，裸值只认直接点在自己身上）。
否则会出现"背景和让位都正确，但按住标题栏拖不动窗口"。
这一点务必在第一轮就实测。

### 步骤 2：自绘标题栏内容（半天）

在那 40px 上放：
- 左侧：应用名/会话名或留白（要 `data-tauri-drag-region`，否则拖不动）
- 右侧：三个自绘按钮，**必须带 `data-tauri-drag-region="false"` 或放在可点击元素上**
  （`button` 元素天然阻断拖拽，直接用 `<button>` 即可）
- 按钮调用 `invoke('plugin:window|minimize' / 'toggle_maximize' / 'close')`
- 最大化态图标切换：监听 `is_maximized`（默认权限已放通）

**注意**：官方在标题栏还挂了"应用/编辑"菜单（`preload-menu.ts`）。
如果产品要这个，需要自己用 Tauri 的 `Menu` API + `popup` 实现，工作量另算。

### 步骤 3：边缘缩放（半天）

在页面四周铺 4 条（或 8 条含角）不可见 hit-test 带，mousedown 时
`invoke('plugin:window|start_resize_dragging', { direction })`。
`ResizeDirection` 是 Tauri 内置枚举，权限 `allow-start-resize-dragging`。

⚠️ 实测注意：最大化和全屏态下应禁用边缘带（否则会拖出窗口）。

### 步骤 4（可选，脏活）：Snap Layouts

只有产品明确要求"悬停最大化按钮要弹贴靠面板"时才做。
需要 `windows-sys` 子类化窗口过程处理 `WM_NCHITTEST` 返回 `HTMAXBUTTON`。
Cargo.toml 里 `windows-sys` 已在（`Cargo.toml:20-26`），需补 `Win32_UI_WindowsAndMessaging` feature。
参考 [tauri-plugin-snap-layout](https://github.com/Hyph-M/tauri-plugin-snap-layout)。

**如果接受"没有 Snap Layouts"**（大量自绘窗口应用都是这样），**这条可以完全跳过**。

---

## 5. 需要产品层面先定的两个问题

1. **观感目标**：是要"看起来像官方版"（那必须接受 Tauri 侧没有原生按钮，观感必然有差异），
   还是要"有自己的设计语言"（那自绘反而更自由）？
2. **Snap Layouts 是否必须在**？
   - 不必 → 步骤 1+2+3，约 1.5 天，风险低
   - 必须 → 加步骤 4，工作量与风险显著上升

---

## 6. 核实过的源码位置索引

### 官方 Electron（`deepseek-ai/deepseek-harness` @ master，已 clone 到 `.ref/`）

| 结论 | 位置 |
|---|---|
| 窗口配置（`titleBarStyle`/`titleBarOverlay`/`trafficLightPosition`/`vibrancy`） | `apps/desktop/src/main.ts:207-239` |
| 标题栏高度常量 = 40 | `apps/desktop/src/windows-layout.ts:4` |
| 主题色 canvas 测量 + IPC 上报 | `apps/desktop/src/preload-windows.ts:8-62` |
| 主进程接收 + `setTitleBarOverlay` + 来源校验 | `apps/desktop/src/main.ts:1046-1057` |
| 全屏态 IPC 推送 | `apps/desktop/src/main.ts:244-254` |
| 框架让位 + `:before` 拖拽区 | `packages/client/ui-layout/src/client/AppFrame.module.css:25-50` |
| 顶部 clearance / 全屏清零 | `packages/client/ui-layout/src/client/AppFrame.module.css:93-108` |
| 侧栏按钮居中到标题栏 | `packages/client/ui-sidebar/src/client/SidebarRoot.module.css:45-50, 92-95` |
| 桌面菜单栏（Shadow DOM + `no-drag`） | `apps/desktop/src/preload-menu.ts:10-27, 89-97` |
| macOS 拖拽区减法模型 | `packages/client/web/src/base.css:47-90` |
| dockkit 浮动层避让 | `packages/client/ui-dockkit/src/components/dockkit.module.css:742-746` |
| 设置浮层避让 | `packages/client/ui-settings-account/src/client/PlatformOverlay.module.css:12-13` |
| app-region 唯一性门禁（测试） | `packages/client/ui-theme/tests/app-region-styles.client.spec.ts` |

### Tauri 2.11.5 / tao 0.35.3

| 结论 | 位置 |
|---|---|
| `title_bar_style` 仅 macOS | `tauri-2.11.5/src/webview/webview_window.rs:723-742` |
| `TitleBarStyle` 文档限定 macOS | `tauri-utils-2.9.3/src/lib.rs:161-180` |
| `decorations` / `shadow` | `tauri-2.11.5/src/webview/webview_window.rs:548-553, 602-615` |
| 无边框最大化用 `rcWork` / 阴影 inset | `tao-0.35.3/src/platform_impl/windows/window.rs:1392-1419` |
| 拖拽脚本注册 | `tauri-2.11.5/src/window/plugin.rs:236-258` |
| 拖拽/双击最大化实现 | `tauri-2.11.5/src/window/scripts/drag.js:5-129` |
| window 命令默认权限边界 | `tauri-2.11.5/build.rs:44-126` |
| 权限标识清单 | `src-tauri/gen/schemas/acl-manifests.json` |
| 远端 URL pattern 自动补 `*` | `tauri-utils-2.9.3/src/acl/mod.rs:284-298` |

### 本仓库现状

| 结论 | 位置 |
|---|---|
| 窗口代码创建（未设 `decorations`） | `src-tauri/src/lib.rs:354-372` |
| 注入脚本通道 | `src-tauri/src/lib.rs:319-344, 364-365` |
| 远端 IPC 授权（需补 window 权限） | `src-tauri/capabilities/remote-ipc.json:7-15` |

---

## 附：参考链接

- 官方仓库：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（`apps/desktop`）
- Electron 窗口自定义：[Window Customization](https://www.electronjs.org/docs/latest/tutorial/window-customization)
- Tauri 窗口自定义：[Window Customization](https://v2.tauri.app/learn/window-customization/)
- Snap Layouts：[tauri-plugin-snap-layout](https://github.com/Hyph-M/tauri-plugin-snap-layout) ·
  [Frameless Tauri app Snap Layouts](https://dev.to/zbrooklyn/windows-11-snap-layouts-in-a-frameless-tauri-app-the-part-every-guide-gets-wrong-2fjh)
- [tauri-plugin-decoration](https://docs.rs/crate/tauri-plugin-decoration/latest)
