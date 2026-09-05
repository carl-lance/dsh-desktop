// build.mjs — compile the dsh-ide plugin into the DSH runtime layout.
//
// Inputs (readable sources):
//   src/host/index.ts     host half (runs in the Node host; ESM, @deepseek-ai/* external)
//   src/client/index.tsx  browser half (runs in the webview; bundled CJS, shell seeds external)
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
import { existsSync } from "node:fs";
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

/** Monaco's ESM files import raw `.css` for side effects (widget styling).
 *  Instead of relying on each module injecting at runtime (which proved
 *  unreliable in the webview), every css file is collected at BUILD time and
 *  the aggregated stylesheet is injected once with the bundle (see
 *  buildClient). Fonts referenced by url() are base64-inlined so the bundle
 *  stays self-contained. */
const monacoCssParts = [];

function mimeFor(file) {
  const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
  const map = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
    ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff",
    ".woff2": "font/woff2", ".eot": "application/vnd.ms-fontobject",
  };
  return map[ext] || "application/octet-stream";
}

async function inlineCssAssets(cssPath, text) {
  const { dirname } = await import("node:path");
  const { readFileSync } = await import("node:fs");
  return text.replace(/url\((['"]?)([^'")]+)\1\)/g, (match, quote, ref) => {
    const clean = ref.trim();
    if (/^(data:|#|https?:|\/)/.test(clean)) return match;
    const abs = join(dirname(cssPath), clean);
    try {
      const buf = readFileSync(abs);
      return `url("data:${mimeFor(abs)};base64,${buf.toString("base64")}")`;
    } catch {
      return match;
    }
  });
}

/** Resolve a bare css specifier (@scope/pkg/path.css) against node_modules
 *  walking up from a directory (avoids build.resolve re-entrancy). */
function resolveBareCss(resolveDir, spec) {
  const segs = spec.split("/");
  const pkgSegs = spec.startsWith("@") ? 2 : 1;
  const pkg = segs.slice(0, pkgSegs).join("/");
  const rest = segs.slice(pkgSegs).join("/");
  let dir = resolveDir;
  for (;;) {
    const base = join(dir, "node_modules", pkg);
    if (existsSync(base)) {
      return rest ? join(base, rest) : null;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const monacoCssPlugin = {
  name: "monaco-css",
  setup(build) {
    build.onResolve({ filter: /\.css$/ }, (args) => {
      const real = args.path.startsWith(".") ? join(args.resolveDir, args.path) : resolveBareCss(args.resolveDir, args.path);
      if (!real || !existsSync(real)) return undefined; // let esbuild handle it
      return {
        path: real,
        namespace: "monaco-css",
        sideEffects: true
      };
    });
    build.onLoad({ filter: /.*/, namespace: "monaco-css" }, async (args) => {
      let text = await readFile(args.path, "utf8");
      text = await inlineCssAssets(args.path, text);
      monacoCssParts.push(text);
      // The real injection happens once in the wrapper; modules only need to
      // exist so esbuild keeps the css files in the graph.
      return { contents: "export {};", loader: "js" };
    });
  }
};

async function buildClient() {
  monacoCssParts.length = 0;
  const result = await build({
    entryPoints: [join(root, "src/client/index.tsx")],
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: ["es2020"],
    jsx: "automatic",
    external: CLIENT_EXTERNALS,
    plugins: [dshExternalsPlugin, monacoCssPlugin],
    minify: false,
    write: false,
    logLevel: "silent",
  });
  const body = result.outputFiles[0].text;
  const cssInject =
    monacoCssParts.length > 0
      ? "(function(){try{var d=document;var h=d.head||d.documentElement;var s=d.createElement('style');s.setAttribute('data-mc-all','1');s.textContent=" +
        JSON.stringify(monacoCssParts.join("\n")) +
        ";h.appendChild(s);}catch(e){}})();\n"
      : "";
  const wrapper = `${cssInject}window.__ModuleLoader__.load({
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

/** Native / runtime-provided node modules the HOST bundle must NOT inline
 *  (resolved from the profile module tree at runtime). */
const HOST_EXTERNALS = ["node-pty", "ws"];

async function buildHost() {
  const result = await build({
    entryPoints: [join(root, "src/host/index.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["es2022"],
    plugins: [dshExternalsPlugin],
    external: HOST_EXTERNALS,
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
