/**
 * Integrity material for everything this plugin downloads and then executes.
 *
 * The plugin runs a proxy kernel (mihomo) and loads a TUN driver DLL
 * (wintun.dll), both fetched at runtime. Downloads may pass through a GitHub
 * mirror, so the bytes are only trustworthy when they are checked against a
 * digest that the mirror cannot rewrite. This module is the single place that
 * defines those trust anchors and the primitives that enforce them:
 *
 *   - pinned SHA-256 digests for a reviewed kernel release and for the
 *     official wintun build (see KERNEL_RELEASES / WINTUN_BUILD),
 *   - `verifyArtifact`, which refuses to accept a file without verification
 *     material and aborts on a size or digest mismatch,
 *   - `stageReplacement`, an atomic file swap that keeps the previously
 *     installed file until the new one has been proven to work.
 *
 * Deliberately no network or process access here: this file is pure filesystem
 * + crypto so it can be unit tested, and so the trust policy is auditable in
 * one place. Anything that fails verification must never be extracted,
 * replaced or executed; callers use ArtifactIntegrityError as a hard stop, not
 * as a retryable network error.
 */
import { createHash } from 'node:crypto'
import { closeSync, existsSync, openSync, readSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename } from 'node:path'

const HASH_CHUNK_BYTES = 1024 * 1024

/**
 * A verification failure. `code` is stable and deliberately distinct from
 * ordinary network errors, so retry logic can tell "this mirror served the
 * wrong bytes, stop now" apart from "this mirror timed out, try the next one".
 */
export class ArtifactIntegrityError extends Error {
  constructor(message, { code = 'integrity-mismatch', artifact = '', url = '', expected = '', actual = '', size = 0, expectedSize = 0 } = {}) {
    super(message)
    this.name = 'ArtifactIntegrityError'
    this.code = code
    this.artifact = artifact
    this.url = url
    this.expected = expected
    this.actual = actual
    this.size = size
    this.expectedSize = expectedSize
  }
}

/**
 * Accept a hex SHA-256 with an optional `sha256:` prefix (the form GitHub uses
 * for release-asset digests). Returns lowercase hex, or '' when the value is
 * not a digest — callers must treat '' as "no verification material", never as
 * "nothing to check".
 */
export function normalizeSha256(value) {
  if (typeof value !== 'string') return ''
  const text = value.trim().toLowerCase().replace(/^sha256:/u, '')
  return /^[a-f0-9]{64}$/u.test(text) ? text : ''
}

export function isSha256(value) {
  return normalizeSha256(value) !== ''
}

/** SHA-256 of a file, streamed so a 60 MB executable does not need one buffer. */
export function sha256File(file) {
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES)
  const fd = openSync(file, 'r')
  try {
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null)
      if (read <= 0) break
      hash.update(buffer.subarray(0, read))
    }
  }
  finally {
    closeSync(fd)
  }
  return hash.digest('hex')
}

/**
 * Verify one downloaded/staged file against a trusted digest.
 *
 * Throws instead of returning a boolean: silently ignoring a missing digest is
 * exactly the failure mode this module exists to prevent. `expectedSize` (the
 * size published next to the digest) is checked first because it is cheap and
 * catches truncated transfers before hashing.
 *
 * @returns {{ sha256: string, size: number, expected: string }}
 */
export function verifyArtifact({ file, expectedSha256, expectedSize = 0, artifact = '文件', url = '' }) {
  const expected = normalizeSha256(expectedSha256)
  if (expected === '') {
    throw new ArtifactIntegrityError(`${artifact}缺少可信的 SHA-256 校验材料，已中止（不会解压、替换或执行）`, {
      code: 'integrity-unpinned',
      artifact,
      url,
      expectedSize,
      size: 0,
    })
  }
  if (!existsSync(file)) {
    throw new ArtifactIntegrityError(`${artifact}不存在：${file}`, { code: 'integrity-missing-file', artifact, url })
  }
  const size = statSync(file).size
  if (Number.isSafeInteger(expectedSize) && expectedSize > 0 && size !== expectedSize) {
    throw new ArtifactIntegrityError(
      `${artifact}大小不符（应为 ${expectedSize} 字节，实际 ${size} 字节），已中止：${url || file}`,
      { code: 'integrity-size-mismatch', artifact, url, expected, size, expectedSize },
    )
  }
  const actual = sha256File(file)
  if (actual !== expected) {
    throw new ArtifactIntegrityError(
      `${artifact} SHA-256 校验失败（应为 ${expected}，实际 ${actual}），已中止并保留旧版本：${url || file}`,
      { code: 'integrity-mismatch', artifact, url, expected, actual, size, expectedSize },
    )
  }
  return { sha256: actual, size, expected }
}

