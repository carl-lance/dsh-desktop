# dsh-ide

DeepSeek Harness Web 的 **IDE 插件**（开发中）。以 **中栏对话视图环（`conversation.view`）的第三个页签**形态存在，
与"对话 / 轨迹"并列切换。路线图见 [PLAN.md](./PLAN.md)。

## 现状（Phase 0）

- 已注册页签"IDE"（占位视图），功能模块按计划分阶段填充。

## 目录

```
plugins/ide/
├── package.json          # dsh.client manifest、exports、scripts
├── tsconfig.json
├── build.mjs             # esbuild 构建：src/ → lib/（可附加 npm pack）
├── PLAN.md               # 开发计划
└── src/
    ├── host/index.ts     # 宿主侧最小入口（Phase 1+ 承载 git/fs/pty）
    └── client/           # WebView 侧
        ├── index.tsx     # 注册 conversation.view 页签（id: ide）
        ├── WorkbenchView.tsx  # 占位视图
        └── locales.ts    # 中英文案
```

## 构建

```powershell
npm install --legacy-peer-deps   # 只安装 esbuild（peer 依赖由 DSH 宿主提供）
npm run build                    # -> lib/index.js + lib/client.js
npm run pack                     # 构建 + npm pack -> dist/dsh-ide-0.1.0.tgz
```

> 必须用 `--legacy-peer-deps`：npm 10 会自动安装 `peerDependencies`，会把 `@deepseek-ai` 依赖族拉进来。

## 装入 dev profile（Phase 0 验证）

dev 模式的 DSH home 在 `<repo>\src-tauri\target\dsh-dev`：

```powershell
$home = "..\src-tauri\target\dsh-dev"
# 1) 复制包（lib/ 需先 npm run build）
New-Item -ItemType Directory -Force "$home\profiles\node_modules\dsh-ide" | Out-Null
Copy-Item -Recurse -Force lib "$home\profiles\node_modules\dsh-ide"
Copy-Item package.json "$home\profiles\node_modules\dsh-ide"
# 2) 追加 cordis.patch.yml insert（幂等）
$patch = "$home\profiles\web\cordis.patch.yml"
if (-not (Select-String -Path $patch -Pattern "dsh-ide" -Quiet)) {
  Add-Content $patch "`n- insert:`n    - id: dsh-ide"
}
```

然后重启 dsh-desktop（或让 watcher 重建）→ 进入会话 → 会话头部视图环出现"IDE"标签。

## 契约说明

- 页签注册形态与官方 `dsh-client-ui-trajectory` 的 `conversation.view` 条目一致（name/id/order/label/locale + React 组件）
- 视图条目为 session 作用域；Phase 1 spike 将确认外部条目可用的 props/inject（sessionId 等）
