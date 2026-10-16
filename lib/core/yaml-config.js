/**
 * mihomo config composition — pure text functions, no I/O.
 *
 * A profile the user imported from FlClash / Clash Verge already owns the
 * interesting parts (proxies, proxy-groups, rules, rule-providers). We only
 * take over the keys that decide *where the kernel listens and how traffic
 * enters it*: ports, controller, TUN and DNS. Those keys are stripped from the
 * imported text and replaced by a generated block, so the user's profile can be
 * re-imported/refreshed at any time without losing our settings.
 *
 * Stripping is line based on purpose: it must not need a YAML parser, must keep
 * comments and anchors intact, and must never reorder a profile we did not
 * author.
 */

/** Top-level keys the plugin regenerates on every start. */
export const MANAGED_KEYS = Object.freeze([
  'port',
  'socks-port',
  'redir-port',
  'tproxy-port',
  'mixed-port',
  'allow-lan',
  'bind-address',
  'lan-allowed-ips',
  'mode',
  'log-level',
  'ipv6',
  'external-controller',
  'external-controller-tls',
  'external-controller-cors',
  'external-ui',
  'external-ui-name',
  'secret',
  'tun',
  'dns',
  'profile',
  'unified-delay',
  'tcp-concurrent',
  'find-process-mode',
  'keep-alive-interval',
  'geodata-mode',
  'geo-auto-update',
  'geox-url',
])

const TOP_LEVEL_KEY = /^([A-Za-z0-9_-]+)\s*:/u

/**
 * Remove each listed top-level key and its indented block from YAML text.
 *
 * @param {string} text raw YAML
 * @param {Iterable<string>} keys top-level keys to drop
 * @returns {string}
 */
export function stripTopLevelKeys(text, keys) {
  const managed = keys instanceof Set ? keys : new Set(keys)
  const lines = String(text ?? '').split(/\r?\n/u)
  const out = []
  let dropping = false
  for (const line of lines) {
    const match = TOP_LEVEL_KEY.exec(line)
    if (match !== null) {
      dropping = managed.has(match[1])
      if (!dropping) out.push(line)
      continue
    }
    if (dropping) {
      // Continuation lines belong to the dropped key: indented, blank, or a
      // list item / block scalar / anchor line that continues it.
      if (line.trim() === '' || /^[ \t]/u.test(line) || /^\s*$/u.test(line)) continue
      dropping = false
    }
    out.push(line)
  }
  return out.join('\n')
}

function yamlString(value) {
  return `'${String(value).replace(/'/gu, "''")}'`
}

function dnsBlock(settings) {
  const lines = [
    'dns:',
    '  enable: true',
    `  ipv6: ${settings.ipv6 ? 'true' : 'false'}`,
    ...(settings.dnsListen === '' ? [] : [`  listen: ${yamlString(settings.dnsListen)}`]),
    `  enhanced-mode: ${settings.dnsMode}`,
    '  use-hosts: true',
    '  default-nameserver:',
    ...settings.dnsBootstrap.map((server) => `    - ${yamlString(server)}`),
    '  nameserver:',
    ...settings.dnsServers.map((server) => `    - ${yamlString(server)}`),
  ]
  if (settings.dnsMode === 'fake-ip') {
    lines.push(
      '  fake-ip-range: 198.18.0.1/16',
      '  fake-ip-filter:',
      "    - '*.lan'",
      "    - '*.local'",
      "    - '*.localdomain'",
      "    - '+.msftconnecttest.com'",
      "    - '+.msftncsi.com'",
      "    - 'time.*.com'",
      "    - 'stun.*.*'",
    )
    if (settings.dnsFallback.length > 0) {
      lines.push(
        '  fallback:',
        ...settings.dnsFallback.map((server) => `    - ${yamlString(server)}`),
        '  fallback-filter:',
        // geoip-based filtering needs geoip.metadb; keeping it off means the
        // config validates even on a machine that cannot reach GitHub yet.
        '    geoip: false',
        '    ipcidr:',
        "      - '240.0.0.0/4'",
      )
    }
  }
  return lines.join('\n')
}

/**
 * `geox-url` points mihomo's on-demand geodata download at the configured
 * GitHub mirror. Without it, an imported GEOIP/GEOSITE rule set would try
 * github.com directly — the very connection a proxy user cannot make.
 */
