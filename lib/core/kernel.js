/**
 * Kernel management: download, verify, install and roll back the mihomo binary
 * and the Wintun DLL it needs to create the TUN adapter on Windows.
 *
 * Trust model (see docs/AUDIT-EVIDENCE.md, 修复项 1):
 *  - The archive is checked against a pinned SHA-256 (reviewed release) or the
 *    digest GitHub publishes for the asset, and its byte size, *before* it is
 *    extracted. A GitHub mirror therefore cannot inject a different binary.
 *  - The executable/DLL extracted from the archive is checked against its pinned
 *    digest before it may replace a working file.
 *  - No verification material is a hard failure ("fail closed"), never a silent
 *    download-and-run. `mihomo -v` runs only *after* both checks pass; it proves
 *    the binary is runnable, it is not an integrity check by itself.
 *  - A failed install/update leaves the previously working kernel and wintun.dll
 *    in place (`stageReplacement` keeps the old file until commit).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { execFile } from 'node:child_process'

import { download, fetchJson, fetchText } from './net.js'
import { runPs } from './ps.js'
import {
  ArtifactIntegrityError,
  DEFAULT_KERNEL_VERSION,
  KERNEL_RELEASES,
  WINTUN_BUILD,
  kernelPin,
  kernelPinForAsset,
  normalizeSha256,
  sha256File,
  stageReplacement,
  verifyArtifact,
} from './artifacts.js'

const RELEASE_API = 'https://api.github.com/repos/MetaCubeX/mihomo/releases'

/**
 * Public GitHub proxies tried when a direct download fails (or first, when the
 * user configured githubMirror). They only ever see a public release URL.
 * Order reflects measured throughput from mainland China; every mirror serves
 * the same immutable release asset, so a slower one is only a fallback — and a
 * mirror that serves different bytes is rejected by the digest check.
 */
export const DEFAULT_MIRRORS = Object.freeze(['https://gh-proxy.org', 'https://gh-proxy.com'])

export { DEFAULT_KERNEL_VERSION }

/** Check managed bytes before any probe, configuration test or launch. */
export function verifyManagedKernel(paths, settings, record = {}) {
  if (settings.kernelPath) return { external: true, verified: false }
  const pin = record?.source === 'user' ? null : kernelPin(record?.tag || settings.kernelVersion)
  const expected = pin?.executable?.sha256 || record?.executableSha256
  return verifyArtifact({ file: paths.kernel, expectedSha256: expected, expectedSize: pin?.executable?.size || record?.executableSize, artifact: '管理的 mihomo.exe' })
}

export function mirrorRewrite(url, mirror) {
  if (!mirror) return url
  const base = mirror.replace(/\/+$/u, '')
  if (url.startsWith('https://github.com/')) return `${base}/${url}`
  return url
}

/** Candidate download URLs, most preferred first, without duplicates. */
export function downloadCandidates(url, mirror = '') {
  const out = []
  const push = (value) => {
    if (value && !out.includes(value)) out.push(value)
  }
  if (mirror) push(mirrorRewrite(url, mirror))
  if (url.startsWith('https://github.com/')) {
    for (const candidate of DEFAULT_MIRRORS) push(mirrorRewrite(url, candidate))
  }
  push(url)
  return out
}

/**
 * Download from the first candidate that yields bytes matching the trusted
 * digest. Network failures fall through to the next mirror; an integrity
 * failure stops immediately (retrying a tampered mirror is pointless and a
 * "successful" install from its bytes is exactly what must never happen).
 *
 * @returns {Promise<{ bytes: number, url: string, verification: { sha256: string, size: number, expected: string } }>}
 */
export async function downloadWithFallback(urls, destination, {
  onProgress,
  timeoutMs,
  expectedSha256,
  expectedSize = 0,
  downloadFn = download,
  artifact = '安装包',
} = {}) {
  const errors = []
  if (normalizeSha256(expectedSha256) === '') {
    throw new ArtifactIntegrityError(`${artifact}: missing trusted SHA-256`, { code: 'integrity-unpinned', artifact })
  }
  for (const url of urls) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await downloadFn(url, destination, { onProgress, timeoutMs })
        const verification = verifyArtifact({ file: destination, expectedSha256, expectedSize, artifact, url })
        return { ...result, url, verification }
      }
      catch (error) {
        if (error instanceof ArtifactIntegrityError) {
          rmSync(destination, { force: true })
          throw error
        }
        errors.push(`${url} (第 ${attempt} 次)：${error.message}`)
        if (attempt === 1) onProgress?.(`下载失败，重试 ${url}`)
      }
    }
  }
  throw new Error(`所有下载地址都失败：\n${errors.join('\n')}`)
}

