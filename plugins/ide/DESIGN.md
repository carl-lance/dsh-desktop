# dsh-ide 功能设计（落地基线）

> 本文把运行时调研结论 + 功能落地方案固化为实现对照基线。架子不变：
> 会话头部按钮（`conversation.session.header.utilities`）+ `shell.overlay` 浮层。
> 功能内容：Git 工具、文件管理器、编辑器/预览、（后置）工作区终端。
> 路线图仍在 `PLAN.md`；本文只回答"在这套架子里每块怎么落地"。
> 标注：✅ 已定 / ⚠️ 待运行时确认 / 🔲 待确认的取舍。

---

## 0. 版本坐标与事实基线（调研已核实）

| 项 | 事实 | 证据 |
|---|---|---|
| 运行时版本 | `@deepseek-ai/dsh@0.1.1-rc.2`（repo 根 README 写 rc.6 已过时） | `scripts/prepare-runtime.ps1:6`、已安装 runtime 内各包 package.json |
| `settings-exposure` | rc.2 **无读取方**，`settings.describe` 暴露全部已注册命名空间 → 插件**无需**自声明 exposure | runtime `dsh-settings` 全树无读取方 |
| dev 实例 DSH home | `<repo>\src-tauri\target\dsh-dev`（debug 构建隔离，见 `src-tauri/src/lib.rs`） | 本仓库源码 |
| 工作区根模型 | 会话级 `session header.cwd`（绝对路径，realpath 唯一）；实体层 `ctx.workspaceRegistry`；落盘 `storages/workspace.json`（`tables.workspaces[*].path`）与 `storages/session_projcache.json`（`identity.cwd`） | runtime `dsh-workspace`、`dsh-session`、`dsh-session-projection-cache` |
| 插件加载方式 | 包目录拷进 `<DSH_HOME>\profiles\node_modules\<pkg>` + `profiles\web\cordis.patch.yml` `- insert: {id,name}`；host 按 `main`（lib/index.js）装入，client bundle 由 runtime `dsh-client-modules` 按 `dsh.client.platform:"web"` + `exports["./client"]` 发现并 serve | 本仓库安装产物 + runtime `dsh-client-modules/lib/index.js` |

**模块可用性盘点（dev profile 树 / 已安装 runtime 树）：**

| 需要 | 现状 | 结论 |
|---|---|---|
| node-pty | ✅ 完整包 + `prebuilds\win32-x64\conpty.node`（dev 与 runtime 两树都有） | host 可直接 import；**无 typings**，需自带 .d.ts |
| git | 无 isomorphic-git/simple-git | `node:child_process` spawn git.exe（args 数组，禁 shell） |
| Monaco / xterm / CodeMirror | 三树均无；官方 UI 高亮 = Shiki(textmate) | 编辑器/终端资产必须插件自带（见 §6/§7） |
| diff@9、zustand、@tanstack/react-virtual | ✅ 存在（dev/runtime 同款） | 可直接用 |
| `@deepseek-ai/dsh-client-ui-slots` | dev profile **缺失**；已安装 runtime 有 0.1.0-rc.7 | ⚠️ S1 重启后首验；断了就把 runtime 副本拷入 dev profile |

---

## 1. 挂载面（✅ 已定，保持现状）

- 头部按钮注册 `conversation.session.header.utilities`（id `dsh-ide`，order 30）；浮层注册 `shell.overlay`（order 100）。
- 两个槽位均为真实槽：官方 `dsh-client-ui-conversation` 自己注册 `header.actions` + `header.utilities`，`shell.overlay` 由官方 `dsh-client-ui-layout` 使用——互不冲突。
- 跨条目共享状态用模块级 store（现有 `ideStore` + `useSyncExternalStore`），不依赖 props 传递。
- `IdeHeaderAction.tsx` 头注释写的 `header.actions` 是笔误，以 `index.tsx` 注册的 `utilities` 为准（顺手修正）。
- 未来若要迁 `conversation.view` 页签（PLAN 终态）：官方把 tabs 渲染在 `role="tablist"` 视图环，注册形态与 `dsh-client-ui-trajectory` 同构；**但本期不做**。

