import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertProfileText,
  composeConfig,
  directConfig,
  looksLikeProfile,
  managedBlock,
  stripTopLevelKeys,
} from '../lib/core/yaml-config.js'
import { normalizeSettings } from '../lib/core/settings.js'

const settings = normalizeSettings({ mixedPort: 7897, controllerPort: 9097, dnsMode: 'fake-ip' })

test('stripTopLevelKeys removes a managed key and its nested block', () => {
  const input = [
    '# my profile',
    'tun:',
    '  enable: true',
    '  stack: gvisor',
    'proxies:',
    '  - name: a',
    '    type: ss',
    'dns:',
    '  enable: false',
    'rules:',
    '  - MATCH,DIRECT',
    '',
  ].join('\n')
  const out = stripTopLevelKeys(input, ['tun', 'dns', 'mixed-port'])
  assert.ok(!out.includes('gvisor'))
  assert.ok(!out.includes('enable: false'))
  assert.ok(out.includes('# my profile'))
  assert.ok(out.includes('proxies:'))
  assert.ok(out.includes('  - name: a'))
  assert.ok(out.includes('rules:'))
  assert.ok(out.includes('  - MATCH,DIRECT'))
})

test('stripTopLevelKeys keeps unmanaged list items at column 0', () => {
  const input = 'rules:\n  - DOMAIN,a\n  - MATCH,DIRECT\nproxy-providers:\n  p:\n    type: http\n'
  const out = stripTopLevelKeys(input, ['tun'])
  assert.equal(out.trim(), input.trim())
})

test('looksLikeProfile distinguishes yaml from html', () => {
  assert.equal(looksLikeProfile('proxies:\n  - name: a\n'), true)
  assert.equal(looksLikeProfile('<!doctype html><html></html>'), false)
  assert.equal(looksLikeProfile('{"a":1}'), false)
})

test('assertProfileText rejects an empty or rule-less document', () => {
  assert.throws(() => assertProfileText('', '订阅'), /为空/u)
  assert.throws(() => assertProfileText('<html>nope</html>'), /不是 Clash/u)
  assert.throws(() => assertProfileText('mixed-port: 7890\n'), /没有 proxies/u)
  assert.deepEqual(assertProfileText('proxies: []\nrules:\n  - MATCH,DIRECT\n').rules, true)
})

test('composeConfig overrides managed keys and keeps imported rules', () => {
  const base = [
    'mixed-port: 1111',
    'secret: "old"',
    'tun:',
    '  enable: false',
    'proxies:',
    '  - name: node-1',
    '    type: ss',
    'rules:',
    '  - MATCH,node-1',
    '',
  ].join('\n')
  const out = composeConfig({ base, settings, secret: 'new-secret' })
  assert.ok(out.includes('mixed-port: 7897'))
  assert.ok(!out.includes('1111'))
  assert.ok(out.includes("secret: 'new-secret'"))
  assert.ok(!out.includes('"old"'))
  assert.equal(out.match(/mixed-port:/gu).length, 1)
  assert.equal(out.match(/^tun:/gmu).length, 1)
  assert.ok(out.includes('  - MATCH,node-1'))
  assert.ok(!out.includes('enable: false'))
})

test('composeConfig adds a catch-all when the profile has no rules', () => {
  const out = composeConfig({ base: 'proxies: []\n', settings, secret: 's' })
  assert.ok(out.includes('rules:'))
  assert.ok(out.includes('  - MATCH,DIRECT'))
})

test('composeConfig does not duplicate an existing rules section', () => {
  const out = composeConfig({ base: 'rules:\n  - MATCH,DIRECT\n', settings, secret: 's' })
  assert.equal(out.match(/(^|\n)rules:/gu).length, 1)
})

test('redir-host mode omits fake-ip keys', () => {
  const block = managedBlock(normalizeSettings({ dnsMode: 'redir-host' }), 's')
  assert.ok(block.includes('enhanced-mode: redir-host'))
  assert.ok(!block.includes('fake-ip-range'))
})

test('directConfig is a complete standalone config', () => {
  const out = directConfig(settings, 'secret')
  assert.ok(out.includes('tun:'))
  assert.ok(out.includes('  enable: true'))
  assert.ok(out.includes('  - MATCH,DIRECT'))
})
