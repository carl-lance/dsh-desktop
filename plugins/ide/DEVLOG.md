# dsh-ide 开发日志（DEVLOG）

> 实时记录 dsh-ide 插件的实现进度、踩坑与决策。规划见 `PLAN.md`；
> 终端实现方案调研见文末 §Terminal。更新日志请追加到顶部。

## 最近更新（五）：改名 dsh-plugin-ide + 桌面启动自动安装器 + dsh-beta 目录
- **包名改为 `dsh-plugin-ide`**（package.json / host name export / ModuleLoader id）；build.mjs 增加前缀校验（不匹配 `dsh-plugin-*` 即构建失败）。内部 slot id、settings 命名空间 `ide`、localStorage `dsh-ide:ws:`、diag 文件名等**保持不变**（非包身份）。
- **桌面自动安装器** `src-tauri/resources/plugin-install.js`（Node，启动前由 lib.rs `install_plugins()` 调用，失败仅日志不阻塞）：
  - 读 `resources/plugins.config.json`（plugins 数组：id/version/archive/previousNames），安装包在 `resources/plugins/*.tgz`；
  - 同版本已装 → 跳过并清理旧名残留；需要安装/升级 → 对 `id + previousNames` 逐个**校验目录内 package.json.name 精确一致**后移走(.bak)→解包校验包身份→装入→写 `profiles/<p>/cordis.patch.yml`→成功才删 .bak（失败回滚还原）；
  - patch 用“块级解析”维护单个 insert 条目并保留无关条目（边角：无 marker 孤儿行清理不完美，本次已手工归一 dev 文件，fresh 安装路径干净）；
  - 已知坑：PowerShell `$HOME` 保留变量不可赋值，脚本测试时换用 `$dshHome`。
- **release 用户数据目录改为 `dsh-beta`**（lib.rs `dsh_home_path`），与稳定版 `dsh` 隔离；debug 仍 `target/dsh-dev`。
- tauri.conf `bundle.resources` 增加 installer/config/plugins 三项；`resources/plugins/dsh-plugin-ide-0.1.0.tgz` 已放置。
- dev profile 已迁移：旧 `dsh-ide` 目录删除、`dsh-plugin-ide@0.1.0` 装入、patch 单一条目。**注意：Rust 改动尚未 cargo 编译验证；dev 需重启才会以新包名加载。**

## 最近更新（四）：收尾清理与文档同步（初版已提交 77b4045）
- 清理 host 死代码（无任何 client 调用，零行为变化）：
  - `git.pending`（已被 `git.pendingBranches` 取代）、`git.compare`（被 `git.compareDetail` 取代）、`git.checkoutHash`（从未做 UI）三个 dispatch case；
  - `git.ts` 对应函数 `gitPendingCommits / gitCompare / gitCheckoutHash` 与 index.ts 导入一并删除，grep 确认无残留引用。
- 已重新打包并安装 dev profile（host lib 53.6kB）。
- 文档同步：`PLAN.md` 重写为当前里程碑（核心功能均已完成），剩余“打磨/增强”仅记录不排期。
- 打磨后备清单（记录，暂不做）：历史轮询节流、推送失败重试按钮、深色主题与毛玻璃参数适配、超多分支历史性能/截断、bundle minify/语言按需、git.all 轮询降频、错误统一 toast+host 日志、diag 机制收尾（保留开关）、单测冒烟。

## 最近更新（三）：分隔条交互重构 / 构建卡死排查（磁盘满）

### 分隔条交互（Workbench.tsx）
- 需求演进：先统一 左右(面板宽)/上下(终端高) 两条拖动条的粗细与 hover → 后改为“分隔条脱离面板、在最外层容器按坐标渲染悬浮线”。
- 当前实现：两个 10px 透明命中区（panel 手柄 + terminal 顶手柄），仅负责 mousedown/enter/leave/拖动；
  - `guide` 坐标状态（`axis:'x'|'y'` + pos）驱动**根容器悬浮线**（pointer-events:none，z 70）：竖线=面板左边界 X（内容区高）、横线=终端顶边 Y（图标栏左侧全宽）；
  - 悬停/拖动中显示 3px 蓝线并跟随光标，松手消失；
  - 松手后按坐标记忆：面板宽（px）/终端高占比（WsCache.panelW / termRatio）。
- 边界边框：面板 `borderLeft`、终端 `borderTop/Right` 恢复常驻 1px 细线（此前曾因去掉自带边框只剩 hover 线而被反馈“不显示边框”，已回补）。**注意：此版（含 guide 悬浮线）最后几个改动尚未成功打包验证**。

