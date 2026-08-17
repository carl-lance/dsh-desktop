# DSH Desktop

基于 [Tauri 2](https://tauri.app/) 的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 桌面客户端。

免命令行、双击即用的 DeepSeek Harness Web UI：应用启动时自动在后台拉起 Node.js sidecar（`dsh web`），界面由系统 WebView 渲染，无需打开浏览器、无需手动起服务。

## 架构

```
dsh-desktop.exe（Tauri 2 / Rust 壳，约 30MB 内存）
│
├─ WebView2 ──────加载──────▶ http://127.0.0.1:3080（dsh web UI）
│
└─ spawn（std::process）──▶ node.exe + @deepseek-ai/dsh（sidecar 后端）
     └─ DSH_HOME → %APPDATA%\ai.deepseek.dsh-desktop\dsh（用户数据隔离）
```

- **后端**：Node.js 22.19 运行时 + npm 安装的 `@deepseek-ai/dsh`，以 sidecar 形式随安装包分发
- **前端**：dsh 官方 Web UI（React SPA），由后端在 `127.0.0.1:3080` 提供
- **生命周期**：Rust 侧负责启动后端、轮询端口就绪后导航 WebView、退出时清理整个 sidecar 进程树（`taskkill /T` + Windows Job Object 兜底，任务管理器强杀也不会残留 node 进程）

## 环境要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| Windows | 10 / 11 | 需要 WebView2 运行时（Win10/11 通常已内置） |
| Node.js | ^22.19.0 | 运行时与构建均需要 |
| Rust | 1.77+ | 仅构建需要（`tauri-cli` 依赖） |

## 快速开始

```powershell
# 1. 安装 Tauri CLI 等前端依赖
npm install

# 2. 生成运行时资源（node.exe + dsh-runtime，约 3 分钟，自动精简 .map/.ts/.d.ts）
npm run prepare:runtime

# 3. 开发模式运行（首次 Rust 编译约 5–15 分钟）
npm run dev
```

首次运行会弹出 **DSH Desktop** 窗口：先是 loading 页，后端就绪后自动进入 DeepSeek Harness 界面。

## 打包发布

```powershell
npm run build
```

生成 NSIS 安装包（`src-tauri/target/release/bundle/nsis/`）。安装包内含 node.exe 与完整 dsh 运行时，目标机器无需安装 Node.js。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发模式（debug 构建 + 热重载） |
| `npm run build` | Release 打包（NSIS 安装包） |
| `npm run prepare:runtime` | 重新生成 dsh 运行时（升级 dsh 版本改 `scripts/prepare-runtime.ps1` 的 `$Version`） |

## 项目结构

```
├─ src-tauri/                 # Tauri 应用（Rust）
│  ├─ src/lib.rs              # 生命周期：sidecar 启动/端口轮询/导航/退出清理
│  ├─ tauri.conf.json         # 窗口尺寸、图标、资源打包配置
│  ├─ resources/              # 运行时资源（node.exe + dsh-runtime，构建时生成，不入库）
│  └─ icons/                  # 应用图标（DeepSeek Harness 品牌图标）
├─ frontend/index.html        # 启动 loading 页（后端就绪前显示）
├─ scripts/prepare-runtime.ps1 # 生成运行时资源的构建脚本
└─ package.json
```

## 已知问题与注意

- **性能**：`npm run dev` 为 debug 构建，执行任务时界面可能卡顿；使用 `npm run build` 的 release 产物可获得正常性能。
- **首屏白屏**：进入页面瞬间的短暂空白是 React SPA 首帧渲染的固有间隙，窗口背景色已与页面主题对齐，视觉上基本无缝。
- **端口**：后端固定占用 `127.0.0.1:3080`，启动前请确保该端口空闲。
- **版本**：DeepSeek Harness 处于 developer preview 阶段（当前打包 `@deepseek-ai/dsh@0.1.0-rc.6`），API 可能有破坏性变更，升级需重新验证。