## 2. 双端通信架构（✅ 已定，源自 dsh-plugin-template 验证）

外部插件**没有**直达 host 服务的自定义 RPC（apiproxy 是预置白名单）；唯一官方通道是 **settings 命名空间**：

```
client（webview）                          host（Node，profile 模块树）
─────────────────                         ───────────────────────────
ctx.settingsScope.bind({ns})   ──op set──▶ ctx.settings.register(ns, schema)
controller.set(field, value)     wire       scope.watch(() => reconcile())
useSnapshot 读投影               ◀─update─  scope.get() → 执行业务 → settings.update(ns, 投影)
```

要点（照抄模板模式，含 `.git` 不可用时的教训）：
- 服务名区分：host 侧 `settings`，client 侧 **`settingsScope`**（client `inject` 声明 `["slots","locale","settingsScope"]`）。
- host `inject: ["settings"]`，`ctx.inject(["settings"], ...)` 等就绪再注册；注册用 `settingsNamespace()`（kebab 校验）。
- 每次 watch 从 `scope.get()` **重读**，不做事件负载依赖；错误绝不抛进 cordis fail-loud 启动守卫（投影失败只 warn）。
- 回写投影：JSON 去重、空文档不回写。
- 命名空间拆分（🔲 实施时定稿）：建议按域分 ns（如 `ide` 会话/健康、`ide-git`、`ide-fs`），字段级 `set` + 独立 watch 隔离；避免单一大文档的 revision 噪音。

### 2.1 请求/投影模式（host 操作的统一建模）

IDE 的 host 操作不是"配置"，是**命令 + 结果**，统一建模为请求文档字段：

```jsonc
// client → ns 文档写（字段级 set）
{ "req": { "reqId": "r1", "op": "git.status", "payload": {} } }
// host → ns 文档投影回写
{ "result": { "reqId": "r1", "ok": true,  "data": { ... } },
  "state":  { ... } }          // 与请求无关的持续投影（分支、变更列表等）
```

- 每 ns/每 cwd 一把执行锁：串行执行，队列由 host 管理。
- 大结果截断：git diff 全文走 `fs.read` 由编辑器打开，不走文档通道（JSON wire 有体积/性能边界）。
- 写操作（commit/add/write）用请求 + 结果确认；UI 用 `reqId` 匹配渲染。

## 3. 工作区 / session 绑定（✅ 已定 + ⚠️ 一处待验）

- 工作区根解析优先级：
  1. host `inject: ["workspaceRegistry"]`（host-plane Service，`sessionPath(sessionId)` / 记录 `.path`，路径为 fs.realpath 规范值）；
  2. 兜底读 `<DSH_HOME>\storages\workspace.json` 的 `tables.workspaces[*].path`。
- client 侧：头部按钮条目 props 是否真注入 `sessionId`（代码已声明可选 prop，slot owner 是否注入）→ **⚠️ S1 打印验证**；拿到后随开关写入会话绑定字段。
- 安全边界：所有 fs/git/pty 根 = 该工作区根；任何路径先 `path.resolve` + 前缀校验（防 symlink 逃逸）；git 一律 `-C <root>` 且 op 白名单。

## 4. Git 工具（对应 PLAN Phase 2）

**host op 白名单（第一期）**：`status`（`-b --porcelain=v1`）、`diff`（stat / 单文件 unified）、`add -A` / `reset`、`commit`、`branch`（列表/切换）、`checkout`、`log --oneline -N`、`pull` / `push`。