### 构建卡死排查（→ 根因：磁盘占用满）
- 现象：host 构建 `[ok] lib/index.js` 后 client 构建卡死（CPU 持续上涨），从某次“tool call aborted”之后复现；自己终端跑同样卡。
- 排查过程（记录备查）：
  1. 多次提权构建在本会话被中止（审批失效）；
  2. 用户终端 `node build.mjs --pack` 卡在 client 步 → `debug-client.mjs` 二分：
     - `--smoke` OK（esbuild 本身正常）；
     - 正常 / `--no-css` 全卡（排除 monaco-css 插件）；
     - `--entry-monaco`、`--entry-workbench` 全卡；
     - `--probe-codicon` OK，`--probe-api`（仅 monaco editor.api）卡 → 与业务代码无关；
     - esbuild CLI 直连 monaco-api 同样卡；
  3. 用户确认 **电脑磁盘占用已满** —— 判定为写盘/杀软扫描导致大图打包僵死，非代码问题。
- 清理动作：删 `plugins/ide/dist`、`lib/client.js`、`.npm-cache`、npm cache/temp/回收站；待空间恢复后重新打包。
- 遗留临时文件（可后续清理）：`plugins/ide/debug-client.mjs`（二分工具，可保留复用）、`plugins/ide/probe/{codicon-only.ts, monaco-api.ts}`。

## 最近更新（二）：历史面板重构 / 推送完善 / 布局与编辑器细节

### 提交历史（GitHistory）——从 @gitgraph 改为自绘虚拟滚动
- 需求收敛：虚拟滚动 + 1000 条 + 倒序（最新在上）+ 按分支筛选 + 行交互。
- **弃用 @gitgraph/react**（包体积 −0.1MB）：自绘行式泳道，SVG 一次性画 线/圆点/合并弧，DOM 只挂载可视行（行高 22px，onScroll 切窗口）。
- 列分配改经典 git 图规则：当前分支主线固定最左列 0；分叉在右侧加列；只在合并/汇合回主线时向左收。每提交向下连父提交：同列垂直、跨列弧线。
- **颜色**：`laneColor(col)` 前 16 用高区分定性色板（Okabe-Ito+Tableau），超出黄金角 HSL；跨列弧线归属“右侧那条分支”（取两侧列号较大者），修复“折线与另一分支同色”。
- 顶部：范围下拉选择器（全部/当前/输入分支搜索列表，默认全部；外部点击/Esc 收起）；`HEAD xxx · N 条` 作为靠右半行灰色提示（悬停为行 title：显示“推导出的包含分支列表”）。
- 交互：左键详情；右键菜单（提交详情 / 与当前对比 / 回滚该提交[仅当前分支祖先]）；提交详情弹窗（说明/作者/时间/改动文件树 + 与当前对比按钮）；对比浮层（`git.diffList` 差异文件树 + 点文件 `git.diffDetail` 行级 diff，≤600 行截断）；回滚 = `git.commitRevert`（`merge-base --is-ancestor` 校验 + 合并提交 `-m 1` + `--no-edit`）。
- 悬停分支名推导：`buildBranchMap` 从各引用尖端沿父链 BFS 标记包含分支（不再只有尖端才有名字，也不显示“无分支标签”字样）。
- 4s 静默轮询 git.log，捕捉终端/外部提交（内容未变不重绘）。

### 分支与推送
- 分支下拉：搜索框过滤；右键新增“基于此分支新建分支”（`git.checkout`/`git.branchCreate`，`check-ref-format` 校验、可选“创建后立即检出”）；无远程时快捷行 更新/推送 换成“设置远程”（`git.remoteAdd`，git push/pull 无上游自动 `-u` / `pull origin <分支>`）。
- 对比 = `git.compareDetail` 两栏提交（分支独有/当前独有）→ 点提交看文件 → 一键转检出；检出 = 确认弹窗（“从 A 切换到 B”文案 + 工作区改动文件树 + 智能检出[stash→切换→pop，冲突保留搁置] / 强制检出[两段确认]）。
- 推送：`git.pendingBranches` 按本地分支分组列出未推送（上游领先 / **新分支**（本地有远程无 → IDEA 式列出，可 push -u）/ 无远程提示）；组头复选框多选 + 二级树（分支 ⇄ 提交列表）+ “推送（N）”批量（`git.pushBranch`）。

### 布局 / 视觉
- 所有弹层遮罩统一毛玻璃：新增 `client/overlay.ts` `maskStyle(z)`（`--dsw-alias-bg-mask-2` + `backdrop-filter: blur(10px) saturate(1.25)`），14 处遮罩替换。
- 右侧文件/Git 面板可拖宽：编辑器↔面板间 10px 分隔条（细线 1px → hover 3px 蓝）；宽度 px 按工作区记忆（WsCache.panelW）。
- 底部终端整行但不遮图标栏：终端贴底宽 = 图标栏左侧全宽（右侧 1px 竖分隔线），编辑器列/面板/分隔条高度随终端收缩（`calc(100% - bottomH)`）不被压；终端高度比例按工作区记忆（WsCache.termRatio）。终端右上缘拖高。

