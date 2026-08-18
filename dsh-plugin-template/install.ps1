# install.ps1 — one-shot installer for the dsh-mcp-panel plugin.
#
# Installs into a desktop-app profile by copying the package into the profile
# module tree (real directory, so @deepseek-ai/* peer imports resolve from
# <DSH_HOME>/profiles/node_modules — no pnpm, no registry, no junction), then
# appends the cordis.patch.yml insert entry, and optionally applies the
# host-apiproxy exposure extension to the given runtime.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File install.ps1
#   powershell -ExecutionPolicy Bypass -File install.ps1 -DshHome "C:\Users\x\AppData\Roaming\ai.deepseek.dsh-desktop\dsh" `
#       -RuntimePath "E:\Local\DSH Desktop\resources\dsh-runtime" -PackagePath "dsh-mcp-panel-0.1.0.tgz"

param(
  [string]$DshHome = "",
  [string]$Profile = "web",
  [string]$PackagePath = "",
  [string]$RuntimePath = "",
  [string]$PatchScript = ""
)
$ErrorActionPreference = "Stop"

# --- resolve defaults -------------------------------------------------------
if (-not $DshHome) { $DshHome = Join-Path $env:APPDATA "ai.deepseek.dsh-desktop\dsh" }
if (-not $PackagePath) { $PackagePath = Split-Path -Parent $MyInvocation.MyCommand.Path }
$profilesModules = Join-Path $DshHome "profiles\node_modules"
$profileDir = Join-Path $DshHome "profiles\$Profile"
$target = Join-Path $profilesModules "dsh-mcp-panel"

Write-Host "== dsh-mcp-panel installer =="
Write-Host "  DSH home : $DshHome"
Write-Host "  profile  : $Profile"
Write-Host "  package  : $PackagePath"
Write-Host "  target   : $target"

# --- stage the package ------------------------------------------------------
$stage = Join-Path $env:TEMP "dsh-mcp-panel-install"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

$pkgDir = Join-Path $stage "package"
if (Test-Path $PackagePath -PathType Leaf) {
  Write-Host "==> extracting tarball"
  tar -xzf $PackagePath -C $stage
  if ($LASTEXITCODE -ne 0) { throw "tar extraction failed" }
} else {
  Write-Host "==> copying package directory (skipping node_modules)"
  New-Item -ItemType Directory -Force -Path $pkgDir | Out-Null
  Copy-Item (Join-Path $PackagePath "*") $pkgDir -Recurse -Force -Exclude "node_modules"
}

$manifest = Join-Path $pkgDir "package.json"
if (-not (Test-Path $manifest)) { throw "package.json not found in $pkgDir" }

# --- install into the profile module tree -----------------------------------
if (Test-Path $target) { Remove-Item -Recurse -Force $target }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
Copy-Item $pkgDir $target -Recurse -Force
Write-Host "  [ok] installed to $target"

# --- append the cordis.patch.yml insert (idempotent) ------------------------
$patch = Join-Path $profileDir "cordis.patch.yml"
if (-not (Test-Path $patch)) { throw "profile patch file not found: $patch" }
$patchText = [System.IO.File]::ReadAllText($patch)
if ($patchText.Contains("- id: dsh-mcp-panel")) {
  Write-Host "  [ok] cordis.patch.yml already contains the entry (idempotent skip)"
} else {
  $entry = @"

# dsh-mcp-panel: MCP management panel in the settings dialog (host reconciler + client section)
- insert:
    - id: dsh-mcp-panel
      name: dsh-mcp-panel
"@
  [System.IO.File]::AppendAllText($patch, $entry, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "  [ok] appended entry to $patch"
}

# --- host-apiproxy exposure extension ---------------------------------------
if ($RuntimePath) {
  $candidates = @(
    $PatchScript,                                              # explicit
    (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "patch-apiproxy-exposure.ps1"), # beside this installer
    "E:\AIProjects\workspace\dsh-desktop\scripts\patch-apiproxy-exposure.ps1"
  ) | Where-Object { $_ -and (Test-Path $_) }
  $patchScript = $candidates | Select-Object -First 1
  if ($patchScript) {
    Write-Host "==> applying host-apiproxy exposure extension ($patchScript)"
    & powershell -ExecutionPolicy Bypass -File $patchScript -Runtime $RuntimePath
    if ($LASTEXITCODE -ne 0) { throw "host-apiproxy exposure patch failed" }
  } else {
    Write-Host "  [warn] patch-apiproxy-exposure.ps1 not found; run it manually against: $RuntimePath"
  }
} else {
  Write-Host "  [skip] -RuntimePath not given; the host-apiproxy exposure extension was not touched"
  Write-Host "         (required for the MCP section to read/write its settings namespace)"
}

# --- done --------------------------------------------------------------------
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "== done. Restart the desktop app once, then refresh the Web UI: settings -> MCP."