- 执行：`spawn(git.exe, args, { cwd: root })`；**args 数组、无 shell**；超时 + 输出上限；UTF-8。
- commit message：写临时文件后 `commit -F <tmp>`（防引号/换行注入与编码问题），用完删除。
- 凭据：交给 git.exe 系统 credential manager（工作区仓库通常已配置，插件不处理）。
- 状态刷新：git 无事件源 → commit/checkout/add 等操作成功后主动重跑 `status`（文件保存后也可触发，见 §5）。
- 数据面：`ide-git` 文档 = `{ sessionId, cwd, req, state: { branch, status[], log[] }, result, error }`。

**UI（overlay 内）**：变更列表（M/A/D 用 dsh alias 令牌着色，可点选看 diff）→ diff 面板 → 提交信息框 + 提交/暂存按钮 + 分支下拉 + log 列表。样式全部走 `--dsw-*` 令牌 + 幂等注入；文案进 zh/en 字典。

## 5. 文件管理器（对应 PLAN Phase 3）

- host op：`list(dir)`（懒加载目录）、`read(path)`（文本，**≤512KB**，超限提示走编辑器只读策略）、`write(path, text)`、`stat`。忽略列表默认 `.git/node_modules/target/dist` 等。
- 写文件后触发 git 状态刷新（保存 → 徽标联动）。
- 数据面：`ide-fs` = `{ cwd, tree: { dir → entries[] }, open: { path, content, rev }, writeReq }`。
- 树 UI：懒展开 + 选中态；路径渲染在工作区根之下；新建/重命名/删除后置（🔲）。

## 6. 编辑器/预览（Phase 3；🔲 三条路线待确认，默认 A）

事实：Monaco/xterm/CM 在运行时均无；client bundle 有 purity 门（只许 require react + `@deepseek-ai/dsh-client-*` 种子，`verify.mjs` 的 mockRequire 即证明）→ 大库只能 **a) 内联进 `lib/client.js`** 或 **b) 插件自有静态资产服务**。

| 路线 | 做法 | 代价 |
|---|---|---|
| **A. CodeMirror 6 内联（推荐默认）** | esbuild 把 CM6（纯 JS、无 worker）打进 client bundle；配 `@codemirror/lang-*` 常用语言子集；diff 用 CM6 并排/高亮 | client bundle +~数百 KB（min+gz 实测为准）；首次物化稍慢；零静态服务/CORS/worker 配置 |
| B. Monaco 自托管 | host 起 127.0.0.1 静态服务 + client 跨端口 fetch ESM + worker 配置 | 工程量大；二期候选（或等官方引入 Monaco） |
| C. 只读预览优先 | textarea/简单 diff + （自带的）Shiki 预览 | 先不出真编辑器 |

决策建议：**默认 A**；实现顺序上先只读预览 → 编辑保存闭环（写文件 → 刷新 git 徽标）。⚠️ 内联体积与首帧物化延迟实测后定稿。

## 7. 工作区终端（PLAN Phase 4；本期后置，先记设计）

- host `apply` 时起 loopback-only HTTP/WS 服务（port 0 随机）+ node-pty spawn，cwd 锁工作区根；一次性 token 经 settings 文档下发；`dispose` 关服杀 pty。
- client 内联 `@xterm/xterm` + addon-fit（纯 JS，样式注入），连 `ws://127.0.0.1:<port>`（WS 无 CORS 限制）。
- 布局：overlay 底部条 or IDE 工作区内独立区（🔲）。

## 8. 工作台 UI 布局（overlay 内，Phase 2/3 目标形态）

```
┌ chrome 栏：IDE · 工作区名/分支 · 状态点 · ─── 关闭 ✕ ┐
├ toolbar：Git 操作入口（branch select / 提交 / 刷新…）┤
├──────────┬───────────────────────────────────────────┤
│ 左栏页签  │  编辑器 / diff 主区                         │
│ [文件|Git]│  （CM6 只读默认，可切编辑）                  │
│          │                                             │
├──────────┴───────────────────────────────────────────┤
│ （Phase 4：终端条）                                    │
└───────────────────────────────────────────────────────┘
```

