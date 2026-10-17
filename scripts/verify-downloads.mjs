/** Real downloads and executable probes, confined to a new Node-created temp directory. No TUN/registry changes. */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { layout } from '../lib/core/paths.js'
import { installKernel, ensureWintun } from '../lib/core/kernel.js'
import { SETTINGS_DEFAULTS } from '../lib/core/settings.js'
import { KERNEL_RELEASES, DEFAULT_KERNEL_VERSION, WINTUN_BUILD } from '../lib/core/artifacts.js'

const evidenceDir = fileURLToPath(new URL('../docs/evidence/', import.meta.url))
mkdirSync(evidenceDir, { recursive: true })
const testDir = mkdtempSync(join(tmpdir(), 'dsh-verified-download-'))
const paths = layout(testDir)
const settings = { ...SETTINGS_DEFAULTS, kernelPath: '', wintunPath: '', tunEnable: false, systemProxy: false }
const pin = KERNEL_RELEASES[DEFAULT_KERNEL_VERSION]
const report = { checkedAt: new Date().toISOString(), node: process.version, platform: process.platform, testDirectory: testDir, checks: {} }
try {
  const response = await fetch(`https://api.github.com/repos/MetaCubeX/mihomo/releases/tags/${DEFAULT_KERNEL_VERSION}`, {
    headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000),
  })
  if (response.ok) {
    const release = await response.json()
    const asset = release.assets.find(item => item.name === pin.asset)
    assert.equal(asset.digest, 'sha256:' + pin.sha256)
    assert.equal(asset.size, pin.size)
    report.release = { tag: release.tag_name, source: release.html_url, asset: asset.name, digest: asset.digest, size: asset.size }
  } else {
    const source = `https://github.com/MetaCubeX/mihomo/releases/expanded_assets/${DEFAULT_KERNEL_VERSION}`
    const page = await fetch(source, { signal: AbortSignal.timeout(30000) })
    if (!page.ok) throw new Error(`GitHub asset page: HTTP ${page.status}`)
    const html = await page.text()
    const at = html.indexOf('/' + pin.asset + '"')
    assert.ok(at >= 0, 'asset link missing from official page')
    const entry = html.slice(at, html.indexOf('</li>', at))
    assert.ok(entry.includes(pin.sha256), 'official asset digest does not match pin')
    report.release = { tag: DEFAULT_KERNEL_VERSION, source, asset: pin.asset, digest: 'sha256:' + pin.sha256, apiStatus: response.status }
  }
  report.checks.upstreamDigest = true
  report.wintunTrustSource = 'https://www.wintun.net/'
  report.kernel = await installKernel({ paths, settings, onProgress: message => console.log(message) })
  report.wintun = await ensureWintun({ paths, settings, env: {}, onProgress: message => console.log(message) })
  assert.equal(report.kernel.verification.verified, true)
  assert.equal(report.wintun.dll.sha256, WINTUN_BUILD.dll.sha256)
  report.checks.verifiedDownloadInstallAndProbe = true
} catch (error) { report.error = error.message; process.exitCode = 1 }
writeFileSync(resolve(evidenceDir, 'downloads.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
// Keep the directory as inspectable evidence. Never clean a user-supplied path.
