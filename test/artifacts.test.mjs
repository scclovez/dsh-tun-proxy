import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ArtifactIntegrityError,
  DEFAULT_KERNEL_VERSION,
  KERNEL_RELEASES,
  WINTUN_BUILD,
  isSha256,
  normalizeSha256,
  sha256File,
  stageReplacement,
  verifyArtifact,
} from '../lib/core/artifacts.js'

const sha256 = (data) => createHash('sha256').update(data).digest('hex')

function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-artifacts-'))
  try {
    return fn(dir)
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('normalizeSha256 accepts hex with or without the sha256: prefix', () => {
  const digest = 'a'.repeat(64)
  assert.equal(normalizeSha256(digest), digest)
  assert.equal(normalizeSha256(`sha256:${digest.toUpperCase()}`), digest)
  assert.equal(isSha256(digest), true)
  for (const value of ['', 'abc', 'sha256:', 'g'.repeat(64), null, undefined, 42]) {
    assert.equal(normalizeSha256(value), '', `unexpected digest for ${String(value)}`)
    assert.equal(isSha256(value), false)
  }
})

test('sha256File hashes the whole file', () => withTemp((dir) => {
  const file = join(dir, 'payload.bin')
  const bytes = Buffer.from('dsh-tun-proxy integrity fixture')
  writeFileSync(file, bytes)
  assert.equal(sha256File(file), sha256(bytes))
}))

test('verifyArtifact accepts a matching digest and size', () => withTemp((dir) => {
  const bytes = Buffer.from('verified artifact')
  const file = join(dir, 'a.zip')
  writeFileSync(file, bytes)
  const result = verifyArtifact({ file, expectedSha256: sha256(bytes), expectedSize: bytes.length, artifact: '测试包' })
  assert.equal(result.sha256, sha256(bytes))
  assert.equal(result.size, bytes.length)
}))

test('verifyArtifact fails closed when no digest is supplied', () => withTemp((dir) => {
  const file = join(dir, 'a.zip')
  writeFileSync(file, 'bytes')
  for (const expected of ['', undefined, 'sha256:', 'not-a-digest']) {
    assert.throws(
      () => verifyArtifact({ file, expectedSha256: expected, artifact: '测试包' }),
      (error) => error instanceof ArtifactIntegrityError && error.code === 'integrity-unpinned',
    )
  }
  // Nothing was mutated by a failed verification.
  assert.equal(readFileSync(file, 'utf8'), 'bytes')
}))

test('verifyArtifact rejects a truncated file by size before hashing', () => withTemp((dir) => {
  const file = join(dir, 'a.zip')
  writeFileSync(file, 'short')
  assert.throws(
    () => verifyArtifact({ file, expectedSha256: sha256('shorter'), expectedSize: 100, artifact: '测试包' }),
    (error) => error instanceof ArtifactIntegrityError && error.code === 'integrity-size-mismatch',
  )
}))

test('verifyArtifact rejects a digest mismatch (mirror tampering)', () => withTemp((dir) => {
  const file = join(dir, 'a.zip')
  writeFileSync(file, 'tampered bytes')
  assert.throws(
    () => verifyArtifact({ file, expectedSha256: sha256('official bytes'), expectedSize: 'tampered bytes'.length, artifact: '测试包', url: 'https://mirror.example/a.zip' }),
    (error) => error instanceof ArtifactIntegrityError
      && error.code === 'integrity-mismatch'
      && error.expected === sha256('official bytes')
      && error.actual === sha256('tampered bytes')
      && error.url === 'https://mirror.example/a.zip',
  )
}))

test('stageReplacement keeps the old file until commit', () => withTemp((dir) => {
  const target = join(dir, 'mihomo.exe')
  const staged = join(dir, 'mihomo.exe.new')
  writeFileSync(target, 'old kernel')
  writeFileSync(staged, 'new kernel')
  const replacement = stageReplacement(staged, target)
  assert.equal(readFileSync(target, 'utf8'), 'new kernel')
  assert.equal(readFileSync(`${target}.previous`, 'utf8'), 'old kernel')
  replacement.commit()
  assert.equal(readFileSync(target, 'utf8'), 'new kernel')
  assert.equal(existsSync(`${target}.previous`), false)
}))

test('stageReplacement rollback restores the previous bytes exactly', () => withTemp((dir) => {
  const target = join(dir, 'mihomo.exe')
  const staged = join(dir, 'mihomo.exe.new')
  writeFileSync(target, 'old kernel')
  writeFileSync(staged, 'unusable kernel')
  const replacement = stageReplacement(staged, target)
  replacement.rollback()
  assert.equal(readFileSync(target, 'utf8'), 'old kernel')
  assert.equal(existsSync(`${target}.previous`), false)
}))

test('an interrupted replacement backup is never silently discarded', () => withTemp(dir => {
  const target = join(dir, 'mihomo.exe'), staged = target + '.new'
  writeFileSync(target, 'uncertain current'); writeFileSync(target + '.previous', 'last working'); writeFileSync(staged, 'new')
  assert.throws(() => stageReplacement(staged, target), /Unfinished replacement/)
  assert.equal(readFileSync(target + '.previous', 'utf8'), 'last working')
  assert.equal(readFileSync(target, 'utf8'), 'uncertain current')
}))

test('pinned manifests are well formed and the default version is pinned', () => {
  assert.equal(normalizeSha256(KERNEL_RELEASES[DEFAULT_KERNEL_VERSION]?.sha256), KERNEL_RELEASES[DEFAULT_KERNEL_VERSION]?.sha256)
  for (const [tag, pin] of Object.entries(KERNEL_RELEASES)) {
    assert.equal(normalizeSha256(pin.sha256), pin.sha256, `${tag} archive digest`)
    assert.equal(normalizeSha256(pin.executable.sha256), pin.executable.sha256, `${tag} executable digest`)
    assert.ok(pin.size > 0, `${tag} archive size`)
    assert.ok(pin.executable.size > 0, `${tag} executable size`)
    assert.ok(pin.url.startsWith('https://github.com/'), `${tag} canonical URL`)
    assert.ok(pin.source.startsWith('https://github.com/'), `${tag} release page`)
  }
  assert.equal(normalizeSha256(WINTUN_BUILD.sha256), WINTUN_BUILD.sha256)
  assert.equal(normalizeSha256(WINTUN_BUILD.dll.sha256), WINTUN_BUILD.dll.sha256)
  assert.ok(WINTUN_BUILD.size > 0)
  assert.ok(WINTUN_BUILD.dll.size > 0)
  assert.ok(WINTUN_BUILD.dll.path.endsWith('amd64/wintun.dll'))
})
