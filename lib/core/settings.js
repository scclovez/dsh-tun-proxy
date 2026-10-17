/**
 * Settings: defaults, validation and persistence.
 *
 * Settings live in <home>/settings.json and are the single source of truth for
 * every tun_proxy_* tool. `normalizeSettings` and `applyPatch` are pure so they
 * can be unit tested without touching the filesystem.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'

import { DEFAULT_KERNEL_VERSION, normalizeSha256 } from './artifacts.js'

export const TUN_STACKS = ['mixed', 'gvisor', 'system']
export const DNS_MODES = ['fake-ip', 'redir-host']
export const PROXY_MODES = ['rule', 'global', 'direct']
export const LOG_LEVELS = ['silent', 'error', 'warning', 'info', 'debug']

export const SETTINGS_DEFAULTS = Object.freeze({
  /** Pinned, reviewed release by default; '' means "latest GitHub release".
   *  Unpinned versions are only installed when a trusted SHA-256 is available. */
  kernelVersion: DEFAULT_KERNEL_VERSION,
  /** Optional explicit SHA-256 of the kernel archive, for a version/mirror this
   *  project has not pinned. Trusted because the user supplied it; still checked. */
  kernelSha256: '',
  /** Use an existing mihomo binary (e.g. Clash Verge's verge-mihomo.exe). */
  kernelPath: '',
  /** Optional GitHub download mirror prefix, e.g. https://gh-proxy.com */
  githubMirror: '',
  /** Explicit path to a wintun.dll; '' auto-detects then downloads. */
  wintunPath: '',
  /** Clash/mihomo HTTP+HTTPS mixed port (also the SOCKS port). */
  mixedPort: 17890,
  /** mihomo external controller (REST API) port, bound to 127.0.0.1. */
  controllerPort: 9090,
  /** rule | global | direct */
  mode: 'rule',
  profileId: '',
  selectedNode: '',
  systemProxy: false,
  customRules: [],
  testUrl: 'https://www.gstatic.com/generate_204',
  testTimeout: 5000,
  chainEnabled: false,
  /** Traffic order: entry, intermediate hops, final exit. */
  chain: [],
  manualProxies: [],
  /** TUN stack: mixed | gvisor | system */
  tunStack: 'mixed',
  /** TUN adapter name shown in Windows network settings. */
  tunDevice: 'dsh-tun',
  /** Enable TUN (virtual adapter that captures all traffic). */
  tunEnable: true,
  /** Standalone DNS listener for the managed dns: block. Kept off the common
   *  1053 that other Clash clients (e.g. FlClash) also bind. */
  dnsListen: '127.0.0.1:10530',
  /** fake-ip | redir-host. redir-host (default) keeps real DNS answers, so DSH's
   *  own web_fetch SSRF guard still accepts hostnames while TUN captures traffic.
   *  Use fake-ip if you also run a fake-ip-aware fetch plugin. */
  dnsMode: 'redir-host',
  /** Clash/mihomo subscription URL (FlClash / Clash Verge compatible). */
  subscriptionUrl: '',
  /** Local Clash/mihomo YAML (e.g. a FlClash export) used when set. */
  profilePath: '',
  /** When neither subscription nor profilePath is set, reuse the profile of a
   *  locally installed Clash Verge / FlClash instead of running DIRECT. */
  autoImport: false,
  /** Fetch the subscription again on every start. */
  refreshOnStart: true,
  /** Start the kernel when DSH boots. */
  autoStart: false,
  /** Stop the kernel when DSH quits (or this plugin is unloaded). Only a
   *  graceful shutdown can run the hook; force-killing DSH still leaves it up. */
  stopOnExit: false,
  /** Expose the mixed port on the LAN. */
  allowLan: false,
  /** TUN strict-route (can break other VPNs; off by default). */
  strictRoute: false,
  /** TUN MTU. */
  mtu: 9000,
  /** mihomo log level. */
  logLevel: 'info',
  /** IPv6: only meaningful when the machine really has IPv6. */
  ipv6: false,
  /** Plain-IP DNS used only to bootstrap DoH hostnames (must be IPs). */
  dnsBootstrap: ['223.5.5.5', '119.29.29.29'],
  /** Main DNS for the managed dns: block. DoH by default: under TUN, plain
   *  UDP DNS can be hijacked back into the kernel and time out. */
  dnsServers: ['https://doh.pub/dns-query', 'https://dns.alidns.com/dns-query'],
  /** Fallback DNS for fake-ip mode. Empty by default: foreign DoH resolvers are
   *  unreachable on many mainland networks and only cause timeouts. Add e.g.
   *  https://1.1.1.1/dns-query if your line can reach them directly. */
  dnsFallback: [],
})

