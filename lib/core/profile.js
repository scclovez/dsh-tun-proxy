import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fetchText } from './net.js'
import { parseProfile, relocateProviderPaths } from './chain.js'

export async function prepareProfile(base, paths, { refresh = false } = {}) {
  const profile = relocateProviderPaths(parseProfile(base.text), base.path ? dirname(base.path) : base.source === 'file' ? dirname(base.detail) : '')
  for (const [name, provider] of Object.entries(profile['proxy-providers'] ?? {})) {
    if (provider.payload) continue
    let text = ''
    const cache = join(paths.cache, `provider-${Buffer.from(name).toString('hex')}.yaml`)
    if (provider.type === 'file') {
      const file = isAbsolute(provider.path ?? '') ? provider.path : resolve(paths.data, provider.path ?? '')
      if (!existsSync(file)) throw new Error(`节点提供者 ${name} 的文件不存在`)
      text = readFileSync(file, 'utf8')
    } else if (provider.type === 'http') {
      if (!refresh && existsSync(cache)) text = readFileSync(cache, 'utf8')
      else {
        try {
          const headers = Object.fromEntries(Object.entries(provider.header ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)]))
          text = (await fetchText(provider.url, { headers, timeoutMs: 15000 })).text
          if (!Array.isArray(parseProfile(text).proxies)) throw new Error('缺少 proxies 数组')
          writeFileSync(cache, text, 'utf8')
        } catch {
          if (existsSync(cache)) text = readFileSync(cache, 'utf8')
          else throw new Error(`无法读取节点提供者 ${name}；请检查订阅网络后重试`)
        }
      }
    }
    if (text) provider.payload = parseProfile(text).proxies ?? []
  }
  return profile
}
