import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createService } from '../lib/core/service.js'

test('node links can be imported as the first operation in an empty profile', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-proxy-first-import-'))
  try {
    const service = createService({ env: { ...process.env, DSH_TUN_PROXY_HOME: join(home, 'new-profile') } })
    const link = 'ss://' + Buffer.from('aes-128-gcm:private').toString('base64') + '@127.0.0.1:8388#first'
    const result = await service.importSource({ source: link })
    assert.equal(result.nodes[0].name, 'first')
    assert.ok(service.readSettings().profileId)
    assert.ok(service.profileContent(service.readSettings().profileId).content.includes('first'))
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('standalone service never imports installed applications and imports a URL transactionally', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-proxy-url-'))
  let requests = 0, userAgent = '', invalid = false
  const server = createServer((request, response) => {
    requests++; userAgent = request.headers['user-agent']
    response.end(invalid ? '<html>not a subscription</html>' : 'proxies:\n  - { name: entry, type: socks5, server: 127.0.0.1, port: 1080 }\n')
  })
  try {
    const localApp = join(home, 'fake-app', 'io.github.clash-verge-rev.clash-verge-rev')
    mkdirSync(join(localApp, 'profiles'), { recursive: true })
    writeFileSync(join(localApp, 'profiles.yaml'), 'current: CURRENT\n')
    writeFileSync(join(localApp, 'profiles', 'CURRENT.yaml'), 'proxies: [{name: must-not-import, type: socks5, server: localhost, port: 9999}]')
    const service = createService({ env: { ...process.env, APPDATA: join(home, 'fake-app'), DSH_TUN_PROXY_HOME: join(home, 'state') } })
    assert.equal(service.readSettings().autoImport, false)
    assert.deepEqual((await service.catalog()).nodes, [])
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const url = `http://127.0.0.1:${server.address().port}/subscription?token=private`
    const result = await service.importSource({ source: url })
    assert.equal(result.nodes[0].name, 'entry')
    assert.equal(requests, 1, 'catalog uses the imported cache instead of fetching again')
    assert.equal(userAgent, 'clash.meta')
    assert.ok(!JSON.stringify(result).includes('token=private'))
    const currentId = service.profileList().activeId
    const cached = service.profileContent(currentId).content
    invalid = true
    await assert.rejects(service.importSource({ source: url + '&new=1' }), /无法导入/)
    assert.equal(service.exportBackup().profiles[0].url, url)
    assert.equal(service.profileContent(currentId).content, cached)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(home, { recursive: true, force: true })
  }
})
