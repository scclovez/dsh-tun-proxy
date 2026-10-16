/**
 * The plugin's service layer: one object that owns settings, the managed mihomo
 * kernel, its generated config and its REST controller. Tools, HTTP routes and
 * the boot-time autostart all call into this and nothing else.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { basename, extname, join } from 'node:path'

import { layout, pluginHome } from './paths.js'
import { SETTINGS_DEFAULTS, applyPatch, loadSettings, maskUrl, normalizeSettings, publicSettings, saveSettings } from './settings.js'
import { assertProfileText, composeConfig, profileSections } from './yaml-config.js'
import { controllerRequest, fetchText, proxyGetText, waitForController } from './net.js'
import { ensureGeodata, ensureWintun, installKernel, kernelVersion, runKernel, testConfig } from './kernel.js'
import { defaultRoutes, isAdmin, killTree, killTreeSync, listImagePids, listImagePidsSync, portOwner, processAlive, runPs, sleep, tunAdapters } from './ps.js'
import { buildProfile, CHAIN_GROUP, OUTBOUND_GROUP, profileCatalog, profileYaml } from './chain.js'
import { IP_ENDPOINTS, parseIpPayload } from './ipcheck.js'
import { prepareProfile } from './profile.js'
import { normalizeSubscription } from './subscription.js'
import { createProfileStore } from './profiles.js'
import { createSystemProxy } from './system-proxy.js'

const KERNEL_EXE = 'mihomo.exe'

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
  }
  catch {
    return fallback
  }
}

function writeJsonAtomic(file, value) {
  mkdirSync(join(file, '..'), { recursive: true })
  const temp = `${file}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temp, file)
}

function tailFile(file, lines, maxBytes = 256 * 1024) {
  if (!existsSync(file)) return ''
  let text = ''
  try {
    const info = statSync(file)
    const start = Math.max(0, info.size - maxBytes)
    const fd = openSync(file, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(maxBytes, info.size))
      readSync(fd, buffer, 0, buffer.length, start)
      text = buffer.toString('utf8')
    }
    finally {
      closeSync(fd)
    }
  }
  catch {
    return ''
  }
  const parts = text.split(/\r?\n/u)
  return parts.slice(Math.max(0, parts.length - lines - 1)).join('\n')
}

function psSingleQuote(value) {
  return `'${String(value).replace(/'/gu, "''")}'`
}

function portInUse(port) {
  return portOwner(port).catch(() => '')
}

export function createService({ env = process.env, bundleConfig = {} } = {}) {
  const home = pluginHome(env)
  const paths = layout(home)
  const state = () => readJson(paths.stateFile, {})
  const saveState = (patch) => writeJsonAtomic(paths.stateFile, { ...state(), ...patch })
  const profiles = createProfileStore(paths)
  const systemProxy = createSystemProxy({ load: () => state().systemProxy, save: (value) => saveState({ systemProxy: value }) })
  let activityPrevious = null

  function ensureDirs() {
    for (const dir of [paths.home, paths.bin, paths.data, paths.logs, paths.cache, paths.profiles]) {
      mkdirSync(dir, { recursive: true })
    }
  }

  function readSettings() {
    ensureDirs()
    if (!existsSync(paths.settingsFile)) {
      const initial = { ...SETTINGS_DEFAULTS }
      if (typeof bundleConfig.autoStart === 'boolean') initial.autoStart = bundleConfig.autoStart
      const normalized = loadSettings(paths.settingsFile, initial)
      saveSettings(paths.settingsFile, normalized)
      return normalized
    }
    return loadSettings(paths.settingsFile)
  }

  function updateSettings(patch) {
    const current = readSettings()
    const next = applyPatch(current, patch)
    saveSettings(paths.settingsFile, next)
    if (next.subscriptionUrl !== current.subscriptionUrl) rmSync(paths.subscriptionFile, { force: true })
    return next
  }

  function secret() {
    const current = state()
    if (typeof current.secret === 'string' && /^[a-f0-9]{16,}$/u.test(current.secret)) return current.secret
    const generated = randomBytes(16).toString('hex')
    saveState({ secret: generated })
    return generated
  }

  /** The binary to run: an external one when configured, else the managed copy. */
  function kernelBinary(settings) {
    return settings.kernelPath !== '' ? settings.kernelPath : paths.kernel
  }

  /** Child env that lets a kernel outside bin/ still find our wintun.dll. */
  function kernelEnv() {
    return { ...(env ?? process.env), PATH: `${paths.bin};${(env ?? process.env).PATH ?? ''}` }
  }

  /**
   * Decide which profile text seeds the generated config.
   * Highest priority: an explicit local file, then the subscription (fresh if
   * refreshOnStart, otherwise its cached copy), then nothing (DIRECT).
   */
  async function resolveBase(settings, { onProgress, refresh = false } = {}) {
    if (settings.profileId) {
      let item = profiles.get(settings.profileId)
      if (refresh && item.url && settings.refreshOnStart) {
        try { await profiles.update(item.id); item = profiles.get(item.id) } catch { /* retain valid cached profile */ }
      }
      const text = profiles.content(item.id)
      return { text, source: 'profile', detail: item.name, path: profiles.file(item.id), sections: assertProfileText(text) }
    }
    if (settings.profilePath !== '') {
      if (!existsSync(settings.profilePath)) throw new Error(`profilePath 不存在：${settings.profilePath}`)
      const text = readFileSync(settings.profilePath, 'utf8')
      return { text, source: 'file', detail: settings.profilePath, sections: assertProfileText(text, 'profilePath') }
    }
    const cached = existsSync(paths.subscriptionFile) ? readFileSync(paths.subscriptionFile, 'utf8') : ''
    if (settings.subscriptionUrl === '') {
      return { text: '', source: 'none', detail: '', sections: profileSections('') }
    }
    if ((!settings.refreshOnStart || !refresh) && cached !== '') {
      return { text: cached, source: 'subscription-cache', detail: maskUrl(settings.subscriptionUrl), sections: profileSections(cached) }
    }
    try {
      onProgress?.('拉取订阅 …')
      const response = await fetchText(settings.subscriptionUrl, { headers: { 'user-agent': 'clash.meta' }, timeoutMs: 45000 })
      const text = normalizeSubscription(response.text)
      const sections = assertProfileText(text, '订阅')
      mkdirSync(paths.profiles, { recursive: true })
      writeFileSync(paths.subscriptionFile, text, 'utf8')
      saveState({ subscriptionUpdatedAt: new Date().toISOString(), subscriptionBytes: text.length })
      return { text, source: 'subscription', detail: maskUrl(settings.subscriptionUrl), sections }
    }
    catch (error) {
      if (cached !== '') {
        return {
          text: cached,
          source: 'subscription-cache',
          detail: maskUrl(settings.subscriptionUrl),
          sections: profileSections(cached),
          warning: `订阅刷新失败，沿用上次缓存：${error.message}`,
        }
      }
      throw new Error(`订阅拉取失败且没有缓存：${error.message}`)
    }
  }

  async function preparedProfile(settings, { refresh = false, refreshSubscription = false } = {}) {
    const base = await resolveBase(settings, { refresh: refreshSubscription })
    const profile = await prepareProfile(base, paths, { refresh })
    return { base, profile }
  }

  async function compile(settings = readSettings()) {
    const { base, profile } = await preparedProfile(settings, { refreshSubscription: settings.refreshOnStart })
    const output = buildProfile(profile, settings)
    for (const provider of Object.values(output['proxy-providers'] ?? {})) if (provider.type !== 'inline') delete provider.payload
    const text = composeConfig({ base: profileYaml(output), settings, secret: secret() })
    const candidate = join(paths.data, 'candidate.yaml')
    writeFileSync(candidate, text, 'utf8')
    const checked = await testConfig({ paths, configFile: candidate, kernel: kernelBinary(settings) })
    if (!checked.ok) throw new Error(`配置未通过 mihomo 校验：\n${checked.output}`)
    return { text, base }
  }

  async function catalog({ refresh = false } = {}) {
    const settings = readSettings()
    const { base, profile } = await preparedProfile(settings, { refresh })
    return { source: base.source, nodes: profileCatalog(profile, settings.manualProxies).map(({ name, type }) => ({ name, type })), chain: settings.chain, chainEnabled: settings.chainEnabled }
  }

  function upsertProxy(proxy) {
    const current = readSettings()
    const existing = current.manualProxies.find((item) => item.name === proxy.name)
    const clean = { ...proxy }
    delete clean.passwordConfigured
    if (existing && clean.password === undefined) clean.password = existing.password
    return publicSettings(updateSettings({ manualProxies: [...current.manualProxies.filter((item) => item.name !== clean.name), clean] }))
  }

  function removeProxy(name) {
    const current = readSettings()
    if (current.chain.includes(name)) throw new Error('请先从代理链中移除此节点')
    return publicSettings(updateSettings({ manualProxies: current.manualProxies.filter((item) => item.name !== name) }))
  }

  async function findKernelPid() {
    const executableNames = [...new Set([basename(kernelBinary(readSettings())), basename(kernelBinary(state().appliedSettings ?? readSettings()))])]
    const filter = executableNames.map((name) => `Name='${name}'`).join(' OR ')
    const out = await runPs(
      `$p = Get-CimInstance Win32_Process -Filter ${psSingleQuote(filter)} -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine.Contains(${psSingleQuote(paths.configFile)}) } | Select-Object -First 1 -ExpandProperty ProcessId; if ($p) { "$p" }`,
      { timeoutMs: 20000 },
    ).catch(() => '')
    const pid = Number.parseInt(String(out).trim(), 10)
    return Number.isSafeInteger(pid) && pid > 0 ? pid : 0
  }

  async function controllerHealth(settings) {
    try {
      const res = await controllerRequest({ port: settings.controllerPort, secret: secret(), path: '/version', timeoutMs: 2500 })
      return res.ok ? res.data : null
    }
    catch {
      return null
    }
  }

  async function runningPid() {
    // Fast path: the pid we recorded is still alive (no subprocess at all).
    const recorded = Number(state().pid ?? 0)
    if (Number.isSafeInteger(recorded) && recorded > 0 && processAlive(recorded)) return recorded
    // Cheap negative check: nothing with our kernel's image name is running, so
    // there is nothing to discover and no need for the precise (slow) query.
    const names = [...new Set([basename(kernelBinary(readSettings())), basename(kernelBinary(state().appliedSettings ?? readSettings()))])]
    const candidates = (await Promise.all(names.map((name) => listImagePids(name)))).flat()
    if (candidates.length === 0) {
      if (recorded) saveState({ pid: 0 })
      return 0
    }
    if (candidates.length === 1 && candidates[0] === recorded) return recorded
    // Ambiguous (crash, foreign kernel with the same image name): match the
    // command line against our config file before adopting anything.
    const found = await findKernelPid()
    if (found > 0) saveState({ pid: found })
    return found
  }

  async function install({ version = '', force = false, onProgress } = {}) {
    ensureDirs()
    const settings = readSettings()
    const kernel = await installKernel({ paths, settings, force, version, onProgress })
    const wintun = await ensureWintun({ paths, settings, onProgress })
    const geodata = await ensureGeodata({ paths, env }).catch(() => ({ copied: [], source: 'skipped' }))
    if (version !== '' && version !== settings.kernelVersion) updateSettings({ kernelVersion: version })
    saveState({ kernelVersion: kernel.version, installedAt: new Date().toISOString() })
    return { kernel, wintun, geodata, settings: publicSettings(readSettings()) }
  }

  async function start({ onProgress, auto = false, prepared, allowDirect = false } = {}) {
    ensureDirs()
    const settings = readSettings()
    const kernelBin = kernelBinary(settings)
    if (!existsSync(kernelBin)) {
      throw new Error('还没有安装 mihomo 内核：先运行 tun_proxy_install，或用 tun_proxy_config 设置 kernelPath 指向已有的 mihomo 可执行文件')
    }
    const pid = await runningPid()
    if (pid > 0) {
      if (await controllerHealth(state().appliedSettings ?? settings) !== null) {
        return { started: false, alreadyRunning: true, pid, status: await status({ settings }) }
      }
      // A recorded process that no longer answers the controller is stale
      // (crash, manual kill, changed controller port). Clear it so the fresh
      // start does not collide on the mixed port.
      await killTree(pid)
      saveState({ pid: 0 })
    }
    const admin = await isAdmin()
    if (settings.tunEnable && !admin) {
      throw new Error('启用 TUN 需要管理员权限：请以管理员身份启动 DSH（或安装 Clash Verge 的 service 模式后重试）')
    }
    if (settings.tunEnable) await ensureWintun({ paths, settings, onProgress })
    await assertPortsAvailable(settings)
    await ensureGeodata({ paths, env }).catch(() => {})

    const { base, text: configText } = prepared ?? await compile(settings)
    if (!allowDirect && base.source === 'none' && settings.manualProxies.length === 0) throw new Error('请先导入订阅 URL 或添加节点，再启动代理。当前没有可用节点。')
    const secretValue = secret()
    mkdirSync(paths.data, { recursive: true })
    writeFileSync(paths.configFile, configText, 'utf8')

    const test = await testConfig({ paths, configFile: paths.configFile, kernel: kernelBin })
    if (!test.ok) {
      throw new Error(`生成的配置未通过 mihomo -t 校验：\n${test.output}`)
    }

    onProgress?.('启动 mihomo …')
    const args = ['-d', paths.data, '-f', paths.configFile]
    const startedAt = Date.now()
    let spawnedPid = 0
    {
      const fd = openSync(paths.logFile, 'a')
      const child = spawn(kernelBin, args, {
        detached: true,
        stdio: ['ignore', fd, fd],
        windowsHide: true,
        cwd: paths.data,
        env: kernelEnv(),
      })
      spawnedPid = child.pid ?? 0
      child.unref()
      closeSync(fd)
    }

    try {
      const version = await waitForController({ port: settings.controllerPort, secret: secretValue, timeoutMs: 30000 })
      const resolvedPid = spawnedPid > 0 && processAlive(spawnedPid) ? spawnedPid : await findKernelPid()
      saveState({
        pid: resolvedPid,
        startedAt: new Date(startedAt).toISOString(),
        configFile: paths.configFile,
        kernelVersion: version?.version ?? '',
        baseSource: base.source,
        baseDetail: base.detail ?? '',
        autoStarted: auto,
        appliedSettings: settings,
        profileVersion: settings.profileId ? profiles.get(settings.profileId).updatedAt : '',
      })
      if (settings.systemProxy) await systemProxy.enable(settings.mixedPort)
      if (settings.selectedNode) {
        const available = await controllerRequest({ port: settings.controllerPort, secret: secretValue, path: `/proxies/${OUTBOUND_GROUP}` })
        if (available.data?.all?.includes(settings.selectedNode)) await controllerRequest({ port: settings.controllerPort, secret: secretValue, path: `/proxies/${OUTBOUND_GROUP}`, method: 'PUT', body: { name: settings.selectedNode } })
      }
      if (settings.mode === 'global') {
        const selected = await controllerRequest({ port: settings.controllerPort, secret: secretValue, path: '/proxies/GLOBAL', method: 'PUT', body: { name: settings.chainEnabled ? CHAIN_GROUP : OUTBOUND_GROUP } })
        if (!selected.ok) throw new Error('无法选中全局出口策略')
      }
      return {
        started: true,
        pid: resolvedPid,
        controllerVersion: version,
        // Never echo base.text back: an imported profile contains node
        // credentials, and tool results are persisted in the session.
        base: {
          source: base.source,
          detail: base.detail ?? '',
          sections: base.sections ?? null,
          warning: base.warning ?? null,
        },
        warnings: base.warning ? [base.warning] : [],
        status: await status({ settings }),
      }
    }
    catch (error) {
      await systemProxy.restore().catch(() => {})
      const pidNow = spawnedPid > 0 ? spawnedPid : await findKernelPid()
      if (pidNow > 0) await killTree(pidNow)
      const log = tailFile(paths.logFile, 30)
      saveState({ pid: 0 })
      throw new Error(`mihomo 启动失败：${error.message}\n\n最后日志：\n${log}`)
    }
  }

  async function stop() {
    ensureDirs()
    const settings = state().appliedSettings ?? readSettings()
    const pid = await runningPid()
    await systemProxy.restore()
    const killed = pid > 0 ? await killTree(pid) : true
    saveState({ pid: 0, stoppedAt: new Date().toISOString() })
    let adapterGone = true
    if (settings.tunEnable) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const adapters = await tunAdapters().catch(() => [])
        adapterGone = !adapters.some((adapter) => adapter.name === settings.tunDevice)
        if (adapterGone) break
        await sleep(250)
      }
    }
    return { stopped: killed, pid, adapterGone, status: await status({ settings }) }
  }

  /**
   * "Where does my traffic actually leave from?"
   *
   * The probe is sent through the local mixed port, so it traverses exactly the
   * path the rest of the machine uses (kernel -> selected node or chain). When
   * TUN is off we can additionally ask the same endpoint directly and report
   * both answers; with TUN on every route goes through the kernel, so a
   * "direct" number would be meaningless and is therefore omitted.
   */
  async function ipCheck({ timeoutMs = 8000 } = {}) {
    const settings = state().appliedSettings ?? readSettings()
    if (await controllerHealth(settings) === null) throw new Error('mihomo 没有在运行，先启动代理再检测出口 IP')
    const failures = []
    let throughProxy = null
    for (const endpoint of IP_ENDPOINTS) {
      const started = Date.now()
      try {
        const { text } = await proxyGetText(settings.mixedPort, endpoint.url, { timeoutMs })
        const parsed = parseIpPayload(text)
        if (parsed === null) throw new Error('响应里没有可用 IP')
        throughProxy = { ...parsed, endpoint: endpoint.id, url: endpoint.url, ms: Date.now() - started }
        break
      }
      catch (error) {
        failures.push(`${endpoint.id}: ${error.message}`)
      }
    }
    if (throughProxy === null) throw new Error(`所有出口检测地址都失败：\n${failures.join('\n')}`)

    const exit = { mode: settings.mode, selected: '', chain: settings.chainEnabled ? settings.chain : [] }
    try {
      const path = settings.chainEnabled ? `/proxies/${encodeURIComponent(CHAIN_GROUP)}` : `/proxies/${encodeURIComponent(OUTBOUND_GROUP)}`
      const group = await controllerRequest({ port: settings.controllerPort, secret: secret(), path, timeoutMs: 4000 })
      exit.selected = group.data?.now ?? ''
    }
    catch { /* informational only */ }

    let direct = null
    if (!settings.tunEnable) {
      const started = Date.now()
      try {
        const { text } = await fetchText(IP_ENDPOINTS[0].url, { timeoutMs })
        const parsed = parseIpPayload(text)
        if (parsed !== null) direct = { ...parsed, endpoint: IP_ENDPOINTS[0].id, ms: Date.now() - started }
      }
      catch { /* the direct probe is optional */ }
    }
    return {
      checkedAt: new Date().toISOString(),
      proxyPort: settings.mixedPort,
      throughProxy,
      direct,
      exit,
      verdict: exit.selected === 'DIRECT' ? 'direct' : 'proxied',
      note: settings.tunEnable ? 'TUN 已开启：整机流量都经过内核，无法另外测“直连出口”' : '',
    }
  }

  async function configSummary(settings) {
    const info = await controllerHealth(settings)
    if (info === null) return null
    const res = await controllerRequest({ port: settings.controllerPort, secret: secret(), path: '/configs', timeoutMs: 5000 }).catch(() => null)
    if (res === null || !res.ok) return null
    const data = res.data ?? {}
    return {
      mode: data.mode,
      mixedPort: data['mixed-port'] ?? data.port,
      tunEnabled: Boolean(data.tun?.enable),
      tunStack: data.tun?.stack,
    }
  }

  async function restart() {
    const settings = readSettings()
    const previous = state().appliedSettings
    const previousProfileVersion = state().profileVersion
    let prepared
    try {
      prepared = await compile(settings)
      await assertPortsAvailable(settings, await runningPid() > 0 ? previous : null)
    }
    catch (error) {
      if (previous && await runningPid() > 0) {
        if (settings.profileId && settings.profileId === previous.profileId && profiles.get(settings.profileId).updatedAt !== previousProfileVersion) profiles.rollback(settings.profileId)
        saveSettings(paths.settingsFile, previous)
      }
      throw error
    }
    const running = await runningPid() > 0
    if (running) await stop()
    try { return await start({ prepared }) }
    catch (error) {
      if (running && previous) {
        if (settings.profileId && settings.profileId === previous.profileId && profiles.get(settings.profileId).updatedAt !== previousProfileVersion) profiles.rollback(settings.profileId)
        saveSettings(paths.settingsFile, previous)
        try { await start(); error.message += '\n已恢复上次设置并重新启动原代理。' }
        catch (rollback) { error.message += `\n恢复原代理失败：${rollback.message}` }
      }
      throw error
    }
  }

  async function assertPortsAvailable(settings, active = null) {
    for (const key of ['mixedPort', 'controllerPort']) {
      if (active?.[key] === settings[key]) continue
      await new Promise((resolve, reject) => {
        const server = createServer()
        server.once('error', () => reject(new Error(`端口 ${settings[key]} 已被其他程序占用，请在设置中修改 ${key}`)))
        server.listen(settings[key], '127.0.0.1', () => server.close(resolve))
      })
    }
  }

  async function status({ settings: supplied, verbose = false } = {}) {
    ensureDirs()
    const settings = supplied ?? readSettings()
    const kernelBin = kernelBinary(settings)
    const installed = existsSync(kernelBin)
    const version = installed ? await kernelVersion(kernelBin).catch(() => '') : ''
    const pid = await runningPid()
    const active = pid > 0 ? state().appliedSettings ?? settings : settings
    const controller = pid > 0 ? await controllerHealth(active) : null
    const admin = await isAdmin().catch(() => false)
    const [adapters, routes] = await Promise.all([
      verbose && settings.tunEnable ? tunAdapters().catch(() => []) : [],
      verbose ? defaultRoutes().catch(() => []) : [],
    ])
    const tunAdapter = adapters.find((adapter) => adapter.name === settings.tunDevice)
      ?? adapters.find((adapter) => adapter.status === 'Up')
      ?? adapters[0]
    // Join the routes we already fetched instead of querying per adapter.
    if (tunAdapter && routes.length > 0) {
      tunAdapter.defaultRouteVia = routes
        .filter((route) => Number(route.ifIndex) === Number(tunAdapter.ifIndex))
        .map((route) => route.nextHop)
    }
    const warnings = []
    if (!installed) warnings.push('内核未安装：运行 tun_proxy_install 下载 mihomo，或把 kernelPath 指向已有的 mihomo.exe')
    if (settings.tunEnable && !admin) warnings.push('当前进程不是管理员，TUN 模式无法启动')
    if (verbose && settings.tunEnable && pid > 0 && adapters.length === 0) warnings.push('内核在运行，但没有看到 Wintun 网卡')
    if (settings.dnsMode === 'fake-ip' && settings.tunEnable && pid > 0) {
      warnings.push('fake-ip 模式下 DSH 自己的 web_fetch 可能因为解析到 198.18.x.x 被 SSRF 校验拦截；需要时可把 dnsMode 改成 redir-host')
    }
    if (settings.subscriptionUrl === '' && settings.profilePath === '' && pid > 0
      && !['auto-import', 'subscription-cache'].includes(state().baseSource ?? '')) {
      warnings.push('没有可用的订阅或本地配置，当前所有流量按 DIRECT 规则直连')
    }
    const conflictPort = verbose ? await portInUse(settings.mixedPort) : ''
    if (pid > 0 && conflictPort !== '' && conflictPort !== String(pid)) {
      warnings.push(`混合端口 ${settings.mixedPort} 已被 PID ${conflictPort} 占用`)
    }
    if (pid > 0) {
      const recent = tailFile(paths.logFile, 120)
      const dialErrors = (recent.match(/connect error|dns resolve failed/gu) ?? []).length
      if (dialErrors >= 3) {
        warnings.push('内核日志显示最近多次节点连接失败：当前节点/机场可能不可用，用 tun_proxy_nodes action=delay 逐个测节点，或换 profilePath / subscriptionUrl')
      }
      const dnsBind = recent.includes('Start DNS server') && recent.includes('bind: Only one usage')
      if (dnsBind) warnings.push(`独立 DNS 监听（${settings.dnsListen}）端口被占用；TUN 的 DNS 劫持仍可用，也可改 dnsListen 换端口`)
    }
    return {
      running: pid > 0,
      pid: pid > 0 ? pid : null,
      kernel: { installed, version, path: kernelBin, managed: settings.kernelPath === '' },
      kernelDir: paths.home,
      controller: { port: active.controllerPort, ready: controller !== null, version: controller?.version ?? '', summary: await configSummary(active) },
      tun: {
        enabled: settings.tunEnable,
        stack: settings.tunStack,
        device: settings.tunDevice,
        adapter: tunAdapter ?? null,
        defaultRoutes: routes,
      },
      elevation: { admin },
      profile: {
        source: state().baseSource ?? null,
        detail: state().baseDetail ?? null,
        subscriptionUpdatedAt: state().subscriptionUpdatedAt ?? null,
        autoImport: settings.autoImport,
      },
      log: verbose ? tailFile(paths.logFile, 60) : undefined,
      settings: publicSettings(settings),
      warnings,
      pendingChanges: pid > 0 && (JSON.stringify(state().appliedSettings) !== JSON.stringify(settings) || Boolean(settings.profileId && profiles.get(settings.profileId).updatedAt !== state().profileVersion)),
      chain: { enabled: settings.chainEnabled, hops: settings.chain, transport: 'TCP' },
    }
  }

  async function updateSubscription({ onProgress } = {}) {
    const settings = readSettings()
    if (settings.profileId) return profiles.update(settings.profileId)
    if (settings.subscriptionUrl === '') throw new Error('还没有配置 subscriptionUrl')
    onProgress?.('拉取订阅 …')
    const response = await fetchText(settings.subscriptionUrl, { headers: { 'user-agent': 'clash.meta' }, timeoutMs: 45000 })
    const text = normalizeSubscription(response.text), bytes = response.bytes
    const sections = assertProfileText(text, '订阅')
    mkdirSync(paths.profiles, { recursive: true })
    writeFileSync(paths.subscriptionFile, text, 'utf8')
    const updatedAt = new Date().toISOString()
    saveState({ subscriptionUpdatedAt: updatedAt, subscriptionBytes: bytes })
    return { updatedAt, bytes, sections, url: maskUrl(settings.subscriptionUrl) }
  }

  async function importSource({ source, name }) {
    const list = await addProfile({ source, name })
    activateProfile(list.items.at(-1).id)
    return { imported: true, ...(await catalog()), settings: publicSettings(readSettings()) }
  }

  function profileList() {
    const current = readSettings()
    if (!profiles.list().length && !current.profileId) {
      const owned = current.profilePath.startsWith(paths.profiles + '\\') || current.profilePath.startsWith(paths.profiles + '/')
      const cached = current.subscriptionUrl && existsSync(paths.subscriptionFile) ? paths.subscriptionFile : owned && existsSync(current.profilePath) ? current.profilePath : ''
      if (cached) {
        const item = profiles.seed({ text: readFileSync(cached, 'utf8'), url: current.subscriptionUrl, name: current.subscriptionUrl ? new URL(current.subscriptionUrl).hostname : '节点配置' })
        updateSettings({ profileId: item.id, profilePath: '', subscriptionUrl: '' })
      }
    }
    return { activeId: readSettings().profileId, items: profiles.list() }
  }
  async function addProfile(input) {
    ensureDirs()
    const item = await profiles.add(input)
    if (!readSettings().profileId) activateProfile(item.id)
    return profileList()
  }
  function activateProfile(id) {
    profiles.get(id)
    updateSettings({ profileId: id, profilePath: '', subscriptionUrl: '', chainEnabled: false, chain: [], selectedNode: '' })
    return profileList()
  }
  async function removeProfile(id) {
    if (readSettings().profileId === id) {
      if (await runningPid() > 0) await stop()
      updateSettings({ profileId: '', profilePath: '', subscriptionUrl: '', chainEnabled: false, chain: [] })
    }
    profiles.remove(id)
    const first = profiles.list()[0]
    if (!readSettings().profileId && first) activateProfile(first.id)
    return profileList()
  }
  async function refreshProfile(id) { await profiles.update(id); return profileList() }
  function editProfile(input) { profiles.edit(input); return profileList() }

  async function controller(path, method = 'GET', body) {
    const settings = state().appliedSettings ?? readSettings()
    const result = await controllerRequest({ port: settings.controllerPort, secret: secret(), path, method, body, timeoutMs: 8000 })
    if (!result.ok) throw new Error(`内核请求失败 (${result.status})`)
    return result.data
  }
  async function activity() {
    if (!Number(state().pid) || !processAlive(Number(state().pid))) return { running: false, up: 0, down: 0, uploadTotal: 0, downloadTotal: 0, connections: [] }
    const data = await controller('/connections')
    const now = Date.now(), seconds = activityPrevious ? Math.max(.1, (now - activityPrevious.time) / 1000) : 0
    const result = { running: true, uploadTotal: data.uploadTotal ?? 0, downloadTotal: data.downloadTotal ?? 0,
      up: seconds ? Math.max(0, ((data.uploadTotal ?? 0) - activityPrevious.upload) / seconds) : 0,
      down: seconds ? Math.max(0, ((data.downloadTotal ?? 0) - activityPrevious.download) / seconds) : 0,
      connections: (data.connections ?? []).slice(0, 1000).map((item) => ({ id: item.id, host: item.metadata?.host || item.metadata?.destinationIP || '', port: item.metadata?.destinationPort, network: item.metadata?.network, process: item.metadata?.process || item.metadata?.processPath || '', rule: item.rule, chains: item.chains ?? [], upload: item.upload, download: item.download, start: item.start })),
    }
    activityPrevious = { time: now, upload: result.uploadTotal, download: result.downloadTotal }
    return result
  }
  async function closeConnections(id) {
    if (id !== undefined && (typeof id !== 'string' || id.length > 128)) throw new Error('连接 ID 无效')
    await controller(id ? `/connections/${encodeURIComponent(id)}` : '/connections', 'DELETE')
    return { closed: true }
  }
  async function rules() { return { custom: readSettings().customRules, rules: (await controller('/rules'))?.rules ?? [] } }
  async function batchDelay(names) {
    if (!Array.isArray(names) || names.length > 6 || names.some((value) => typeof value !== 'string')) throw new Error('每批最多测试 6 个节点')
    return { results: await Promise.all(names.map((node) => delay({ node }).catch(() => ({ node, ok: false })))) }
  }
  function exportBackup() {
    return { format: 'dsh-proxy-backup', version: 1, settings: readSettings(), profiles: profiles.export() }
  }
  async function restoreBackup(backup) {
    if (backup?.format !== 'dsh-proxy-backup' || backup.version !== 1 || !Array.isArray(backup.profiles) || backup.profiles.length > 200) throw new Error('备份格式无效')
    const validated = backup.profiles.map((item) => {
      if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100) throw new Error('订阅名称无效')
      if (item.url && !['http:', 'https:'].includes(new URL(item.url).protocol)) throw new Error('订阅地址无效')
      return { ...item, content: normalizeSubscription(item.content) }
    })
    const next = normalizeSettings({ ...backup.settings, profileId: '', profilePath: '', subscriptionUrl: '', kernelPath: '', wintunPath: '', systemProxy: false, autoStart: false })
    if (await runningPid() > 0) await stop()
    const idMap = new Map()
    for (const item of validated) idMap.set(item.id, profiles.seed({ text: item.content, url: item.url || '', name: item.name }).id)
    next.profileId = idMap.get(backup.settings?.profileId) || idMap.values().next().value || ''
    saveSettings(paths.settingsFile, next)
    return profileList()
  }

  async function nodes() {
    const settings = state().appliedSettings ?? readSettings()
    if (await controllerHealth(settings) === null) throw new Error('mihomo 没有在运行，先执行 tun_proxy_start')
    const res = await controllerRequest({ port: settings.controllerPort, secret: secret(), path: '/proxies', timeoutMs: 10000 })
    if (!res.ok) throw new Error(`控制器返回 ${res.status}`)
    const groups = []
    for (const [name, value] of Object.entries(res.data?.proxies ?? {})) {
      if (!Array.isArray(value?.all) || value.all.length === 0) continue
      groups.push({
        name,
        type: value.type,
        now: value.now,
        nodes: value.all.slice(0, 400),
      })
    }
    const configs = await controllerRequest({ port: settings.controllerPort, secret: secret(), path: '/configs', timeoutMs: 5000 }).catch(() => null)
    return { mode: configs?.data?.mode ?? settings.mode, groups }
  }

  async function selectNode({ group, node }) {
    const settings = state().appliedSettings ?? readSettings()
    if (await controllerHealth(settings) === null) {
      if (group !== OUTBOUND_GROUP || !(await catalog()).nodes.some((item) => item.name === node)) throw new Error('节点不存在')
      updateSettings({ selectedNode: node })
      return { group, now: node, ok: true, offline: true }
    }
    const list = await nodes()
    const target = list.groups.find((item) => item.name === group)
    if (target === undefined) {
      throw new Error(`没有名为 ${group} 的策略组。可用：${list.groups.map((item) => item.name).join(', ') || '(无)'}`)
    }
    if (node !== undefined && node !== '' && !target.nodes.includes(node)) {
      throw new Error(`策略组 ${group} 里没有节点 ${node}`)
    }
    const res = await controllerRequest({
      port: settings.controllerPort,
      secret: secret(),
      path: `/proxies/${encodeURIComponent(group)}`,
      method: 'PUT',
      body: { name: node },
      timeoutMs: 10000,
    })
    if (!res.ok && res.status !== 204) throw new Error(`切换失败：HTTP ${res.status}`)
    if (group === OUTBOUND_GROUP) {
      updateSettings({ selectedNode: node })
      saveState({ appliedSettings: { ...state().appliedSettings, selectedNode: node } })
    }
    const after = await controllerRequest({ port: settings.controllerPort, secret: secret(), path: `/proxies/${encodeURIComponent(group)}`, timeoutMs: 5000 })
    return { group, now: after.data?.now ?? node, ok: after.data?.now === node }
  }

  async function delay({ node, url, timeoutMs } = {}) {
    const settings = state().appliedSettings ?? readSettings()
    url ??= readSettings().testUrl
    timeoutMs ??= readSettings().testTimeout
    const res = await controllerRequest({
      port: settings.controllerPort,
      secret: secret(),
      path: `/proxies/${encodeURIComponent(node)}/delay?timeout=${timeoutMs}&url=${encodeURIComponent(url)}`,
      timeoutMs: timeoutMs + 4000,
    })
    if (!res.ok) return { node, ok: false, message: res.data?.message ?? `HTTP ${res.status}` }
    return { node, ok: true, delay: res.data?.delay ?? null }
  }

  async function setMode({ mode }) {
    const settings = updateSettings({ mode })
    if (await controllerHealth(settings) !== null) {
      await controllerRequest({ port: settings.controllerPort, secret: secret(), path: '/configs', method: 'PATCH', body: { mode }, timeoutMs: 8000 })
    }
    return { mode, settings: publicSettings(readSettings()) }
  }

  async function uninstall({ purge = false } = {}) {
    const settings = readSettings()
    if (await runningPid() > 0) await stop()
    const removed = []
    for (const file of [paths.kernel, paths.wintun]) {
      if (existsSync(file)) {
        rmSync(file, { force: true })
        removed.push(file)
      }
    }
    if (purge) {
      rmSync(paths.home, { recursive: true, force: true })
      return { purged: true, removed }
    }
    rmSync(paths.configFile, { force: true })
    return { purged: false, removed, externalKernelKept: settings.kernelPath || '' }
  }

  async function logs({ lines = 80 } = {}) {
    return { file: paths.logFile, tail: tailFile(paths.logFile, lines) }
  }

  /**
   * Synchronous shutdown path used by the plugin's `stopOnExit` hook: kill the
   * kernel without awaiting anything, because a quitting DSH may not give the
   * event loop another turn. The Windows system proxy is restored by the async
   * `stop()` that the hook fires first.
   */
  function stopSync() {
    const recorded = Number(state().pid ?? 0)
    const killed = []
    if (Number.isSafeInteger(recorded) && recorded > 0 && processAlive(recorded)) {
      killTreeSync(recorded)
      killed.push(recorded)
    }
    else {
      const name = basename(kernelBinary(state().appliedSettings ?? readSettings()))
      const found = listImagePidsSync(name)
      if (found.length === 1) {
        killTreeSync(found[0])
        killed.push(found[0])
      }
    }
    if (killed.length > 0) saveState({ pid: 0, stoppedAt: new Date().toISOString() })
    return { stopped: killed.length > 0, pids: killed }
  }

  let pending = Promise.resolve()
  const serialize = (operation) => (...args) => {
    const next = pending.then(() => operation(...args))
    pending = next.catch(() => {})
    return next
  }
  return {
    env,
    paths,
    ensureDirs,
    readSettings,
    profileList,
    addProfile: serialize(addProfile),
    activateProfile,
    removeProfile: serialize(removeProfile),
    refreshProfile: serialize(refreshProfile),
    editProfile,
    profileContent: (id) => ({ content: profiles.content(id) }),
    syncProfiles: serialize(() => profiles.due()),
    activity,
    closeConnections,
    rules,
    batchDelay,
    exportBackup,
    restoreBackup: serialize(restoreBackup),
    updateSettings,
    importSource: serialize(importSource),
    catalog,
    compile,
    upsertProxy,
    removeProxy,
    restart: serialize(restart),
    install: serialize(install),
    start: serialize(start),
    stop: serialize(stop),
    stopSync,
    status,
    ipCheck,
    updateSubscription,
    nodes,
    selectNode,
    delay,
    setMode,
    uninstall,
    logs,
    runKernel: (args) => runKernel(kernelBinary(readSettings()), args),
  }
}

export { composeConfig, profileSections }
