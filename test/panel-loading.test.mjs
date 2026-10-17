import assert from 'node:assert/strict'
import test from 'node:test'
import { createPanelLoader } from '../lib/panel.js'

const tick = () => new Promise((resolve) => setImmediate(resolve))
const initial = () => ({ tab: 'dashboard', settings: null, catalog: [], groups: [], group: '', chain: [] })
function fixture() {
  const requests = [], waiting = new Map()
  const call = (name) => { requests.push(name); return new Promise((resolve, reject) => waiting.set(name, { resolve, reject })) }
  return { call, requests, waiting }
}
function metadata(f) {
  f.waiting.get('settings').resolve({ chain: [], manualProxies: [] })
  f.waiting.get('catalog').resolve({ nodes: [{ name: 'entry', type: 'socks5' }] })
}

test('settings and nodes render while slow runtime diagnostics are still pending', async () => {
  const f = fixture(), state = initial(), updates = []
  const loader = createPanelLoader(f.call, state, () => updates.push({ settings: Boolean(state.settings), nodes: state.catalog.length }))
  const loading = loader.load()
  f.waiting.get('profiles').resolve({ items: [], activeId: '' })
  await tick()
  assert.deepEqual(f.requests, ['profiles', 'settings', 'catalog', 'status'])
  metadata(f)
  await tick()
  assert.equal(state.catalog[0].name, 'entry')
  assert.ok(updates.some((value) => value.settings && value.nodes === 1))
  assert.equal(state.loading, true)
  f.waiting.get('status').resolve({ running: true })
  await tick()
  f.waiting.get('nodes').resolve({ groups: [{ name: 'DSH-PROXY', nodes: ['entry'] }] })
  await loading
  assert.equal(state.loading, false)
  assert.equal(state.group, 'DSH-PROXY')
  loader.dispose()
})

test('returning to the panel restores the node tab without repeating initialization; expiry and refresh reload', async () => {
  let clock = 1000
  const calls = [], values = { profiles: { items: [], activeId: '' }, settings: { chain: [] }, catalog: { nodes: [{ name: 'entry' }] }, status: { running: false } }
  const call = async (name) => { calls.push(name); return structuredClone(values[name]) }
  const firstState = initial(), first = createPanelLoader(call, firstState, undefined, { now: () => clock })
  await first.load()
  firstState.tab = 'proxies'; firstState.search = 'entry'
  first.dispose()
  const restored = initial(), second = createPanelLoader(call, restored, undefined, { now: () => clock })
  assert.equal(restored.tab, 'proxies')
  assert.equal(restored.search, 'entry')
  assert.equal(restored.catalog[0].name, 'entry')
  await second.load()
  assert.equal(calls.length, 4)
  await second.load({ force: true })
  assert.equal(calls.length, 8)
  clock += 30001
  await second.load()
  assert.equal(calls.length, 12)
  second.dispose()
  clock += 30001
  const expired = initial(), third = createPanelLoader(call, expired, undefined, { now: () => clock })
  assert.equal(expired.settings, null)
  await third.load()
  assert.equal(calls.length, 16)
  third.dispose()
})

test('a failed diagnostic leaves the node catalog visible and permits a real retry', async () => {
  const f = fixture(), state = initial(), loader = createPanelLoader(f.call, state)
  const loading = loader.load()
  const rejected = assert.rejects(loading, /offline/)
  f.waiting.get('profiles').resolve({ items: [], activeId: '' })
  await tick(); metadata(f)
  f.waiting.get('status').reject(new Error('offline'))
  await rejected
  assert.equal(state.loading, false)
  assert.equal(state.catalog[0].name, 'entry')
  const retry = loader.load()
  assert.equal(f.requests.filter((name) => name === 'profiles').length, 2)
  f.waiting.get('profiles').resolve({ items: [], activeId: '' })
  await tick(); metadata(f)
  f.waiting.get('status').resolve({ running: false })
  await retry
  loader.dispose()
})
