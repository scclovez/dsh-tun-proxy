/**
 * Acceptance-style tests for the download verification contract in
 * docs/AUDIT-EVIDENCE.md (修复项 1):
 *
 *  - a correct digest installs the artifact,
 *  - a wrong digest aborts and leaves the old kernel in place,
 *  - a mirror serving tampered bytes is rejected (and not retried),
 *  - missing verification material fails closed before downloading,
 *  - an unusable executable is rolled back to the previous version,
 *  - the same guarantees apply to wintun.dll (archive and amd64 DLL).
 *
 * All network/process access is injected, so these run offline and never touch
 * the real plugin state directory.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ArtifactIntegrityError, KERNEL_RELEASES } from '../lib/core/artifacts.js'
import { ensureWintun, installKernel, resolveRelease, verifyManagedKernel } from '../lib/core/kernel.js'
import { layout } from '../lib/core/paths.js'

const digest = (data) => createHash('sha256').update(data).digest('hex')

const ZIP_BYTES = Buffer.from('fixture-mihomo-archive-v1.19.32')
const EXE_BYTES = Buffer.from('fixture-mihomo-executable')
const OLD_BYTES = Buffer.from('previous-working-mihomo-executable')

const RELEASE = {
  tag: 'v1.19.32',
  assetName: 'fixture-mihomo-v1.19.32.zip',
  assetSize: ZIP_BYTES.length,
  url: 'https://github.com/MetaCubeX/mihomo/releases/download/v1.19.32/fixture-mihomo-v1.19.32.zip',
  source: 'https://github.com/MetaCubeX/mihomo/releases/tag/v1.19.32',
  sha256: digest(ZIP_BYTES),
  sha256Source: 'pinned',
  executable: { name: 'mihomo.exe', size: EXE_BYTES.length, sha256: digest(EXE_BYTES) },
  pinned: true,
}

const SETTINGS = Object.freeze({
  kernelPath: '',
  kernelVersion: 'v1.19.32',
  kernelSha256: '',
  githubMirror: '',
  wintunPath: '',
})

test('runtime checks reject same-size changes and require an installation digest for unpinned kernels', async () => withHome(async ({ paths }) => {
  const settings = { ...SETTINGS, kernelVersion: 'v9.9.9' }
  writeFileSync(paths.kernel, EXE_BYTES)
  assert.throws(() => verifyManagedKernel(paths, settings), { code: 'integrity-unpinned' })
  const record = { tag: 'v9.9.9', executableSha256: digest(EXE_BYTES), executableSize: EXE_BYTES.length }
  assert.equal(verifyManagedKernel(paths, settings, record).sha256, digest(EXE_BYTES))
  writeFileSync(paths.kernel, Buffer.alloc(EXE_BYTES.length, 0x41))
  assert.throws(() => verifyManagedKernel(paths, settings, record), { code: 'integrity-mismatch' })
}))

test('runtime verification preserves explicit user trust and does not apply a different release pin', async () => withHome(async ({ paths }) => {
  writeFileSync(paths.kernel, EXE_BYTES)
  const record = { tag: SETTINGS.kernelVersion, source: 'user', executableSha256: digest(EXE_BYTES), executableSize: EXE_BYTES.length }
  assert.equal(verifyManagedKernel(paths, SETTINGS, record).sha256, digest(EXE_BYTES))
  assert.deepEqual(verifyManagedKernel(paths, { ...SETTINGS, kernelPath: 'user-selected.exe' }), { external: true, verified: false })
}))

async function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-kernel-install-'))
  const paths = layout(home)
  mkdirSync(paths.bin, { recursive: true })
  mkdirSync(paths.cache, { recursive: true })
  try {
    return await fn({ home, paths })
  }
  finally {
    rmSync(home, { recursive: true, force: true })
  }
}

/**
 * @param {object} [options]
 * @param {object} [options.release] release descriptor returned by the resolver
 * @param {Buffer} [options.downloadBytes] bytes a "remote" URL serves
 * @param {Buffer} [options.extractedExe] bytes placed in the extracted archive
 * @param {(url: string) => Buffer} [options.downloadFor] per-URL download body
 * @param {(file: string) => string} [options.probe] `mihomo -v` result
 */