/**
 * Atomically put `sourceFile` in place of `targetFile`, keeping the old file as
 * `<target>.previous` until the caller commits.
 *
 * A failed rename never leaves the target missing: when the old file was moved
 * aside and the new one cannot be moved in, the old file is put back
 * immediately. `bytes`/`mtime` are unchanged for the old file, so a failed
 * update cannot break a working proxy.
 *
 * @returns {{ path: string, backup: string, hadPrevious: boolean, commit: () => void, rollback: () => void }}
 */
export function stageReplacement(sourceFile, targetFile) {
  const backup = `${targetFile}.previous`
  const hadPrevious = existsSync(targetFile)
  if (existsSync(backup)) throw new Error(`Unfinished replacement: preserve ${backup} and recover it before retrying`)
  if (hadPrevious) {
    try {
      renameSync(targetFile, backup)
    }
    catch (error) {
      throw new Error(`无法替换 ${basename(targetFile)}：旧文件正在被占用或没有权限（${error.message}）。请先停止代理再重试。`)
    }
  }
  try {
    renameSync(sourceFile, targetFile)
  }
  catch (error) {
    if (hadPrevious) {
      try {
        renameSync(backup, targetFile)
      }
      catch { /* the previous file remains at `.previous` for manual recovery */ }
    }
    throw new Error(`无法写入 ${basename(targetFile)}：${error.message}`)
  }
  let settled = false
  return {
    path: targetFile,
    backup,
    hadPrevious,
    /** New file verified: drop the old copy. */
    commit() {
      if (settled) return
      settled = true
      if (hadPrevious) rmSync(backup, { force: true })
    },
    /** New file failed: restore the previous file byte for byte. */
    rollback() {
      if (settled) return
      settled = true
      rmSync(targetFile, { force: true })
      if (hadPrevious && existsSync(backup)) renameSync(backup, targetFile)
    },
  }
}

/**
 * Reviewed mihomo release(s) with pinned digests.
 *
 * Every entry is a trust anchor: install with `kernelVersion` set to one of
 * these tags is fully deterministic and needs no network metadata beyond the
 * archive itself. The archive digest was taken from the SHA-256 published on
 * the GitHub release page (asset digest, also returned by the Releases API as
 * `assets[].digest`) and cross-checked against an independent mirror download;
 * the executable digest is computed from the verified archive. When adding a
 * release, update this table in a dedicated commit so the change is reviewable.
 */
export const KERNEL_RELEASES = Object.freeze({
  'v1.19.32': Object.freeze({
    tag: 'v1.19.32',
    asset: 'mihomo-windows-amd64-compatible-v1.19.32.zip',
    url: 'https://github.com/MetaCubeX/mihomo/releases/download/v1.19.32/mihomo-windows-amd64-compatible-v1.19.32.zip',
    size: 22525067,
    sha256: '974a4d7ad69aed27aa2e8f91d61113573c14dadb14562c63e58effabf59816f0',
    executable: Object.freeze({
      name: 'mihomo-windows-amd64-compatible.exe',
      size: 61276672,
      sha256: '04f8d7fc2b314771e1ecbf15951d59f0e1cb7914503c88cfb6972ff6a824e314',
    }),
    source: 'https://github.com/MetaCubeX/mihomo/releases/tag/v1.19.32',
    publishedAt: '2026-09-30T17:09:21Z',
    digestOrigin: 'GitHub Release asset digest (sha256) shown on the release page; cross-checked with an independent mirror download and with the previously installed binary.',
  }),
})

/** Kernel version used when the user has not chosen one: a pinned, reviewed build. */
export const DEFAULT_KERNEL_VERSION = 'v1.19.32'

/** Pinned digest for one specific tag+asset, or null. */
export function kernelPin(tag) {
  return typeof tag === 'string' && Object.hasOwn(KERNEL_RELEASES, tag) ? KERNEL_RELEASES[tag] : null
}

/** Pinned digest for a tag when the release publishes the expected asset name. */
export function kernelPinForAsset(tag, assetName) {
  const pin = kernelPin(tag)
  return pin !== null && pin.asset === assetName ? pin : null
}

/**
 * Official Wintun build. Both the archive and the amd64 DLL inside it are
 * pinned; the DLL also carries a valid Authenticode signature from WireGuard
 * LLC, but the digest is the actual gate because it is exact and offline.
 */
export const WINTUN_BUILD = Object.freeze({
  version: '0.14.1',
  url: 'https://www.wintun.net/builds/wintun-0.14.1.zip',
  size: 750540,
  sha256: '07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51',
  dll: Object.freeze({
    /** Path inside the archive; the `bin` directory contains x86/arm/arm64 too. */
    path: 'wintun/bin/amd64/wintun.dll',
    size: 427552,
    sha256: 'e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce',
    signer: 'CN=WireGuard LLC, O=WireGuard LLC, L=Boulder, S=Colorado, C=US',
  }),
  source: 'https://www.wintun.net/builds/wintun-0.14.1.zip',
  digestOrigin: 'SHA-256 computed from the official wintun.net build archive; the amd64 DLL hash is pinned separately and its Authenticode signature verified as WireGuard LLC.',
})
