# dsh-ide 开发规划（PLAN）

> 架子已定：**头部按钮 + shell.overlay 常驻浮层（关闭=隐藏保活）**；不做 conversation.view 页签。
> 功能规划/取舍与逐步实现日志分别见 `DESIGN.md`、`DEVLOG.md`。本文 = 里程碑与待办（勾选随完成更新）。

## 里程碑状态

### ✅ 已落地
- 工作台布局：左多标签（编辑器/diff/终端）+ 右侧文件/Git 面板 + 最右图标栏（面板收起走图标）
- Monaco 编辑器（91 语言上色、行号、小地图、折叠、查找、Ctrl+S、脏点、截断只读、光标保持、外部文件自动重载不脏）
- 文件管理：树/右键菜单/新建/重命名/删除/加入VCS/拖放移动（二次确认）/git 状态着色（?A M !!）
- 监听：fs.watch 递归→文件树+git+干净编辑器自动同步；git 5s 轮询
- 状态：按工作区缓存（localStorage）+ 关闭隐藏保活 + 宿主切换跟随（DOM 轮询 sessionId）
- Git UI：分支下拉（非 git 显示 加入VCS 管理→先弹窗后 init）；Git 面板=提交记录树
- 弹窗（dsh 风格）：提交（文件树勾选+说明）、推送（左提交右文件树+信息）、加入VCS（分支名/.gitignore/加入-忽略）

### ⏳ 后端接线（UI 已就位，动作待真实 git）
- [ ] 提交：add 选中（含新文件）→ `commit -F`（临时文件传 message）→ 更新 git 状态
- [ ] 提交并推送：上述 + push
- [ ] 推送：当前分支 `git push`（含远端不存在分支时 -u 提示）
- [ ] 更新：`git pull`（含冲突/快进结果提示）
- [ ] 检出：分支列表选择 → checkout（远端分支自动建本地跟踪）
- [ ] 分支 对比：对比基线选择 → 左侧打开 diff 标签（可复用 commit.diff / `git diff` 数据）
- [ ] 分支 重命名 / 删除（本地 -d/-D；远端 -d push origin :name；保护当前分支）

### ⏳ 终端（调研完成，见 DEVLOG §Terminal）
- [ ] host `terminalServer.ts`：loopback http + ws + node-pty 会话（shell 探测 pwsh/powershell，cwd 锁工作区根）
- [ ] 客户端 `TerminalPane`：@xterm/xterm + FitAddon（新依赖装进插件），WS 直连、fit/重连
- [ ] 标签关闭确认：运行中进程 → 弹窗（终止/取消）
- [ ] 会话生命周期：切工作区/关闭应用时的清理策略
- [ ] 多会话/重命名（二期）

### ⏳ 打磨与性能
- [ ] bundle 体积：Monaco+全部语言 ~7.5MB(未压缩) → minify + 语言按需（分块/动态 import）+ 移除无用（gitgraph 若弃用）
- [ ] git.all 频繁轮询优化（dirty 节流/后台降频）
- [ ] 错误可见性：把 host/client 关键错误统一 toast + host 日志
- [ ] 深色主题适配（monaco 主题随 dsh 主题切换）
- [ ] 移除/收尾诊断探针代码与 diag 文件机制（或保留开关）
- [ ] 单元/冒烟：ChangeTree、路径 jail、语言探测、porcelain 解析

## 架构备忘（不再讨论项）
- 通信仅 settings 命名空间；client 请求串行化；host 串行队列
- fs/git 一律 realpath jail；git 走 `-C` + args（禁 shell）
- Monaco 打包式（monacoHost 接缝为迁托管式预留）；CSS 构建期聚合注入；worker 用空 stub
- 每个 workspace 有 localStorage 缓存；面板隐藏不卸载；宿主会话跟随用 DOM 轮询（无公开事件）

## 长线候选（未排期）
- 文件历史/与指定提交 diff；搜索；设置面板；主题图标优化；把提交/推送等弹窗逐步做成真正的向导式多步