function makeDeps({ release = RELEASE, downloadBytes = ZIP_BYTES, extractedExe = EXE_BYTES, downloadFor, probe } = {}) {
  const calls = { download: [], extract: 0, probe: [], resolve: [] }
  const deps = {
    resolveRelease: async (options) => {
      calls.resolve.push(options)
      return { ...release }
    },
    download: async (url, destination) => {
      calls.download.push(url)
      const bytes = downloadFor ? downloadFor(url) : downloadBytes
      writeFileSync(destination, bytes)
      return { bytes: bytes.length, total: bytes.length }
    },
    extractZip: async (_zip, destination) => {
      calls.extract++
      mkdirSync(destination, { recursive: true })
      writeFileSync(join(destination, 'mihomo.exe'), extractedExe)
      return 'stub'
    },
    kernelVersion: async (file) => {
      calls.probe.push(file)
      if (probe) return probe(file)
      if (!existsSync(file)) return ''
      return readFileSync(file).equals(EXE_BYTES) ? 'v1.19.32' : 'v1.19.31'
    },
  }
  return { deps, calls }
}

function assertCleanup(paths) {
  assert.equal(existsSync(`${paths.kernel}.new`), false, 'staged kernel must not be left behind')
  assert.equal(existsSync(`${paths.kernel}.previous`), false, 'previous-kernel backup must not be left behind')
}

test('correct digest installs the kernel and reports the verified digests', async () => withHome(async ({ paths }) => {
  writeFileSync(paths.kernel, OLD_BYTES)
  const { deps, calls } = makeDeps()
  const result = await installKernel({ paths, settings: SETTINGS, deps })

  assert.equal(result.skipped, false)
  assert.equal(result.version, 'v1.19.32')
  assert.equal(result.verification.verified, true)
  assert.equal(result.verification.sha256, digest(ZIP_BYTES))
  assert.equal(result.verification.expected, digest(ZIP_BYTES))
  assert.equal(result.verification.source, 'pinned')
  assert.equal(result.verification.executableSha256, digest(EXE_BYTES))
  assert.equal(result.verification.executableExpected, digest(EXE_BYTES))
  assert.deepEqual(readFileSync(paths.kernel), EXE_BYTES)
  assert.equal(calls.extract, 1)
  assert.deepEqual(readdirSync(paths.cache), [], 'archive and extraction directory must be cleaned up')
  assertCleanup(paths)

  // A second call with the recorded verified digest is a no-op, not a download.
  const skipped = await installKernel({ paths, settings: SETTINGS, deps, installedSha256: digest(ZIP_BYTES) })
  assert.equal(skipped.skipped, true)
  assert.equal(skipped.verification.verified, true)
  assert.equal(calls.download.length, 1, 'verified same-version install must not download again')
}))

test('a wrong digest aborts the install and keeps the old kernel intact', async () => withHome(async ({ paths }) => {
  writeFileSync(paths.kernel, OLD_BYTES)
  const tampered = Buffer.from(ZIP_BYTES)
  tampered[0] ^= 0xff
  const { deps, calls } = makeDeps({ release: { ...RELEASE, sha256: digest(Buffer.from('some-other-archive')) }, downloadBytes: tampered })

  await assert.rejects(
    () => installKernel({ paths, settings: SETTINGS, deps }),
    (error) => error instanceof ArtifactIntegrityError && error.code === 'integrity-mismatch',
  )
  assert.deepEqual(readFileSync(paths.kernel), OLD_BYTES, 'old kernel must be preserved byte for byte')
  assert.equal(calls.extract, 0, 'tampered archive must never be extracted')
  assertCleanup(paths)
}))

