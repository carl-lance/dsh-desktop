/**
 * dsh-ide — text document model + language detection.
 *
 * Detection maps a file path to a Monaco monarch language id (the ids below
 * exist in the bundled monaco basic-languages set for 0.56); "" = plain text.
 * C files use "cpp" (monaco ships no plain-C monarch language).
 */

import type { ITextDocument, LanguageId } from "./types";

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** Language id derived from a file path (best effort). */
export function languageIdFromPath(uri: string): LanguageId {
  const lower = uri.toLowerCase();
  const name = basename(lower);

  // Filename-based first.
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return "dockerfile";
  if (name === "cmakelists.txt") return "";
  if (name === "makefile") return "";
  if (name === ".gitignore" || name === ".gitattributes") return "ini";
  if (name === ".env" || name === ".npmrc" || name === ".yarnrc") return "ini";

  // Frontend.
  if (lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts")) return "typescript";
  if (lower.endsWith(".jsx")) return "typescript";
  if (/\.(js|mjs|cjs)$/.test(lower)) return "javascript";
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) return "json";
  if (lower.endsWith(".html") || lower.endsWith(".htm") || lower.endsWith(".vue")) return "html";
  if (/\.(css|pcss)$/.test(lower)) return "css";
  if (lower.endsWith(".scss")) return "scss";
  if (lower.endsWith(".less")) return "less";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".mdx")) return "mdx";
  if (lower.endsWith(".xml") || lower.endsWith(".svg")) return "xml";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
  if (lower.endsWith(".astro")) return "html";

  // Backend / general.
  if (lower.endsWith(".py") || lower.endsWith(".pyw")) return "python";
  if (lower.endsWith(".java")) return "java";
  if (lower.endsWith(".go")) return "go";
  if (lower.endsWith(".rs")) return "rust";
  if (lower.endsWith(".cs")) return "csharp";
  if (lower.endsWith(".php") || lower.endsWith(".phtml")) return "php";
  if (lower.endsWith(".rb") || lower.endsWith(".rake")) return "ruby";
  if (lower.endsWith(".swift")) return "swift";
  if (lower.endsWith(".kt") || lower.endsWith(".kts")) return "kotlin";
  if (lower.endsWith(".sh") || lower.endsWith(".bash") || lower.endsWith(".zsh")) return "shell";
  if (lower.endsWith(".ps1") || lower.endsWith(".psm1")) return "powershell";
  if (lower.endsWith(".bat") || lower.endsWith(".cmd")) return "bat";
  if (/\.(sql|mysql|pgsql)$/.test(lower)) return "sql";
  if (lower.endsWith(".lua")) return "lua";
  if (lower.endsWith(".pl")) return "perl";
  if (lower.endsWith(".scala")) return "";
  if (lower.endsWith(".dart")) return "dart";
  if (lower.endsWith(".fs") || lower.endsWith(".fsx")) return "fsharp";
  if (lower.endsWith(".ex") || lower.endsWith(".exs")) return "elixir";
  if (lower.endsWith(".vb")) return "vb";
  if (lower.endsWith(".sol")) return "solidity";
  if (lower.endsWith(".proto")) return "protobuf";
  if (lower.endsWith(".graphql") || lower.endsWith(".gql")) return "graphql";
  if (lower.endsWith(".hcl") || lower.endsWith(".tf")) return "hcl";

  // Embedded / systems.
  if (lower.endsWith(".c") || lower.endsWith(".h")) return "cpp";
  if (/\.(cpp|cc|cxx|hpp|hh|hxx|ino|mm)$/.test(lower)) return "cpp";
  if (/\.(v|sv|svh|vh)$/.test(lower)) return "systemverilog";

  // Config / data.
  if (lower.endsWith(".ini") || lower.endsWith(".properties") || lower.endsWith(".cfg")) return "ini";
  if (lower.endsWith(".toml")) return "";
  if (lower.endsWith(".env")) return "ini";

  return "";
}

export interface OpenDocumentInput {
  uri: string;
  content: string;
  /** Content was truncated at load — the editor opens read-only. */
  truncated?: boolean;
}

/** Create the read-only metadata half of a text document. */
export function createTextDocument(input: OpenDocumentInput): ITextDocument {
  return {
    uri: input.uri,
    fileName: basename(input.uri),
    languageId: languageIdFromPath(input.uri),
    isReadonly: input.truncated === true,
    truncated: input.truncated === true,
  };
}