const INT_RANGES = {
  mixedPort: [1, 65535],
  controllerPort: [1, 65535],
  mtu: [576, 65535],
  testTimeout: [1000, 30000],
}

const STRING_KEYS = new Set([
  'profileId',
  'selectedNode',
  'testUrl',
  'kernelVersion',
  'kernelSha256',
  'kernelPath',
  'githubMirror',
  'wintunPath',
  'mode',
  'tunStack',
  'tunDevice',
  'dnsMode',
  'subscriptionUrl',
  'profilePath',
  'logLevel',
  'dnsListen',
])

const BOOLEAN_KEYS = new Set([
  'systemProxy',
  'chainEnabled',
  'tunEnable',
  'refreshOnStart',
  'autoStart',
  'autoImport',
  'stopOnExit',
  'allowLan',
  'strictRoute',
  'ipv6',
])

const ARRAY_KEYS = new Set(['dnsServers', 'dnsFallback', 'dnsBootstrap', 'chain', 'customRules'])

export function settingsKeys() {
  return Object.keys(SETTINGS_DEFAULTS)
}

function fail(key, why) {
  const error = new Error(`设置 ${key} 无效：${why}`)
  error.code = 'settings-invalid'
  error.key = key
  return error
}

function normalizeStringArray(key, value) {
  if (!Array.isArray(value)) throw fail(key, '必须是字符串数组')
  const out = []
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '' || /[\r\n\0]/.test(item)) {
      throw fail(key, '每一项都必须是非空单行字符串')
    }
    out.push(item.trim())
  }
  return out
}

/** Validate and canonicalize one settings object. Throws on invalid input. */
export function normalizeSettings(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw fail('settings', '必须是 JSON 对象')
  }
  const merged = { ...SETTINGS_DEFAULTS, ...input }
  for (const key of Object.keys(merged)) {
    if (!(key in SETTINGS_DEFAULTS)) {
      const error = new Error(`未知设置项：${key}`)
      error.code = 'settings-invalid'
      error.key = key
      throw error
    }
  }
  for (const key of STRING_KEYS) {
    const value = merged[key]
    if (typeof value !== 'string') throw fail(key, '必须是字符串')
    if (/[\r\n\0]/.test(value)) throw fail(key, '不能包含换行或空字符')
    merged[key] = value.trim()
  }
  for (const key of BOOLEAN_KEYS) {
    if (typeof merged[key] !== 'boolean') throw fail(key, '必须是布尔值')
  }
  for (const [key, [min, max]] of Object.entries(INT_RANGES)) {
    const value = merged[key]
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      throw fail(key, '必须是整数')
    }
    if (value < min || value > max) throw fail(key, `必须在 ${min}-${max} 之间`)
  }
  for (const key of ARRAY_KEYS) merged[key] = normalizeStringArray(key, merged[key])
  if (merged.kernelSha256 !== '') {
    const digest = normalizeSha256(merged.kernelSha256)
    if (digest === '') throw fail('kernelSha256', '必须是 64 位十六进制 SHA-256（可带 sha256: 前缀）')
    merged.kernelSha256 = digest
  }
  if (merged.chain.length > 8 || new Set(merged.chain).size !== merged.chain.length) throw fail('chain', '最多 8 跳，节点不能重复')
  if (merged.chainEnabled && merged.chain.length < 2) throw fail('chain', '链式代理至少需要入口和出口两跳')
  if (merged.chainEnabled && merged.mode === 'direct') throw fail('mode', '直连模式不能同时启用代理链')
  if (!Array.isArray(merged.manualProxies)) throw fail('manualProxies', '必须是节点数组')
  const names = new Set()
  merged.manualProxies = merged.manualProxies.map((proxy) => {
    if (!proxy || typeof proxy !== 'object' || !['socks5', 'http'].includes(proxy.type)) throw fail('manualProxies', '手动节点类型必须为 socks5 或 http')
    for (const key of ['name', 'server']) {
      if (typeof proxy[key] !== 'string' || !proxy[key].trim() || /[\r\n\0]/u.test(proxy[key])) throw fail('manualProxies', `节点 ${key} 无效`)
    }
    if (proxy.name.startsWith('DSH-') || names.has(proxy.name)) throw fail('manualProxies', '节点名称重复或使用了保留前缀 DSH-')
    names.add(proxy.name)
    if (!Number.isSafeInteger(proxy.port) || proxy.port < 1 || proxy.port > 65535) throw fail('manualProxies', '节点端口无效')
    for (const key of Object.keys(proxy)) {
      if (!['name', 'type', 'server', 'port', 'username', 'password', 'tls', 'skip-cert-verify', 'udp'].includes(key)) throw fail('manualProxies', `不支持的节点字段 ${key}`)
    }
    for (const key of ['username', 'password']) if (proxy[key] !== undefined && (typeof proxy[key] !== 'string' || /[\r\n\0]/u.test(proxy[key]))) throw fail('manualProxies', `${key} 无效`)
    for (const key of ['tls', 'skip-cert-verify', 'udp']) if (proxy[key] !== undefined && typeof proxy[key] !== 'boolean') throw fail('manualProxies', `${key} 必须为布尔值`)
    return { ...proxy }
  })
  if (merged.dnsServers.length === 0) throw fail('dnsServers', '至少需要一个 DNS 服务器')

  if (merged.tunStack !== '' && !TUN_STACKS.includes(merged.tunStack)) {
    throw fail('tunStack', `必须是 ${TUN_STACKS.join(' / ')}`)
  }
  if (!DNS_MODES.includes(merged.dnsMode)) throw fail('dnsMode', `必须是 ${DNS_MODES.join(' / ')}`)
  if (!PROXY_MODES.includes(merged.mode)) throw fail('mode', `必须是 ${PROXY_MODES.join(' / ')}`)
  if (!LOG_LEVELS.includes(merged.logLevel)) throw fail('logLevel', `必须是 ${LOG_LEVELS.join(' / ')}`)
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(merged.tunDevice)) {
    throw fail('tunDevice', '只能是字母、数字、下划线、点或连字符，最长 64')
  }
  if (merged.mixedPort === merged.controllerPort) {
    throw fail('controllerPort', '不能与 mixedPort 相同')
  }
  for (const key of ['wintunPath', 'profilePath', 'kernelPath']) {
    if (merged[key] !== '' && !isAbsolute(merged[key])) throw fail(key, '必须是绝对路径')
  }
  for (const key of ['subscriptionUrl', 'githubMirror', 'testUrl']) {
    if (merged[key] === '') continue
    let url
    try {
      url = new URL(merged[key])
    }
    catch {
      throw fail(key, '必须是 http(s) URL')
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw fail(key, '必须是 http(s) URL')
  }
  if (merged.dnsListen !== '' && !/^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/u.test(merged.dnsListen)) {
    throw fail('dnsListen', '必须是 host:port 形式，例如 127.0.0.1:10530')
  }
  if (merged.githubMirror !== '') merged.githubMirror = merged.githubMirror.replace(/\/+$/u, '')
  return merged
}

