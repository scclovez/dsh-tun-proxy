import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json')))
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json')))
const pinned = lock.packages['node_modules/yaml']
assert.equal(manifest.dependencies.yaml, '2.9.1')
assert.equal(pinned.version, manifest.dependencies.yaml)
assert.deepEqual(Object.keys(lock.packages).sort(), ['', 'node_modules/yaml'])
const metadataURL = `https://registry.npmjs.org/yaml/${pinned.version}`
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response
}
const metadata = await (await get(metadataURL)).json()
assert.equal(metadata.version, pinned.version)
assert.match(metadata.gitHead, /^[a-f0-9]{40}$/)
assert.equal(metadata.dist.integrity, pinned.integrity, 'lock SRI must match the official registry')
assert.equal(new URL(metadata.dist.tarball).origin, 'https://registry.npmjs.org')
assert.deepEqual(metadata.dependencies ?? {}, {}, 'yaml runtime dependency tree must remain empty')
const tarball = Buffer.from(await (await get(metadata.dist.tarball)).arrayBuffer())
const integrity = 'sha512-' + createHash('sha512').update(tarball).digest('base64')
assert.equal(integrity, pinned.integrity, 'tarball SRI mismatch')
const evidence = {
  checkedAt: new Date().toISOString(), node: process.version,
  package: 'yaml', version: pinned.version, metadataURL,
  tarball: metadata.dist.tarball, integrity, sha256: createHash('sha256').update(tarball).digest('hex'),
  gitHead: metadata.gitHead, repository: metadata.repository, license: metadata.license,
  upstreamSource: `https://github.com/eemeli/yaml/tree/${metadata.gitHead}`,
  runtimeDependencies: metadata.dependencies ?? {}, optionalHostPeers: manifest.peerDependencies,
  note: 'Host peers are supplied by DSH and excluded from the plugin runtime dependency lock.',
}
mkdirSync(resolve(root, 'docs/evidence'), { recursive: true })
writeFileSync(resolve(root, 'docs/evidence/supply-chain.json'), JSON.stringify(evidence, null, 2) + '\n')
console.log(JSON.stringify(evidence, null, 2))
