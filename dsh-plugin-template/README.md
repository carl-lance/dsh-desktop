# dsh-plugin-template

[DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) 插件开发模板。
使用可读的 **TypeScript/TSX 源码**，通过 **esbuild** 编译成 DSH 运行时所要求的产物布局，
并用 `npm pack` 打包发布。

示例功能是 MCP 服务器管理面板（即 `dsh-mcp-panel` 插件的结构化重写）：一个设置弹窗分区，
把服务器配置存入设置命名空间，并通过 `@deepseek-ai/dsh-mcp-client` 实时挂载。

## 目录结构

```
dsh-plugin-template/
├── package.json          # dsh.client 声明、exports、scripts
├── tsconfig.json
├── build.mjs             # esbuild 构建：src/ → lib/（可附加 npm pack）
├── verify.mjs            # 按 __ModuleLoader__ 契约冒烟加载 lib/client.js
└── src/                  # 可读源码，模块化组织
    ├── shared/
    │   └── types.ts      # 双端共享类型（纯类型，构建时擦除）
    ├── host/             # Node 宿主侧
    │   ├── index.ts      #   插件入口：装配命名空间 + 调和器 + 生命周期
    │   ├── schema.ts     #   设置命名空间 schema
    │   └── reconciler.ts #   mcp-client 调和器（挂载/卸载/状态回写）
    └── client/           # WebView 浏览器侧
        ├── index.tsx     #   插件入口：字典 + 分区注册
        ├── locales.ts    #   中英文案（en 完整性由类型系统保证）
        ├── validate.ts   #   纯函数 JSON 配置校验（可单测）
        ├── styles.ts     #   样式注入（幂等）
        ├── JsonEditor.tsx#   原始 JSON 编辑器组件
        ├── ServerCard.tsx#   可展开服务器卡片组件
        └── McpSection.tsx#   分区组合
```

DSH 实际加载两个产物：
- `lib/index.js` — 宿主入口（纯 ESM，`@deepseek-ai/*` 保持 external，运行时从 profile 模块树解析）
- `lib/client.js` — 浏览器入口（打包成 CJS 并包裹在 `window.__ModuleLoader__.load({ id, factory })` 中；运行时只 require 宿主种子模块——`react`、`@deepseek-ai/dsh-client-*`）

## 构建与打包

```powershell
npm install --legacy-peer-deps   # 只安装 esbuild（peer 依赖由 DSH 宿主提供）
npm run build                    # -> lib/index.js + lib/client.js
npm run pack                     # 构建 + npm pack -> dist/dsh-plugin-template-0.1.0.tgz
npm run verify                   # 按 __ModuleLoader__ 契约冒烟加载产物
```

> 必须用 `--legacy-peer-deps`：npm 10 会自动安装 `peerDependencies`，会把整个
> `@deepseek-ai` 依赖族拉进来。模板的 peer 只是契约声明——运行中的 DSH 宿主已经提供它们。

## 从模板开始一个新插件

1. 复制本目录并改名：
   - `package.json`：`name`、`description`（`dsh.client.inject` 按你 require 的种子模块调整）
   - `build.mjs`：无需改（包 id 自动读 `package.json` 的 name）
   - 客户端 bundle 的 id 即包名，自动生成
2. 修改 `src/host/`（宿主逻辑）和 `src/client/`（界面）。
3. `npm run pack`，然后装进某个 profile：

   ```powershell
   powershell -ExecutionPolicy Bypass -File ..\dsh-mcp-panel\install.ps1 `
     -PackagePath "dist\<你的包名>-0.1.0.tgz"
   ```

   或手动：解压到 `<DSH_HOME>\profiles\node_modules\<你的包名>`，
   并在 `<DSH_HOME>\profiles\web\cordis.patch.yml` 追加 `- insert:` 条目。

## 双端如何通信（零自定义 RPC）

- 浏览器侧通过 `settingsScope` 服务读写 `mcp` 设置命名空间；宿主侧注册该命名空间
  （带 schema）、监听变化，并在每次变化时调和业务（此处为动态 `dsh-mcp-client` 实例）。
- 宿主侧把 `runtimeStatus` 投影写回命名空间，界面无需任何 Remote 即可渲染状态。
- 通信细节（WebSocket、序列化、事件转发）全部由框架封装，两侧代码只读写一个普通对象。

## 版本说明

- rc.6 宿主对 Web 可见命名空间有白名单限制；模板通过 `settings-exposure` 命名空间声明自己，
  rc.6 会采纳，rc.7+ 忽略（rc.7 原生暴露所有已注册命名空间）。
- `dsh-mcp-panel/test/mcp-echo-server.mjs` 是一个零依赖的 MCP 测试服务器，
  可在任意宿主上快速验证挂载功能。