test('a tampering GitHub mirror is rejected without falling back to other URLs', async () => withHome(async ({ paths }) => {
  writeFileSync(paths.kernel, OLD_BYTES)
  const tampered = Buffer.from(ZIP_BYTES)
  tampered[1] ^= 0xff
  const { deps, calls } = makeDeps({
    downloadFor: (url) => (url.startsWith('https://mirror.example/') ? tampered : ZIP_BYTES),
  })
  const settings = { ...SETTINGS, githubMirror: 'https://mirror.example' }

  await assert.rejects(
    () => installKernel({ paths, settings, deps }),
    (error) => error instanceof ArtifactIntegrityError
      && error.code === 'integrity-mismatch'
      && error.url.startsWith('https://mirror.example/'),
  )
  assert.equal(calls.download.length, 1, 'an integrity failure must stop the candidate loop immediately')
  assert.equal(calls.download[0].startsWith('https://mirror.example/'), true, 'the mirror is the first candidate')
  assert.deepEqual(readFileSync(paths.kernel), OLD_BYTES)
  assert.equal(calls.extract, 0)
  assertCleanup(paths)
}))

test('missing verification material fails closed before any download', async () => withHome(async ({ paths }) => {
  writeFileSync(paths.kernel, OLD_BYTES)
  const { deps, calls } = makeDeps({ release: { ...RELEASE, sha256: '', executable: null } })

  await assert.rejects(
    () => installKernel({ paths, settings: SETTINGS, deps }),
    (error) => error instanceof ArtifactIntegrityError && error.code === 'integrity-unpinned',
  )
  assert.equal(calls.download.length, 0, 'nothing may be downloaded without a trusted digest')
  assert.equal(calls.probe.length, 0, 'an unverified old kernel must not be executed either')
  assert.deepEqual(readFileSync(paths.kernel), OLD_BYTES)
  assertCleanup(paths)
}))

test('an archive replaced after download verification is rejected before extraction', async () => withHome(async ({ paths }) => {
  writeFileSync(paths.kernel, OLD_BYTES)
  const { deps, calls } = makeDeps()
  await assert.rejects(() => installKernel({ paths, settings: SETTINGS, deps,
    onProgress(message) { if (message.startsWith('解压并')) writeFileSync(join(paths.cache, RELEASE.assetName), 'changed archive') },
  }), ArtifactIntegrityError)
  assert.equal(calls.extract, 0)
  assert.equal(calls.probe.length, 0)
  assert.deepEqual(readFileSync(paths.kernel), OLD_BYTES)
}))

test('a staged binary replaced before execution is rejected and rolls back', async () => withHome(async ({ paths }) => {
  writeFileSync(paths.kernel, OLD_BYTES)
  const { deps, calls } = makeDeps()
  await assert.rejects(() => installKernel({ paths, settings: SETTINGS, deps,
    onProgress(message) { if (message.startsWith('替换内核')) writeFileSync(`${paths.kernel}.new`, 'changed binary') },
  }), ArtifactIntegrityError)
  assert.equal(calls.probe.length, 0)
  assert.deepEqual(readFileSync(paths.kernel), OLD_BYTES)
  assertCleanup(paths)
}))

test('a same-size replacement invalidates an installed-digest record', async () => withHome(async ({ paths }) => {
  const changed = Buffer.from(EXE_BYTES); changed[0] ^= 1
  writeFileSync(paths.kernel, changed)
  const { deps, calls } = makeDeps()
  const result = await installKernel({ paths, settings: SETTINGS, deps, installedSha256: digest(ZIP_BYTES) })
  assert.equal(result.skipped, false)
  assert.equal(calls.download.length, 1)
  assert.equal(calls.probe.length, 1, 'only the freshly verified replacement is executed')
  assert.deepEqual(readFileSync(paths.kernel), EXE_BYTES)
}))

test('a tampered executable inside a verified archive is rejected before replacement', async () => withHome(async ({ paths }) => {
  writeFileSync(paths.kernel, OLD_BYTES)
  const replaced = Buffer.from(EXE_BYTES)
  replaced[0] ^= 0xff
  const { deps } = makeDeps({ extractedExe: replaced })

  await assert.rejects(
    () => installKernel({ paths, settings: SETTINGS, deps }),
    (error) => error instanceof ArtifactIntegrityError && error.code === 'integrity-mismatch' && error.artifact === '解压后的 mihomo.exe',
  )
  assert.deepEqual(readFileSync(paths.kernel), OLD_BYTES)
  assertCleanup(paths)
}))

