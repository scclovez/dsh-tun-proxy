import assert from 'node:assert/strict'
import test from 'node:test'
import { createSystemProxy } from '../lib/core/system-proxy.js'

test('system proxy restores the complete previous state including PAC', async () => {
  const before = { enable: 0, server: 'old:1234', bypass: '*.internal', pac: 'https://example.com/proxy.pac' }
  let current = structuredClone(before), state = null
  const proxy = createSystemProxy({ read: async () => current, write: async (value) => { current = structuredClone(value) }, load: () => state, save: (value) => { state = value } })
  await proxy.enable(17890)
  assert.equal(current.pac, null)
  assert.equal(current.enable, 1)
  await proxy.enable(17891)
  assert.equal((await proxy.restore()).restored, true)
  assert.deepEqual(current, before)
  assert.equal(state, null)
})

test('system proxy does not overwrite another app that took ownership', async () => {
  let current = { enable: 0, server: null, bypass: null, pac: null }, state = null
  const proxy = createSystemProxy({ read: async () => current, write: async (value) => { current = value }, load: () => state, save: (value) => { state = value } })
  await proxy.enable(17890)
  current = { enable: 1, server: '127.0.0.1:7890', pac: null }
  assert.equal((await proxy.restore()).restored, false)
  assert.equal(current.server, '127.0.0.1:7890')
})

test('synchronous shutdown restores PAC and bypass without awaiting the event loop', async () => {
  const before = { enable: 1, server: 'old:1234', bypass: '*.private', pac: 'https://example.test/pac' }
  let current = structuredClone(before), state = null
  const proxy = createSystemProxy({ read: async () => current, write: async v => { current = v }, readSync: () => current, writeSync: v => { current = v }, load: () => state, save: v => { state = v } })
  await proxy.enable(17890)
  assert.equal(proxy.restoreSync().restored, true)
  assert.deepEqual(current, before)
  assert.equal(state, null)
})

test('a failed restore retains durable recovery data for restart and uninstall', async () => {
  const backup = { enable: 0, server: null, bypass: null, pac: null }
  let state = { backup, owned: 'http=127.0.0.1:17890;https=127.0.0.1:17890' }, fail = true
  let current = { enable: 1, server: state.owned, pac: null }
  const proxy = createSystemProxy({ read: async () => current, write: async v => { if (fail) throw new Error('registry unavailable'); current = v }, load: () => state, save: v => { state = v } })
  await assert.rejects(proxy.restore(), /registry unavailable/)
  assert.deepEqual(state.backup, backup)
  fail = false
  assert.equal((await proxy.restore()).restored, true)
  assert.deepEqual(current, backup)
})
