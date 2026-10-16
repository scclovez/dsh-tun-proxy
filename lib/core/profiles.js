import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { normalizeSubscription } from './subscription.js'
import { parseProfile } from './chain.js'
import { fetchText } from './net.js'
import { maskUrl } from './settings.js'

export function createProfileStore(paths) {
  const manifest = join(paths.home, 'subscriptions.json')
  const load = () => {
    if (!existsSync(manifest)) return []
    const value = JSON.parse(readFileSync(manifest, 'utf8'))
    if (!Array.isArray(value)) throw new Error('订阅列表损坏')
    return value
  }
  const save = (items) => {
    mkdirSync(paths.profiles, { recursive: true })
    writeFileSync(manifest + '.tmp', JSON.stringify(items, null, 2))
    renameSync(manifest + '.tmp', manifest)
  }
  function file(id) {
    if (!/^[a-f0-9-]{36}$/i.test(id ?? '')) throw new Error('订阅 ID 无效')
    return join(paths.profiles, `${id}.yaml`)
  }
  function get(id) {
    const item = load().find((item) => item.id === id)
    if (!item) throw new Error('订阅不存在')
    return item
  }
  function visible(item) {
    const { url, ...rest } = item
    return { ...rest, url: maskUrl(url), remote: Boolean(url) }
  }
  async function download(url) {
    try {
      const response = await fetchText(url, { headers: { 'user-agent': 'clash.meta' }, timeoutMs: 45000 })
      const info = {}
      for (const pair of (response.subscriptionInfo ?? '').split(';')) {
        const [key, value] = pair.trim().split('=')
        if (['upload', 'download', 'total', 'expire'].includes(key) && Number.isFinite(Number(value)) && Number(value) >= 0) info[key] = Number(value)
      }
      return { text: normalizeSubscription(response.text), info }
    } catch (error) {
      // A subscription URL is a credential. Never include it in UI/log errors.
      throw new Error(`订阅更新失败：${String(error.message).replaceAll(url, maskUrl(url))}`)
    }
  }
  function stats(text) {
    const profile = parseProfile(text)
    return (profile.proxies?.length ?? 0) + Object.values(profile['proxy-providers'] ?? {}).reduce((sum, value) => sum + (value.payload?.length ?? 0), 0)
  }
  function writeProfile(id, text) {
    const target = file(id)
    mkdirSync(paths.profiles, { recursive: true })
    writeFileSync(target + '.tmp', text)
    renameSync(target + '.tmp', target)
  }
  async function add({ source, name = '' }) {
    if (typeof source !== 'string' || !source.trim()) throw new Error('请输入订阅链接')
    source = source.trim()
    const remote = /^https?:\/\//i.test(source) && !/[\r\n]/.test(source)
    if (remote) new URL(source)
    const { text, info = {} } = remote ? await download(source) : { text: normalizeSubscription(source) }
    const items = load()
    const existing = remote ? items.find((item) => item.url === source) : null
    const item = {
      id: existing?.id ?? randomUUID(), name: name.trim() || existing?.name || (remote ? new URL(source).hostname : '节点配置'),
      url: remote ? source : '', autoUpdateHours: existing?.autoUpdateHours ?? 24,
      updatedAt: new Date().toISOString(), nodeCount: stats(text), info,
    }
    if (existing) {
      writeFileSync(file(item.id) + '.previous', readFileSync(file(item.id)))
      writeFileSync(file(item.id) + '.previous-meta.json', JSON.stringify(existing))
    }
    writeProfile(item.id, text)
    save([...items.filter((entry) => entry.id !== item.id), item])
    return visible(item)
  }
  async function update(id) {
    const items = load(), item = get(id)
    if (!item.url) return visible(item)
    const { text, info } = await download(item.url)
    writeFileSync(file(id) + '.previous', readFileSync(file(id)))
    writeFileSync(file(id) + '.previous-meta.json', JSON.stringify(item))
    writeProfile(id, text)
    Object.assign(item, { info, nodeCount: stats(text), updatedAt: new Date().toISOString() })
    save(items.map((entry) => entry.id === id ? item : entry))
    return visible(item)
  }
  function edit({ id, name, autoUpdateHours, source }) {
    const items = load(), item = get(id)
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new Error('订阅名称无效')
      item.name = name.trim()
    }
    if (autoUpdateHours !== undefined) {
      if (!Number.isInteger(autoUpdateHours) || autoUpdateHours < 0 || autoUpdateHours > 720) throw new Error('更新间隔应为 0–720 小时')
      item.autoUpdateHours = autoUpdateHours
    }
    if (source !== undefined) {
      const text = normalizeSubscription(source)
      writeFileSync(file(id) + '.previous', readFileSync(file(id)))
      writeFileSync(file(id) + '.previous-meta.json', JSON.stringify(get(id)))
      // Editing a remote document creates a local version, avoiding silent
      // replacement by a later subscription refresh.
      writeProfile(id, text); item.url = ''; item.nodeCount = stats(text)
      item.updatedAt = new Date().toISOString()
    }
    save(items.map((entry) => entry.id === id ? item : entry))
    return visible(item)
  }
  function remove(id) {
    get(id); save(load().filter((item) => item.id !== id))
    for (const suffix of ['', '.previous', '.previous-meta.json']) rmSync(file(id) + suffix, { force: true })
    return { removed: true }
  }
  async function due() {
    const result = []
    for (const item of load()) {
      if (!item.url || !item.autoUpdateHours || Date.now() - Date.parse(item.updatedAt) < item.autoUpdateHours * 3600000) continue
      try { result.push({ id: item.id, ok: true, profile: await update(item.id) }) }
      catch (error) { result.push({ id: item.id, ok: false, error: error.message }) }
    }
    return result
  }
  function seed({ text, url = '', name = '默认配置' }) {
    text = normalizeSubscription(text)
    const item = { id: randomUUID(), name, url, autoUpdateHours: 24, updatedAt: new Date().toISOString(), nodeCount: stats(text), info: {} }
    writeProfile(item.id, text); save([...load(), item]); return visible(item)
  }
  function rollback(id) {
    const target = file(id)
    if (!existsSync(target + '.previous') || !existsSync(target + '.previous-meta.json')) return false
    const item = JSON.parse(readFileSync(target + '.previous-meta.json', 'utf8'))
    writeFileSync(target, readFileSync(target + '.previous'))
    save(load().map((entry) => entry.id === id ? item : entry))
    for (const suffix of ['.previous', '.previous-meta.json']) rmSync(target + suffix, { force: true })
    return true
  }
  return { list: () => load().map(visible), get, file, add, update, edit, remove, due, seed, rollback,
    export: () => load().map((item) => ({ ...item, content: readFileSync(file(item.id), 'utf8') })),
    content: (id) => { get(id); return readFileSync(file(id), 'utf8') },
  }
}
