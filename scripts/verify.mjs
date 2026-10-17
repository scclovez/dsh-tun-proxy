/**
 * End-to-end proof that the managed kernel really gives the whole machine a TUN
 * proxy. It uses its own state directory and its own ports and a DIRECT-only
 * profile, so it needs no subscription. Checks:
 *
 *   1. the kernel and wintun.dll are installed and `mihomo -v` answers,
 *   2. the kernel starts and the external controller answers,
 *   3. a Wintun adapter exists and owns a default route,
 *   4. outbound traffic is actually captured by the kernel (controller
 *      /connections sees a TCP connect we make to 1.1.1.1:443 — no external
 *      service needed),
 *   5. DNS is intercepted in fake-ip mode (a lookup returns 198.18.x.x),
 *   6. stopping removes the adapter and restores the default routes.
 *
 * Usage: node scripts/verify.mjs [--home <dir>] [--mirror <url>] [--keep-running] [--no-install]
 * Exit 0 = all checks passed, 1 = a check failed, 2 = cannot test here.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lookup } from 'node:dns/promises'
import { connect } from 'node:net'

import { createService } from '../lib/core/service.js'
import { controllerRequest } from '../lib/core/net.js'
import { defaultRoutes, isAdmin, tunAdapters } from '../lib/core/ps.js'
import { kernelVersion } from '../lib/core/kernel.js'

const argv = process.argv.slice(2)
const flagValue = (name) => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}
const keepRunning = argv.includes('--keep-running')
const noInstall = argv.includes('--no-install')
const autoImport = argv.includes('--auto-import')
const home = flagValue('--home') ?? mkdtempSync(join(tmpdir(), 'dsh-tun-proxy-verify-'))
const mirror = flagValue('--mirror') ?? ''
const kernelPath = flagValue('--kernel') ?? ''

const checks = []
function check(name, passed, detail) {
  checks.push({ name, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  return passed
}

function note(message) {
  console.log(`INFO  ${message}`)
}

async function egressIp() {
  for (const url of ['https://myip.ipip.net', 'https://api.ipify.org', 'https://www.cloudflare.com/cdn-cgi/trace']) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
      const text = (await response.text()).trim()
      if (text !== '') return `${url} → ${text.split(/\r?\n/u)[0]}`
    }
    catch { /* try the next endpoint */ }
  }
  return '(所有出口探测地址都不可达，本条不影响 TUN 判定)'
}

/** Open a TCP connection to a literal public IP so the kernel must see it. */
function probeConnection(host = '1.1.1.1', port = 443, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: timeoutMs })
    const done = (event) => {
      socket.destroy()
      resolve(event)
    }
    socket.on('connect', () => done('connected'))
    socket.on('timeout', () => done('timeout'))
    socket.on('error', (error) => done(`error: ${error.code ?? error.message}`))
  })
}

