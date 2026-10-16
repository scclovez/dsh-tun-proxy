/**
 * Windows helpers. Everything that needs the OS (elevation, adapters, routes,
 * process termination) goes through PowerShell so the plugin stays dependency
 * free and behaviour is the same whether DSH runs elevated or not.
 */
import { execFile } from 'node:child_process'

const PS = 'powershell.exe'

export function runPs(script, { timeoutMs = 30000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      PS,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, cwd },
      (error, stdout, stderr) => {
        if (error) {
          error.message = `${error.message}\n${String(stderr).trim()}`
          reject(error)
          return
        }
        resolve(String(stdout).trim())
      },
    )
  })
}

export async function isAdmin() {
  const out = await runPs(
    '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
  )
  return /^true$/iu.test(out)
}

/** Wintun TUN adapters currently present, with their default-route state. */
export async function tunAdapters() {
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$adapters = @(Get-NetAdapter | Where-Object { $_.InterfaceDescription -like 'Wintun*' -or $_.Name -like 'Mihomo*' -or $_.Name -like 'dsh-tun*' -or $_.Name -like 'meta*' })",
    '$list = foreach ($a in $adapters) {',
    '  $routes = @(Get-NetRoute -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -DestinationPrefix "0.0.0.0/0" | Select-Object -ExpandProperty NextHop)',
    '  [pscustomobject]@{ name = $a.Name; description = $a.InterfaceDescription; status = [string]$a.Status; ifIndex = $a.ifIndex; defaultRouteVia = $routes }',
    '}',
    'ConvertTo-Json -InputObject @($list) -Depth 4 -Compress',
  ].join('\n')
  const out = await runPs(script, { timeoutMs: 20000 })
  return parseJsonArray(out)
}

/** Default IPv4 routes of the whole machine, for "is TUN really first?" checks. */
export async function defaultRoutes() {
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    '$r = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix "0.0.0.0/0" | Select-Object @{n=\'nextHop\';e={$_.NextHop}}, @{n=\'metric\';e={$_.RouteMetric}}, @{n=\'ifIndex\';e={$_.ifIndex}}, @{n=\'alias\';e={$_.InterfaceAlias}})',
    'ConvertTo-Json -InputObject @($r) -Depth 4 -Compress',
  ].join('\n')
  const out = await runPs(script, { timeoutMs: 20000 })
  return parseJsonArray(out)
}

/** Kill a process tree; returns true when the pid is gone afterwards. */
export async function killTree(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  await runPs(`taskkill /PID ${pid} /T /F | Out-Null`, { timeoutMs: 20000 }).catch(() => {})
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!processAlive(pid)) return true
    await sleep(250)
  }
  return !processAlive(pid)
}

export function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  }
  catch (error) {
    return error?.code === 'EPERM'
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseJsonArray(out) {
  const text = String(out ?? '').trim()
  if (text === '' || text === 'null') return []
  try {
    const value = JSON.parse(text)
    if (Array.isArray(value)) return value
    return value === null ? [] : [value]
  }
  catch {
    return []
  }
}
