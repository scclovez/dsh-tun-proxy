/**
 * Windows helpers.
 *
 * Everything here is answered by native tools (whoami / net / netsh / ipconfig /
 * tasklist / taskkill) instead of PowerShell, because on a real machine a bare
 * `powershell.exe -Command 1` costs ~2 s and the WMI cmdlets used before cost
 * 3–7 s each (Get-NetAdapter 6.7 s, Get-NetRoute 3.7 s), while these answer in
 * 70–300 ms. PowerShell is kept only as a last-resort fallback and for callers
 * that genuinely need it (`runPs`, used by the system-proxy notification).
 *
 * Measured on the author's machine (elevated Windows 10, mihomo TUN running):
 *   powershell -Command 1 .......... 1955 ms      netsh ipv4 interfaces .... 135 ms
 *   Get-NetAdapter + Get-NetRoute .. 6680 ms      ipconfig /all ............. 69 ms
 *   Get-NetRoute 0.0.0.0/0 ......... 3688 ms      tasklist ................. 150 ms
 *   Get-CimInstance Win32_Process .. ~2500 ms     taskkill ................. 148 ms
 */
import { execFile, execFileSync } from 'node:child_process'
import { closeSync, openSync, unlinkSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

const PS = 'powershell.exe'
const IS_WINDOWS = process.platform === 'win32'

/** Run a native command. Resolves with the exit code instead of rejecting on failure. */
function run(file, args, { timeoutMs = 20000, maxBuffer = 8 * 1024 * 1024, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer, encoding: raw ? 'buffer' : 'utf8' }, (error, stdout, stderr) => {
      if (error && error.code === 'ENOENT') {
        reject(new Error(`${file} 不可用：${error.message}`))
        return
      }
      resolve({
        code: typeof error?.code === 'number' ? error.code : 0,
        buffer: raw ? Buffer.from(stdout ?? Buffer.alloc(0)) : Buffer.alloc(0),
        stdout: raw ? '' : String(stdout ?? ''),
        stderr: String(stderr ?? ''),
      })
    })
  })
}

/**
 * PowerShell escape hatch. Kept for the system-proxy notification (Add-Type is
 * the only way to broadcast the settings change) and as a fallback path.
 */
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

// ── elevation ────────────────────────────────────────────────────────────────

let adminPromise = null

/**
 * Is this process elevated? Cached for the process lifetime — an elevation
 * change cannot happen mid-process, and the check is only needed once.
 */
export function isAdmin() {
  if (!IS_WINDOWS) return Promise.resolve(false)
  adminPromise ??= detectAdmin()
  return adminPromise
}

async function detectAdmin() {
  // 1) Cheapest and independent of running services: System32 is writable by an
  //    elevated token only. ~1 ms.
  const probe = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', `dsh-tun-probe-${randomBytes(4).toString('hex')}.tmp`)
  try {
    closeSync(openSync(probe, 'wx'))
    try { unlinkSync(probe) } catch { /* leftover probe is harmless */ }
    return true
  }
  catch (error) {
    if (error?.code === 'EACCES' || error?.code === 'EPERM') return false
  }
  // 2) whoami /groups: a high integrity level (S-1-16-12288) means elevated.
  try {
    const { stdout, code } = await run('whoami.exe', ['/groups'])
    if (code === 0) {
      if (/S-1-16-(12288|16384)/u.test(stdout)) return true
      const line = stdout.split(/\r?\n/u).find((entry) => entry.includes('S-1-5-32-544'))
      if (line !== undefined) return /enabled group/iu.test(line) && !/deny only/iu.test(line)
      return false
    }
  }
  catch { /* fall through */ }
  // 3) net session needs the Server service, but is still far cheaper than WMI.
  try {
    const { code } = await run('net.exe', ['session'])
    return code === 0
  }
  catch { /* fall through */ }
  // 4) PowerShell, last resort.
  try {
    const out = await runPs('([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)')
    return /^true$/iu.test(out)
  }
  catch {
    return false
  }
}

// ── interfaces / routes ──────────────────────────────────────────────────────

