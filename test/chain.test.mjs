import assert from 'node:assert/strict'
import test from 'node:test'
import { buildProfile, parseProfile, profileCatalog } from '../lib/core/chain.js'
import { normalizeSettings, publicSettings } from '../lib/core/settings.js'

const profile = {
  proxies: [
    { name: 'entry', type: 'socks5', server: '127.0.0.1', port: 11001, 'dialer-proxy': 'legacy' },
    { name: 'middle', type: 'http', server: '127.0.0.1', port: 11002 },
    { name: 'exit', type: 'ss', server: '127.0.0.1', port: 11003, cipher: 'aes-128-gcm', password: 'private' },
  ], rules: ['MATCH,DIRECT'],
}

test('chain clones concrete nodes in traffic order without altering original dialers or rules', () => {
  const original = structuredClone(profile)
  const result = buildProfile(profile, normalizeSettings({ chainEnabled: true, chain: ['entry', 'middle', 'exit'] }))
  const hops = result.proxies.slice(-3)
  assert.equal(hops[0]['dialer-proxy'], undefined)
  assert.equal(hops[1]['dialer-proxy'], 'DSH-HOP-1')
  assert.equal(hops[2]['dialer-proxy'], 'DSH-HOP-2')
  assert.equal(hops[2].password, 'private')
  assert.deepEqual(result.rules, ['NETWORK,UDP,REJECT', 'MATCH,DSH-CHAIN'])
  assert.deepEqual(profile, original)
})

test('invalid chains fail before kernel launch', () => {
  for (const input of [
    { chainEnabled: true, chain: ['entry'] },
    { chain: ['entry', 'entry'] },
    { chainEnabled: true, chain: ['entry', 'exit'], mode: 'direct' },
  ]) assert.throws(() => normalizeSettings(input))
  assert.throws(() => buildProfile(profile, normalizeSettings({ chainEnabled: true, chain: ['entry', 'absent'] })), /不存在/)
  const unsupported = { proxies: [...profile.proxies, { name: 'hy', type: 'hysteria2' }] }
  assert.throws(() => buildProfile(unsupported, normalizeSettings({ chainEnabled: true, chain: ['entry', 'hy'] })), /不支持/)
  assert.doesNotThrow(() => buildProfile(unsupported, normalizeSettings({ chainEnabled: true, chain: ['hy', 'entry'] })))
})

test('provider overrides and manual exits are selectable without exposing credentials', () => {
  const providers = { 'proxy-providers': { airport: { type: 'inline', override: { 'additional-prefix': 'A-' }, payload: [profile.proxies[2]] } } }
  assert.equal(profileCatalog(providers)[0].name, 'A-exit')
  const settings = normalizeSettings({ manualProxies: [{ name: 'custom', type: 'socks5', server: 'localhost', port: 1080, password: 'secret' }] })
  const visible = publicSettings(settings)
  assert.equal(visible.manualProxies[0].password, undefined)
  assert.equal(visible.manualProxies[0].passwordConfigured, true)
  assert.throws(() => normalizeSettings({ manualProxies: [{ ...settings.manualProxies[0], port: 70000 }] }))
})

test('strict YAML supports anchors, flow maps, BOM and rejects duplicate keys', () => {
  const parsed = parseProfile('\uFEFFproxies:\n  - &n {name: entry, type: socks5, server: localhost, port: 1080}\ncopy: *n\n')
  assert.equal(parsed.copy.name, 'entry')
  assert.throws(() => parseProfile('mode: rule\nmode: global'), /YAML/)
})

test('custom rules precede subscription rules while chain mode remains an explicit full chain', () => {
  const normal = buildProfile(profile, normalizeSettings({ customRules: ['DOMAIN,example.org,DIRECT'] }))
  assert.equal(normal.rules[0], 'DOMAIN,example.org,DIRECT')
  assert.equal(normal.rules.at(-1), 'MATCH,DIRECT')
  const chained = buildProfile(profile, normalizeSettings({ customRules: ['MATCH,DIRECT'], chainEnabled: true, chain: ['entry', 'exit'] }))
  assert.equal(chained.rules.at(-1), 'MATCH,DSH-CHAIN')
})
