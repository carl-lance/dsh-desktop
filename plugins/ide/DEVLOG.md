# dsh-ide 开发日志（DEVLOG）

> 实时记录 dsh-ide 插件的实现进度、踩坑与决策。规划见 `PLAN.md`；
> 终端实现方案调研见文末 §Terminal。更新日志请追加到顶部。

## 2026-09 · 架构与里程碑回顾（按实现顺序）

### M0 插件骨架与安装链路
- 位置 `plugins/ide`，client 通过 slots 注册 `conversation.session.header.utilities`（IDE 按钮）+ `shell.overlay`（浮层）；host 提供 `name/inject/apply` 空壳。
- 构建 = esbuild（`build.mjs`，host ESM / client CJS + `__ModuleLoader__` 包装，`dsh-ide` id 自动取自 package.json）；装包 = tar 解到 `<dev>\profiles\node_modules\dsh-ide` + `cordis.patch.yml` 幂等 insert。
- 环境坑：esbuild 服务进程在沙箱以管道 spawn 会 EPERM → 构建需提权/用户终端执行；npm 缓存写用户目录被拦 → `--cache` 指到工作区内。

### S1 双端链路（settings 命名空间）
- 通道：`ide` 命名空间 + 请求/应答 envelope（`reqJson/resultJson`，reqId 匹配），host 串行队列；host 侧 `resolve` 成功投影 `cwd/title/sessionId`。
- workspace 根解析：读 `<DSH_HOME>/storages/workspace.json`（按 sessionIds 匹配），未注入 workspaceRegistry。
- fs op：list/read(≤512KB)/write/rename/rm/mkdir，全部 realpath jail。

### 编辑器内核演化（重要）
1. v1 纯 `<pre>` 只读 → 用户要求高亮。
2. 接 CodeMirror 6（官方+legacy 语言包）→ 用户问“有没有像 Monaco 那么全”。
3. **换 Monaco 0.56（打包式）**：`monacoHost.ts` 集中加载（esbuild 子路径映射 `monaco-editor/editor/…`），精选 editor features + monarch basic-languages（91 语言注册，json/css/html/ts 全覆盖；basic-languages 缺 json → 补引 `language/json/monaco.contribution`）。
4. **Monaco CSS**：ESM 直接 import `.css`，esbuild 需处理 → 早期逐模块注入只生效 1 个（诊断 `style[data-mc]=1`，textarea 裸奔=文本域观感）→ 改为**构建期聚合全部 CSS 一次注入**（`build.mjs` monaco-css 插件收集 + `data-mc-all` style）。
5. **Worker 噪音**：`import.meta` 在 CJS 失效 → `Invalid URL`/`Could not create web worker`；语义服务不需要 → `MonacoEnvironment.getWorker` 返回空 stub worker。
6. 适配层：`editor/types.ts`（VSCode 式 ITextDocument/IEditor 契约）→ `document.ts`（语言探测）→ `monacoEditor.ts`（创建/保存/脏点/光标保持 reloadText）→ `EditorGroup.tsx`（标签组 + PaneSaver 注册 + snapshot/restore）。**为迁“托管式 Monaco”预留 monacoHost 接缝**。

### UI/交互（反复打磨）
- 布局：左多标签（编辑器/diff/终端占位）｜右侧页签隔离的 文件/Git｜最右图标栏（文件/Git/终端），收起改由图标栏控制；面板头部去掉收起按钮。
- 编辑器：路径即标签名、关闭只在标签 ×、只读用右上锁标（截断≥512KB）、Ctrl+S 保存、脏点；刷新保留光标（reloadText 内容相同跳过 + 选区/滚动恢复）。
- 文件树：直接平铺根内容（去掉“·”伪节点）；懒加载；右键菜单（文件：重命名/删除/加入 VCS；目录+新建）；顶部图标按钮（+文件/+夹）；刷新**保留展开态**（reloadTick 只重读已加载目录）。
- **拖放**：HTML5 DnD 在本 WebView2 里 dragstart 后 dragover/drop 到不了 document（diag 证实）→ 改**指针拖拽**（mousedown+5px 阈值+松手解析落点：夹/文件父目录/根），实时高亮目标夹 + 光标标签“移动到…”，二次确认；普通点击不再被吞（此前误吞 bug）。
- 右键菜单被全局 dsh 注入菜单抢占问题：插件内 window 捕获层拦截；Monaco 区只拦不放；分支弹窗内右键自建菜单。
- **状态保持**：关闭面板不卸载（display:none），编辑器/光标/展开/面板全保留；**按工作区隔离 + localStorage 缓存**（`dsh-ide:ws:<cwd>`，EditorGroup snapshot/restore，恢复的未保存文档带脏点且外部同步不覆盖）。
- 会话/工作区跟随：全局上下文探针结论 = 宿主不暴露 active-session 全局；头部 props 探针 = 切会话不重渲染（不可靠）→ **DOM 轮询**当前可见头部按钮的 `data-ide-header-session`（300ms），变化即 openForSession。
- git 状态：`git.all`（发现根+nested .git，深度受限）状态行着色：??暗红/A绿/M蓝/!!忽略灰，无字母徽标；**5s 轮询 + 文件事件即时刷新**（.git 自激已过滤）；文件树“加入 VCS”(git.add)。
- Git 面板只保留**提交记录/分支树**视图；提交/推送走**弹窗**。
- 分支下拉（WebStorm 式）：非 git 工作区显示“加入 VCS 管理”→ **先弹窗**（文件树勾选加入/忽略、创建 .gitignore、初始分支名默认 main）→ `git init -b` + 可选写 .gitignore + addMany；git 工作区显示当前分支 + 级联全分支列表 + 右键（对比/检出/重命名/删除 待后端）+ 顶部快捷（更新/提交/推送，UI 先行）。
- 提交弹窗：dsh 风格模态 + **文件树表达**变更（可勾选）+ 提交说明 + 提交/提交并推送（待后端）。
- 推送弹窗：左右分区（左=待推送提交列表 `git.pending`，选中→右=该提交改动文件树 `git.commitFiles` + 下方提交信息；UI 先行）。

