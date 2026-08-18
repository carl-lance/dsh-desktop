# dsh-plugin-template

Starter template for a [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) plugin.
Readable **TypeScript/TSX sources** compiled by **esbuild** into the exact runtime
layout DSH expects, and packaged with `npm pack`.

The example feature is the MCP server management panel (the `dsh-mcp-panel`
plugin, re-expressed in structured sources): a settings-dialog section that
stores server configs in a settings namespace and live-mounts them through
`@deepseek-ai/dsh-mcp-client`.

## Layout

```
dsh-plugin-template/
├── package.json          # dsh.client declaration, exports, scripts
├── tsconfig.json
├── build.mjs             # esbuild build: src/ → lib/ (+ optional npm pack)
├── verify.mjs            # loads lib/client.js under the __ModuleLoader__ contract
└── src/                  # readable sources, modular
    ├── shared/
    │   └── types.ts      # TYPE-ONLY shapes shared by both halves (erased at build)
    ├── host/             # Node side
    │   ├── index.ts      #   plugin entry: wire namespaces + reconciler + lifecycle
    │   ├── schema.ts     #   settings namespace schemas
    │   └── reconciler.ts #   mcp-client reconciler (mount/unmount/status)
    └── client/           # webview side
        ├── index.tsx     #   plugin entry: dictionaries + section registration
        ├── locales.ts    #   zh/en dictionaries (en completeness is type-checked)
        ├── validate.ts   #   pure JSON config validation (unit-testable)
        ├── styles.ts     #   stylesheet injection (idempotent)
        ├── JsonEditor.tsx#   raw JSON editor component
        ├── ServerCard.tsx#   expandable server card component
        └── McpSection.tsx#   section composition
```

DSH loads two artifacts:
- `lib/index.js` — host entry (plain ESM, `@deepseek-ai/*` imports stay external, resolved from the profile module tree at runtime)
- `lib/client.js` — browser entry (bundled CJS wrapped in `window.__ModuleLoader__.load({ id, factory })`; only the shell seed modules — `react`, `@deepseek-ai/dsh-client-*` — are require()-ed at runtime)

## Build & pack

```powershell
npm install --legacy-peer-deps   # only esbuild is installed (peers are provided by the DSH host)
npm run build                    # -> lib/index.js + lib/client.js
npm run pack                     # build + npm pack -> dist/dsh-plugin-template-0.1.0.tgz
npm run verify                   # smoke-load the bundle under the __ModuleLoader__ contract
```

> `--legacy-peer-deps` matters: npm 10 auto-installs `peerDependencies`, which
> would drag in the whole `@deepseek-ai` family. The template declares peers
> only as a contract — the running DSH host already provides them.

## Start a new plugin from this template

1. Copy the directory and rename:
   - `package.json`: `name`, `description`, `dsh.client.inject` (keep the seeds you require)
   - `build.mjs`: nothing (it reads the id from `package.json`)
   - the client bundle id is the package name automatically
2. Edit `src/index.ts` (host logic) and `src/client.tsx` (UI).
3. `npm run pack`, then install into a profile:

   ```powershell
   powershell -ExecutionPolicy Bypass -File ..\dsh-mcp-panel\install.ps1 `
     -PackagePath "dist\<your-name>-0.1.0.tgz"
   ```

   or manually: extract into `<DSH_HOME>\profiles\node_modules\<your-name>` and
   add an `- insert:` entry to `<DSH_HOME>\profiles\web\cordis.patch.yml`.

## How the halves talk (no custom RPC)

- The browser half reads/writes the `mcp` settings namespace through the
  `settingsScope` service; the host half registered that namespace with a
  schema, watches it, and reconciles work (here: dynamic `dsh-mcp-client`
  instances) on every change.
- The host writes a `runtimeStatus` projection back into the namespace so the
  UI can render status without any Remote.

## Version notes

- rc.6 hosts gate Web-visible namespaces behind an allowlist; the template
  declares itself via the `settings-exposure` namespace, which rc.6 honors and
  rc.7+ ignores (rc.7 exposes every registered namespace natively).
- The test server in `dsh-mcp-panel/test/mcp-echo-server.mjs` is a handy
  zero-dependency MCP server for verifying mounts on any host.