/** `netsh interface ipv4 show interfaces` → [{ ifIndex, metric, mtu, up, name }] (~135 ms). */
async function netInterfaces() {
  const { stdout, code } = await run('netsh.exe', ['interface', 'ipv4', 'show', 'interfaces'])
  if (code !== 0) return []
  const list = []
  for (const raw of stdout.split(/\r?\n/u)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('---') || /^Idx\b/iu.test(line)) continue
    const parts = line.split(/\s{2,}/u)
    if (parts.length < 5) continue
    const ifIndex = Number(parts[0])
    if (!Number.isSafeInteger(ifIndex)) continue
    list.push({
      ifIndex,
      metric: Number(parts[1]),
      mtu: Number(parts[2]),
      up: /^connected$/iu.test(parts[3]),
      name: parts.slice(4).join('  ').trim(),
    })
  }
  return list
}

/**
 * `ipconfig /all` → Map(adapter name → description), e.g. dsh-tun → "Meta Tunnel" (~69 ms).
 * The output language *and* codepage are not stable: on a zh-CN machine the
 * labels may come out as GBK-encoded Chinese, so the text is decoded as UTF-8
 * first and retried as GBK when no label matched. When both fail the map stays
 * empty and callers fall back to matching the adapter name.
 */
async function netAdapterDescriptions() {
  const HEADER = /^.*?(?:adapter|适配器)\s+(.+?):$/u
  const DESCRIPTION = /^(?:Description|描述)[\s.·]*:\s*(.+)$/u
  const parse = (text) => {
    const descriptions = new Map()
    let current = ''
    for (const raw of text.split(/\r?\n/u)) {
      const line = raw.trim()
      const header = HEADER.exec(line)
      if (header !== null && !line.includes(' . ')) {
        current = header[1].trim()
        continue
      }
      const description = DESCRIPTION.exec(line)
      if (description !== null && current !== '') descriptions.set(current, description[1].trim())
    }
    return descriptions
  }
  try {
    const { buffer } = await run('ipconfig.exe', ['/all'], { raw: true })
    let descriptions = parse(new TextDecoder('utf-8').decode(buffer))
    if (descriptions.size === 0) {
      try {
        const gbk = new TextDecoder('gbk').decode(buffer)
        if (gbk !== '') descriptions = parse(gbk)
      }
      catch { /* decoder unavailable: keep the UTF-8 attempt */ }
    }
    return descriptions
  }
  catch {
    return new Map()
  }
}

/** `netsh interface ipv4 show route` → [{ prefix, ifIndex, metric, gatewayOrName }] (~150 ms). */
async function netRoutes() {
  const { stdout, code } = await run('netsh.exe', ['interface', 'ipv4', 'show', 'route'])
  if (code !== 0) return []
  const list = []
  for (const raw of stdout.split(/\r?\n/u)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('---') || /^Publish\b/iu.test(line)) continue
    const parts = line.split(/\s{2,}/u)
    if (parts.length < 5) continue
    const ifIndex = Number(parts[4])
    if (!Number.isSafeInteger(ifIndex)) continue
    list.push({
      prefix: parts[3],
      ifIndex,
      metric: Number(parts[2]),
      gatewayOrName: parts[5] ?? '',
    })
  }
  return list
}

const TUN_NAME = /^(dsh-tun|mihomo|meta|clash|sing-box|wintun|utun|tun)/iu
const TUN_DESCRIPTION = /wintun|meta tunnel|wireguard|sing-box|clash|mihomo|tunnel/iu

/**
 * TUN adapters currently present. Name/state/ifIndex come from netsh, the
 * Wintun-ness comes from the ipconfig description, so renamed adapters are
 * still recognised. `defaultRouteVia` is empty unless `withRoutes` is set —
 * callers that already have routes should join them locally to save a call.
 */