### host 能力清单（现有）
resolve / fs.list/read/write/rename/rm/mkdir / git.all / git.log / git.branches / git.add / git.addMany / git.init / git.pending / git.commitFiles / ui.diag / drag.diag / session.diag / watch（fs.watch recursive + fsRev 投影 + .git 噪声过滤）。

### 关键问题记录（已修）
- `instance.disposeCommand` 不存在 → overlay slot crash → 改 DOM keydown 实现 Ctrl+S。
- Monaco CSS 只注入 1/138 → 聚合一次性注入。
- `expanded is not defined`（FileTree 受控化残留）→ slot crash。
- React #310（GitBranchMenu 提前 return 越过 hooks）→ hooks 全量前置。
- 拖放误吞点击 → 仅真实拖动后 suppress。
- 客户端并发 call 覆盖 reqJson 丢应答 → ideApi 串行化（单飞）。

### 当前状态
dev profile 可跑：文件树/编辑器(Monaco 全语言)/右键/拖放/监听/按工作区状态/git 状态与分支菜单/提交·推送弹窗（动作待后端）。

## Terminal 实现方案调研（进行中 → 结论草案）

前提（已核实）：profile 模块树含 `node-pty@1.2.0-beta.15`（`prebuilds/win32-x64/conpty.node` 在，ESM `import pty from 'node-pty'` 可行，无 typings 需自带声明）；`ws` 包存在（host 可 external 复用）；`@xterm/*` **不存在** → 需 `npm i -D @xterm/xterm @xterm/addon-fit`（纯 JS+CSS，CSS 走现有 monaco-css 聚合注入；xterm 也 import .css）。默认 shell：探测 `pwsh`→否则 `powershell.exe`。

方案（计划实现，参考 Codex/WebStorm 集成终端形态，跑在现有“终端”标签页）：
1. **host 微服务**：`terminalServer.ts` — loopback-only `http` server + `ws` upgrade（127.0.0.1:随机端口）；每次 `term.open` 生成一次性 token + pty 会话。
2. **pty 会话**：node-pty `spawn(shell, [], {cwd: 工作区根(realpath jail), env, name:'xterm-256color', cols, rows})`；pty.data→ws.send，ws data→pty.write；尺寸 `pty.resize(cols,rows)`；exit→关闭会话与 socket。
3. **信道**：client 通过既有 settings 通道发 `term.open`（带 cwd），host 回 `{port,token,sessionId}`；之后 xterm 直连 `ws://127.0.0.1:port?token=…&id=…`（本地 HTTP WS 无 CORS 限制）；尺寸/断开可再走 op `term.resize/kill`（或直接在 WS 上发控制帧）。
4. **xterm 客户端**：TerminalPane（新标签 kind=terminal 已有占位）：`new Terminal` + FitAddon + 连接管理（open→fit→focus、断开提示、重连一次）；样式随 dsh。
5. **生命周期与关闭确认**：标签注册 `kill()`/`isRunning`；关闭含运行进程的标签 → 确认弹窗（终止/取消），与既有标签关闭钩子合并；面板 display:none 保活期间 pty 继续运行；host 插件 dispose / 会话切换时按需关停（策略：跟随工作区，切走关闭全部本工作区终端并提示？先做：切走保留运行，回到再连；若 dsh 整体退出则杀 pty 树）。
6. **安全**：仅 127.0.0.1；token 一次性；cwd 锁工作区根；shell 参数白名单；会话数上限。

风险/开放项：
- WebView2 对 blob/本地 WS 无 CSP 限制（页面无 CSP meta，已核）；仍建议 token 校验防同机其它页面。
- 大输出节流/backpressure（pty→ws 背压处理）。
- 编码：conpty UTF-8 处理与 xterm 需要 `UTF-8` decode 一致。
- 多会话管理 UI（标签多实例、重命名）二期。
- 尺寸：面板显示/隐藏（display:none）后重开需 FitAddon.fit + terminal.refresh；已在 EditorGroup.relayout 预留。

下一步：按此方案实现 host `terminalServer` + 客户端 `TerminalPane`，先单会话跑通再扩展。
