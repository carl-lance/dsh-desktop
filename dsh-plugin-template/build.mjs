// build.mjs — compile the DSH plugin template into the runtime layout.
//
// Inputs (readable sources):
//   src/host/index.ts    host half (runs in the Node host; ESM, @deepseek-ai/* external)
//   src/client/index.tsx browser half (runs in the webview; bundled CJS, shell seeds external)
//
// Outputs (what DSH loads):
//   lib/index.js    host entry  — plain ESM
//   lib/client.js   browser entry — window.__ModuleLoader__.load({ id, factory }) wrapper
//
// Usage:
//   node build.mjs          # build only
//   node build.mjs --pack   # build, then npm pack into dist/
//
// The client half is wrapped exactly like official bundles: the factory
// receives `require`, which resolves the shell seed modules (react,
// @deepseek-ai/dsh-client-*, ...) and other registered plugin bundles.

import { build } from "esbuild";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const PLUGIN_ID = pkg.name;

/** Bare specifiers the client bundle must keep external: the webview shell
 *  owns these modules (window.__DSH_BOOT__ / __ModuleLoader__ seed table). */
const CLIENT_EXTERNALS = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
];

/** Resolve every `@deepseek-ai/*` import as external (the runtime provides
 *  these; esbuild's `external` option only accepts literal strings). */
const dshExternalsPlugin = {
  name: "dsh-externals",
  setup(build) {
    build.onResolve({ filter: /^@deepseek-ai\// }, (args) => ({
      path: args.path,
      external: true
    }));
  }
};

async function buildClient() {
  const result = await build({
    entryPoints: [join(root, "src/client/index.tsx")],
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: ["es2020"],
    jsx: "automatic",
    external: CLIENT_EXTERNALS,
    plugins: [dshExternalsPlugin],
    minify: false,
    write: false,
    logLevel: "silent",
  });
  const body = result.outputFiles[0].text;
  const wrapper = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(PLUGIN_ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${body}
\t\treturn module.exports;
\t}
});
`;
  await writeFile(join(root, "lib/client.js"), wrapper, "utf8");
  console.log("  [ok] lib/client.js");
}

async function buildHost() {
  const result = await build({
    entryPoints: [join(root, "src/host/index.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["es2022"],
    plugins: [dshExternalsPlugin],
    minify: false,
    write: false,
    logLevel: "silent",
  });
  await writeFile(join(root, "lib/index.js"), result.outputFiles[0].text, "utf8");
  console.log("  [ok] lib/index.js");
}

async function pack() {
  const dist = join(root, "dist");
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  const result = spawnSync("npm", ["pack", "--pack-destination", dist], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`  [ok] tarball in ${dist}`);
}

await mkdir(join(root, "lib"), { recursive: true });
console.log(`building ${PLUGIN_ID}...`);
await buildHost();
await buildClient();
if (process.argv.includes("--pack")) {
  console.log("packing...");
  await pack();
}
console.log("done.");
