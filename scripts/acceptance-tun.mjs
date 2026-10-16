import { connect } from 'node:net'
import { Resolver } from 'node:dns/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
import { createService } from '../lib/core/service.js'
import { defaultRoutes, tunAdapters, isAdmin } from '../lib/core/ps.js'
import { controllerRequest } from '../lib/core/net.js'
import { readFileSync } from 'node:fs'

const home = resolve(process.argv[2] ?? `acceptance/tun-${Date.now()}`)
const kernel = process.env.DSH_TEST_KERNEL
if (!kernel) throw new Error('Set DSH_TEST_KERNEL to an existing mihomo.exe')
if (!await isAdmin()) throw new Error('TUN acceptance requires administrator rights')
if ((await tunAdapters()).some((adapter) => adapter.status === 'Up')) throw new Error('An existing TUN is active; leave it untouched and retry after it is stopped')
mkdirSync(home, { recursive: true })
const service = createService({ env: { ...process.env, DSH_TUN_PROXY_HOME: home } })
service.updateSettings({ kernelPath: kernel, wintunPath: resolve(kernel, '..', 'wintun.dll'), autoImport: false, tunEnable: true, mixedPort: 17891, controllerPort: 19091, dnsListen: '127.0.0.1:18530', dnsMode: 'fake-ip', tunDevice: 'dsh-tun-accept', mode: 'rule' })
const before = await defaultRoutes()
const evidence = { time: new Date().toISOString(), home, checks: {} }
let socket
try {
  await service.start({ allowDirect: true })
  const status = await service.status({ verbose: true })
  assert.equal(status.tun.adapter?.name, 'dsh-tun-accept')
  assert.ok(status.tun.defaultRoutes.some((route) => Number(route.ifIndex) === Number(status.tun.adapter.ifIndex)))
  evidence.checks.adapterAndRoute = true
  const probeHost = '203.0.113.231', probePort = 54873
  socket = connect({ host: probeHost, port: probePort })
  socket.on('error', () => {})
  const secret = JSON.parse(readFileSync(service.paths.stateFile, 'utf8')).secret
  let captured = false
  for (let attempt = 0; attempt < 35; attempt++) {
    const result = await controllerRequest({ port: 19091, secret, path: '/connections' })
    captured = result.data?.connections?.some((connection) => connection.metadata?.destinationIP === probeHost && String(connection.metadata?.destinationPort) === String(probePort))
      || readFileSync(service.paths.logFile, 'utf8').includes(`${probeHost}:${probePort}`)
    if (captured) break
    await new Promise((r) => setTimeout(r, 1000))
  }
  assert.ok(captured, 'the exact test TCP connection must appear in the controller or kernel log')
  evidence.checks.exactTcpCaptured = true
  evidence.probe = `${probeHost}:${probePort} (documentation address, proves interception rather than Internet reachability)`
  const resolver = new Resolver(); resolver.setServers(['127.0.0.1:18530'])
  const addresses = await resolver.resolve4('dsh-acceptance.example.com')
  assert.ok(addresses.some((address) => address.startsWith('198.18.')))
  evidence.checks.dnsFakeIp = true
} catch (error) {
  evidence.error = error.message
  process.exitCode = 1
} finally {
  socket?.destroy()
  try {
    await service.stop()
    evidence.checks.adapterRemoved = !(await tunAdapters()).some((adapter) => adapter.name === 'dsh-tun-accept')
    const after = await defaultRoutes()
    const normalize = (routes) => routes.map((route) => `${route.ifIndex}:${route.nextHop}:${route.metric}`).sort()
    evidence.checks.routesRestored = JSON.stringify(normalize(before)) === JSON.stringify(normalize(after))
    if (!evidence.checks.adapterRemoved || !evidence.checks.routesRestored) process.exitCode = 1
  } catch (error) { evidence.cleanupError = error.message; process.exitCode = 1 }
  writeFileSync(join(home, 'result.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence, null, 2))
}
