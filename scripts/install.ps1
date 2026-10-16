# dsh-tun-proxy — 安装到 DSH profile
#
# 把一个本地插件目录注册进 DSH profile：
#   1. 备份 package.json
#   2. 加一条 file: 依赖
#   3. 把包名加进 dsh.profile.bundles
#   4. 在该 profile 目录里跑 pnpm install
#
# 用法（在插件目录下）：
#   powershell -ExecutionPolicy Bypass -File scripts/install.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -PluginPath D:\path\to\dsh-tun-proxy
#   powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -SkipPnpm   # 只改配置不装依赖
#
# 装完后需要重启 DSH 才会加载插件（工具名：tun_proxy_*）。

[CmdletBinding()]
param(
  [string]$PluginPath,
  [string]$ProfileDir = $env:DSH_PROFILE_DIR,
  [switch]$SkipPnpm
)

$ErrorActionPreference = 'Stop'

# $PSScriptRoot is not reliable in param() defaults on Windows PowerShell 5.1.
if (-not $PluginPath -or $PluginPath.Trim() -eq '') {
  $PluginPath = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
}
if (-not $ProfileDir -or $ProfileDir.Trim() -eq '') {
  $ProfileDir = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
}
$ProfileDir = (Resolve-Path -LiteralPath $ProfileDir).Path
$PluginPath = (Resolve-Path -LiteralPath $PluginPath).Path
$packageJsonPath = Join-Path $ProfileDir 'package.json'

if (-not (Test-Path -LiteralPath $packageJsonPath)) {
  throw "找不到 profile 的 package.json：$packageJsonPath"
}
if (-not (Test-Path -LiteralPath (Join-Path $PluginPath 'package.json'))) {
  throw "PluginPath 不像一个插件包：$PluginPath"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item -LiteralPath $packageJsonPath -Destination "$packageJsonPath.bak-tun-proxy-$stamp" -Force
Write-Host "已备份：$packageJsonPath.bak-tun-proxy-$stamp"

$raw = Get-Content -LiteralPath $packageJsonPath -Raw -Encoding UTF8
$json = $raw | ConvertFrom-Json

if (-not $json.dependencies) {
  $json | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) -Force
}
$spec = 'file:' + ($PluginPath -replace '\\', '/')
$json.dependencies | Add-Member -NotePropertyName 'dsh-tun-proxy' -NotePropertyValue $spec -Force

if (-not $json.dsh) {
  $json | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{ profile = [pscustomobject]@{ bundles = @() } }) -Force
}
if (-not $json.dsh.profile) {
  $json.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{ bundles = @() }) -Force
}
$bundles = @($json.dsh.profile.bundles)
if ($bundles -notcontains 'dsh-tun-proxy') {
  $bundles += 'dsh-tun-proxy'
}
$json.dsh.profile.bundles = $bundles

# Windows PowerShell 5.1's Set-Content -Encoding UTF8 adds a BOM, which
# DSH's JSON.parse rejects before it can load any plugins.
[System.IO.File]::WriteAllText($packageJsonPath, ($json | ConvertTo-Json -Depth 12), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "已写入依赖 $spec 并加入 bundles"

if (-not $SkipPnpm) {
  # Install only this plugin's dependency tree; do not rewrite other DSH bundles.
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) { throw 'npm.cmd is required; install Node.js or use -SkipPnpm after preparing dependencies.' }
  Push-Location $PluginPath
  try {
    if ((Test-Path -LiteralPath 'package-lock.json') -or (Test-Path -LiteralPath 'npm-shrinkwrap.json')) {
      & $npm.Source ci --omit=dev --ignore-scripts --legacy-peer-deps --no-audit --no-fund
    }
    else {
      & $npm.Source install --omit=dev --ignore-scripts --legacy-peer-deps --no-audit --no-fund
    }
    if ($LASTEXITCODE -ne 0) { throw 'Plugin dependency installation failed.' }
    & node (Join-Path $PluginPath 'scripts\build-client.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Client panel build failed.' }
  }
  finally { Pop-Location }
  $link = [System.IO.Path]::GetFullPath((Join-Path $ProfileDir 'node_modules\dsh-tun-proxy'))
  $expectedParent = [System.IO.Path]::GetFullPath((Join-Path $ProfileDir 'node_modules'))
  if ((Split-Path -Parent $link) -ne $expectedParent) { throw 'Unexpected plugin installation target.' }
  $item = Get-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue
  if ($item) {
    $oldPackage = Get-Content -LiteralPath (Join-Path $link 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($oldPackage.name -ne 'dsh-tun-proxy') { throw 'The target belongs to another package.' }
    $backup = Join-Path $ProfileDir ('backup-tun-proxy-' + $stamp)
    if (Test-Path -LiteralPath $backup) { $backup += '-' + [Guid]::NewGuid().ToString('N') }
    Move-Item -LiteralPath $link -Destination $backup
    Write-Host "Previous plugin saved to $backup"
  }
  # A real package directory is required: symlinks resolve peers relative to
  # the source directory, outside DSH's profile and its shared dependencies.
  New-Item -ItemType Directory -Path $link -Force | Out-Null
  foreach ($entry in @('lib', 'web', 'scripts', 'cordis.patch.yml', 'package.json', 'LICENSE', 'README.md', 'README.en.md')) {
    Copy-Item -LiteralPath (Join-Path $PluginPath $entry) -Destination $link -Recurse
  }
  $dependenciesDir = Join-Path $link 'node_modules'
  New-Item -ItemType Directory -Path $dependenciesDir -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $PluginPath 'node_modules\yaml') -Destination $dependenciesDir -Recurse
  Write-Host "Installed proxy center in $link"

}

Write-Host ''
Write-Host '完成。重启 DSH 后即可使用 tun_proxy_* 工具，或先跑：' -ForegroundColor Green
Write-Host "  node `"$PluginPath\scripts\cli.mjs`" status"
