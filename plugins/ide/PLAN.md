# dsh-ide 开发计划

> 目标：DeepSeek Harness Web 的 **IDE 插件**——中栏 `conversation.view` 视图环的第三个页签（与"对话/轨迹"并列切换）。
> 覆盖：Git 版本管理（提交/推送/SSH 密钥/可配置 git.exe）、文件浏览 + Monaco 预览、仅工作区范围的终端。
> 本文件是路线图；每个 Phase 完成即勾选，未决点以 ⚠️ 标注并在对应 Phase 的 spike 中关闭。

## 架构基线（已确认）

- **挂载点**：`conversation.view`（kind: list / scope: session）——已代码级验证与 trajectory 注册形态一致
- **形态**：客户端插件注册视图标签（React，页签名 **IDE**，id `ide`），宿主侧 Node 承载 git/fs/pty 能力
- **版本**：dsh **0.1.1-rc.2**（npm latest，本项目内置）。⚠️ 0.1.2-rc.1 存在破坏性重构（`dsh-client-runtime` 删除、conversation 拆包），升级前需整体评估
- **开发/验证环境**：dev 模式 home = `<crate>/target/dsh-dev`（已改），插件装入该 profile 验证

---

## Phase 0 — 基础插件包（本次交付，骨架）

- [x] `plugins/ide/` 目录 + package.json（`dsh.client` manifest，name `dsh-ide`）+ build.mjs（esbuild，源自模板）+ tsconfig
- [x] 客户端：注册 `conversation.view` 页签（id `ide`，order 20，标签"IDE"）+ 占位视图 + locales（zh/en）
- [x] 宿主侧最小入口（name/inject/apply，暂无逻辑）
- [ ] **验证步骤（需在用户环境执行）**：
  1. `npm install --legacy-peer-deps`（只装 esbuild）
  2. `npm run build` → `lib/index.js` + `lib/client.js`
  3. 装入 dev profile：复制到 `<repo>\src-tauri\target\dsh-dev\profiles\node_modules\dsh-ide`，
     并在 `...\profiles\web\cordis.patch.yml` 追加 `- insert: - id: dsh-ide`（幂等）
  4. 重启 sidecar → 进入会话 → 头部视图环应出现第三个标签"IDE"

## Phase 1 — 契约 spike（必须最先做，决定后续数据面）

- [ ] ⚠️ 确认 `conversation.view` 外部条目接收的 props/inject（sessionId 等）与渲染生命周期（切会话/收起时是否卸载）
- [ ] ⚠️ 确认宿主侧能力边界：插件 host 能否裸 `child_process`、能否 `require('node-pty')`（profiles 链接集是否含它——dsh-subprocess-local 依赖它，大概率在）、能否读工作区根路径
- [ ] 决定 Git/FS 数据面：host 服务直连（ctx 服务 + 命名空间投影）vs 插件自有 127.0.0.1 微服务器（流式/大文件）——倾向：常规操作走 host 服务；终端/大 diff 走微服务器
- [ ] 工作区根解析：会话 `cwd`（session.header.cwd）为 git/终端默认目录

## Phase 2 — Git 核心（host 侧）

- [ ] 设置：git.exe 路径（自动探测 + 手动指定）、user.name/email、SSH 密钥导入（粘贴/拖文件/浏览 → `~/.ssh` + 权限 600）
- [ ] 状态：status / 变更列表（M/A/D）+ diff（工作区 vs HEAD / 暂存 vs 工作区）
- [ ] 操作：stage/unstage、commit（提交信息 UI）、pull/push、分支切换、log 历史
- [ ] 客户端视图：变更列表 + 提交面板（复用 dsh 令牌样式）

## Phase 3 — 文件浏览 + Monaco 预览

- [ ] 文件树：工作区根遍历（忽略 .git/node_modules/常见目录）
- [ ] Monaco：⚠️ 体积与 worker——评估 内联进 client bundle vs 插件自有静态资产服务（monaco ~4MB + worker）
- [ ] 只读预览默认，可切换读写 + 保存（写文件 → 刷新 git 徽标）

## Phase 4 — 工作区终端

- [ ] xterm.js（client）+ node-pty（host，cwd 锁工作区根）
- [ ] ⚠️ 终端流通道：WebSocket（微服务器）优先；会话内布局（页签底部条 or IDE 内部区域）

## Phase 5 — 打磨与入口

- [ ] 附加入口：`sidebar.footer.action`（list 槽）或 `conversation.session.header.actions`（list 槽）注册快捷按钮
- [ ] 主题/国际化随 dsh（`--dsw-alias-*` 令牌 + locale 已就位）
- [ ] 与壳层注入功能共存验证（右键菜单/退出确认/外链——互不干扰）

---

## 已否决/暂缓

- 右栏 details：single 槽被官方占用 + 300-520px 太窄，不做宿主
- `shell.overlay`：官方浮层槽（list，空置）——留作"快速操作浮层/拖拽安装反馈"等辅助面，主 IDE 按页签走
- 0.1.2 升级：等正式版稳定 + 官方迁移范式后再评估