test('a verified but unusable executable is rolled back to the previous kernel', async () => withHome(async ({ paths }) => {
  writeFileSync(paths.kernel, OLD_BYTES)
  const { deps } = makeDeps({ probe: (file) => (readFileSync(file).equals(EXE_BYTES) ? '' : 'v1.19.31') })

  await assert.rejects(
    () => installKernel({ paths, settings: SETTINGS, deps }),
    (error) => error instanceof ArtifactIntegrityError && error.code === 'integrity-executable-unusable',
  )
  assert.deepEqual(readFileSync(paths.kernel), OLD_BYTES, 'the old kernel must be restored')
  assertCleanup(paths)
}))

test('an explicit sha256 override is handed to the resolver', async () => withHome(async ({ paths }) => {
  const { deps, calls } = makeDeps()
  const explicit = digest(ZIP_BYTES)
  await installKernel({ paths, settings: SETTINGS, deps, sha256: explicit })
  assert.equal(calls.resolve.length, 1)
  assert.equal(calls.resolve[0].sha256, explicit)
}))

test('resolveRelease resolves a pinned version offline', async () => {
  const result = await resolveRelease({
    version: 'v1.19.32',
    deps: { fetchJson: async () => { throw new Error('the pinned manifest must not touch the network') } },
  })
  const pin = KERNEL_RELEASES['v1.19.32']
  assert.equal(result.sha256, pin.sha256)
  assert.equal(result.sha256Source, 'pinned')
  assert.equal(result.assetName, pin.asset)
  assert.equal(result.assetSize, pin.size)
  assert.equal(result.executable.sha256, pin.executable.sha256)
})

test('resolveRelease uses the GitHub asset digest for an unpinned version', async () => {
  const published = 'b'.repeat(64)
  const apiRelease = {
    tag_name: 'v9.9.9',
    html_url: 'https://github.com/MetaCubeX/mihomo/releases/tag/v9.9.9',
    assets: [{
      name: 'mihomo-windows-amd64-compatible-v9.9.9.zip',
      size: 12345,
      browser_download_url: 'https://github.com/MetaCubeX/mihomo/releases/download/v9.9.9/mihomo-windows-amd64-compatible-v9.9.9.zip',
      digest: `sha256:${published}`,
    }],
  }
  const result = await resolveRelease({ version: 'v9.9.9', deps: { fetchJson: async () => apiRelease } })
  assert.equal(result.sha256, published)
  assert.equal(result.sha256Source, 'github-api')
  assert.equal(result.executable, null)
})

test('resolveRelease fails closed when neither a pin nor a published digest exists', async () => {
  const apiRelease = {
    tag_name: 'v9.9.9',
    html_url: 'https://github.com/MetaCubeX/mihomo/releases/tag/v9.9.9',
    assets: [{
      name: 'mihomo-windows-amd64-compatible-v9.9.9.zip',
      size: 12345,
      browser_download_url: 'https://github.com/MetaCubeX/mihomo/releases/download/v9.9.9/mihomo-windows-amd64-compatible-v9.9.9.zip',
      digest: null,
    }],
  }
  await assert.rejects(
    () => resolveRelease({ version: 'v9.9.9', deps: { fetchJson: async () => apiRelease } }),
    (error) => error instanceof ArtifactIntegrityError && error.code === 'integrity-unpinned',
  )
})

// ── wintun.dll ───────────────────────────────────────────────────────────────

const WINTUN_ZIP = Buffer.from('fixture-wintun-archive-0.14.1')
const WINTUN_DLL = Buffer.from('fixture-wintun-amd64-dll')
const OLD_DLL = Buffer.from('previously-installed-wintun-x86-or-unverified')

