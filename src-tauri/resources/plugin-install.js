// plugin-install.js — desktop-side plugin installer for DSH Desktop.
//
// Invoked by the Tauri shell BEFORE the dsh backend starts:
//   node plugin-install.js <config> <pluginsDir> <dshHome>
//
// For every entry in plugins.config.json:
//   * current id installed at the same version -> skip, but still clean up
//     stale previous-name directories + patch entries;
//   * otherwise -> move exact-name installs (current id + previousNames, each
//     verified by its package.json name) aside, extract the .tgz, verify the
//     packed identity, install, patch each profile's cordis.patch.yml, then
//     drop backups.
//
// Failure policy: per-plugin errors are logged and SKIPPED (with rollback);
// backup-cleanup failures are warnings. Exit code is always 0 so startup is
// never blocked.
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const NAME_RE = /^dsh-plugin-[a-z0-9][a-z0-9._-]*$/;

function log(kind, msg) {
  console.log(`[plugin-install][${kind}] ${msg}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function installedVersion(base, id) {
  try {
    const p = readJson(path.join(base, id, "package.json"));
    return p && typeof p.version === "string" ? p.version : null;
  } catch {
    return null;
  }
}

function rmQuiet(target, what) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
    return true;
  } catch (err) {
    log("warn", `remove ${what || target} failed: ${err.message} (will retry later)`);
    return false;
  }
}

function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remove directories whose package.json name is exactly one of `names`. */
function removeOldDirs(base, names, extra) {
  const candidates = Array.from(new Set(names.filter((n) => NAME_RE.test(n) && n !== extra)));
  for (const name of candidates) {
    const dir = path.join(base, name);
    if (!fs.existsSync(dir)) continue;
    let meta = null;
    try {
      meta = readJson(path.join(dir, "package.json"));
    } catch {
      meta = null;
    }
    if (!meta || meta.name !== name) {
      log("warn", `skip delete ${dir}: package.json name is not exactly "${name}"`);
      continue;
    }
    if (rmQuiet(dir, `old install ${name}`)) log("clean", `removed stale ${name}`);
  }
}

/** cordis.patch.yml maintenance: exactly one `- insert:` entry for `id` in
 *  each profile, stale previous-name entries removed, unrelated entries kept. */
function patchProfiles(dshHome, id, previousNames) {
  const profilesRoot = path.join(dshHome, "profiles");
  let profileDirs = [];
  try {
    profileDirs = fs.readdirSync(profilesRoot, { withFileTypes: true });
  } catch {
    profileDirs = [];
  }
  const oldSet = new Set((previousNames || []).filter((n) => NAME_RE.test(n) && n !== id));
  const ID_RE = /^(\s*)- id:\s*(dsh-plugin-[a-z0-9][a-z0-9._-]*)\s*$/;
  const NM_RE = /^\s*name:\s*(dsh-plugin-[a-z0-9][a-z0-9._-]*)\s*$/;
  const MARKER_RE = /^\s*- insert:\s*$/;
  const NEW_BLOCK = `- insert:\n    - id: ${id}\n      name: ${id}\n`;

  for (const e of profileDirs) {
    if (!e.isDirectory() || e.name === "node_modules") continue;
    const patchFile = path.join(profilesRoot, e.name, "cordis.patch.yml");
    if (!fs.existsSync(patchFile)) continue;
    try {
      const raw = fs.readFileSync(patchFile, "utf8").split(/\r?\n/);
      const out = [];
      let hasId = false;
      let i = 0;
      while (i < raw.length) {
        const line = raw[i];
        if (!MARKER_RE.test(line)) {
          // Plain (non-block) line: drop orphan id/name lines that belong to
          // us (stale names, or current id without a marker — it is re-added
          // canonically below when missing).
          const pidm = ID_RE.exec(line);
          const pnmm = NM_RE.exec(line);
          if (pidm) {
            const n = pidm[2];
            if (n === id || oldSet.has(n)) {
              i++;
              continue;
            }
          }
          if (pnmm) {
            const n = pnmm[1];
            if (n === id || oldSet.has(n)) {
              i++;
              continue;
            }
          }
          out.push(line);
          i++;
          continue;
        }
        // Collect one marker + its indented children.
        const block = [line];
        i++;
        while (i < raw.length) {
          const nxt = raw[i];
          if (MARKER_RE.test(nxt)) break;
          if (nxt.trim() !== "" && !/^[ \t]/.test(nxt)) break;
          block.push(nxt);
          i++;
        }
        const kept = [];
        for (let b = 0; b < block.length; b++) {
          const l = block[b];
          if (b === 0) {
            kept.push(l);
            continue;
          }
          const idm = ID_RE.exec(l);
          if (idm) {
            const n = idm[2];
            if (n === id) {
              hasId = true;
              kept.push(l);
              continue;
            }
            if (oldSet.has(n)) continue; // drop stale id line
            kept.push(l);
            continue;
          }
          const nmm = NM_RE.exec(l);
          if (nmm) {
            if (oldSet.has(nmm[1])) continue; // drop stale name line
            kept.push(l);
            continue;
          }
          kept.push(l);
        }
        if (kept.length > 1) out.push(...kept); // marker with any content
      }
      let next = out.join("\n");
      if (!hasId) {
        const orphan = new RegExp(`^\\s+- id:\\s*${escRe(id)}\\s*$`, "m");
        if (orphan.test(next)) {
          next = next.replace(orphan, (m) => `- insert:\n${m}`);
        } else {
          next = (next.replace(/\s*$/, "") + "\n" + NEW_BLOCK);
        }
      }
      // Drop empty markers (nothing after them until EOF/another marker).
      const lines2 = next.split("\n");
      const out2 = [];
      for (let k = 0; k < lines2.length; k++) {
        const l = lines2[k];
        if (MARKER_RE.test(l)) {
          let j = k + 1;
          while (j < lines2.length && lines2[j].trim() === "") j++;
          const following = j < lines2.length ? lines2[j] : "";
          if (following === "" || MARKER_RE.test(following)) continue;
        }
        out2.push(l);
      }
      let final = out2.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
      if (!final.endsWith("\n")) final += "\n";
      fs.writeFileSync(patchFile, final, "utf8");
    } catch (err) {
      log("warn", `patch ${patchFile} failed: ${err.message}`);
    }
  }
}

function installOne(base, cfg, pluginsDir, dshHome) {
  const { id, version, archive, previousNames } = cfg;
  if (typeof id !== "string" || !NAME_RE.test(id)) throw new Error(`invalid id: ${id}`);
  if (typeof version !== "string") throw new Error(`invalid version for ${id}`);
  const archName = typeof archive === "string" ? path.basename(archive) : "";
  if (!archName) throw new Error(`missing archive for ${id}`);
  const archPath = path.join(pluginsDir, archName);
  if (!fs.existsSync(archPath)) throw new Error(`archive not found: ${archName}`);

  const previous = Array.isArray(previousNames) ? previousNames : [];
  if (installedVersion(base, id) === version) {
    removeOldDirs(base, previous, id);
    patchProfiles(dshHome, id, previous);
    log("skip", `${id}@${version} already installed (stale entries cleaned)`);
    return;
  }
  log("install", `${id}@${version} (was ${installedVersion(base, id) ?? "absent"})`);

  const candidates = Array.from(new Set([id, ...previous.filter((n) => NAME_RE.test(n))]));
  const moved = [];
  let installed = false;
  const dest = path.join(base, id);
  fs.mkdirSync(base, { recursive: true });

  try {
    for (const name of candidates) {
      const dir = path.join(base, name);
      if (!fs.existsSync(dir)) continue;
      let meta = null;
      try {
        meta = readJson(path.join(dir, "package.json"));
      } catch {
        meta = null;
      }
      if (!meta || meta.name !== name) {
        throw new Error(`refusing to touch ${dir}: package.json name is not exactly "${name}"`);
      }
      const bak = `${dir}.bak-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      fs.renameSync(dir, bak);
      moved.push({ dir, bak });
    }

    const tmp = fs.mkdtempSync(path.join(base, ".install-"));
    try {
      const res = spawnSync("tar", ["-xzf", archPath, "-C", tmp], { encoding: "utf8" });
      if (res.status !== 0) throw new Error(`tar failed: ${(res.stderr || res.stdout || "").toString().trim()}`);
      let pkgDir = path.join(tmp, "package");
      if (!fs.existsSync(pkgDir) || !fs.statSync(pkgDir).isDirectory()) pkgDir = tmp;
      const meta = readJson(path.join(pkgDir, "package.json"));
      if (meta.name !== id) throw new Error(`archive contains "${meta.name}", expected "${id}"`);
      if (meta.version !== version) throw new Error(`archive version ${meta.version}, expected ${version}`);
      fs.renameSync(pkgDir, dest);
      installed = true;
      patchProfiles(dshHome, id, previous);
      rmQuiet(tmp, "install temp");
    } catch (err) {
      rmQuiet(tmp, "install temp");
      throw err;
    }

    for (const m of moved) rmQuiet(m.bak, `backup ${m.bak}`);
    log("ok", `${id}@${version} installed`);
  } catch (err) {
    if (installed) rmQuiet(dest, "half-installed copy");
    for (const m of moved) {
      if (!fs.existsSync(m.dir) && fs.existsSync(m.bak)) {
        try {
          fs.renameSync(m.bak, m.dir);
        } catch (e) {
          log("warn", `restore ${m.bak} failed: ${e.message}`);
        }
      }
    }
    throw err;
  }
}

function main() {
  const [configFile, pluginsDir, dshHome] = process.argv.slice(2);
  if (!configFile || !pluginsDir || !dshHome) {
    log("skip", "usage: node plugin-install.js <config> <pluginsDir> <dshHome>");
    return;
  }
  let cfg;
  try {
    cfg = readJson(configFile);
  } catch (err) {
    log("skip", `config unreadable (${err.message}) — skipping plugin install`);
    return;
  }
  if (!cfg || !Array.isArray(cfg.plugins) || cfg.plugins.length === 0) {
    log("skip", "config has no plugins — nothing to install");
    return;
  }
  const base = path.join(dshHome, "profiles", "node_modules");
  for (const entry of cfg.plugins) {
    try {
      installOne(base, entry, pluginsDir, dshHome);
    } catch (err) {
      log("skip", `${entry && entry.id ? entry.id : "?"}: ${err && err.message ? err.message : String(err)}`);
    }
  }
  log("done", "installer finished");
}

main();