export async function tunAdapters({ withRoutes = false } = {}) {
  if (!IS_WINDOWS) return []
  const [interfaces, descriptions] = await Promise.all([netInterfaces(), netAdapterDescriptions()])
  const adapters = interfaces
    .filter((item) => TUN_NAME.test(item.name) || TUN_DESCRIPTION.test(descriptions.get(item.name) ?? ''))
    .map((item) => ({
      name: item.name,
      description: descriptions.get(item.name) ?? item.name,
      status: item.up ? 'Up' : 'Disconnected',
      ifIndex: item.ifIndex,
      defaultRouteVia: [],
    }))
  if (withRoutes) {
    const routes = await defaultRoutes().catch(() => [])
    for (const adapter of adapters) {
      adapter.defaultRouteVia = routes
        .filter((route) => Number(route.ifIndex) === Number(adapter.ifIndex))
        .map((route) => route.nextHop)
    }
  }
  return adapters
}

/** Default IPv4 routes of the whole machine, for "is TUN really first?" checks. (~300 ms) */
export async function defaultRoutes() {
  if (!IS_WINDOWS) return []
  const [routes, interfaces] = await Promise.all([netRoutes(), netInterfaces()])
  const names = new Map(interfaces.map((item) => [String(item.ifIndex), item.name]))
  return routes
    .filter((route) => route.prefix === '0.0.0.0/0')
    .map((route) => ({
      nextHop: route.gatewayOrName,
      metric: route.metric,
      ifIndex: route.ifIndex,
      alias: names.get(String(route.ifIndex)) ?? route.gatewayOrName,
    }))
}

/** PID listening on this TCP port, or '' when nothing is listening. (~32 ms) */
export async function portOwner(port) {
  if (!IS_WINDOWS || !Number.isSafeInteger(port) || port <= 0) return ''
  try {
    const { stdout, code } = await run('netstat.exe', ['-ano', '-p', 'tcp'])
    if (code !== 0) return ''
    const suffix = `:${port}`
    for (const raw of stdout.split(/\r?\n/u)) {
      const cells = raw.trim().split(/\s+/u)
      if (cells.length < 5 || !/^LISTENING$/iu.test(cells[3])) continue
      if (!cells[1].endsWith(suffix)) continue
      const pid = Number(cells[4])
      if (Number.isSafeInteger(pid) && pid > 0) return String(pid)
    }
  }
  catch { /* treat as unknown */ }
  return ''
}

// ── processes ────────────────────────────────────────────────────────────────

/** PIDs of every process with this image name (e.g. "mihomo.exe"). ~150 ms */
export async function listImagePids(imageName) {
  if (!IS_WINDOWS || typeof imageName !== 'string' || imageName === '') return []
  try {
    const { stdout } = await run('tasklist.exe', ['/fi', `imagename eq ${imageName}`, '/fo', 'csv', '/nh'])
    const pids = []
    for (const raw of stdout.split(/\r?\n/u)) {
      const line = raw.trim()
      if (line === '' || line.startsWith('INFO:')) continue
      const cells = line.split('","').map((cell) => cell.replace(/^"|"$/gu, ''))
      const pid = Number(cells[1])
      if (Number.isSafeInteger(pid) && pid > 0) pids.push(pid)
    }
    return pids
  }
  catch {
    return []
  }
}

/** Kill a process tree; returns true when the pid is gone afterwards. */
export async function killTree(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  await run('taskkill.exe', ['/PID', String(pid), '/T', '/F']).catch(() => {})
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

/**
 * Synchronous variants for shutdown hooks: while DSH quits the event loop may
 * not get another turn, so these must not await anything.
 */
export function listImagePidsSync(imageName) {
  if (!IS_WINDOWS || typeof imageName !== 'string' || imageName === '') return []
  try {
    const stdout = execFileSync('tasklist.exe', ['/fi', `imagename eq ${imageName}`, '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 5000, encoding: 'utf8' })
    const pids = []
    for (const raw of String(stdout).split(/\r?\n/u)) {
      const line = raw.trim()
      if (line === '' || line.startsWith('INFO:')) continue
      const pid = Number(line.split('","')[1]?.replace(/"/gu, ''))
      if (Number.isSafeInteger(pid) && pid > 0) pids.push(pid)
    }
    return pids
  }
  catch {
    return []
  }
}

export function killTreeSync(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 8000, stdio: 'ignore' })
  }
  catch { /* already gone */ }
  return !processAlive(pid)
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
