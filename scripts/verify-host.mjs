import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const desktop = resolve(process.argv[2] ?? '')
assert.ok(existsSync(desktop) && /\.exe$/i.test(desktop), 'Pass the installed DeepSeek Harness.exe path')
const root = fileURLToPath(new URL('../', import.meta.url))
const staging = mkdtempSync(join(tmpdir(), 'dsh-host-audit-'))
const runtime = join(dirname(desktop), 'resources/app.asar/dsh/node_modules')
const cli = join(runtime, '@deepseek-ai/dsh/lib/bin.js')
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('DSH_')))
Object.assign(env, { ELECTRON_RUN_AS_NODE: '1', DSH_HOME: join(staging, 'home'), DSH_TUN_PROXY_HOME: join(staging, 'state') })
const run = args => {
  const result = spawnSync(desktop, [cli, ...args], { env, windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 })
  if (result.error) throw new Error((result.error.message + '\n' + result.stderr + '\n' + result.stdout).replace(/([?&]token=)[^\s&]+/g, '$1<redacted>').slice(-12000))
  if (result.status !== 0) throw new Error((`exit ${result.status}\n${result.stderr}\n${result.stdout}`).replace(/([?&]token=)[^\s&]+/g, '$1<redacted>').slice(-12000))
  return result.stdout.trim()
}
const version = run(['--version'])
const pkg = join(staging, 'plugin'); mkdirSync(pkg)
cpSync(join(root, 'lib'), join(pkg, 'lib'), { recursive: true })
cpSync(join(root, 'web'), join(pkg, 'web'), { recursive: true })
writeFileSync(join(pkg, 'package.json'), JSON.stringify({ type: 'module' }))
cpSync(join(root, 'node_modules/yaml'), join(pkg, 'node_modules/yaml'), { recursive: true })
for (const name of ['schemastery', 'dsh-tools', 'dsh-typert-protocol']) {
  const dir = join(pkg, 'node_modules/@deepseek-ai', name); mkdirSync(dir, { recursive: true })
  const entry = spawnSync(desktop, ['-e', `console.log(require.resolve(${JSON.stringify('@deepseek-ai/' + name)}, {paths:[${JSON.stringify(runtime)}]}))`], { env, windowsHide: true, encoding: 'utf8', timeout: 15000 })
  assert.equal(entry.status, 0, entry.stderr)
  const url = pathToFileURL(entry.stdout.trim()).href
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }))
  writeFileSync(join(dir, 'index.js'), `export * from ${JSON.stringify(url)};\n` + (name === 'schemastery' ? `export { default } from ${JSON.stringify(url)};\n` : ''))
}
const marker = join(staging, 'lifecycle.json')
const wrapper = join(staging, 'audit-entry.mjs')
writeFileSync(wrapper, `import * as plugin from ${JSON.stringify(pathToFileURL(join(pkg, 'lib/index.js')).href)};
import { writeFileSync } from 'node:fs';
export const name = 'dsh-tun-proxy-audit';
export const Config = plugin.Config;
const record = value => writeFileSync(${JSON.stringify(marker)}, JSON.stringify(value));
export function apply(ctx, config) {
  plugin.apply(ctx, config);
  record({ loaded: true });
  ctx.effect(() => () => record({ loaded: true, disposed: true }));
  setTimeout(async () => {
    try {
      let owner;
      for (const key of ['dispose', 'fiber', 'scope', 'root']) {
        try {
          const value = key === 'dispose' ? ctx : ctx[key];
          if (typeof value?.dispose === 'function') { owner = value; break; }
        } catch { /* un-injected service access can throw */ }
      }
      if (!owner) throw new Error('No plugin disposal API');
      await owner.dispose();
      process.exit(0);
    } catch (error) { record({ loaded: true, error: error.message }); process.exit(1); }
  }, 2000);
}
`)
const overlay = join(staging, 'audit.yml')
writeFileSync(overlay, `- insert:\n    - id: tun-proxy-audit\n      name: ${wrapper.replaceAll('\\', '/')}\n      config:\n        autoStart: false\n`)
const hostNode = spawnSync(desktop, ['--version'], { env, windowsHide: true, encoding: 'utf8', timeout: 15000 })
const report = { checkedAt: new Date().toISOString(), hostVersion: version, runnerNode: process.version, hostNode: hostNode.stdout.trim(), testDirectory: staging, checks: {} }
try {
  const imported = spawnSync(desktop, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(wrapper).href)})`], { env, windowsHide: true, encoding: 'utf8', timeout: 15000 })
  assert.equal(imported.status, 0, imported.stderr || imported.error?.message)
  report.checks.realPeerImports = true
  const composed = run(['--profile', 'audit', '--from-default-profile', 'web', '--patch', overlay, '--dump-config'])
  assert.ok(composed.includes('tun-proxy-audit'))
  report.checks.composition = true
  report.help = run(['--profile', 'audit', '--patch', overlay, '--help'])
  run(['--profile', 'audit', '--patch', overlay, '--host', '127.0.0.1', '--port', '0', '--no-open'])
  report.lifecycle = existsSync(marker) ? JSON.parse(readFileSync(marker)) : null
  report.checks.realPluginMounted = report.lifecycle?.loaded === true
  report.checks.disposed = report.lifecycle?.disposed === true
  assert.ok(report.checks.realPluginMounted && report.checks.disposed, 'plugin must mount and dispose in the actual host')
} catch (error) { report.error = error.message; process.exitCode = 1 }
if (existsSync(marker)) report.lifecycle = JSON.parse(readFileSync(marker))
mkdirSync(join(root, 'docs/evidence'), { recursive: true })
writeFileSync(join(root, 'docs/evidence/host.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
