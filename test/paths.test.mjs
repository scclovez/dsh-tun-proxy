import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { assertSafeStateHome } from '../lib/core/paths.js'

import { candidateProfileRoots, dshHome, layout, pluginHome } from '../lib/core/paths.js'

test('state roots cannot be the user home, DSH data, repository, or their ancestors', () => {
  for (const directory of [homedir(), process.cwd(), join(homedir(), '.dsh'), join(homedir(), '.dsh', 'sessions')]) {
    assert.throws(() => assertSafeStateHome(directory, {}), /Unsafe plugin state/)
  }
  assert.equal(assertSafeStateHome(join(homedir(), '.dsh', 'tun-proxy'), {}), join(homedir(), '.dsh', 'tun-proxy'))
})

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