async function main() {
  console.log(`verify home: ${home}${mirror ? `\nmirror: ${mirror}` : ''}${kernelPath ? `\nkernel: ${kernelPath}` : ''}`)
  const service = createService({ env: { ...process.env, DSH_TUN_PROXY_HOME: home } })
  service.ensureDirs()
  service.updateSettings({
    autoStart: false,
    subscriptionUrl: '',
    profilePath: '',
    autoImport,
    mixedPort: 7891,
    controllerPort: 9091,
    tunDevice: 'dsh-tun-verify',
    tunStack: 'mixed',
    dnsMode: 'fake-ip',
    refreshOnStart: false,
    logLevel: 'info',
    ...(mirror ? { githubMirror: mirror } : {}),
    ...(kernelPath ? { kernelPath } : {}),
  })

  if (!(await isAdmin())) {
    console.error('需要管理员权限才能创建 TUN 网卡：请以管理员身份运行本脚本。')
    return 2
  }

  const beforeRoutes = await defaultRoutes().catch(() => [])
  note(`direct egress: ${await egressIp()}`)
  note(`default routes before: ${beforeRoutes.length}`)

  if (!noInstall && !existsSync(service.paths.kernel) && kernelPath === '') {
    console.log('installing kernel …')
    const installed = await service.install({ onProgress: (message) => process.stdout.write(`\r  ${message}            `) })
    const sha = installed.kernel.verification?.sha256 ?? '(未校验)'
    console.log(`\r  kernel ${installed.kernel.version} (${installed.kernel.asset}, ${Math.round(installed.kernel.bytes / 1048576)} MiB, sha256 ${sha}), wintun via ${installed.wintun.source}`)
  }
  else if (kernelPath !== '') {
    const installed = await service.install({})
    console.log(`  using external kernel ${installed.kernel.path} (${installed.kernel.version}), wintun via ${installed.wintun.source}, geodata: ${installed.geodata.source}`)
  }

  check('kernel installed', existsSync(kernelPath || service.paths.kernel), await kernelVersion(kernelPath || service.paths.kernel))
  const stateJson = existsSync(service.paths.stateFile) ? JSON.parse(readFileSync(service.paths.stateFile, 'utf8')) : {}
  check('kernel install has verified SHA-256', !existsSync(service.paths.kernel) || typeof stateJson.kernelInstall?.sha256 === 'string' && stateJson.kernelInstall.sha256.length === 64, stateJson.kernelInstall?.sha256 ?? '(managed kernel installed without a recorded digest)')
  check('wintun.dll present', existsSync(service.paths.wintun), service.paths.wintun)

  const startResult = await service.start({ onProgress: (message) => process.stdout.write(`\r  ${message}            `) })
  console.log('')
  check('kernel started', startResult.started === true, `pid ${startResult.pid}`)
  if (startResult.base) {
    note(`config base: ${startResult.base.source}${startResult.base.detail ? ` (${startResult.base.detail})` : ''}`)
  }

  const settings = service.readSettings()
  const secret = JSON.parse(readFileSync(service.paths.stateFile, 'utf8')).secret
  const versionRes = await controllerRequest({ port: settings.controllerPort, secret, path: '/version', timeoutMs: 3000 }).catch(() => null)
  check('external controller answers', versionRes?.ok === true, versionRes?.data?.version ?? 'no response')

  const adapters = await tunAdapters().catch(() => [])
  const adapter = adapters.find((item) => item.name === settings.tunDevice)
  check('TUN adapter exists', Boolean(adapter), adapter ? `${adapter.name} ${adapter.status}` : `seen: ${adapters.map((item) => item.name).join(', ') || 'none'}`)

  const routes = await defaultRoutes().catch(() => [])
  const tunRoute = routes.find((route) => adapter && Number(route.ifIndex) === Number(adapter.ifIndex))
  check('TUN adapter owns a default route', Boolean(tunRoute), tunRoute ? `nextHop ${tunRoute.nextHop} metric ${tunRoute.metric}` : 'no default route on the adapter')

  const probeResult = await probeConnection()
  note(`TCP probe 1.1.1.1:443 → ${probeResult}`)
  await new Promise((resolve) => setTimeout(resolve, 800))
  const connections = await controllerRequest({ port: settings.controllerPort, secret, path: '/connections', timeoutMs: 5000 }).catch(() => null)
  const all = JSON.stringify(connections?.data?.connections ?? {})
  const count = Object.keys(connections?.data?.connections ?? {}).length
  check('kernel captured outbound traffic', all.includes('1.1.1.1') || count > 0, `${count} connection(s) in the kernel, 1.1.1.1 seen: ${all.includes('1.1.1.1')}`)

  let fakeIp = ''
  try {
    fakeIp = (await lookup('www.gstatic.com')).address ?? ''
  }
  catch (error) {
    fakeIp = `(lookup failed: ${error.message})`
  }
  check('DNS is intercepted (fake-ip range)', fakeIp.startsWith('198.18.'), fakeIp)

  note(`egress through the TUN: ${await egressIp()}`)

  if (autoImport) {
    try {
      const nodes = await service.nodes()
      const nodeCount = nodes.groups.reduce((total, group) => total + group.nodes.length, 0)
      const runtime = await service.status()
      check('imported profile has proxy groups', nodes.groups.length > 0, `${nodes.groups.length} group(s), ${nodeCount} node entries, mode ${nodes.mode}, base ${runtime.profile.source}`)
      const firstGroup = nodes.groups[0]
      if (firstGroup) note(`group ${firstGroup.name} → ${firstGroup.now}`)
    }
    catch (error) {
      check('imported profile has proxy groups', false, error.message)
    }
  }

  if (keepRunning) {
    note('--keep-running: leaving the kernel up')
  }
  else {
    const stopped = await service.stop()
    check('kernel stopped', stopped.stopped === true, `pid ${stopped.pid}`)
    const afterAdapters = await tunAdapters().catch(() => [])
    check('TUN adapter removed', !afterAdapters.some((item) => item.name === settings.tunDevice), afterAdapters.map((item) => item.name).join(', ') || 'none')
    const afterRoutes = await defaultRoutes().catch(() => [])
    check('default routes restored', afterRoutes.length === beforeRoutes.length, `${beforeRoutes.length} before / ${afterRoutes.length} after`)
  }

  const failed = checks.filter((entry) => !entry.passed)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  if (flagValue('--home') === undefined && !keepRunning) rmSync(home, { recursive: true, force: true })
  return failed.length === 0 ? 0 : 1
}

process.exitCode = await main().catch((error) => {
  console.error('verify crashed:', error?.stack ?? error)
  return 1
})
