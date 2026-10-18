/**
 * COMPAT001 evidence: install, activate and uninstall this exact package on the
 * installed official DSH build whose exact version the manifest declares.
 *
 * Everything runs in a throwaway DSH_HOME (`profiles/compat`) created by
 * `dsh plugin add` itself and a throwaway plugin state directory. The real
 * profile, the Windows system proxy and TUN are never touched.
 *
 * What is verified
 *   1. the installed host reports one of the versions declared `compatible`
 *      in this package.json — a mismatch fails instead of claiming support;
 *   2. `dsh plugin --profile compat add <tarball>` installs the packed package
 *      and records it as an active bundle in the profile manifest;
 *   3. the real host boots that profile, mounts the plugin (panel served, state
 *      route reachable) and the Host Connection gate answers the state request;
 *   4. `dsh plugin --profile compat remove` uninstalls it and the profile
 *      manifest no longer references the package.
 *
 * Rollback of an already-installed previous version is not exercised here and
 * therefore stays `unknown` in package.json.
 *
 * Usage:
 *   node scripts/verify-compatibility.mjs "<DeepSeek Harness.exe>"
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const desktop = resolve(process.argv[2] ?? '')
assert.ok(existsSync(desktop) && /\.exe$/i.test(desktop), 'Pass the installed DeepSeek Harness.exe path')

const root = fileURLToPath(new URL('../', import.meta.url))
const evidenceDir = join(root, 'docs/evidence')
mkdirSync(evidenceDir, { recursive: true })
const staging = mkdtempSync(join(tmpdir(), 'dsh-compat-audit-'))
const home = join(staging, 'home')
const stateDir = join(staging, 'state')
const profile = 'compat'
const profileDir = join(home, 'profiles', profile)
const port = 17897
const base = `http://127.0.0.1:${port}`

const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('DSH_')))
Object.assign(env, { ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home, DSH_TUN_PROXY_HOME: stateDir })
const cli = join(dirname(desktop), 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js')

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const declared = manifest.dsh?.compatibility ?? {}
const declaredCompatible = Object.entries(declared.dshReleases ?? {}).filter(([, status]) => status === 'compatible').map(([release]) => release)
assert.ok(declaredCompatible.length > 0, 'package.json must declare at least one exact compatible dsh release')

const report = {
  checkedAt: new Date().toISOString(),
  hostVersion: '',
  declaredCompatible,
  runnerNode: process.version,
  staging,
  isolatedHome: true,
  realProfileTouched: false,
  checks: {},
  details: {},
}

function run(args, { timeout = 300000 } = {}) {
  const result = spawnSync(desktop, [cli, ...args], { env, cwd: staging, windowsHide: true, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (result.error) throw new Error(`${result.error.message}\n${output}`.slice(-6000))
  if (result.status !== 0) throw new Error(`exit ${result.status}\n${output}`.slice(-6000))
  return (result.stdout ?? '').trim()
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function profileManifest() {
  return JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
}

function probeBundles() {
  const names = profileManifest()?.dsh?.profile?.bundles ?? []
  return { declared: names, includesPlugin: names.includes(manifest.name) }
}

async function waitFor(fn, { timeoutMs = 120000, intervalMs = 300 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value !== undefined) return value
    }
    catch (error) { last = error }
    await new Promise((done) => setTimeout(done, intervalMs))
  }
  throw new Error(`timeout: ${last?.message ?? 'condition never became true'}`)
}

let server = null
const rawLogs = []

try {
  // Refuse to run against the user's real home: this evidence must be isolated.
  const userHome = process.env.USERPROFILE ?? ''
  assert.ok(!home.toLowerCase().startsWith(join(userHome, '.dsh').toLowerCase()), 'isolated home must not be the real DSH home')

  report.hostVersion = run(['--version'])
  report.details.hostVersionOutput = report.hostVersion
  assert.ok(declaredCompatible.includes(report.hostVersion), `host ${report.hostVersion} is not declared compatible; got ${declaredCompatible.join(', ')}`)

  // 1. Pack the exact working tree; the tarball hash binds this evidence.
  //    Node refuses to spawn .cmd shims without a shell, so run npm's CLI with
  //    this Node binary and fall back to a shell only when it is not bundled.
  const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  const packArgs = ['pack', '--pack-destination', staging, '--silent']
  const pack = existsSync(npmCli)
    ? spawnSync(process.execPath, [npmCli, ...packArgs], { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 180000 })
    : spawnSync('npm', packArgs, { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 180000, shell: true })
  assert.equal(pack.status, 0, pack.stderr || pack.error?.message || 'npm pack failed')
  const tarball = join(staging, `${manifest.name}-${manifest.version}.tgz`)
  assert.ok(existsSync(tarball), 'npm pack must produce the plugin tarball')
  report.details.tarball = { path: tarball, sha256: sha256(tarball), bytes: readFileSync(tarball).length, version: manifest.version }
  report.details.gitHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).stdout?.trim() ?? null

  // 2. Initialise an isolated profile and install the tarball through the
  //    official plugin manager (pnpm), not by copying files.
  run(['--profile', profile, '--from-default-profile', 'web', '--dump-config'])
  const added = run(['plugin', '--profile', profile, 'add', tarball])
  report.details.installOutputTail = added.slice(-1500)
  const afterInstall = profileManifest()
  const dependency = afterInstall.dependencies?.[manifest.name]
  const installedManifest = JSON.parse(readFileSync(join(profileDir, 'node_modules', manifest.name, 'package.json'), 'utf8'))
  report.details.installed = { dependency, installedVersion: installedManifest.version, bundles: probeBundles() }
  assert.ok(String(dependency ?? '').includes(manifest.version) || String(dependency ?? '').includes('.tgz'), 'profile must depend on the packed package')
  assert.equal(installedManifest.version, manifest.version)
  assert.equal(probeBundles().includesPlugin, true, 'plugin manager must enable the bundle')
  report.checks.installed = true

  // 3. Boot the real host on this profile and prove the plugin is mounted.
  server = spawn(desktop, [cli, '--profile', profile, '--host', '127.0.0.1', '--port', String(port), '--no-open'], { env, cwd: staging, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  report.details.serverPid = server.pid ?? null
  const collect = (chunk) => {
    rawLogs.push(String(chunk))
    if (rawLogs.length > 400) rawLogs.shift()
  }
  server.stdout.on('data', collect)
  server.stderr.on('data', collect)

  const announced = await waitFor(() => {
    const match = /dsh web: (https?:\/\/[^\s]+\?token=([A-Za-z0-9_-]+))/u.exec(rawLogs.join(''))
    return match === null ? undefined : { url: match[1], token: match[2] }
  })
  report.details.launch = { urlRedacted: announced.url.replace(/([?&]token=)[^\s&]+/gu, '$1<redacted>') }

  // The panel is static: 200 proves the plugin registered its routes in the host.
  const panel = await waitFor(async () => {
    try {
      const response = await fetch(`${base}/tun-proxy/panel`, { signal: AbortSignal.timeout(5000) })
      return response.status === 200 ? response : undefined
    }
    catch { return undefined }
  })
  const panelText = await panel.text()
  assert.ok(panelText.includes('DSH 代理中心'), 'panel must be served by the mounted plugin')

  // No credential: the state route must answer, and it must refuse.
  const unauthorised = await fetch(`${base}/tun-proxy/state`, { signal: AbortSignal.timeout(5000) })
  // Launch token -> browser-session cookie -> authorised read of real state.
  const login = await fetch(`${base}/?token=${encodeURIComponent(announced.token)}`, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
  const cookies = typeof login.headers.getSetCookie === 'function' ? login.headers.getSetCookie() : []
  const minted = cookies.find((value) => value.startsWith('dsh-auth-'))
  assert.ok(minted, 'launch token must mint a browser-session cookie')
  const cookie = minted.split(';')[0]
  const authorised = await fetch(`${base}/tun-proxy/state`, { headers: { cookie }, signal: AbortSignal.timeout(10000) })
  const state = await authorised.json()
  report.details.activation = {
    panelStatus: panel.status,
    panelBytes: panelText.length,
    stateWithoutCredential: unauthorised.status,
    loginStatus: login.status,
    stateWithCredential: authorised.status,
    stateOk: state.ok === true,
    kernelInstalled: state.status?.kernel?.installed ?? null,
  }
  assert.equal(unauthorised.status, 401, 'state must require Host Connection authorization')
  assert.equal(authorised.status, 200)
  assert.equal(state.ok, true, 'authorised read must reach the service')
  report.checks.started = true
  report.checks.activated = true

  spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' })
  server = null
  await new Promise((done) => setTimeout(done, 1500))

  // 4. Uninstall through the same official manager and prove the profile is clean.
  const removed = run(['plugin', '--profile', profile, 'remove', manifest.name])
  report.details.uninstallOutputTail = removed.slice(-1500)
  const afterRemove = profileManifest()
  const bundlesAfter = afterRemove?.dsh?.profile?.bundles ?? []
  report.details.afterRemove = {
    dependencyPresent: Object.hasOwn(afterRemove.dependencies ?? {}, manifest.name),
    bundlePresent: bundlesAfter.includes(manifest.name),
    nodeModulesPresent: existsSync(join(profileDir, 'node_modules', manifest.name)),
  }
  assert.equal(report.details.afterRemove.dependencyPresent, false, 'profile must drop the dependency')
  assert.equal(report.details.afterRemove.bundlePresent, false, 'profile must drop the bundle')
  report.checks.uninstalled = true

  report.details.rollback = 'unknown — an upgrade/rollback from an older installed version was not exercised'
  report.details.limitations = [
    'Only the host and OS of this run are covered; other DSH versions and systems stay unknown.',
    'TUN/virtual adapter activation was not enabled; the plugin mounted and answered in web mode only.',
    'Rollback of an already-installed previous version is not verified.',
  ]
} catch (error) {
  report.error = String(error?.stack ?? error).slice(-6000)
  process.exitCode = 1
} finally {
  if (server !== null && server.pid !== undefined) {
    spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' })
  }
  report.serverLogTail = rawLogs.join('').replace(/([?&]token=)[^\s&]+/gu, '$1<redacted>').slice(-4000)
  report.stagingRetained = true
  writeFileSync(join(evidenceDir, 'compatibility.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
  // The disposable home, profile and tarball stay in the temp staging directory
  // so the recorded paths and hashes remain inspectable; nothing outside it is
  // touched and nothing outside it is ever deleted.
}