const WINTUN_BUILD = Object.freeze({
  version: '0.14.1',
  url: 'https://www.wintun.net/builds/wintun-0.14.1.zip',
  size: WINTUN_ZIP.length,
  sha256: digest(WINTUN_ZIP),
  dll: { path: 'wintun/bin/amd64/wintun.dll', size: WINTUN_DLL.length, sha256: digest(WINTUN_DLL), signer: '' },
})

function makeWintunDeps({ archive = WINTUN_ZIP, dll = WINTUN_DLL, extractLayout = 'amd64' } = {}) {
  const calls = { download: 0, extract: 0 }
  const deps = {
    wintunBuild: WINTUN_BUILD,
    download: async (_url, destination) => {
      calls.download++
      writeFileSync(destination, archive)
      return { bytes: archive.length, total: archive.length }
    },
    extractZip: async (_zip, destination) => {
      calls.extract++
      const dir = extractLayout === 'amd64' ? join(destination, 'wintun', 'bin', 'amd64') : join(destination, 'wintun', 'bin', 'x86')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'wintun.dll'), dll)
      return 'stub'
    },
  }
  return { deps, calls }
}

test('wintun: correct archive installs the verified amd64 DLL', async () => withHome(async ({ paths }) => {
  writeFileSync(paths.wintun, OLD_DLL)
  const { deps, calls } = makeWintunDeps()
  const result = await ensureWintun({ paths, settings: SETTINGS, env: {}, deps })
  assert.equal(result.verified, true)
  assert.equal(result.source, 'download')
  assert.equal(result.dll.sha256, digest(WINTUN_DLL))
  assert.equal(result.archive.sha256, digest(WINTUN_ZIP))
  assert.deepEqual(readFileSync(paths.wintun), WINTUN_DLL)
  assert.equal(calls.download, 1)
}))

test('wintun: a tampered archive is rejected and the old DLL is kept', async () => withHome(async ({ paths }) => {
  writeFileSync(paths.wintun, OLD_DLL)
  const { deps } = makeWintunDeps({ archive: Buffer.concat([WINTUN_ZIP, Buffer.from('tampered')]) })
  await assert.rejects(
    () => ensureWintun({ paths, settings: SETTINGS, env: {}, deps }),
    (error) => error instanceof ArtifactIntegrityError && error.code === 'integrity-size-mismatch',
  )
  assert.deepEqual(readFileSync(paths.wintun), OLD_DLL)
}))

test('wintun: an archive without the amd64 DLL is rejected', async () => withHome(async ({ paths }) => {
  writeFileSync(paths.wintun, OLD_DLL)
  const { deps } = makeWintunDeps({ extractLayout: 'x86' })
  await assert.rejects(
    () => ensureWintun({ paths, settings: SETTINGS, env: {}, deps }),
    (error) => error instanceof ArtifactIntegrityError && error.code === 'integrity-missing-file',
  )
  assert.deepEqual(readFileSync(paths.wintun), OLD_DLL)
}))

test('wintun: an already verified managed DLL needs no download', async () => withHome(async ({ paths }) => {
  writeFileSync(paths.wintun, WINTUN_DLL)
  const { deps, calls } = makeWintunDeps()
  const result = await ensureWintun({ paths, settings: SETTINGS, env: {}, deps })
  assert.equal(result.verified, true)
  assert.equal(result.source, 'plugin')
  assert.equal(calls.download, 0)
}))

test('wintun: an explicit wintunPath is used but reported as unverified when it differs', async () => withHome(async ({ paths }) => {
  const custom = join(paths.home, 'my-wintun.dll')
  writeFileSync(custom, Buffer.from('custom-local-wintun'))
  const { deps, calls } = makeWintunDeps()
  const result = await ensureWintun({ paths, settings: { ...SETTINGS, wintunPath: custom }, env: {}, deps })
  assert.equal(result.verified, false)
  assert.match(result.warning, /摘要不一致/u)
  assert.equal(calls.download, 0, "the user's explicit local file is used as-is")
  assert.deepEqual(readFileSync(paths.wintun), Buffer.from('custom-local-wintun'))
}))
