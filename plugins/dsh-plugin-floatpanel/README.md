# dsh-plugin-floatpanel

右下角悬浮窗插件 —— 在 DeepSeek Harness Web UI 右下角显示一个悬浮面板。

- 纯 UI 插件：全部逻辑在浏览器端（client half），宿主端（host half）为空实现
- 刻意使用原生 DOM（不依赖任何 `@deepseek-ai/dsh-client-*` shell seed），跨运行时版本兼容
- 遵循项目现有插件结构与自动安装逻辑（`plugin-install.js` + `plugins.config.json`）

## 构建

```powershell
cd plugins\dsh-plugin-floatpanel
npm install          # 安装 esbuild（devDependency）
node build.mjs       # 编译出 lib/index.js + lib/client.js
node verify.mjs      # 验证产物符合 __ModuleLoader__ 契约
node build.mjs --pack  # 打包出 dist\dsh-plugin-floatpanel-0.1.0.tgz
```

## 自动安装（桌面版）

1. 将打包出的 tgz 放入 `src-tauri\resources\plugins\`
2. 在 `src-tauri\resources\plugins.config.json` 的 `plugins` 数组追加：

```json
{
  "id": "dsh-plugin-floatpanel",
  "version": "0.1.0",
  "archive": "dsh-plugin-floatpanel-0.1.0.tgz",
  "previousNames": []
}
```

3. 启动 DSH Desktop，`plugin-install.js` 会自动把插件装入
   `<DSH_HOME>/profiles/node_modules/` 并 patch 各 profile 的 `cordis.patch.yml`

## 行为

- 面板固定在页面右下角（`position: fixed; right/bottom: 16px`）
- 点击右上角 `×` 可关闭
- profile HMR 重载时自动卸载/重挂
