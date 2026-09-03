/**
 * dsh-ide — host-side filesystem operations, jailed to the workspace root.
 *
 * Every path handed in is resolved against the root and must stay inside it
 * (realpath prefix check); anything else throws. Symlinked entries are
 * followed for the containment check, so a link escaping the root is denied.
 */

import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { FsEntry, FsReadData } from "../shared/types";

/** Default hidden / noise directories (top level and nested). */
const IGNORED_NAMES = new Set([".git", "node_modules", "target", "dist", ".idea", ".DS_Store"]);

/** Read cap for the workbench editor (bytes). */
export const READ_CAP = 512 * 1024;

/** Sort: directories first, then by name (case-insensitive). */
function sortEntries(a: FsEntry, b: FsEntry): number {
  if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/** Ensure `p` is an absolute path strictly inside `root`; returns the
 *  normalized absolute path. Throws on escape attempts. */
export async function jail(root: string, p: string): Promise<string> {
  const rootReal = await realpath(root).catch(() => resolve(root));
  const abs = isAbsolute(p) ? resolve(p) : resolve(rootReal, p);
  const absReal = await realpath(abs).catch(() => abs);
  const rel = relative(rootReal, absReal);
  if (rel === "" ) {
    // Root itself is allowed for listing.
    return absReal;
  }
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`path escapes workspace root: ${p}`);
  }
  return absReal;
}

/** List one directory (jailed). Never lists ignored names. */
export async function listDir(root: string, dirPath: string): Promise<FsEntry[]> {
  const target = await jail(root, dirPath);
  const dirents = await readdir(target, { withFileTypes: true });
  const entries: FsEntry[] = [];
  for (const d of dirents) {
    if (IGNORED_NAMES.has(d.name)) continue;
    entries.push({
      name: d.name,
      path: resolve(target, d.name),
      kind: d.isDirectory() ? "dir" : d.isFile() ? "file" : "file",
    });
  }
  return entries.sort(sortEntries);
}

/** Read a text file (jailed, capped). Binary sniffing via NUL bytes. */
export async function readFileText(root: string, filePath: string): Promise<FsReadData> {
  const target = await jail(root, filePath);
  const st = await stat(target);
  if (!st.isFile()) throw new Error("not a file");
  if (st.size > READ_CAP) {
    const head = await readFile(target, { encoding: "utf8" });
    return { path: target, text: head.slice(0, READ_CAP), truncated: true, binary: false };
  }
  const buf = await readFile(target);
  const head = buf.subarray(0, 1024);
  const binary = head.includes(0);
  if (binary) throw new Error("binary file — not opened in the editor");
  return { path: target, text: buf.toString("utf8"), truncated: false, binary: false };
}

/** Write UTF-8 text to a file (jailed). Returns byte count. */
export async function writeFileText(root: string, filePath: string, text: string): Promise<{ path: string; bytes: number }> {
  const target = await jail(root, filePath);
  const buf = Buffer.from(text, "utf8");
  await writeFile(target, buf);
  return { path: target, bytes: buf.length };
}

/** Rename / move inside the root (both sides jailed). */
export async function renameEntry(root: string, from: string, to: string): Promise<{ ok: true }> {
  const a = await jail(root, from);
  const b = await jail(root, to);
  await rename(a, b);
  return { ok: true };
}

/** Delete a file, or a directory recursively (jailed). */
export async function removeEntry(root: string, path: string): Promise<{ ok: true }> {
  const target = await jail(root, path);
  const st = await stat(target);
  await rm(target, { recursive: st.isDirectory(), force: true });
  return { ok: true };
}

/** Create one directory (jailed). */
export async function makeDir(root: string, path: string): Promise<{ ok: true }> {
  const target = await jail(root, path);
  await mkdir(target, { recursive: false });
  return { ok: true };
}
