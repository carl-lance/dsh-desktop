// Verify lib/client.js materializes under the __ModuleLoader__ contract with
// a mocked browser environment (seed modules stubbed).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const code = readFileSync("lib/client.js", "utf8");
if (!code.startsWith("window.__ModuleLoader__.load(")) throw new Error("wrapper missing");

const factoryRegistry = new Map();
globalThis.window = {
  __ModuleLoader__: { load: ({ id, factory }) => factoryRegistry.set(id, factory) },
  document: { querySelector: () => null, createElement: () => ({ dataset: {}, appendChild() {} }) },
};

const require = createRequire(import.meta.url);
const module = { exports: {} };
const mockRequire = (spec) => {
  if (spec === "react") return { useState: (v) => [v, () => {}], useMemo: (f) => f() };
  if (spec === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null, Fragment: () => null };
  if (spec === "@deepseek-ai/dsh-client-web-react") return { bindSnapshotSelector: () => () => null };
  if (spec === "@deepseek-ai/dsh-client-ui-primitives") {
    return { Button: () => null, IconChevronDownOutline14: () => null, IconEditOutline16: () => null, IconTrashOutline16: () => null };
  }
  throw new Error(`unexpected require: ${spec}`);
};
// 1) execute the bundle: registers the factory via window.__ModuleLoader__.load
new Function("window", "require", "module", "exports", code)(globalThis.window, mockRequire, module, module.exports);
// 2) invoke the registered factory the way the webview does
const factory = factoryRegistry.get("dsh-plugin-template");
if (typeof factory !== "function") throw new Error("factory not registered");
const exp = factory(mockRequire);
if (typeof exp.apply !== "function" || !Array.isArray(exp.inject)) throw new Error("exports shape wrong");
console.log("client.js materializes OK: apply + inject present, inject =", JSON.stringify(exp.inject));

// Host side: ensure it parses as ESM and keeps externals.
// (Imports resolve only inside a DSH profile; here we just confirm the file
// loads far enough to reach its first external import, proving externals
// stayed external.)
import("./lib/index.js").then((m) => {
  console.log("index.js loads OK: exports =", Object.keys(m).join(", "));
  console.log("ALL GOOD");
}).catch((e) => {
  const first = e.message.split("\n")[0];
  if (/Cannot find package '@deepseek-ai\//.test(first)) {
    console.log("index.js OK: externals stay external as designed (" + first + ")");
    console.log("ALL GOOD");
  } else {
    console.error("index.js unexpected failure:", first);
    process.exitCode = 1;
  }
});
