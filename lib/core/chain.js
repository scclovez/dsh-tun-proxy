import { parseDocument, stringify } from 'yaml'
import { isAbsolute, resolve } from 'node:path'

export const CHAIN_GROUP = 'DSH-CHAIN'
export const OUTBOUND_GROUP = 'DSH-PROXY'

export function parseProfile(text) {
  const doc = parseDocument(String(text || '{}').replace(/^\uFEFF/u, ''), { uniqueKeys: true })
  if (doc.errors.length) throw new Error(`YAML 格式错误：${doc.errors[0].message}`)
  const value = doc.toJS({ maxAliasCount: 100 })
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置必须是 YAML 对象')
  return value
}

export function profileCatalog(profile, manual = []) {
  const entries = [...(profile.proxies ?? []), ...manual]
  for (const provider of Object.values(profile['proxy-providers'] ?? {})) {
    for (const proxy of provider.payload ?? []) {
      const override = provider.override ?? {}
      const { 'additional-prefix': prefix = '', 'additional-suffix': suffix = '', 'proxy-name': rename, ...fields } = override
      let name = proxy.name
      for (const rule of rename ?? []) name = name.replace(new RegExp(rule.pattern, 'g'), rule.target)
      entries.push({ ...proxy, ...fields, name: `${prefix}${name}${suffix}` })
    }
  }
  const names = new Set()
  for (const proxy of entries) {
    if (!proxy?.name || !proxy.type) throw new Error('节点缺少 name 或 type')
    if (names.has(proxy.name)) throw new Error(`节点名称重复：${proxy.name}`)
    if (proxy.name.startsWith('DSH-')) throw new Error(`节点使用保留前缀：${proxy.name}`)
    names.add(proxy.name)
  }
  return entries
}

/** Work on a detached object. Imported profiles and existing dialers remain untouched. */
export function buildProfile(profile, settings) {
  const result = structuredClone(profile)
  const catalog = profileCatalog(profile, settings.manualProxies)
  const groups = result['proxy-groups'] ?? []
  if (groups.some((group) => [CHAIN_GROUP, OUTBOUND_GROUP].includes(group.name))) throw new Error('导入配置包含保留策略组 DSH-CHAIN / DSH-PROXY')
  result.proxies = [...(result.proxies ?? []), ...structuredClone(settings.manualProxies)]
  const targets = [...catalog.map((proxy) => proxy.name)]
  if (settings.chainEnabled) {
    const hops = settings.chain.map((name, index) => {
      const original = catalog.find((proxy) => proxy.name === name)
      if (!original) throw new Error(`链式节点不存在：${name}。请刷新节点目录后重新选择。`)
      // Restrict hops to TCP-capable conventional proxies; unsupported transports
      // must fail explicitly instead of silently bypassing an earlier hop.
      const tcpTypes = ['ss', 'ssr', 'vmess', 'vless', 'trojan', 'socks5', 'http', 'snell']
      const entryTypes = [...tcpTypes, 'hysteria', 'hysteria2', 'tuic', 'wireguard']
      if (!(index === 0 ? entryTypes : tcpTypes).includes(original.type)) throw new Error(`第 ${index + 1} 跳不支持 ${original.type}：${name}。HY2 / TUIC 等 UDP 传输只能作为入口。`)
      const hop = { ...structuredClone(original), name: `DSH-HOP-${index + 1}` }
      delete hop['dialer-proxy']
      if (index > 0) hop['dialer-proxy'] = `DSH-HOP-${index}`
      hop.udp = false
      return hop
    })
    result.proxies.push(...hops)
    groups.push({ name: CHAIN_GROUP, type: 'select', proxies: [hops.at(-1).name] })
    targets.unshift(CHAIN_GROUP)
  }
  groups.push({ name: OUTBOUND_GROUP, type: 'select', proxies: [...new Set([...targets, 'DIRECT'])] })
  result['proxy-groups'] = groups
  if (settings.chainEnabled) {
    // This switch means all matched traffic uses the chain, including profiles
    // with their own MATCH rule. TCP chains explicitly reject unsupported UDP.
    result.rules = ['NETWORK,UDP,REJECT', `MATCH,${CHAIN_GROUP}`]
  } else if (!result.rules?.length) result.rules = [`MATCH,${OUTBOUND_GROUP}`]
  if (!settings.chainEnabled && settings.customRules?.length) result.rules = [...settings.customRules, ...result.rules]
  return result
}

export function relocateProviderPaths(profile, baseDir) {
  if (!baseDir) return profile
  const result = structuredClone(profile)
  for (const key of ['proxy-providers', 'rule-providers']) {
    for (const provider of Object.values(result[key] ?? {})) {
      if (provider.type === 'file' && provider.path && !isAbsolute(provider.path)) provider.path = resolve(baseDir, provider.path)
    }
  }
  return result
}

export function profileYaml(profile) { return stringify(profile, { lineWidth: 0 }) }