function pickAsset(assets) {
  const zips = assets.filter((asset) => /windows-amd64.*\.zip$/iu.test(asset.name) && !/go1[0-9]{2}/u.test(asset.name))
  const preferred = zips.find((asset) => /compatible/iu.test(asset.name)) ?? zips[0]
    ?? assets.find((asset) => /windows-amd64.*\.zip$/iu.test(asset.name))
  if (!preferred) throw new Error('这个 mihomo 版本没有 windows-amd64 的 zip 资源')
  return preferred
}

/**
 * Resolve a release (latest when version is empty) and bind it to a digest.
 *
 * A version present in KERNEL_RELEASES resolves fully offline from the pinned
 * manifest. Otherwise the GitHub Releases API supplies the asset name, size,
 * URL and — for reviewed-by-GitHub assets — the `digest` field. `sha256` lets a
 * caller (or the `kernelSha256` setting) state the expected digest explicitly
 * for a version/mirror this project has not pinned; it is still mandatory.
 */
export async function resolveRelease({ version = '', mirror = '', sha256 = '', deps = {} } = {}) {
  const fetchRelease = deps.fetchJson ?? fetchJson
  const explicit = normalizeSha256(sha256)
  const pin = version ? kernelPin(version) : null
  if (pin !== null) {
    return {
      tag: pin.tag,
      assetName: pin.asset,
      assetSize: explicit === '' ? pin.size : 0,
      url: pin.url,
      source: pin.source,
      sha256: explicit || pin.sha256,
      sha256Source: explicit === '' ? 'pinned' : 'user',
      executable: explicit === '' ? pin.executable : null,
      pinned: true,
    }
  }

  const url = version ? `${RELEASE_API}/tags/${encodeURIComponent(version)}` : `${RELEASE_API}/latest`
  const release = await fetchRelease(url, { headers: { accept: 'application/vnd.github+json' } })
  const asset = pickAsset(release.assets ?? [])
  const tag = release.tag_name
  const pinnedForAsset = kernelPinForAsset(tag, asset.name)
  const published = normalizeSha256(asset.digest ?? '')
  const digest = explicit || (pinnedForAsset !== null ? pinnedForAsset.sha256 : '') || published
  if (digest === '') {
    throw new ArtifactIntegrityError(
      `mihomo ${tag} / ${asset.name} 没有可用的可信 SHA-256：Release 未提供 digest，本仓库也未固定该版本。`
      + `已拒绝下载安装。请把 kernelVersion 设为已固定版本（${Object.keys(KERNEL_RELEASES).join('、')}），`
      + '或用 kernelSha256 设置项提供来自可信渠道的 SHA-256。',
      { code: 'integrity-unpinned', artifact: 'mihomo 安装包', url: asset.browser_download_url },
    )
  }
  return {
    tag,
    assetName: asset.name,
    assetSize: asset.size,
    url: asset.browser_download_url,
    source: release.html_url,
    sha256: digest,
    sha256Source: explicit ? 'user' : pinnedForAsset !== null ? 'pinned' : 'github-api',
    executable: explicit ? null : pinnedForAsset !== null ? pinnedForAsset.executable : null,
    pinned: pinnedForAsset !== null || explicit !== '',
  }
}

/** Run `mihomo -v` (or `-t` for config test) and return raw output. */
export function runKernel(kernelPath, args, { timeoutMs = 120000, cwd } = {}) {
  return new Promise((resolve) => {
    execFile(kernelPath, args, { timeout: timeoutMs, windowsHide: true, cwd, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), error: error ?? null })
    })
  })
}

/** `mihomo -v` is cheap (95 ms) but status() asks for it on every call. */
const versionCache = new Map()

export async function kernelVersion(kernelPath) {
  if (!existsSync(kernelPath)) return ''
  let stamp = null
  try {
    const info = statSync(kernelPath)
    stamp = `${info.mtimeMs}:${info.size}`
    const cached = versionCache.get(kernelPath)
    if (cached !== undefined && cached.stamp === stamp) return cached.version
  }
  catch { /* fall through to a fresh probe */ }
  const result = await runKernel(kernelPath, ['-v'], { timeoutMs: 20000 })
  const text = `${result.stdout}\n${result.stderr}`
  const match = /v\d+\.\d+\.\d+/u.exec(text)
  const version = match ? match[0] : text.trim().split(/\r?\n/u)[0] ?? ''
  if (stamp !== null) versionCache.set(kernelPath, { stamp, version })
  return version
}

