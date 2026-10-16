import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer, connect } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createService } from '../lib/core/service.js'

const kernel = process.env.DSH_TEST_KERNEL
const listen = async (server) => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port }

function socksProxy(seen, sockets) {
  return createServer((socket) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {})
    let buffer = Buffer.alloc(0), phase = 'greeting'
    const onData = (data) => {
      buffer = Buffer.concat([buffer, data])
      if (phase === 'greeting') {
        if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return
        buffer = buffer.subarray(2 + buffer[1]); phase = 'request'; socket.write(Buffer.from([5, 0]))
      }
      if (phase === 'request') {
        if (buffer.length < 5) return
        let host, end
        if (buffer[3] === 1) { end = 8; if (buffer.length < end + 2) return; host = [...buffer.subarray(4, 8)].join('.') }
        else if (buffer[3] === 3) { end = 5 + buffer[4]; if (buffer.length < end + 2) return; host = buffer.subarray(5, end).toString() }
        else { socket.destroy(); return }
        const port = buffer.readUInt16BE(end)
        seen.push({ host, port }); phase = 'connecting'; socket.pause(); socket.removeListener('data', onData)
        const upstream = connect({ host, port }); sockets.add(upstream)
        upstream.on('close', () => sockets.delete(upstream))
        upstream.on('error', () => socket.destroy())
        socket.on('close', () => upstream.destroy())
        upstream.once('connect', () => {
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
          const rest = buffer.subarray(end + 2); if (rest.length) upstream.write(rest)
          socket.pipe(upstream); upstream.pipe(socket); socket.resume()
        })
      }
    }
    socket.on('data', onData)
  })
}

function throughMixedPort(port, targetPort) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    const chunks = []
    socket.setTimeout(10000, () => socket.destroy(new Error('HTTP proxy timeout')))
    socket.on('error', reject)
    socket.on('data', (data) => chunks.push(data))
    socket.on('end', () => resolve(Buffer.concat(chunks).toString()))
    socket.on('connect', () => socket.write(`GET http://127.0.0.1:${targetPort}/ HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\nConnection: close\r\n\r\n`))
  })
}

test('real mihomo sends traffic through every ordered hop and preserves service after invalid apply', { skip: !kernel, timeout: 120000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-proxy-chain-live-'))
  const sockets = new Set(), entrySeen = [], exitSeen = []
  const entry = socksProxy(entrySeen, sockets), exit = socksProxy(exitSeen, sockets)
  const target = createHttpServer((_, response) => { response.writeHead(200); response.end('dsh-chain-proof') })
  const freePort = async () => { const server = createServer(); const port = await listen(server); await new Promise((r) => server.close(r)); return port }
  let service
  try {
    const entryPort = await listen(entry), exitPort = await listen(exit), targetPort = await listen(target)
    const profile = join(home, 'profile.yaml')
    writeFileSync(profile, 'proxies: []\n')
    service = createService({ env: { ...process.env, DSH_TUN_PROXY_HOME: home } })
    service.updateSettings({ kernelPath: kernel, tunEnable: false, autoImport: false, profilePath: profile, mixedPort: await freePort(), controllerPort: await freePort(), dnsListen: '', mode: 'global', chainEnabled: true, chain: ['entry', 'exit'], manualProxies: [
      { name: 'entry', type: 'socks5', server: '127.0.0.1', port: entryPort },
      { name: 'exit', type: 'socks5', server: '127.0.0.1', port: exitPort },
    ] })
    const started = await service.start()
    assert.equal(started.started, true)
    const mixedPort = service.readSettings().mixedPort
    assert.match(await throughMixedPort(mixedPort, targetPort), /dsh-chain-proof/)
    const occupied = createServer()
    const occupiedPort = await listen(occupied)
    try {
      service.updateSettings({ controllerPort: occupiedPort })
      await assert.rejects(service.restart(), /占用/)
      assert.equal(service.readSettings().controllerPort, started.status.settings.controllerPort)
      assert.match(await throughMixedPort(mixedPort, targetPort), /dsh-chain-proof/)
    } finally { await new Promise((r) => occupied.close(r)) }
    assert.ok(entrySeen.some((item) => item.port === exitPort), 'entry must dial the exit proxy')
    assert.ok(exitSeen.some((item) => item.port === targetPort), 'exit must dial the target')
    assert.ok(!entrySeen.some((item) => item.port === targetPort), 'entry must never bypass exit')
    const runtime = await service.activity()
    assert.equal(runtime.running, true)
    assert.ok(runtime.uploadTotal + runtime.downloadTotal > 0)
    assert.ok((await service.rules()).rules.length >= 1)
    service.updateSettings({ customRules: ['DOMAIN-SUFFIX,example.org,DIRECT'], chain: ['entry', 'missing-exit'] })
    await assert.rejects(service.restart(), /不存在/)
    assert.deepEqual(service.readSettings().chain, ['entry', 'exit'])
    assert.match(await throughMixedPort(mixedPort, targetPort), /dsh-chain-proof/)
    const config = readFileSync(service.paths.configFile, 'utf8')
    assert.match(config, /dialer-proxy: DSH-HOP-1/)
    await service.stop()
    await service.addProfile({ name: 'standalone', source: `proxies: [{name: single-exit, type: socks5, server: 127.0.0.1, port: ${exitPort}}]` })
    service.updateSettings({ mode: 'rule', chainEnabled: false, selectedNode: 'single-exit', customRules: ['DOMAIN,example.org,DIRECT'] })
    await service.start()
    assert.equal((await service.nodes()).groups.find((group) => group.name === 'DSH-PROXY').now, 'single-exit')
    assert.match(await throughMixedPort(mixedPort, targetPort), /dsh-chain-proof/)
    assert.ok((await service.rules()).rules.some((rule) => rule.payload === 'example.org'))
    const activeId = service.profileList().activeId
    service.editProfile({ id: activeId, source: 'proxies: [{name: broken, type: invalid-protocol, server: localhost, port: 1080}]' })
    await assert.rejects(service.restart(), /校验/)
    assert.match(service.profileContent(activeId).content, /single-exit/)
    assert.match(await throughMixedPort(mixedPort, targetPort), /dsh-chain-proof/)
    console.log('PROOF: entry → exit → HTTP target; bad node and occupied port kept original proxy operational')
  } finally {
    if (service) await service.stop()
    for (const socket of sockets) socket.destroy()
    for (const server of [entry, exit, target]) await new Promise((r) => server.close(r))
    rmSync(home, { recursive: true, force: true })
  }
})
