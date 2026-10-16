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
