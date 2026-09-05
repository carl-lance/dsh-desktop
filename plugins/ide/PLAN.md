# dsh-ide 开发规划（PLAN）

> 架子：**头部按钮 + shell.overlay 常驻浮层（关闭=隐藏保活）**；不做 conversation.view 页签。
> 实现细节与踩坑见 `DEVLOG.md`，设计取舍见 `DESIGN.md`。本文 = 里程碑与待办。

## 里程碑状态：初版已完成

初版提交：`77b4045 feat(plugins/ide): dsh-ide 初版 —— IDE 核心功能基本完成`

### ✅ 核心功能（已实现并验证）
- **编辑器**：Monaco（91 语言、行号、小地图、折叠、查找、Ctrl+S、脏点、截断只读、光标保持、外部文件自动重载不脏）
- **文件**：树/右键菜单/新建/重命名/删除/加入 VCS/拖放移动（二次确认）/git 状态着色（?A M !!）
- **监听**：fs.watch → 文件树+git+干净编辑器同步；git 5s 轮询
- **状态**：按工作区 localStorage 缓存（面板宽/终端高/展开/编辑器 tabs）；面板隐藏不卸载；会话跟随（DOM 轮询 sessionId）
- **Git 交互**：
  - 搁置（提交弹框 [更改|搁置] 页签，stash push/list/pop/drop）
  - 提交 / 提交并推送（勾选文件树 + 说明，多仓库）
  - 推送（`git.pendingBranches` 按分支分组 + 新分支语义 + 多选二级树批量 `推送（N）`）
  - 更新（无上游自动 pull origin/分支、无远程中文提示）
  - 分支管理：搜索过滤 / 新建分支(基于此) / 重命名 / 删除 / 对比(两栏提交+文件) / 检出(切换文案+智能/强制) / 设置远程
  - 提交历史：自绘虚拟滚动（1000 条、倒序、主左分叉右泳道、每分支唯一色）、悬停分支归属、右键 详情/与当前对比/回滚该提交、4s 静默轮询
- **终端**：node-pty + loopback http/ws + xterm；底部整行（图标栏左侧）、高度可拖、多标签、跟随工作区
- **布局**：右侧文件/Git 面板宽可拖（记录 px）；编辑器/面板随终端高度自适应；分隔条悬浮线（坐标渲染，hover/拖动 3px 蓝）；毛玻璃遮罩（maskStyle）
- **编码细节**：JSON 折叠专用 provider；codicon 字体 dataURL 内联；host op 失败写 `dsh-ide-opfail.json`

### ⏳ 收尾（记录，暂不做——打磨类）
- [ ] 历史 4s 轮询与手动刷新去重/节流
- [ ] 推送批量失败后的“重试失败项”按钮
- [ ] 深色主题适配（monaco 主题、毛玻璃透明度/模糊参数随 dsh 主题）
- [ ] 超多分支/超大历史下的性能与截断策略
- [ ] bundle 体积：minify + 语言按需/分块
- [ ] git.all 轮询降频（dirty 节流/后台降频）
- [ ] 错误统一 toast + host 日志归档
- [ ] 诊断 diag 文件机制收尾（或保留开关）
- [ ] 单测/冒烟：ChangeTree、路径 jail、语言探测、porcelain 解析

## 架构备忘（不再讨论项）
- 通信仅 settings 命名空间；client 请求串行化；host 串行队列
- fs/git 一律 realpath jail；git 走 `-C` + args（禁 shell）
- Monaco 打包式（monacoHost 接缝为迁托管式预留）；CSS 构建期聚合注入；worker 空 stub；codicon 字体 dataURL
- 每个 workspace 有 localStorage 缓存；面板隐藏不卸载；宿主会话跟随用 DOM 轮询

## 长线候选（未排期）
- 历史右键“检出该提交”（游离 HEAD 快照查看）——host 能力已清，需按需重建
- 文件历史/与指定提交 diff（行内已具备单文件 diff 查看，后续可接入编辑器标签）
- 全文搜索；设置面板；主题图标优化；把提交/推送等弹窗逐步做成向导式多步
