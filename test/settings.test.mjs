import assert from 'node:assert/strict'
import test from 'node:test'

import { SETTINGS_DEFAULTS, applyPatch, maskUrl, normalizeSettings, publicSettings } from '../lib/core/settings.js'

test('defaults normalize without changes', () => {
  const settings = normalizeSettings({})
  assert.equal(settings.mixedPort, 17890)
  assert.equal(settings.tunEnable, true)
  assert.equal(settings.dnsMode, 'redir-host')
  assert.equal(settings.dnsListen, '127.0.0.1:10530')
  assert.deepEqual(settings.dnsFallback, [])
  assert.deepEqual(settings.dnsServers, SETTINGS_DEFAULTS.dnsServers)
})

test('rejects unknown keys', () => {
  assert.throws(() => normalizeSettings({ nope: 1 }), /未知设置项/u)
})

test('rejects out-of-range ports and equal ports', () => {
  assert.throws(() => normalizeSettings({ mixedPort: 0 }), /mixedPort/u)
  assert.throws(() => normalizeSettings({ mixedPort: 7890, controllerPort: 7890 }), /controllerPort/u)
})

test('rejects non-absolute paths and bad urls', () => {
  assert.throws(() => normalizeSettings({ profilePath: 'profiles/a.yaml' }), /绝对路径/u)
  assert.throws(() => normalizeSettings({ subscriptionUrl: 'ftp://example.com/a' }), /http\(s\)/u)
})

test('rejects invalid tun device and enums', () => {
  assert.throws(() => normalizeSettings({ tunDevice: 'bad device!' }), /tunDevice/u)
  assert.throws(() => normalizeSettings({ dnsMode: 'redir' }), /dnsMode/u)
  assert.throws(() => normalizeSettings({ tunStack: 'bogus' }), /tunStack/u)
  assert.throws(() => normalizeSettings({ mode: 'bogus' }), /mode/u)
})

test('applyPatch keeps unrelated settings', () => {
  const base = normalizeSettings({})
  const next = applyPatch(base, { mixedPort: 7897, dnsMode: 'redir-host' })
  assert.equal(next.mixedPort, 7897)
  assert.equal(next.dnsMode, 'redir-host')
  assert.equal(next.tunStack, base.tunStack)
})

test('subscription tokens are masked', () => {
  assert.equal(maskUrl('https://sub.example.com/api/v1/client/subscribe?token=abc'), 'https://sub.example.com/…')
  const view = publicSettings(normalizeSettings({ subscriptionUrl: 'https://sub.example.com/x?token=abc' }))
  assert.equal(view.subscriptionConfigured, true)
  assert.ok(!view.subscriptionUrl.includes('abc'))
})
