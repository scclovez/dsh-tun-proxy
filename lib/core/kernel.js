/**
 * Kernel management: download / verify the mihomo binary and the wintun DLL it
 * needs to create the TUN adapter on Windows.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { execFile } from 'node:child_process'

import { download, fetchJson, fetchText } from './net.js'
import { runPs } from './ps.js'

const RELEASE_API = 'https://api.github.com/repos/MetaCubeX/mihomo/releases'
const WINTUN_URL = 'https://www.wintun.net/builds/wintun-0.14.1.zip'

/**
 * Public GitHub proxies tried when a direct download fails (or first, when the
 * user configured githubMirror). They only ever see a public release URL.
 * Order reflects measured throughput from mainland China; every mirror serves
 * the same immutable release asset, so a slower one is only a fallback.
 */
export const DEFAULT_MIRRORS = Object.freeze(['https://gh-proxy.org', 'https://gh-proxy.com'])

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

async function downloadWithFallback(urls, destination, { onProgress, timeoutMs } = {}) {
  const errors = []
  for (const url of urls) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await download(url, destination, { onProgress, timeoutMs })
        return { ...result, url }
      }
      catch (error) {
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

/** Resolve a release (latest when version is empty). */
export async function resolveRelease({ version = '', mirror = '' } = {}) {
  const url = version ? `${RELEASE_API}/tags/${encodeURIComponent(version)}` : `${RELEASE_API}/latest`
  const release = await fetchJson(url, { headers: { accept: 'application/vnd.github+json' } })
  const asset = pickAsset(release.assets ?? [])
  return {
    tag: release.tag_name,
    assetName: asset.name,
    assetSize: asset.size,
    url: asset.browser_download_url,
    source: release.html_url,
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
        `Expand-Archive -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(destination)} -Force`,
        { timeoutMs: 240000 },
      )
      return 'Expand-Archive'
    }
    catch (psError) {
      throw new Error(`解压失败：tar: ${tarError.message} / Expand-Archive: ${psError.message}`)
    }
  }
}

function findFile(root, pattern) {
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
      else if (pattern.test(entry.name)) return full
    }
  }
  return ''
}

/**
 * Install or update the kernel.
 *
 * @returns {Promise<{kernelPath: string, version: string, tag: string, asset: string, bytes: number, extractor: string}>}
 */
export async function installKernel({ paths, settings, onProgress, force = false, version = '' }) {
  mkdirSync(paths.bin, { recursive: true })
  mkdirSync(paths.cache, { recursive: true })
  if (settings.kernelPath !== '') {
    if (!existsSync(settings.kernelPath)) throw new Error(`kernelPath 不存在：${settings.kernelPath}`)
    const version = await kernelVersion(settings.kernelPath)
    if (version === '') throw new Error(`kernelPath 不是可用的 mihomo：${settings.kernelPath}`)
    return { kernelPath: settings.kernelPath, path: settings.kernelPath, version, tag: version, asset: '(外部内核)', bytes: 0, extractor: '(none)', skipped: true }
  }
  const wanted = version || settings.kernelVersion
  const current = await kernelVersion(paths.kernel)
  const release = await resolveRelease({ version: wanted, mirror: settings.githubMirror })
  if (!force && current !== '' && current === release.tag) {
    return { kernelPath: paths.kernel, path: paths.kernel, version: current, tag: release.tag, asset: '(already installed)', bytes: 0, extractor: '(none)', skipped: true }
  }

  const zipPath = join(paths.cache, release.assetName)
  onProgress?.(`下载 ${release.assetName} …`)
  let lastPercent = -1
  let lastReportAt = 0
  const { bytes, url: downloadUrl } = await downloadWithFallback(
    downloadCandidates(release.url, settings.githubMirror),
    zipPath,
    {
      timeoutMs: 900000,
      onProgress: (state) => {
        const percent = state.total > 0 ? Math.floor((state.seen / state.total) * 100) : 0
        const now = Date.now()
        if (percent === lastPercent && now - lastReportAt < 2000) return
        lastPercent = percent
        lastReportAt = now
        onProgress?.(`下载 ${release.assetName} ${percent}%`)
      },
    },
  )

  const extractDir = join(paths.cache, `extract-${Date.now()}`)
  rmSync(extractDir, { recursive: true, force: true })
  const extractor = await extractZip(zipPath, extractDir)
  const binary = findFile(extractDir, /^mihomo.*\.exe$/iu) || findFile(extractDir, /\.exe$/iu)
  if (binary === '') throw new Error(`解压后没有找到 mihomo 可执行文件（${release.assetName}）`)

  const staged = `${paths.kernel}.new`
  rmSync(staged, { force: true })
  renameSync(binary, staged)
  rmSync(paths.kernel, { force: true })
  renameSync(staged, paths.kernel)
  rmSync(extractDir, { recursive: true, force: true })
  rmSync(zipPath, { force: true })

  const installed = await kernelVersion(paths.kernel)
  if (installed === '') throw new Error('已安装 mihomo，但 `mihomo -v` 没有输出，文件可能损坏')
  return { kernelPath: paths.kernel, path: paths.kernel, version: installed, tag: release.tag, asset: release.assetName, bytes, extractor, downloadUrl, skipped: false }
}

export function wintunCandidates(paths, settings, env = process.env) {
  const out = []
  if (settings.wintunPath) out.push(settings.wintunPath)
  out.push(paths.wintun)
  for (const extra of (env.DSH_TUN_PROXY_WINTUN_CANDIDATES ?? '').split(';')) {
    if (extra.trim() !== '') out.push(extra.trim())
  }
  return out
}

/**
 * Make sure bin/wintun.dll exists. Order: explicit setting, already installed,
 * common system locations, optional env candidates, then the official wintun build.
 */
export async function ensureWintun({ paths, settings, onProgress, env = process.env }) {
  const candidates = wintunCandidates(paths, settings, env)
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      if (candidate !== paths.wintun) {
        mkdirSync(dirname(paths.wintun), { recursive: true })
        writeFileSync(paths.wintun, (await import('node:fs')).readFileSync(candidate))
      }
      return { wintunPath: paths.wintun, source: candidate.startsWith(paths.home) ? 'plugin' : candidate }
    }
  }
  mkdirSync(paths.cache, { recursive: true })
  const zipPath = join(paths.cache, basename(WINTUN_URL))
  const dir = join(paths.cache, 'wintun')
  onProgress?.('下载 wintun.dll …')
  await downloadWithFallback([WINTUN_URL], zipPath, { timeoutMs: 300000 })
  rmSync(dir, { recursive: true, force: true })
  await extractZip(zipPath, dir)
  const dll = findFile(join(dir, 'bin'), /^wintun\.dll$/iu) || findFile(dir, /^wintun\.dll$/iu)
  if (dll === '') throw new Error('wintun 压缩包里没有 wintun.dll')
  mkdirSync(dirname(paths.wintun), { recursive: true })
  rmSync(paths.wintun, { force: true })
  writeFileSync(paths.wintun, (await import('node:fs')).readFileSync(dll))
  const size = statSync(paths.wintun).size
  rmSync(zipPath, { force: true })
  rmSync(dir, { recursive: true, force: true })
  return { wintunPath: paths.wintun, source: 'download', bytes: size }
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
