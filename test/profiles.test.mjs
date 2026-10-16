import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createService } from '../lib/core/service.js'

test('multiple subscriptions retain credentials privately, switch independently, and survive invalid refresh', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-profiles-'))
  let invalid = false
  const server = createServer((request, response) => {
    response.setHeader('subscription-userinfo', 'upload=100; download=200; total=1000; expire=2000000000')
    response.end(invalid ? '<html>failed</html>' : `proxies: [{name: ${request.url.startsWith('/a') ? 'alpha' : 'beta'}, type: socks5, server: localhost, port: 1080}]`)
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const service = createService({ env: { ...process.env, DSH_TUN_PROXY_HOME: home } })
    const a = await service.addProfile({ name: 'A', source: base + '/a?token=secret-a' })
    const firstId = a.activeId
    const b = await service.addProfile({ name: 'B', source: base + '/b?token=secret-b' })
    assert.equal(b.items.length, 2)
    assert.equal(b.activeId, firstId)
    assert.equal(b.items[0].info.total, 1000)
    assert.ok(!JSON.stringify(b).includes('secret-'))
    assert.equal((await service.catalog()).nodes[0].name, 'alpha')
    service.activateProfile(b.items[1].id)
    assert.equal((await service.catalog()).nodes[0].name, 'beta')
    invalid = true
    await assert.rejects(service.refreshProfile(b.items[1].id))
    assert.equal((await service.catalog()).nodes[0].name, 'beta')
    service.editProfile({ id: firstId, name: 'renamed', autoUpdateHours: 0 })
    assert.equal(service.profileList().items[0].name, 'renamed')
    const manifest = join(home, 'subscriptions.json'), entries = JSON.parse(readFileSync(manifest, 'utf8'))
    for (const entry of entries) entry.updatedAt = '2000-01-01T00:00:00Z'
    writeFileSync(manifest, JSON.stringify(entries))
    const due = await service.syncProfiles()
    assert.equal(due.length, 1)
    assert.equal(due[0].ok, false)
    await assert.rejects(service.removeProfile('../foreign-file'))
    const final = await service.removeProfile(firstId)
    assert.equal(final.items.length, 1)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(home, { recursive: true, force: true })
  }
})
