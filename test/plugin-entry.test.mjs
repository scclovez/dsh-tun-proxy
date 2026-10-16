/**
 * Contract test for the DSH-facing half of the plugin.
 *
 * The plugin imports `@deepseek-ai/dsh-tools` and `@deepseek-ai/schemastery`,
 * which only exist inside a running DSH. To test the entry contract anyway we
 * copy `lib/` into a temp package, add minimal stubs for those two modules and
 * then drive `apply()` with a fake cordis context — exactly what DSH does.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')

function writeStub(root, name, source) {
  const dir = join(root, 'node_modules', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '0.0.0', type: 'module', main: 'index.js' }))
  writeFileSync(join(dir, 'index.js'), source)
}

function stagePackage() {
  const temp = mkdtempSync(join(tmpdir(), 'dsh-tun-proxy-entry-'))
  cpSync(join(packageRoot, 'lib'), join(temp, 'lib'), { recursive: true })
  cpSync(join(packageRoot, 'web'), join(temp, 'web'), { recursive: true })
  cpSync(join(packageRoot, 'node_modules', 'yaml'), join(temp, 'node_modules', 'yaml'), { recursive: true })
  writeFileSync(join(temp, 'package.json'), JSON.stringify({ name: 'dsh-tun-proxy', type: 'module', main: 'lib/index.js' }))
  writeStub(temp, '@deepseek-ai/dsh-tools', 'export function defineTool(definition) { return definition }\n')
  writeStub(temp, '@deepseek-ai/dsh-typert-protocol', 'export class TypertRemoteService {}\n')
  writeStub(
    temp,
    '@deepseek-ai/schemastery',
    'function node() { const chain = { default: () => chain, description: () => chain, required: () => chain }; return chain }\n'
      + 'export default { object: () => node(), boolean: () => node(), string: () => node(), array: () => node(), dict: () => node() }\n',
  )
  return temp
}

function fakeContext() {
  const tools = []
  const routes = []
  const effects = []
  const ctx = {
    tools,
    routes,
    effects,
    inject(deps, callback) {
      if (deps.includes('tools')) callback({ tools: { register: (tool) => tools.push(tool) } })
      if (deps.includes('webServer')) {
        callback({
          webServer: { register: (route) => { routes.push(route); return () => {} } },
          effect: (fn, label) => { effects.push({ label, dispose: fn() }) },
        })
      }
    },
    effect(fn, label) {
      effects.push({ label, dispose: fn() })
    },
  }
  return ctx
}

test('apply() registers seven tools, panel routes and the autostart effect', async () => {
  const temp = stagePackage()
  const stateHome = join(temp, 'state')
  process.env.DSH_TUN_PROXY_HOME = stateHome
  try {
    const plugin = await import(pathToFileURL(join(temp, 'lib', 'index.js')).href)
    assert.equal(plugin.name, 'dsh-tun-proxy')
    assert.equal(typeof plugin.apply, 'function')
    assert.ok(plugin.Config, 'Config schema must be exported')

    const ctx = fakeContext()
    plugin.apply(ctx, { autoStart: false })

    assert.deepEqual(
      ctx.tools.map((tool) => tool.name).sort(),
      ['tun_proxy_chain', 'tun_proxy_config', 'tun_proxy_install', 'tun_proxy_nodes', 'tun_proxy_start', 'tun_proxy_status', 'tun_proxy_stop'],
    )
    for (const tool of ctx.tools) {
      assert.ok(tool.description.length > 20, `${tool.name} needs a description`)
      assert.equal(typeof tool.execute, 'function')
      assert.ok(tool.output?.schema, `${tool.name} needs an output schema`)
    }
    assert.deepEqual(ctx.routes.map((route) => route.path), ['/tun-proxy/panel', '/tun-proxy/panel.js', '/tun-proxy/panel-style.js', '/tun-proxy/select.js', '/tun-proxy/state', '/tun-proxy/action'])
    assert.ok(ctx.effects.some((effect) => effect.label === 'dsh-tun-proxy: autostart'))
    for (const effect of ctx.effects) assert.equal(typeof effect.dispose, 'function')
  }
  finally {
    delete process.env.DSH_TUN_PROXY_HOME
    rmSync(temp, { recursive: true, force: true })
  }
})

test('tools return structured errors instead of throwing', async () => {
  const temp = stagePackage()
  const stateHome = join(temp, 'state')
  process.env.DSH_TUN_PROXY_HOME = stateHome
  try {
    const plugin = await import(pathToFileURL(join(temp, 'lib', 'index.js')).href)
    const ctx = fakeContext()
    plugin.apply(ctx, { autoStart: false })
    const byName = new Map(ctx.tools.map((tool) => [tool.name, tool]))

    // No kernel installed in this throwaway home: start must fail as data, not as an exception.
    const started = await byName.get('tun_proxy_start').execute({ skipInstallCheck: true }, { signal: undefined })
    assert.equal(started.ok, false)
    assert.match(started.error, /mihomo|内核/u)

    const configured = await byName.get('tun_proxy_config').execute({ action: 'set', mixedPort: 7899 })
    assert.equal(configured.ok, true)
    assert.equal(configured.settings.mixedPort, 7899)

    const bad = await byName.get('tun_proxy_config').execute({ action: 'set', mixedPort: 70000 })
    assert.equal(bad.ok, false)
    assert.match(bad.error, /mixedPort/u)

    const imported = await byName.get('tun_proxy_config').execute({ action: 'import', source: 'ss://' + Buffer.from('aes-128-gcm:test').toString('base64') + '@127.0.0.1:8388#test' })
    assert.equal(imported.ok, true)
    assert.equal(imported.nodes[0].name, 'test')
  }
  finally {
    delete process.env.DSH_TUN_PROXY_HOME
    rmSync(temp, { recursive: true, force: true })
  }
})