### 编辑器细节
- **codicon 字体内联**：monaco CSS 聚合后 `url(codicon.ttf)` 失效 → 折叠箭头等字形空白；把 ttf base64 成 dataURL（`editor/codiconFontData.ts`）并在 `monacoHost` 注入 `@font-face`。
- **JSON 折叠**：json contribution 在无 worker 时给不出折叠区 → host 注册字符串感知的大括号扫描折叠提供者（其余语言缩进折叠照旧，hover 显示箭头）。

### 工程注意
- 频繁“改了没生效”实为 dev host 未重启加载新包：升级流程必须彻底重启（host ESM 与 client 分开，热刷新无效）。已靠 `dsh-ide-opfail.json`（任何 op 失败写 op/参数/错误/堆栈）排查“unknown op/旧实例”类问题。
- 客户端共 54 处 `call(op)` 与 host dispatch 一一对应核对通过；host 保留 `git.compare/git.pending/git.stash` 旧 op 未删（无调用、无副作用）。

## 最近更新：提交弹窗 WebStorm 式「搁置」

- 对照 WebStorm 澄清：stash 在 JetBrains 语境叫**搁置**，交互发生在提交/变更窗口里——勾选变更文件 → 搁置；且**搁置有列表管理**。据此弃用分支菜单的“贮藏/恢复贮藏”快捷行（已移除），改由提交弹窗承载。
- 底层沿用 `git stash`（不引入 JetBrains shelf 目录）：
  - `git.ts` 新增 `gitStashPush(root, relPaths, msg, addUntracked)`（`stash push -m` + pathspec；勾选含未跟踪文件时先 `git add` 再 push，避免 `-u` 误收无关未跟踪文件）、`gitStashList`（`stash list --format=%H%x1f%gd%x1f%gs`，解析 `On <branch>:` 前缀 → branch/message）、`gitStashPop`（捕获 stdout+stderr，冲突即抛错并保留条目）、`gitStashDrop`；顺手补 `gitIgnoreAdd` 缺失的 `readFile` import。
  - `index.ts` dispatch 增 `git.stashPush / stashList / stashPop / stashDrop`（repo jail 同 addMany），删旧 `git.stash`。
- `CommitDialog` 重写为页签式 **[更改 (n) | 搁置 (n)]**：
  - 更改页 = 勾选变更树（`codeFor` 补 **D 删除**——此前删文件不进弹窗、无法提交/搁置）+ 全选/已选 + 提交说明 + 提交/提交并推送；左下新增 **搁置勾选 (n)**。
  - 搁置页 = 跨仓库 stash 列表（首次进页签懒加载，变更后整体刷新），每项显示 message / 分支 / `stash@{n}`，`恢复搁置`（成功后自动切回更改页）+ `删除`（4s 两段确认）。
  - 各操作结束发 `git.changed` 刷新文件树状态；弹窗保持打开可连续操作；多仓库时列表按仓库分组显示标题。
- 交互细节：搁置命名默认 `搁置 yyyy-MM-dd HH:mm`；恢复/删除引用 `stash@{n}` 直传 execFile（无 shell，安全）。

### 故障修复与 UX 打磨（验证中发现）
- **推送列表空**：无远程仓库时 host 回退查询 `git log --not --remotes` 会被 git 解析为空（`--remotes` 展开为空 + `--not` 反掉了隐式 HEAD）→ 改为显式 `git log HEAD --not --remotes`；无远程时本地提交全部列为“未推送”。
- **更新/推送误报错**：`git.pull`/`git.push` 对“分支无上游”抛原始英文 → 有远程时自动 `pull/push <remote> <branch>`（push 用 `-u` 建立跟踪），无远程时中文提示。
- **推送弹窗查错仓库**：PushDialog 之前用 cwd 默认查 pending，嵌套仓库/根非仓库时查空 → 与分支菜单一致先用 `git.all` 取 `repos[0]` 再带 repo 查询（commitFiles 同修）；列表标题带仓库名。
- **无远程入口**：分支菜单无远程时 更新/推送 合并为 **设置远程** 按钮 → 弹窗填 remote（`git.remoteAdd`，名称/URL 校验）→ 自动恢复 更新/推送。
- **对比/检出不再只 toast**：右键 对比 → `CompareDialog`（两栏提交列表：分支独有/当前独有，点提交看改动文件 + 信息，底部可一键转检出确认）；检出 → `CheckoutDialog`（当前→目标 + 工作区改动数提醒）→ 成功全量刷新。新增 host `git.compareDetail`（HEAD..branch / branch..HEAD 提交列表）。
- **loading**：新增 `Spinner` 组件；分支菜单快捷行（更新进行中行内 spinner、其余禁用）、头部分支按钮、重命名/删除/设置远程/检出/提交/提交并推送/推送 按钮均带 spinner + 防重入。
- **op 失败诊断**：host 任何 op 失败写 `<DSH_HOME>/dsh-ide-opfail.json`（op/参数/错误/堆栈），dev 验证不用再手抄报错。

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