- 全部走 dsw alias 令牌与 UI 字体族；locale zh/en 扩展；Esc/右上角关闭沿用 `ideStore`。

## 9. 构建 / 安装 / 验证循环（✅ 已定）

每步实现后：
1. `node build.mjs --pack`（esbuild 需在沙箱外/提权跑，见会话记录）
2. 解包 → `src-tauri\target\dsh-dev\profiles\node_modules\dsh-ide`（替换旧目录）
3. `cordis.patch.yml` 幂等 insert（已含则跳过）
4. 重启 dev 实例 → 会话内验证

建议补一个 `scripts/install-plugin.ps1` 把 2-3 步合成一条命令（参数 `-DshHome` 默认 dev home；tar 解包；幂等 patch），🔲 待批准后创建。

## 10. 风险与已知坑（实施时对照）

- **dev profile 缺 `@deepseek-ai/dsh-client-ui-slots`**：`dsh-client-runtime` 的 client bundle 顶部 `require("@deepseek-ai/dsh-client-ui-slots")`；若 dev 重启后 `ctx.slots` 链断（MODULE_NOT_FOUND/无按钮），从已安装 runtime 树拷 `dsh-client-ui-slots`（0.1.0-rc.7）进 dev profile 模块树。→ S1 首验。
- dev profile 树 react-dom 声明 19.2.8 与 react 18.3.1 错配：我们 client 只 import react（种子），不从树 resolve react-dom，通常无感；如遇怪错先查此项。
- `@deepseek-ai/*` 安装副本**无 .d.ts**（含 node-pty typings 缺失）→ 插件侧自带最小类型或用 `any`。
- PLAN Phase 1 ⚠️ 已答大半：node-pty 可 import（prebuilds 在候选路径，静态证据足）；**"header 条目是否注入 sessionId"与 conversation.view 外部条目契约**仍需运行时验证（S1 打印 props 即可顺带关闭）。
- settings 文档是 JSON wire：二进制/超大文件不走此通道（§4/§5 已处理）。
- rc 边界：0.1.2-rc.1 有破坏性重构（`dsh-client-runtime` 删除等），升级前整体评估（PLAN 已记）。

## 11. 实施顺序与验收（每步独立可验证）

| 步 | 内容 | 验收 |
|---|---|---|
| S0（前置） | 重启 dev 验证 Phase 0 现状：按钮渲染、overlay 开关、无 ui-slots 报错 | 按钮出现、浮层正常；若断则先拷 ui-slots |
| S1 | host 注册 `ide` ns + workspace 根解析 + 回显（根路径显示到 overlay 工具栏）；打印 header 条目 props 确认 sessionId | settings 双向链路通、根路径正确、sessionId 有无有结论 |
| S2 | Git 最小闭环：status/diff/add/commit/branch | 真实仓库里完成一次提交闭环，状态徽标刷新正确 |
| S3 | 文件树 + CM6（路线 A）只读预览 → 编辑保存 | 树上导航/打开文本/保存后 git status 出现变更 |
| S4 | 终端微服务器 + xterm（可选后置） | pty 交互可用、cwd 锁根、dispose 干净 |

## 12. 决策记录

**已定**：架子（header + overlay）不变；settings 命名空间为唯一双端通道；workspaceRegistry 为根解析首选；git 走白名单 spawn；不引入 exposure 自声明；装包路径与幂等 patch。

**待确认**：命名空间拆分粒度（`ide`/`ide-git`/`ide-fs` vs 单一大 ns）；编辑器路线 A/B/C（默认 A）；CM6 语言子集；终端是否本期；大文件策略细节；`scripts/install-plugin.ps1` 是否建。

> 关联：`PLAN.md`（路线图，勾选与⚠️状态以此文事实为准）；实现代码入口 `src/client/index.tsx`（注册）、`src/host/index.ts`（能力装配）、`src/client/IdeOverlay.tsx`（工作台 UI 落点）。
