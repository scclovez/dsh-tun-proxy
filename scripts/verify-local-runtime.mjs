import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { verifyArtifact } from '../lib/core/artifacts.js'
const root = fileURLToPath(new URL('../', import.meta.url))
const reportFile = new URL('../docs/evidence/local-runtime.json', import.meta.url)
const downloaded = JSON.parse(readFileSync(new URL('../docs/evidence/downloads.json', import.meta.url)))
const kernel = downloaded.kernel.path
verifyArtifact({ file: kernel, expectedSha256: downloaded.kernel.verification.executableSha256 })
const result = spawnSync(process.execPath, ['--test', 'test/mihomo.integration.test.mjs', 'test/process-ownership.test.mjs', 'test/system-proxy.test.mjs'], {
  cwd: root, env: { ...process.env, DSH_TEST_KERNEL: kernel }, windowsHide: true, encoding: 'utf8', timeout: 180000,
})
const report = { checkedAt: new Date().toISOString(), node: process.version, kernelVersion: downloaded.kernel.version,
  realKernel: true, tunEnabled: false, realSystemProxyModified: false,
  passed: result.status === 0 && !result.error, output: result.stdout, error: result.error?.message || result.stderr || null,
}
writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.passed ? 0 : 1
