import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createService } from '../lib/core/service.js'

test('live activity, rules, node tests and connection termination use the authenticated controller', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-activity-'))
  let total = 1000, deleted = ''
  const secret = '0123456789abcdef'
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${secret}`)
    response.setHeader('content-type', 'application/json')
    if (request.method === 'DELETE') { deleted = request.url; response.writeHead(204); response.end(); return }
    if (request.url === '/connections') response.end(JSON.stringify({ uploadTotal: total, downloadTotal: 2000, connections: [{ id: 'conn-1', metadata: { host: 'example.com', destinationPort: '443', process: 'browser' }, chains: ['exit', 'entry'], rule: 'Match', upload: 50, download: 100 }] }))
    else if (request.url === '/rules') response.end(JSON.stringify({ rules: [{ type: 'DomainSuffix', payload: 'example.com', proxy: 'DIRECT' }] }))
    else response.end(JSON.stringify({ delay: 12 }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  try {
    const service = createService({ env: { ...process.env, DSH_TUN_PROXY_HOME: home } })
    const settings = service.updateSettings({ controllerPort: server.address().port })
    writeFileSync(service.paths.stateFile, JSON.stringify({ pid: process.pid, secret, appliedSettings: settings }))
    const first = await service.activity(); assert.equal(first.connections[0].host, 'example.com'); assert.equal(first.up, 0)
    total += 100; assert.ok((await service.activity()).up > 0)
    assert.equal((await service.rules()).rules[0].proxy, 'DIRECT')
    assert.equal((await service.batchDelay(['a', 'b'])).results.length, 2)
    await service.closeConnections('conn-1'); assert.equal(deleted, '/connections/conn-1')
    await service.closeConnections(); assert.equal(deleted, '/connections')
  } finally { await new Promise((resolve) => server.close(resolve)); rmSync(home, { recursive: true, force: true }) }
})
