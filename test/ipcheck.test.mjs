import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'

import { IP_ENDPOINTS, parseIpPayload } from '../lib/core/ipcheck.js'
import { proxyGetText } from '../lib/core/net.js'

test('parses the JSON shape used by ip-api', () => {
  const parsed = parseIpPayload(JSON.stringify({ status: 'success', country: 'Singapore', regionName: 'Central', city: 'Singapore', isp: 'Example ISP', query: '203.0.113.7' }))
  assert.deepEqual(parsed, { ip: '203.0.113.7', location: 'Singapore Central Singapore', isp: 'Example ISP' })
})

test('parses a bare address and the Chinese text shape', () => {
  assert.equal(parseIpPayload('203.0.113.9\n').ip, '203.0.113.9')
  const cn = parseIpPayload('当前 IP：203.0.113.10  来自于：中国 江西 上饶  移动')
  assert.equal(cn.ip, '203.0.113.10')
  assert.match(cn.location, /中国 江西 上饶/u)
})

test('rejects payloads without an address', () => {
  assert.equal(parseIpPayload(''), null)
  assert.equal(parseIpPayload('<html>nope</html>'), null)
  assert.equal(parseIpPayload('{"status":"fail"}'), null)
  assert.equal(parseIpPayload('{"query":"not-an-ip"}'), null)
})

test('every configured endpoint is plain http (the proxy request cannot tunnel TLS)', () => {
  for (const endpoint of IP_ENDPOINTS) assert.ok(endpoint.url.startsWith('http://'), endpoint.url)
})

test('proxyGetText issues an absolute-form request through the given proxy port', async () => {
  const seen = []
  const proxy = createServer((req, res) => {
    seen.push({ url: req.url, host: req.headers.host })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ query: '198.51.100.23', country: 'Japan', city: 'Tokyo' }))
  })
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve))
  const port = proxy.address().port
  try {
    const { text, status } = await proxyGetText(port, IP_ENDPOINTS[0].url, { timeoutMs: 4000 })
    assert.equal(status, 200)
    // the proxy must receive the absolute URL, not a path-only request
    assert.equal(seen.length, 1)
    assert.equal(seen[0].url, IP_ENDPOINTS[0].url)
    assert.equal(seen[0].host, new URL(IP_ENDPOINTS[0].url).host)
    assert.deepEqual(parseIpPayload(text), { ip: '198.51.100.23', location: 'Japan Tokyo', isp: '' })
  }
  finally {
    await new Promise((resolve) => proxy.close(resolve))
  }
})

test('proxyGetText surfaces transport failures instead of hanging', async () => {
  await assert.rejects(() => proxyGetText(1, IP_ENDPOINTS[0].url, { timeoutMs: 1500 }), /ECONNREFUSED|failed|timeout/iu)
})
