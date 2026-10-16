import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'

import { candidateProfileRoots, dshHome, layout, pluginHome } from '../lib/core/paths.js'

test('DSH_HOME and DSH_TUN_PROXY_HOME override the state directory', () => {
  const env = { DSH_HOME: 'C:\\dsh', DSH_TUN_PROXY_HOME: 'D:\\state' }
  assert.equal(dshHome(env), 'C:\\dsh')
  assert.equal(pluginHome(env), 'D:\\state')
  assert.equal(pluginHome({ DSH_HOME: 'C:\\dsh' }), join('C:\\dsh', 'tun-proxy'))
})

test('layout keeps every managed file under one home', () => {
  const paths = layout('C:\\state')
  for (const key of ['bin', 'data', 'logs', 'cache', 'profiles']) {
    assert.ok(paths[key].startsWith('C:\\state'), `${key} must live under home`)
  }
  assert.ok(paths.kernel.endsWith('mihomo.exe'))
  assert.ok(paths.wintun.endsWith('wintun.dll'))
  assert.ok(paths.configFile.endsWith('config.yaml'))
  assert.ok(paths.settingsFile.endsWith('settings.json'))
})

test('candidate profile roots cover Clash Verge Rev, FlClash and legacy dirs', () => {
  const roots = candidateProfileRoots({ APPDATA: 'C:\\Roaming', LOCALAPPDATA: 'C:\\Local', USERPROFILE: 'C:\\Users\\x' })
  assert.ok(roots.some((root) => root.includes('clash-verge-rev')))
  assert.ok(roots.some((root) => root.includes('FlClash')))
  assert.ok(roots.every((root) => root.startsWith('C:\\')))
})
