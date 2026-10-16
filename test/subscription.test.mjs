import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeSubscription, parseNodeUrl } from '../lib/core/subscription.js'
import { parseProfile } from '../lib/core/chain.js'

test('imports standard SS, legacy SS and base64 multi-node subscriptions', () => {
  const auth = Buffer.from('aes-128-gcm:private:password').toString('base64url')
  const link = `ss://${auth}@127.0.0.1:8388#node`
  assert.equal(parseNodeUrl(link).password, 'private:password')
  const legacy = 'ss://' + Buffer.from('aes-128-gcm:private@127.0.0.1:8388').toString('base64') + '#legacy'
  assert.equal(parseNodeUrl(legacy).name, 'legacy')
  const data = parseProfile(normalizeSubscription(Buffer.from(link + '\n' + link).toString('base64')))
  assert.deepEqual(data.proxies.map((proxy) => proxy.name), ['node', 'node (2)'])
})

test('imports VMess WS, VLESS REALITY, Trojan, HY2 and TUIC URLs', () => {
  const vmess = parseNodeUrl('vmess://' + Buffer.from(JSON.stringify({ add: 'example.com', port: '443', id: 'uuid', net: 'ws', path: '/ws', host: 'example.com', tls: 'tls' })).toString('base64'))
  assert.equal(vmess['ws-opts'].path, '/ws')
  const vless = parseNodeUrl('vless://uuid@example.com:443?security=reality&pbk=public&sid=abcd&fp=chrome&sni=example.com#exit')
  assert.equal(vless['reality-opts']['short-id'], 'abcd')
  assert.equal(parseNodeUrl('trojan://password@example.com:443#t').password, 'password')
  assert.equal(parseNodeUrl('hysteria2://auth@example.com:443?sni=example.com#hy').type, 'hysteria2')
  assert.equal(parseNodeUrl('tuic://uuid:password@example.com:443#tuic').password, 'password')
  assert.throws(() => parseNodeUrl('vless://uuid@example.com:443?type=xhttp'), /暂不支持/)
})

test('accepts Clash YAML and rejects non-subscription responses', () => {
  assert.equal(parseProfile(normalizeSubscription('proxies: [{ name: n, type: socks5, server: localhost, port: 1080 }]')).proxies[0].name, 'n')
  assert.throws(() => normalizeSubscription('<html>error</html>'), /无法导入/)
})