async function extractZip(zipPath, destination) {
  const psLiteral = value => `'${String(value).replaceAll("'", "''")}'`
  mkdirSync(destination, { recursive: true })
  try {
    await new Promise((resolve, reject) => {
      execFile('tar.exe', ['-xf', zipPath, '-C', destination], { windowsHide: true, timeout: 180000 }, (error, _stdout, stderr) => {
        if (error) reject(new Error(String(stderr).trim() || error.message))
        else resolve()
      })
    })
    return 'tar'
  }
  catch (tarError) {
    try {
      await runPs(
        `Expand-Archive -LiteralPath ${psLiteral(zipPath)} -DestinationPath ${psLiteral(destination)} -Force`,
        { timeoutMs: 240000 },
      )
      return 'Expand-Archive'
    }
    catch (psError) {
      throw new Error(`解压失败：tar: ${tarError.message} / Expand-Archive: ${psError.message}`)
    }
  }
}

/** All files below a directory, in a stable order. */
function collectFiles(root) {
  const out = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    }
    catch {
      continue
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) out.push(full)
    }
  }
  return out
}

/** The kernel executable inside an extracted archive, preferring the pinned name. */
export function findKernelExecutable(root, pinnedExecutable = null) {
  const executables = collectFiles(root).filter((file) => /\.exe$/iu.test(file))
  if (executables.length === 0) return ''
  if (pinnedExecutable?.name) {
    const exact = executables.find((file) => basename(file).toLowerCase() === pinnedExecutable.name.toLowerCase())
    if (exact !== undefined) return exact
  }
  return executables.find((file) => /^mihomo.*\.exe$/iu.test(basename(file))) ?? executables[0]
}

/** The amd64 wintun.dll inside the extracted official archive (never x86/arm). */
export function findWintunDll(root) {
  const files = collectFiles(root).map((file) => ({ file, rel: relative(root, file).replace(/\\/gu, '/').toLowerCase() }))
  const expected = WINTUN_BUILD.dll.path.toLowerCase()
  const exact = files.find(({ rel }) => rel === expected || rel.endsWith(`/${expected}`))
  if (exact !== undefined) return exact.file
  const amd64 = files.find(({ rel }) => /(^|\/)amd64\/wintun\.dll$/u.test(rel))
  if (amd64 !== undefined) return amd64.file
  throw new ArtifactIntegrityError(
    `wintun 安装包里没有 amd64 的 wintun.dll（只接受 windows-amd64），已中止。看到：${files.map(({ rel }) => rel).join(', ') || '(空)'}`,
    { code: 'integrity-missing-file', artifact: 'wintun 安装包' },
  )
}

/**
 * Install or update the kernel.
 *
 * @param {object} options
 * @param {string} [options.version] release tag, '' for the configured/default release
 * @param {string} [options.sha256] explicit trusted SHA-256 for the archive
 * @param {string} [options.installedSha256] digest recorded for the currently installed archive
 * @param {object} [options.deps] test seam: resolveRelease/download/extractZip/kernelVersion
 */
