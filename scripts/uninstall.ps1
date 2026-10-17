# dsh-tun-proxy — 从 DSH profile 卸载
#
#   1. 先停掉内核（如果这个插件拉起来的）
#   2. 从 package.json 移除 file: 依赖与 bundles 条目
#   3. 保留已安装副本以便恢复，重启 DSH 卸载面板
#   4. 可选 -PurgeState：删除 <DSH_HOME>\tun-proxy 整个状态目录
#
#   powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1 -PurgeState

[CmdletBinding()]
param(
  [string]$PluginPath,
  [string]$ProfileDir = $env:DSH_PROFILE_DIR,
  [string]$StateDir = $env:DSH_TUN_PROXY_HOME,
  [switch]$PurgeState,
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
if (-not $StateDir -or $StateDir.Trim() -eq '') {
  $home0 = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
  $StateDir = Join-Path $home0 'tun-proxy'
}

Write-Host 'Stopping only the kernel owned by this plugin...'
if ($PurgeState) {
  $purgeTarget = [System.IO.Path]::GetFullPath($StateDir).TrimEnd('\')
  $dshRoot = if ($env:DSH_HOME) { [System.IO.Path]::GetFullPath($env:DSH_HOME) } else { Join-Path $env:USERPROFILE '.dsh' }
  foreach ($protectedRoot in @($env:USERPROFILE, $dshRoot, $ProfileDir, $PluginPath)) {
    $protectedPath = [System.IO.Path]::GetFullPath($protectedRoot).TrimEnd('\')
    if ($protectedPath.Equals($purgeTarget, [StringComparison]::OrdinalIgnoreCase) -or $protectedPath.StartsWith($purgeTarget + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe StateDir: refusing to purge a user, DSH, profile or source root.' }
  }
  if ($purgeTarget.StartsWith($dshRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -and -not $purgeTarget.Equals((Join-Path $dshRoot 'tun-proxy'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe StateDir: refusing unrelated DSH data.' }
  if ((Test-Path -LiteralPath $StateDir) -and ((Get-Item -LiteralPath $StateDir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Refusing to purge a reparse-point StateDir.' }
}
$cli = Join-Path $PluginPath 'scripts\cli.mjs'
if ((Test-Path -LiteralPath (Join-Path $StateDir 'state.json')) -and (Test-Path -LiteralPath $cli)) {
  $previousStateDir = $env:DSH_TUN_PROXY_HOME
  try {
    $env:DSH_TUN_PROXY_HOME = $StateDir
    & node $cli stop
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop the owned proxy kernel; uninstall aborted.' }
  }
  finally { $env:DSH_TUN_PROXY_HOME = $previousStateDir }
}

$packageJsonPath = Join-Path $ProfileDir 'package.json'
if (Test-Path -LiteralPath $packageJsonPath) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  Copy-Item -LiteralPath $packageJsonPath -Destination "$packageJsonPath.bak-uninstall-tun-proxy-$stamp" -Force

  $json = Get-Content -LiteralPath $packageJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($json.dependencies -and $json.dependencies.PSObject.Properties.Name -contains 'dsh-tun-proxy') {
    $json.dependencies.PSObject.Properties.Remove('dsh-tun-proxy')
  }
  if ($json.dsh -and $json.dsh.profile -and $json.dsh.profile.bundles) {
    $json.dsh.profile.bundles = @($json.dsh.profile.bundles | Where-Object { $_ -ne 'dsh-tun-proxy' })
  }
  # Keep the manifest readable by DSH's strict JSON.parse on PowerShell 5.1.
  [System.IO.File]::WriteAllText($packageJsonPath, ($json | ConvertTo-Json -Depth 12), (New-Object System.Text.UTF8Encoding($false)))
  Write-Host '已从 profile 移除 dsh-tun-proxy'

  # The package is no longer loaded after its bundle entry is removed.
  # Keep the installed copy for recovery; never rewrite unrelated bundles.
  Write-Host 'Bundle removed. Restart DSH to unload the panel.'

}

if ($PurgeState -and (Test-Path -LiteralPath $StateDir)) {
  $resolved = (Resolve-Path -LiteralPath $StateDir).Path
  Write-Host "删除状态目录：$resolved"
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

Write-Host '完成。重启 DSH 生效。' -ForegroundColor Green
