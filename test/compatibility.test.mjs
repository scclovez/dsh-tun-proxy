/**
 * Static contract for the per-release DSH compatibility declaration.
 *
 * The DSH Store reads `dsh.compatibility.dshReleases` (exact release -> status)
 * and `dsh.compatibility.dshOperations` (install/start/uninstall/rollback) from
 * this manifest, plus `dsh` and `node` ranges. A wide range alone is not
 * evidence, so this test keeps the declaration internally consistent and
 * refuses silent claims that contradict the recorded operations.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const compatibility = manifest.dsh?.compatibility ?? {}

/** Key shape accepted by the Store catalog schema, plus official rc aliases. */
const RELEASE_KEY = /^(?:rc\.(?:7|8)|[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/u
const STATUSES = new Set(['compatible', 'incompatible', 'unknown'])
const OPERATIONS = ['install', 'start', 'uninstall', 'rollback']
const RESULTS = new Set(['passed', 'failed', 'unknown'])

function numeric(version) {
  const [core, prerelease = ''] = version.split('+')[0].split('-')
  return { parts: core.split('.').map(Number), prerelease }
}

/** Minimal caret/tilde/comparator handling for the ranges this package uses. */
function satisfies(version, range) {
  return range.split('||').some((clause) => clause.trim().split(/\s+/u).every((token) => {
    const match = /^(>=|<=|>|<|=|\^|~)?(.*)$/u.exec(token.trim())
    if (match === null || match[2] === '') return true
    const operator = match[1] ?? ''
    const target = numeric(match[2])
    const actual = numeric(version)
    const compare = (left, right) => {
      for (let index = 0; index < 3; index++) {
        if (left.parts[index] !== right.parts[index]) return left.parts[index] < right.parts[index] ? -1 : 1
      }
      // A release outranks its own prereleases.
      if (left.prerelease === right.prerelease) return 0
      if (left.prerelease === '') return 1
      if (right.prerelease === '') return -1
      return left.prerelease.localeCompare(right.prerelease, 'en', { numeric: true })
    }
    const relation = compare(actual, target)
    switch (operator) {
      case '>=': return relation >= 0
      case '>': return relation > 0
      case '<=': return relation <= 0
      case '<': return relation < 0
      case '^': return relation >= 0 && actual.parts[0] === target.parts[0]
      case '~': return relation >= 0 && actual.parts[0] === target.parts[0] && actual.parts[1] === target.parts[1]
      default: return relation === 0
    }
  }))
}

test('declares the compatibility block the Store catalog reads', () => {
  assert.equal(typeof compatibility.dsh, 'string')
  assert.equal(typeof compatibility.node, 'string')
  assert.ok(Array.isArray(compatibility.profiles))
  assert.ok(Array.isArray(compatibility.systems))
})

test('declares at least one exact compatible release inside the declared range', () => {
  const releases = compatibility.dshReleases ?? {}
  const compatible = Object.entries(releases).filter(([, status]) => status === 'compatible')
  assert.ok(compatible.length > 0, 'at least one exact release must be marked compatible')
  for (const [release] of compatible) {
    assert.match(release, RELEASE_KEY, `${release} must be an exact release key the catalog accepts`)
    assert.ok(satisfies(release, compatibility.dsh), `${release} must satisfy the declared dsh range ${compatibility.dsh}`)
  }
})

test('every declared release uses a known status and stays inside the range', () => {
  for (const [release, status] of Object.entries(compatibility.dshReleases ?? {})) {
    assert.match(release, RELEASE_KEY, `${release} must be an exact release key`)
    assert.ok(STATUSES.has(status), `${release} has unknown status ${JSON.stringify(status)}`)
    assert.ok(satisfies(release, compatibility.dsh), `${release} is outside the declared dsh range ${compatibility.dsh}`)
  }
})

test('operation records are complete and never contradict a compatible claim', () => {
  const releases = compatibility.dshReleases ?? {}
  for (const [release, record] of Object.entries(compatibility.dshOperations ?? {})) {
    assert.deepEqual(Object.keys(record).sort(), [...OPERATIONS].sort(), `${release} must record all four operations`)
    for (const operation of OPERATIONS) {
      assert.ok(RESULTS.has(record[operation]), `${release}.${operation} has unknown result ${JSON.stringify(record[operation])}`)
    }
  }
  for (const [release, status] of Object.entries(releases)) {
    if (status !== 'compatible') continue
    const record = compatibility.dshOperations?.[release]
    assert.ok(record !== undefined, `${release} is declared compatible but has no operation evidence`)
    assert.ok(Object.values(record).every((result) => result !== 'failed'), `${release} is compatible but an operation failed`)
  }
})

test('declared ranges mirror the packaged engines and peer requirements', () => {
  assert.equal(compatibility.node, manifest.engines?.node)
  assert.equal(compatibility.dsh, manifest.peerDependencies?.['@deepseek-ai/dsh'])
})

test('unverified releases stay unknown instead of being inferred', () => {
  const releases = compatibility.dshReleases ?? {}
  const unknown = Object.entries(releases).filter(([, status]) => status === 'unknown').map(([release]) => release)
  for (const release of unknown) {
    const record = compatibility.dshOperations?.[release]
    if (record === undefined) continue
    assert.ok(Object.values(record).every((result) => result !== 'passed'), `${release} has unknown compatibility but claims a passed operation`)
  }
})