export async function installKernel({
  paths,
  settings,
  onProgress,
  force = false,
  version = '',
  sha256 = '',
  installedSha256 = '',
  installedExecutableSha256 = '',
  deps = {},
}) {
  const resolve = deps.resolveRelease ?? resolveRelease
  const downloadFn = deps.download ?? download
  const extract = deps.extractZip ?? extractZip
  const probe = deps.kernelVersion ?? kernelVersion

  mkdirSync(paths.bin, { recursive: true })
  mkdirSync(paths.cache, { recursive: true })
  if (settings.kernelPath !== '') {
    if (!existsSync(settings.kernelPath)) throw new Error(`kernelPath 不存在：${settings.kernelPath}`)
    const externalVersion = await probe(settings.kernelPath)
    if (externalVersion === '') throw new Error(`kernelPath 不是可用的 mihomo：${settings.kernelPath}`)
    return {
      kernelPath: settings.kernelPath,
      path: settings.kernelPath,
      version: externalVersion,
      tag: externalVersion,
      asset: '(外部内核)',
      bytes: 0,
      extractor: '(none)',
      skipped: true,
      external: true,
      verification: { sha256: '', expected: '', source: 'external', verified: false },
    }
  }

  const wanted = version || settings.kernelVersion
  const explicit = normalizeSha256(sha256) || normalizeSha256(settings.kernelSha256 ?? '')
  const release = await resolve({ version: wanted, mirror: settings.githubMirror, sha256: explicit })
  if (normalizeSha256(release.sha256) === '') {
    // Defensive: resolveRelease already fails closed, but install must never be
    // able to download first and ask questions later.
    throw new ArtifactIntegrityError(
      `mihomo ${release.tag ?? ''} 没有可信的 SHA-256 校验材料，已拒绝下载安装（不会解压、替换或执行）。`,
      { code: 'integrity-unpinned', artifact: 'mihomo 安装包', url: release.url ?? '' },
    )
  }

  if (!force && existsSync(paths.kernel) && explicit === '') {
    const recorded = normalizeSha256(installedSha256)
    const required = normalizeSha256(release.sha256)
    // Same version but no recorded verified digest (e.g. installed by a build
    // that predates verification): re-download once so the on-disk kernel is
    // proven against the pin instead of being blessed silently.
    const executableDigest = release.executable?.sha256 || installedExecutableSha256
    let intact = false
    if (normalizeSha256(executableDigest) !== '') {
      try { verifyArtifact({ file: paths.kernel, expectedSha256: executableDigest, expectedSize: release.executable?.size, artifact: '已安装的 mihomo.exe' }); intact = true }
      catch (error) { if (!(error instanceof ArtifactIntegrityError)) throw error }
    }
    if (recorded !== '' && recorded === required && intact) {
      return {
        kernelPath: paths.kernel,
        path: paths.kernel,
        version: release.tag,
        tag: release.tag,
        asset: '(already installed)',
        bytes: 0,
        extractor: '(none)',
        skipped: true,
        verification: { sha256: recorded, expected: required, source: 'installed', verified: true },
      }
    }
  }

  const zipPath = join(paths.cache, release.assetName)
  rmSync(zipPath, { force: true })
  onProgress?.(`下载 ${release.assetName}（SHA-256 ${release.sha256.slice(0, 12)}…）`)
  let lastPercent = -1
  let lastReportAt = 0
  const downloaded = await downloadWithFallback(downloadCandidates(release.url, settings.githubMirror), zipPath, {
    timeoutMs: 900000,
    expectedSha256: release.sha256,
    expectedSize: release.assetSize,
    downloadFn,
    artifact: 'mihomo 安装包',
    onProgress: (state) => {
      const percent = state.total > 0 ? Math.floor((state.seen / state.total) * 100) : 0
      const now = Date.now()
      if (percent === lastPercent && now - lastReportAt < 2000) return
      lastPercent = percent
      lastReportAt = now
      onProgress?.(`下载 ${release.assetName} ${percent}%`)
    },
  })

  const extractDir = join(paths.cache, `extract-${Date.now()}`)
  const staged = `${paths.kernel}.new`
  rmSync(extractDir, { recursive: true, force: true })
  rmSync(staged, { force: true })
  let replacement = null
  try {
    onProgress?.('解压并校验 mihomo …')
    verifyArtifact({ file: zipPath, expectedSha256: release.sha256, expectedSize: release.assetSize, artifact: '待解压的 mihomo 安装包' })
    const extractor = await extract(zipPath, extractDir)
    const binary = findKernelExecutable(extractDir, release.executable)
    if (binary === '') {
      throw new ArtifactIntegrityError('解压后没有找到 mihomo 可执行文件，已中止并保留旧版本', {
        code: 'integrity-missing-file',
        artifact: 'mihomo 安装包',
        url: release.url,
      })
    }
    const executable = release.executable === null || release.executable === undefined
      ? { sha256: sha256File(binary), size: statSync(binary).size, expected: '' }
      : verifyArtifact({
        file: binary,
        expectedSha256: release.executable.sha256,
        expectedSize: release.executable.size,
        artifact: '解压后的 mihomo.exe',
        url: release.url,
      })
    renameSync(binary, staged)
    verifyArtifact({ file: staged, expectedSha256: executable.sha256, expectedSize: executable.size, artifact: '待替换的 mihomo.exe' })

    onProgress?.('替换内核并运行 mihomo -v 验证 …')
    replacement = stageReplacement(staged, paths.kernel)
    verifyArtifact({ file: paths.kernel, expectedSha256: executable.sha256, expectedSize: executable.size, artifact: '待执行的 mihomo.exe' })
    const installed = await probe(paths.kernel)
    if (installed === '') {
      replacement.rollback()
      replacement = null
      throw new ArtifactIntegrityError(
        '新内核的 SHA-256 校验通过，但 `mihomo -v` 没有输出：文件可能损坏或与当前系统不兼容。已恢复旧版本。',
        { code: 'integrity-executable-unusable', artifact: 'mihomo 可执行文件', expected: executable.sha256 },
      )
    }
    verifyArtifact({ file: paths.kernel, expectedSha256: executable.sha256, expectedSize: executable.size, artifact: '执行后的 mihomo.exe' })
    replacement.commit()
    replacement = null

    rmSync(extractDir, { recursive: true, force: true })
    rmSync(zipPath, { force: true })
    return {
      kernelPath: paths.kernel,
      path: paths.kernel,
      version: installed,
      tag: release.tag,
      asset: release.assetName,
      bytes: downloaded.bytes,
      extractor,
      downloadUrl: downloaded.url,
      skipped: false,
      verification: {
        sha256: downloaded.verification.sha256,
        size: downloaded.verification.size,
        expected: release.sha256,
        source: release.sha256Source,
        verified: true,
        executableSha256: executable.sha256,
        executableSize: executable.size,
        executableExpected: release.executable?.sha256 ?? '',
      },
    }
  }
  catch (error) {
    if (replacement !== null) {
      try {
        replacement.rollback()
      }
      catch { /* the previous file remains at `.previous` for manual recovery */ }
    }
    rmSync(staged, { force: true })
    rmSync(extractDir, { recursive: true, force: true })
    rmSync(zipPath, { force: true })
    throw error
  }
}

