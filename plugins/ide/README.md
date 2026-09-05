# dsh-plugin-ide

DeepSeek Harness Desktop 的 **IDE 插件**（初版已完成，核心功能：Monaco 编辑器、文件树、Git（提交/搁置/推送/对比/检出/回滚/分支）、底部终端）。规划见 [PLAN.md](./PLAN.md)，日志见 [DEVLOG.md](./DEVLOG.md)。

> 包名采用 `dsh-plugin-*` 前缀约定，供桌面启动安装器按精确包名安全删除/替换。

## 目录

```
plugins/ide/
├── package.json          # dsh.client manifest、exports、scripts（name: dsh-plugin-ide）
├── build.mjs             # esbuild 构建 + 包名前缀校验 + npm pack
├── PLAN.md / DEVLOG.md   # 规划 / 日志
└── src/
    ├── host/             # 宿主侧：settings 命名空间、fs/git/terminal、watcher
    └── client/           # WebView 侧：EditorGroup / Workbench / Git UI / Terminal
```

## 构建

```powershell
npm run build   # -> lib/index.js + lib/client.js
npm run pack    # 构建 + npm pack -> dist/dsh-plugin-ide-0.1.0.tgz
```

## 装入 dev profile（调试用）

dev 模式 DSH home 在 `<repo>\src-tauri\target\dsh-dev`；推荐用桌面安装器（见下），或手动：

```powershell
$dshHome = "..\src-tauri\target\dsh-dev"
node ..\src-tauri\resources\plugin-install.js `
  ..\src-tauri\resources\plugins.config.json `
  ..\src-tauri\resources\plugins `
  $dshHome
```

安装器幂等：同版本已装→跳过（并清理旧名残留）；版本不同/缺失→校验 `package.json.name` 精确匹配后替换并写 `cordis.patch.yml`；任何失败记录并跳过，不阻塞启动。

## 桌面自动安装

`src-tauri` 启动前会执行 `resources/plugin-install.js`（读取 `resources/plugins.config.json`，安装包放 `resources/plugins/*.tgz`，release 用户数据目录为 `dsh-beta`）。重启 dsh-desktop 后进入会话即可看到 IDE。
