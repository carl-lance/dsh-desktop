# Prepare the packaged Node runtime for the Tauri sidecar.
# Produces:
#   src-tauri/resources/dsh-runtime/  <- npm install of @deepseek-ai/dsh (flat, no symlinks)
#   src-tauri/resources/node.exe      <- Node 22 runtime binary
param(
  [string]$Version = "0.1.0-rc.6"
)
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$res = Join-Path $root "src-tauri\resources"
$runtime = Join-Path $res "dsh-runtime"

New-Item -ItemType Directory -Force -Path $res | Out-Null
if (Test-Path $runtime) { Remove-Item -Recurse -Force $runtime }

Write-Host "==> npm install @deepseek-ai/dsh@$Version -> $runtime"
npm install --prefix $runtime "@deepseek-ai/dsh@$Version" --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Write-Host "==> copy node.exe -> $res"
Copy-Item (Get-Command node).Source (Join-Path $res "node.exe") -Force

# Trim: drop dev-only junk that npm dragged in (types, tests, maps) to keep the bundle lean.
Write-Host "==> trimming *.map / *.ts / *.d.ts (typescript, @types kept)"
$nodeModules = Join-Path $runtime "node_modules"
Get-ChildItem $nodeModules -Recurse -Include "*.map", "*.ts", "*.d.ts" -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch "node_modules\\typescript|node_modules\\@types" } |
  Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host "==> done"
$size = (Get-ChildItem $res -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Host ("    runtime size: {0:N1} MB" -f ($size / 1MB))