/** Apply a partial patch on top of current settings, returning a new object. */
export function applyPatch(current, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw fail('patch', '必须是 JSON 对象')
  }
  for (const key of Object.keys(patch)) {
    if (!(key in SETTINGS_DEFAULTS)) {
      const error = new Error(`未知设置项：${key}`)
      error.code = 'settings-invalid'
      error.key = key
      throw error
    }
  }
  return normalizeSettings({ ...current, ...patch })
}

export function loadSettings(settingsFile, fallback = {}) {
  if (!existsSync(settingsFile)) return normalizeSettings({ ...SETTINGS_DEFAULTS, ...fallback })
  let raw
  try {
    raw = JSON.parse(readFileSync(settingsFile, 'utf8').replace(/^\uFEFF/u, ''))
  }
  catch (error) {
    throw new Error(`无法解析 ${settingsFile}：${error.message}`)
  }
  if (raw.autoImport) {
    raw.autoImport = false
    raw.profilePath = ''
    raw.kernelPath = ''
    raw.wintunPath = ''
  }
  return normalizeSettings({ ...SETTINGS_DEFAULTS, ...fallback, ...raw })
}

export function saveSettings(settingsFile, settings) {
  mkdirSync(dirname(settingsFile), { recursive: true })
  const temp = `${settingsFile}.tmp`
  writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  renameSync(temp, settingsFile)
}

/** Never echo a subscription token back to the model or the GUI. */
export function maskUrl(value) {
  if (!value) return ''
  try {
    const url = new URL(value)
    const tail = url.pathname && url.pathname !== '/' ? '/…' : ''
    return `${url.protocol}//${url.host}${tail}`
  }
  catch {
    return '(invalid url)'
  }
}

export function publicSettings(settings) {
  return {
    ...settings,
    subscriptionUrl: maskUrl(settings.subscriptionUrl),
    subscriptionConfigured: settings.subscriptionUrl !== '',
    manualProxies: settings.manualProxies.map(({ password, ...proxy }) => ({ ...proxy, passwordConfigured: Boolean(password) })),
  }
}