/** Explicitly configured local wintun.dll candidates (user trust, hashed anyway). */
function explicitWintunCandidates(settings, env) {
  const out = []
  if (settings.wintunPath) out.push(settings.wintunPath)
  for (const extra of (env.DSH_TUN_PROXY_WINTUN_CANDIDATES ?? '').split(';')) {
    if (extra.trim() !== '') out.push(extra.trim())
  }
  return out
}

export function wintunCandidates(paths, settings, env = process.env) {
  const out = explicitWintunCandidates(settings, env)
  out.push(paths.wintun)
  return out
}

function describeLocalWintunSource(paths, candidate) {
  return candidate.startsWith(paths.home) ? 'plugin' : candidate
}

/**
 * Make sure bin/wintun.dll exists and is the verified amd64 build.
 *
 * Order:
 *  1. an explicitly configured local DLL (`wintunPath` / env) — used as the
 *     user asked, but the digest is still computed and reported;
 *  2. an already installed managed DLL — accepted only when it matches the
 *     pinned digest (a stale/unverified file is replaced, not trusted);
 *  3. the official pinned archive, where the archive *and* the amd64 DLL are
 *     verified before the DLL is put in place.
 */
export async function ensureWintun({ paths, settings, onProgress, env = process.env, deps = {} }) {
  const downloadFn = deps.download ?? download
  const extract = deps.extractZip ?? extractZip
  const build = deps.wintunBuild ?? WINTUN_BUILD
  const pinnedDll = build.dll

  for (const candidate of explicitWintunCandidates(settings, env)) {
    if (candidate === paths.wintun || !existsSync(candidate)) continue
    mkdirSync(dirname(paths.wintun), { recursive: true })
    const digest = sha256File(candidate)
    const size = statSync(candidate).size
    const verified = digest === pinnedDll.sha256
    const staged = `${paths.wintun}.new`
    rmSync(staged, { force: true })
    copyFileSync(candidate, staged)
    const replacement = stageReplacement(staged, paths.wintun)
    replacement.commit()
    return {
      wintunPath: paths.wintun,
      source: describeLocalWintunSource(paths, candidate),
      bytes: size,
      dll: { sha256: digest, size, expected: pinnedDll.sha256, verified },
      verified,
      warning: verified ? '' : `wintunPath 提供的 DLL 与本项目固定的 wintun ${build.version} amd64 版本摘要不一致（实际 ${digest}）。已按用户显式指定的本地文件使用；如非有意，请清空 wintunPath 让插件下载并校验官方 amd64 版本。`,
    }
  }

  if (existsSync(paths.wintun)) {
    try {
      const checked = verifyArtifact({ file: paths.wintun, expectedSha256: pinnedDll.sha256, artifact: '已安装的 wintun.dll' })
      return {
        wintunPath: paths.wintun,
        source: 'plugin',
        bytes: checked.size,
        dll: { sha256: checked.sha256, size: checked.size, expected: pinnedDll.sha256, verified: true },
        verified: true,
      }
    }
    catch (error) {
      if (!(error instanceof ArtifactIntegrityError)) throw error
      onProgress?.('已安装的 wintun.dll 与固定摘要不一致，重新下载官方 amd64 版本 …')
    }
  }

  mkdirSync(paths.cache, { recursive: true })
  const zipPath = join(paths.cache, basename(build.url))
  const dir = join(paths.cache, 'wintun')
  rmSync(zipPath, { force: true })
  rmSync(dir, { recursive: true, force: true })
  onProgress?.('下载 wintun.dll（校验 SHA-256）…')
  const downloaded = await downloadWithFallback([build.url], zipPath, {
    timeoutMs: 300000,
    expectedSha256: build.sha256,
    expectedSize: build.size,
    downloadFn,
    artifact: 'wintun 安装包',
  })

  let replacement = null
  const staged = `${paths.wintun}.new`
  try {
    verifyArtifact({ file: zipPath, expectedSha256: build.sha256, expectedSize: build.size, artifact: '待解压的 wintun 安装包' })
    await extract(zipPath, dir)
    const dll = findWintunDll(dir)
    const checked = verifyArtifact({
      file: dll,
      expectedSha256: pinnedDll.sha256,
      expectedSize: pinnedDll.size,
      artifact: '解压后的 wintun.dll（amd64）',
    })
    mkdirSync(dirname(paths.wintun), { recursive: true })
    rmSync(staged, { force: true })
    copyFileSync(dll, staged)
    const stagedCheck = verifyArtifact({
      file: staged,
      expectedSha256: pinnedDll.sha256,
      expectedSize: pinnedDll.size,
      artifact: '待安装的 wintun.dll',
    })
    replacement = stageReplacement(staged, paths.wintun)
    verifyArtifact({
      file: paths.wintun,
      expectedSha256: pinnedDll.sha256,
      expectedSize: pinnedDll.size,
      artifact: '已安装的 wintun.dll',
    })
    replacement.commit()
    replacement = null
    rmSync(zipPath, { force: true })
    rmSync(dir, { recursive: true, force: true })
    return {
      wintunPath: paths.wintun,
      source: 'download',
      bytes: checked.size,
      dll: { sha256: stagedCheck.sha256, size: stagedCheck.size, expected: pinnedDll.sha256, verified: true },
      verified: true,
      archive: {
        sha256: downloaded.verification.sha256,
        size: downloaded.verification.size,
        expected: build.sha256,
        url: downloaded.url,
      },
    }
  }
  catch (error) {
    if (replacement !== null) {
      try {
        replacement.rollback()
      }
      catch { /* the previous file remains at `.previous` for manual recovery */ }
    }
    rmSync(staged, { force: true })
    rmSync(zipPath, { force: true })
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
}

/**
 * Copy geodata from a local Clash-family installation when we have none.
 *
 * GEOIP/GEOSITE rules in imported profiles, and mihomo's own geodata, would
 * otherwise be downloaded from GitHub at startup — which is exactly what fails
 * on a machine that needs a proxy in the first place.
 */
export async function ensureGeodata({ paths }) {
  // mihomo downloads missing databases into its own data directory. Never
  // inspect or copy another application's files.
  return { copied: [], source: 'managed', directory: paths.data }
}

/** Validate a generated config with `mihomo -t` before we hand it to TUN. */
export async function testConfig({ paths, configFile, kernel = paths.kernel }) {
  const result = await runKernel(kernel, ['-t', '-d', paths.data, '-f', configFile], { timeoutMs: 60000, cwd: paths.data })
  const output = `${result.stdout}\n${result.stderr}`.trim()
  const ok = result.code === 0 && /configuration file .* test is successful/iu.test(output)
  return { ok, output, code: result.code }
}

export async function githubReachable() {
  try {
    await fetchText('https://api.github.com/repos/MetaCubeX/mihomo/releases/latest', { timeoutMs: 15000, maxBytes: 1024 })
    return true
  }
  catch {
    return false
  }
}