function geoxBlock(settings) {
  if (settings.githubMirror === '') return []
  const base = settings.githubMirror.replace(/\/+$/u, '')
  const release = 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest'
  return [
    'geox-url:',
    `  geoip: ${yamlString(`${base}/${release}/geoip.dat`)}`,
    `  geosite: ${yamlString(`${base}/${release}/geosite.dat`)}`,
    `  mmdb: ${yamlString(`${base}/${release}/geoip.metadb`)}`,
    `  asn: ${yamlString(`${base}/${release}/GeoLite2-ASN.mmdb`)}`,
  ]
}

function tunBlock(settings) {
  return [
    'tun:',
    `  enable: ${settings.tunEnable ? 'true' : 'false'}`,
    `  stack: ${settings.tunStack}`,
    `  device: ${yamlString(settings.tunDevice)}`,
    '  auto-route: true',
    '  auto-detect-interface: true',
    `  strict-route: ${settings.strictRoute ? 'true' : 'false'}`,
    `  mtu: ${settings.mtu}`,
    '  dns-hijack:',
    '    - any:53',
  ].join('\n')
}

/**
 * The generated block that always wins over the imported profile.
 *
 * @param {object} settings normalized settings
 * @param {string} secret external-controller bearer token
 */
export function managedBlock(settings, secret) {
  const lines = [
    '# ── dsh-tun-proxy managed block ─────────────────────────────────────────────',
    '# 由 dsh-tun-proxy 在每次启动时重新生成；对导入的订阅/配置文件只做键级覆盖。',
    '# ───────────────────────────────────────────────────────────────────────────',
    `mixed-port: ${settings.mixedPort}`,
    `allow-lan: ${settings.allowLan ? 'true' : 'false'}`,
    "bind-address: '127.0.0.1'",
    `mode: ${settings.mode}`,
    `log-level: ${settings.logLevel}`,
    `ipv6: ${settings.ipv6 ? 'true' : 'false'}`,
    'unified-delay: true',
    'tcp-concurrent: true',
    'find-process-mode: off',
    'profile:',
    '  store-selected: true',
    '  store-fake-ip: true',
    `external-controller: 127.0.0.1:${settings.controllerPort}`,
    `secret: ${yamlString(secret)}`,
    tunBlock(settings),
    dnsBlock(settings),
    ...geoxBlock(settings),
  ]
  return lines.join('\n')
}

/** Does this text look like a Clash/mihomo profile rather than an HTML page? */
export function looksLikeProfile(text) {
  const head = String(text ?? '').slice(0, 4096)
  if (/^\s*</u.test(head)) return false
  return /(^|\n)\s*(proxies|proxy-providers|proxy-groups|rules|tun|mixed-port|port|dns)\s*:/u.test(head)
}

/** A profile is usable when it declares at least one of these sections. */
export function profileSections(text) {
  const source = String(text ?? '')
  return {
    proxies: /(^|\n)proxies\s*:/u.test(source),
    providers: /(^|\n)proxy-providers\s*:/u.test(source),
    groups: /(^|\n)proxy-groups\s*:/u.test(source),
    rules: /(^|\n)rules\s*:/u.test(source),
  }
}

export function assertProfileText(text, label = 'profile') {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error(`${label} 为空`)
  }
  if (!looksLikeProfile(text)) {
    throw new Error(`${label} 不是 Clash/mihomo 格式的 YAML（前 200 字符：${text.slice(0, 200)}）`)
  }
  const sections = profileSections(text)
  if (!sections.proxies && !sections.providers && !sections.rules && !sections.groups) {
    throw new Error(`${label} 里没有 proxies / proxy-groups / rules 段落`)
  }
  return sections
}

/**
 * Final config = managed block + imported profile (managed keys stripped).
 * When the imported profile has no `rules:` section we append a catch-all so
 * mihomo never runs a rule mode with zero rules.
 *
 * @param {{base?: string, settings: object, secret: string}} input
 */
export function composeConfig({ base = '', settings, secret }) {
  const clean = base.trim() === '' ? '' : stripTopLevelKeys(base, MANAGED_KEYS).trim()
  const parts = [managedBlock(settings, secret)]
  if (clean !== '') parts.push('', '# ── imported profile ──', clean)
  const hasRules = /(^|\n)rules\s*:/u.test(clean)
  if (!hasRules) {
    parts.push('', '# 导入的配置没有 rules 段，补一条兜底规则', 'rules:', '  - MATCH,DIRECT')
  }
  parts.push('')
  return parts.join('\n')
}

/** Minimal valid profile that still exercises TUN, used by the self test. */
export function directConfig(settings, secret) {
  return composeConfig({
    base: 'proxies: []\nproxy-groups: []\nrules:\n  - MATCH,DIRECT\n',
    settings,
    secret,
  })
}
