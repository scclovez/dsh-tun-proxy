import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createService } from '../lib/core/service.js'

test('backup round trip keeps profile credentials and custom rules without inheriting OS proxy state', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-backup-'))
  try {
    const create = (name) => createService({ env: { ...process.env, DSH_TUN_PROXY_HOME: join(home, name) } })
    const source = create('source'), destination = create('destination')
    await source.addProfile({ name: 'private-profile', source: 'ss://' + Buffer.from('aes-128-gcm:password').toString('base64') + '@127.0.0.1:8388#entry' })
    source.updateSettings({ customRules: ['DOMAIN-SUFFIX,example.org,DIRECT'], systemProxy: true, autoStart: true })
    const backup = source.exportBackup()
    const before = destination.profileList()
    await assert.rejects(destination.restoreBackup({ ...backup, profiles: [{ name: 'invalid', content: '<bad>' }] }))
    assert.deepEqual(destination.profileList(), before)
    const restored = await destination.restoreBackup(backup)
    assert.equal(restored.items[0].name, 'private-profile')
    assert.match(destination.profileContent(restored.activeId).content, /password/)
    assert.deepEqual(destination.readSettings().customRules, source.readSettings().customRules)
    assert.equal(destination.readSettings().systemProxy, false)
    assert.equal(destination.readSettings().autoStart, false)
    assert.notEqual(restored.activeId, backup.settings.profileId)
    const selected = await destination.selectNode({ group: 'DSH-PROXY', node: 'entry' })
    assert.equal(selected.offline, true)
    assert.equal(destination.readSettings().selectedNode, 'entry')
  } finally { rmSync(home, { recursive: true, force: true }) }
})
