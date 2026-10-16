import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('PowerShell 5.1 install/uninstall preserve profile data and strict JSON compatibility', {
  skip: process.platform !== 'win32',
}, () => {
  const temp = mkdtempSync(join(tmpdir(), 'dsh-tun-proxy-profile-'))
  const profile = join(temp, 'profile')
  mkdirSync(profile)
  const manifest = join(profile, 'package.json')
  const original = {
    name: 'profile-fixture',
    description: '保留原有配置',
    dependencies: { 'existing-plugin': 'file:C:/existing' },
    dsh: { profile: { bundles: ['existing-plugin'] } },
  }
  // An earlier version of the installer left this BOM in the real profile.
  writeFileSync(manifest, '\uFEFF' + JSON.stringify(original))
  const runScript = (name, args = []) => {
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', join(pluginRoot, 'scripts', name),
      '-PluginPath', pluginRoot, '-ProfileDir', profile, '-SkipPnpm', ...args,
    ], { encoding: 'utf8', timeout: 30000 })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const bytes = readFileSync(manifest)
    assert.notEqual(bytes.subarray(0, 3).toString('hex'), 'efbbbf')
    return JSON.parse(bytes.toString('utf8'))
  }
  try {
    const installed = runScript('install.ps1')
    assert.equal(installed.description, original.description)
    assert.equal(installed.dependencies['existing-plugin'], original.dependencies['existing-plugin'])
    assert.equal(installed.dependencies['dsh-tun-proxy'], 'file:' + pluginRoot.replaceAll('\\', '/'))
    assert.deepEqual(installed.dsh.profile.bundles, ['existing-plugin', 'dsh-tun-proxy'])
    const uninstalled = runScript('uninstall.ps1', ['-StateDir', join(temp, 'unused-state')])
    assert.deepEqual(uninstalled, original)
  }
  finally {
    rmSync(temp, { recursive: true, force: true })
  }
})
