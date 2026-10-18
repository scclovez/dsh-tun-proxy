/**
 * GUI acceptance for docs/evidence/gui.json.
 *
 * Runs the real plugin inside an isolated DSH host (temporary DSH_HOME and
 * plugin state directory), renders the panel in headless Chromium, and drives
 * install / start / stop / uninstall through the exact same-origin HTTP
 * surface the panel itself calls. TUN and the Windows system proxy stay off;
 * the real proxy registry is only read, before and after, and must not change.
 *
 * Usage:
 *   node scripts/verify-gui.mjs "<DeepSeek Harness.exe>" ["<chrome.exe>"]
 *
 * Nothing under the user's profile or the real DSH profile is written.
 */
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const desktop = resolve(process.argv[2] ?? '')
assert.ok(existsSync(desktop) && /\.exe$/i.test(desktop), 'Pass the installed DeepSeek Harness.exe path')
const chrome = resolve(process.argv[3] ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
assert.ok(existsSync(chrome), `Chrome not found: ${chrome}`)

const root = fileURLToPath(new URL('../', import.meta.url))
const evidenceDir = join(root, 'docs/evidence')
mkdirSync(evidenceDir, { recursive: true })
const staging = mkdtempSync(join(tmpdir(), 'dsh-gui-audit-'))
const home = join(staging, 'home')
const stateDir = join(staging, 'state')
const pluginDir = join(staging, 'plugin')
const port = 17895
const base = `http://127.0.0.1:${port}`
let sessionCookie = ''

const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('DSH_')))
Object.assign(env, {
  ELECTRON_RUN_AS_NODE: '1',
  DSH_HOME: home,
  DSH_TUN_PROXY_HOME: stateDir,
})
const cli = join(dirname(desktop), 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js')

function run(args, { timeout = 120000 } = {}) {
  const result = spawnSync(desktop, [cli, ...args], { env, cwd: staging, windowsHide: true, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (result.error) throw new Error(`${result.error.message}\n${output}`.slice(-8000))
  if (result.status !== 0) throw new Error(`exit ${result.status}\n${output}`.slice(-8000))
  return (result.stdout ?? '').trim()
}

function proxyRegistry() {
  const out = spawnSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'], { encoding: 'utf8', windowsHide: true }).stdout ?? ''
  const value = (name) => {
    const line = out.split(/\r?\n/u).find((row) => row.trim().startsWith(name))
    return line === undefined ? null : line.trim().split(/\s{2,}/u).at(-1)
  }
  return { enable: value('ProxyEnable'), server: value('ProxyServer'), bypass: value('ProxyOverride'), pac: value('AutoConfigURL') }
}

function chromeRun(url, { screenshot = '', dom = false, profile = '' } = {}) {
  const args = [
    '--headless', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', `--user-data-dir=${profile === '' ? join(staging, `chrome-${Date.now()}`) : profile}`,
    '--window-size=1440,1800', '--virtual-time-budget=6000',
  ]
  if (screenshot !== '') args.push(`--screenshot=${screenshot}`)
  if (dom) args.push('--dump-dom')
  args.push(url)
  const result = spawnSync(chrome, args, { windowsHide: true, encoding: 'utf8', timeout: 90000, maxBuffer: 32 * 1024 * 1024 })
  if (screenshot !== '' && !existsSync(screenshot)) throw new Error(`headless Chrome wrote no screenshot: ${result.stderr ?? ''}`.slice(-4000))
  if (dom) return String(result.stdout ?? '')
  return ''
}

async function getPath(path) {
  const response = await fetch(base + path, { headers: authHeaders({ origin: base }) })
  return { status: response.status, type: response.headers.get('content-type') ?? '', body: await response.text() }
}

/** Every state/action call carries the browser-session cookie minted from the launch token. */
function authHeaders(extra = {}) {
  return sessionCookie === '' ? extra : { ...extra, cookie: sessionCookie }
}

/**
 * Exchange the process launch token printed by `dsh web` for the signed
 * browser-session cookie the Host Connection service requires.
 */
async function login(token) {
  const response = await fetch(`${base}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' })
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
  const minted = cookies.find((value) => value.startsWith('dsh-auth-'))
  assert.ok(minted, `launch token must mint a browser-session cookie (got HTTP ${response.status})`)
  sessionCookie = minted.split(';')[0]
  return { status: response.status, cookieName: sessionCookie.split('=')[0] }
}

/** Raw socket request: proves a missing Host header (HTTP/1.0) is refused. */
function rawRequest(line, headerLines = []) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    let data = ''
    socket.setTimeout(15000, () => { socket.destroy(); reject(new Error('raw request timed out')) })
    socket.on('connect', () => socket.write([line, ...headerLines, '', ''].join('\r\n')))
    socket.on('data', (chunk) => { data += String(chunk) })
    socket.on('end', () => resolve(data))
    socket.on('error', reject)
  })
}

async function action(name, body = {}, { attempts = 3 } = {}) {
  let last = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(`${base}/tun-proxy/action`, {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json', origin: base, 'sec-fetch-site': 'same-origin' }),
        body: JSON.stringify({ ...body, action: name }),
      })
      const json = await response.json()
      if (!response.ok || json.ok !== true) throw new Error(`${name}: HTTP ${response.status} ${json.error ?? ''}`)
      return json.result
    }
    catch (error) {
      last = error
      if (attempt < attempts) await new Promise((done) => setTimeout(done, 500))
    }
  }
  throw last
}

async function waitForState(predicate, { timeoutMs = 60000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    try {
      const value = await action('status', { verbose: true })
      last = value
      if (predicate(value)) return value
    }
    catch { /* server not ready yet */ }
    await new Promise((done) => setTimeout(done, intervalMs))
  }
  throw new Error(`timeout waiting for state; last=${JSON.stringify(last).slice(0, 800)}`)
}

const report = {
  checkedAt: new Date().toISOString(),
  hostVersion: '',
  runnerNode: process.version,
  staging,
  port,
  realSystemProxyModified: false,
  tunEnabled: false,
  checks: {},
  details: {},
}

let server = null
const logs = []
const rawLogs = []
const startedAt = Date.now()
const profileFile = join(staging, 'acceptance-profile.yaml')
writeFileSync(profileFile, [
  'mixed-port: 17892',
  'mode: rule',
  'proxies:',
  '  - { name: acceptance-socks, type: socks5, server: 127.0.0.1, port: 17893 }',
  'proxy-groups:',
  '  - { name: ACCEPT, type: select, proxies: [acceptance-socks] }',
  'rules:',
  '  - MATCH,ACCEPT',
  '',
].join('\n'))

try {
  report.hostVersion = run(['--version'])
  report.details.hostVersionOutput = report.hostVersion

  mkdirSync(pluginDir)
  cpSync(join(root, 'lib'), join(pluginDir, 'lib'), { recursive: true })
  cpSync(join(root, 'web'), join(pluginDir, 'web'), { recursive: true })
  writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({ name: 'dsh-tun-proxy-gui-audit', version: '0.3.1', type: 'module' }))
  const runtime = join(dirname(desktop), 'resources/app.asar/dsh/node_modules')
  cpSync(join(root, 'node_modules/yaml'), join(pluginDir, 'node_modules/yaml'), { recursive: true })
  for (const name of ['schemastery', 'dsh-tools', 'dsh-typert-protocol']) {
    const dir = join(pluginDir, 'node_modules/@deepseek-ai', name)
    mkdirSync(dir, { recursive: true })
    const entry = spawnSync(desktop, ['-e', `console.log(require.resolve(${JSON.stringify('@deepseek-ai/' + name)}, {paths:[${JSON.stringify(runtime)}]}))`], { env, windowsHide: true, encoding: 'utf8', timeout: 15000 })
    assert.equal(entry.status, 0, entry.stderr ?? '')
    const url = pathToFileURL(entry.stdout.trim()).href
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }))
    writeFileSync(join(dir, 'index.js'), `export * from ${JSON.stringify(url)};\n` + (name === 'schemastery' ? `export { default } from ${JSON.stringify(url)};\n` : ''))
  }

  const overlay = join(staging, 'gui-audit.yml')
  writeFileSync(overlay, `- insert:\n    - id: tun-proxy-gui-audit\n      name: ${join(pluginDir, 'lib/index.js').replaceAll('\\', '/')}\n      config:\n        autoStart: false\n`)
  const composed = run(['--profile', 'audit', '--from-default-profile', 'web', '--patch', overlay, '--dump-config'])
  assert.ok(composed.includes('tun-proxy-gui-audit'), 'audit profile must compose the plugin')

  server = spawn(desktop, [cli, '--profile', 'audit', '--patch', overlay, '--host', '127.0.0.1', '--port', String(port), '--no-open'], { env, cwd: staging, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  report.details.serverPid = server.pid ?? null
  server.on('exit', (code, signal) => { logs.push(`SERVER EXIT code=${code} signal=${signal}`) })
  server.on('error', (error) => { logs.push(`SERVER ERROR ${error?.message ?? error}`) })
  const collect = (chunk) => {
    const text = String(chunk)
    rawLogs.push(text)
    if (rawLogs.length > 400) rawLogs.shift()
    logs.push(text.replace(/([?&]token=)[^\s&]+/gu, '$1<redacted>'))
    if (logs.length > 400) logs.shift()
  }
  server.stdout.on('data', collect)
  server.stderr.on('data', collect)

  // AUTH001: the launch token is the only way in; mint the browser cookie first.
  const announced = await (async () => {
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) {
      const match = /dsh web: (https?:\/\/[^\s]+\?token=([A-Za-z0-9_-]+))/u.exec(rawLogs.join(''))
      if (match !== null) return { url: match[1], token: match[2] }
      await new Promise((done) => setTimeout(done, 200))
    }
    throw new Error(`dsh web never printed a tokenised URL; log tail: ${logs.slice(-20).join('')}`)
  })()
  report.details.launch = { urlRedacted: announced.url.replace(/([?&]token=)[^\s&]+/gu, '$1<redacted>') }

  const unauthorised = await fetch(`${base}/tun-proxy/state`)
  const unauthorisedAction = await fetch(`${base}/tun-proxy/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ action: 'stop' }),
  })
  const noHost = await rawRequest('GET /tun-proxy/state HTTP/1.0', [])
  const crossOrigin = await fetch(`${base}/tun-proxy/state`, { headers: { origin: 'http://evil.example' } })
  report.details.authBeforeLogin = {
    stateWithoutCredential: unauthorised.status,
    actionWithoutCredential: unauthorisedAction.status,
    http10WithoutHost: noHost.split('\r\n')[0],
    crossOriginStatus: crossOrigin.status,
  }
  assert.ok([401, 403].includes(unauthorised.status), 'state must require Host Connection authorization')
  assert.ok([401, 403].includes(unauthorisedAction.status), 'action must require Host Connection authorization')
  assert.match(noHost.split('\r\n')[0], /^HTTP\/1\.[01] 40[13]/u, 'HTTP/1.0 without Host must be refused')
  assert.equal(crossOrigin.status, 403)

  const session = await login(announced.token)
  report.details.login = session
  report.checks.authenticationEnforced = true

  await waitForState(() => true, { timeoutMs: 90000 })
  report.checks.hostMountedPlugin = true

  const panel = await getPath('/tun-proxy/panel')
  const assets = {}
  for (const path of ['/tun-proxy/panel.js', '/tun-proxy/panel-style.js', '/tun-proxy/select.js']) {
    const asset = await getPath(path)
    assets[path] = { status: asset.status, type: asset.type, bytes: asset.body.length }
    assert.equal(asset.status, 200, path)
    assert.ok(asset.type.includes('javascript'), path)
  }
  assert.equal(panel.status, 200)
  assert.ok(panel.body.includes('DSH 代理中心'))
  assert.ok(panel.body.includes('mountPanel'))
  report.checks.panelAssets = true
  report.details.panel = { status: panel.status, bytes: panel.body.length, assets }

  const initial = await action('status', { verbose: true })
  assert.equal(initial.kernel.installed, false)
  report.checks.initialState = true
  report.details.initialKernel = { installed: initial.kernel.installed, version: initial.kernel.version }

  const registryBefore = proxyRegistry()
  report.details.registryBefore = registryBefore

  const saved = await action('set', { patch: {
    tunEnable: false, systemProxy: false, autoStart: false, stopOnExit: false,
    mixedPort: 17892, controllerPort: 19092, dnsListen: '127.0.0.1:18531',
    profilePath: profileFile, logLevel: 'debug',
  } })
  assert.equal(saved.mixedPort, 17892)
  assert.equal(saved.controllerPort, 19092)
  assert.equal(saved.tunEnable, false)
  assert.equal(saved.systemProxy, false)
  assert.equal(saved.profilePath, profileFile)
  const persisted = JSON.parse(readFileSync(join(stateDir, 'settings.json'), 'utf8'))
  assert.equal(persisted.mixedPort, 17892)
  assert.equal(persisted.profilePath, profileFile)
  report.checks.settingsSaved = true
  report.details.savedSettings = { mixedPort: saved.mixedPort, controllerPort: saved.controllerPort, tunEnable: saved.tunEnable, systemProxy: saved.systemProxy, profilePath: saved.profilePath }

  const installed = await action('install')
  assert.equal(installed.kernel.verification?.verified, true)
  assert.match(installed.kernel.version, /^v1\.19\.32/u)
  assert.equal(installed.wintun?.verified, true)
  assert.equal(installed.wintun?.dll?.sha256, 'e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce')
  let status = await action('status', { verbose: true })
  assert.equal(status.kernel.installed, true)
  assert.match(status.kernel.version, /^v1\.19\.32/u)
  assert.match(status.kernel.sha256, /^[a-f0-9]{64}$/u)
  assert.equal(status.wintun.sha256, 'e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce')
  report.checks.kernelInstalled = true
  report.details.kernel = { version: status.kernel.version, sha256: status.kernel.sha256, tag: status.kernel.tag, wintunSha256: status.wintun.sha256, bytes: installed.kernel.bytes, downloadUrl: installed.kernel.downloadUrl }

  const panelPng = join(evidenceDir, 'gui-panel.png')
  // The browser needs its own cookie, minted through the same token redirect.
  // --dump-dom also makes headless Chrome exit after the redirect completes.
  const chromeProfile = join(staging, 'chrome-auth')
  chromeRun(`${base}/?token=${encodeURIComponent(announced.token)}`, { profile: chromeProfile, dom: true })
  const panelDom = chromeRun(`${base}/tun-proxy/panel`, { screenshot: panelPng, dom: true, profile: chromeProfile })
  for (const marker of ['代理中心', '内核', 'v1.19.32']) assert.ok(panelDom.includes(marker), `panel DOM must contain ${marker}`)
  report.checks.panelRendered = true
  report.details.panelRender = { screenshot: 'docs/evidence/gui-panel.png', bytes: panelDom.length }

  const started = await action('start')
  status = await waitForState((value) => value.running === true && value.controller?.ready === true, { timeoutMs: 60000 })
  assert.equal(status.running, true)
  assert.equal(status.controller.ready, true)
  assert.match(status.controller.version ?? '', /v1\.19\.32/u)
  report.checks.startedThroughPanelApi = true
  report.details.start = { running: status.running, controllerReady: status.controller.ready, controllerVersion: status.controller.version, pid: status.pid, mixedPort: 17892, startResult: { version: started.kernel?.version ?? '' } }

  const runningPng = join(evidenceDir, 'gui-panel-running.png')
  const runningDom = chromeRun(`${base}/tun-proxy/panel`, { screenshot: runningPng, dom: true, profile: chromeProfile })
  assert.ok(runningDom.includes('运行中'), 'running panel must show 运行中')
  assert.ok(runningDom.includes('v1.19.32'))
  report.checks.runningPanelRendered = true
  report.details.panelRenderRunning = { screenshot: 'docs/evidence/gui-panel-running.png', bytes: runningDom.length }

  const stopped = await action('stop')
  status = await waitForState((value) => value.running === false, { timeoutMs: 30000 })
  assert.equal(status.running, false)
  report.checks.stopped = true
  report.details.stop = stopped

  const removed = await action('uninstall', { purge: true })
  assert.equal(removed.purged, true)
  assert.equal(existsSync(join(stateDir, 'bin', 'mihomo.exe')), false)
  const afterUninstall = await action('status', { verbose: true })
  assert.equal(afterUninstall.kernel.installed, false)
  report.checks.uninstalled = true
  report.details.uninstall = { purged: removed.purged, kernelInstalled: afterUninstall.kernel.installed, removed }

  const registryAfter = proxyRegistry()
  report.details.registryAfter = registryAfter
  assert.deepEqual(registryAfter, registryBefore, 'isolated run must not modify the real Windows proxy registry')
  report.checks.realSystemProxyUntouched = true
} catch (error) {
  report.error = String(error?.stack ?? error).slice(-6000)
  process.exitCode = 1
} finally {
  if (server !== null && server.pid !== undefined) {
    spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' })
  }
  report.durationMs = Date.now() - startedAt
  report.serverLogTail = logs.slice(-100).join('')
  writeFileSync(join(evidenceDir, 'gui.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
