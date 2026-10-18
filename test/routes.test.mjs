import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'

import { registerRoutes } from '../lib/routes.js'

/** Minimal stand-in for the host context: webServer plus the `connection` service. */
function fakeHost({ connection, protocol = 'http:' } = {}) {
  const routes = []
  const host = {
    routes,
    webServer: {
      protocol,
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    get(name) {
      if (name === 'connection') return connection
      if (name === 'webServer') return host.webServer
      return undefined
    },
  }
  return host
}

function fakeRequest({ method = 'GET', url = '/', headers = { 'content-type': 'application/json' }, rawHeaders, body } = {}) {
  const request = new EventEmitter()
  request.method = method
  request.url = url
  request.headers = { 'content-type': 'application/json', ...headers }
  request.rawHeaders = rawHeaders ?? Object.entries(request.headers).flatMap(([name, value]) => [name, value])
  request.destroyed = false
  request.destroy = () => { request.destroyed = true }
  process.nextTick(() => {
    if (body !== undefined) request.emit('data', Buffer.from(body))
    request.emit('end')
  })
  return request
}

function fakeResponse() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers ?? {}
    },
    end(chunk) {
      this.body = chunk ?? ''
    },
    destroy() {},
  }
}

async function call(route, options) {
  const response = fakeResponse()
  const request = fakeRequest(options)
  await route.handler(request, response)
  let json = null
  try {
    json = JSON.parse(response.body)
  }
  catch { /* non-JSON */ }
  return { response, json, request }
}

/** Records every call so a test can prove the guard ran before any side effect. */
function serviceStub() {
  const calls = { status: 0, stop: 0, start: 0, readSettings: 0 }
  return {
    calls,
    async status({ verbose } = {}) {
      calls.status++
      return { running: false, verbose: verbose === true }
    },
    async stop() {
      calls.stop++
      return { stopped: true, pid: 123 }
    },
    async readSettings() {
      calls.readSettings++
      return { mixedPort: 7890 }
    },
    async start() {
      calls.start++
      return { started: true, pid: 4242 }
    },
  }
}

/** The official Host Connection gate: undefined authorises, 401/403 reject. */
function allowedConnection(onRequest) {
  return {
    requestRejection(request) {
      onRequest?.(request)
      return undefined
    },
  }
}

const LOCAL_HEADERS = { host: '127.0.0.1:60443', 'sec-fetch-site': 'same-origin' }

function routesOf(host) {
  const byPath = new Map(host.routes.map((route) => [route.path, route]))
  return { state: byPath.get('/tun-proxy/state'), action: byPath.get('/tun-proxy/action') }
}

test('registers the static panel routes plus the guarded state and action routes', () => {
  const host = fakeHost({ connection: allowedConnection() })
  const dispose = registerRoutes(host, serviceStub())
  assert.deepEqual(host.routes.map((route) => route.path), ['/tun-proxy/panel', '/tun-proxy/panel.js', '/tun-proxy/panel-style.js', '/tun-proxy/select.js', '/tun-proxy/state', '/tun-proxy/action'])
  assert.equal(typeof dispose, 'function')
})

test('GET /tun-proxy/state returns status for an authorised same-origin request', async () => {
  const host = fakeHost({ connection: allowedConnection() })
  const service = serviceStub()
  registerRoutes(host, service)
  const { response, json } = await call(routesOf(host).state, { method: 'GET', url: '/tun-proxy/state?verbose=1', headers: LOCAL_HEADERS })
  assert.equal(response.status, 200)
  assert.equal(json.ok, true)
  assert.equal(json.status.running, false)
  assert.equal(json.status.verbose, true)
  assert.equal(service.calls.status, 1)
})

test('state and action read nothing until the Connection gate has authorised', async () => {
  let seen = []
  const host = fakeHost({
    connection: {
      requestRejection(request) {
        seen.push(request)
        return undefined
      },
    },
  })
  const service = serviceStub()
  registerRoutes(host, service)
  const { state, action } = routesOf(host)

  await call(state, { headers: LOCAL_HEADERS })
  await call(action, { method: 'POST', headers: LOCAL_HEADERS, body: JSON.stringify({ action: 'stop' }) })
  assert.equal(seen.length, 2, 'both routes must consult the official gate')
  assert.equal(service.calls.status, 1)
  assert.equal(service.calls.stop, 1)
})

test('GET /tun-proxy/state rejects other methods and cross-origin', async () => {
  const host = fakeHost({ connection: allowedConnection() })
  registerRoutes(host, serviceStub())
  const { state } = routesOf(host)
  const wrongMethod = await call(state, { method: 'POST', headers: LOCAL_HEADERS })
  assert.equal(wrongMethod.response.status, 405)
  const crossOrigin = await call(state, { headers: { origin: 'http://evil.example', host: '127.0.0.1:19387' } })
  assert.equal(crossOrigin.response.status, 403)
})

test('POST /tun-proxy/action dispatches and reports unknown actions as 400', async () => {
  const host = fakeHost({ connection: allowedConnection() })
  registerRoutes(host, serviceStub())
  const { action } = routesOf(host)
  const stop = await call(action, {
    method: 'POST',
    body: JSON.stringify({ action: 'stop' }),
    headers: LOCAL_HEADERS,
  })
  assert.equal(stop.response.status, 200)
  assert.equal(stop.json.result.stopped, true)

  const unknown = await call(action, {
    method: 'POST',
    body: JSON.stringify({ action: 'nope' }),
    headers: LOCAL_HEADERS,
  })
  assert.equal(unknown.response.status, 400)
  assert.equal(unknown.json.ok, false)
})

test('missing or failing Connection authorization fails closed before any side effect', async () => {
  const cases = [
    ['no connection service', undefined, 403],
    ['service without requestRejection', {}, 403],
    ['throwing requestRejection', { requestRejection() { throw new Error('boom') } }, 403],
    ['asynchronous rejection', { requestRejection() { return Promise.resolve(403) } }, 403],
    ['401 rejection', { requestRejection() { return 401 } }, 401],
    ['403 rejection', { requestRejection() { return 403 } }, 403],
  ]
  for (const [label, connection, expected] of cases) {
    const host = fakeHost({ connection })
    const service = serviceStub()
    registerRoutes(host, service)
    const { state, action } = routesOf(host)

    const read = await call(state, { headers: LOCAL_HEADERS })
    assert.equal(read.response.status, expected, label)
    assert.equal(read.json.ok, false, label)
    assert.equal(service.calls.status, 0, `${label}: status must not be read`)

    const write = await call(action, { method: 'POST', headers: LOCAL_HEADERS, body: JSON.stringify({ action: 'install', version: 'v1.19.32' }) })
    assert.equal(write.response.status, expected, label)
    assert.equal(write.json.ok, false, label)
    assert.equal(service.calls.start + service.calls.stop, 0, `${label}: no action may run`)
  }
})

test('a 401 from the official gate stays 401 while an unusable gate becomes 403', async () => {
  const unauthorised = fakeHost({ connection: { requestRejection: () => 401 } })
  registerRoutes(unauthorised, serviceStub())
  assert.equal((await call(routesOf(unauthorised).state, { headers: LOCAL_HEADERS })).response.status, 401)

  const broken = fakeHost({ connection: { requestRejection: () => 'nope' } })
  registerRoutes(broken, serviceStub())
  const response = await call(routesOf(broken).state, { headers: LOCAL_HEADERS })
  assert.equal(response.response.status, 403)
  assert.equal(response.json.code, 'authorization')
})

test('Host, Origin and Fetch Metadata are all validated before state is read', async () => {
  const host = fakeHost({ connection: allowedConnection() })
  const service = serviceStub()
  registerRoutes(host, service)
  const { state } = routesOf(host)

  const rejected = [
    ['no Host (HTTP/1.0)', {}],
    ['rebinding host', { host: 'evil.example:60443' }],
    ['non-loopback address', { host: '192.168.1.10:60443' }],
    ['zero-padded loopback', { host: '127.000.000.001:60443' }],
    ['port out of range', { host: '127.0.0.1:70000' }],
    ['dangling colon', { host: '127.0.0.1:' }],
    ['userinfo in Host', { host: 'evil.example@127.0.0.1:60443' }],
    ['unknown Fetch Metadata', { ...LOCAL_HEADERS, 'sec-fetch-site': 'cross-site' }],
    ['same-site port sibling', { ...LOCAL_HEADERS, 'sec-fetch-site': 'same-site' }],
    ['cross-origin Origin', { ...LOCAL_HEADERS, origin: 'http://evil.example' }],
    ['port-mismatched Origin', { ...LOCAL_HEADERS, origin: 'http://127.0.0.1:1' }],
    ['opaque Origin', { ...LOCAL_HEADERS, origin: 'null' }],
    ['Origin with a path', { ...LOCAL_HEADERS, origin: 'http://127.0.0.1:60443/tun-proxy' }],
    ['empty Origin', { ...LOCAL_HEADERS, origin: '' }],
    ['non-http Origin', { ...LOCAL_HEADERS, origin: 'file://127.0.0.1:60443' }],
  ]
  for (const [label, headers] of rejected) {
    const result = await call(state, { headers })
    assert.equal(result.response.status, 403, label)
    assert.equal(result.json.ok, false, label)
  }
  assert.equal(service.calls.status, 0, 'no rejected request may reach service.status()')

  const duplicateHost = await call(state, { headers: LOCAL_HEADERS, rawHeaders: ['host', '127.0.0.1:60443', 'host', 'evil.example', 'sec-fetch-site', 'same-origin'] })
  assert.equal(duplicateHost.response.status, 403, 'duplicate Host fields are ambiguous')

  for (const headers of [
    { host: 'localhost:60443', 'sec-fetch-site': 'same-origin' },
    { host: '127.0.0.1:60443', 'sec-fetch-site': 'none' },
    { host: '[::1]:60443', origin: 'http://[::1]:60443' },
    { host: 'LOCALHOST:60443' },
  ]) {
    const result = await call(state, { headers })
    assert.equal(result.response.status, 200, `loopback host ${headers.host} with ${JSON.stringify(headers)}`)
  }
  assert.equal(service.calls.status, 4)
})

test('https listeners accept only https Origins for the same authority', async () => {
  const host = fakeHost({ connection: allowedConnection(), protocol: 'https:' })
  registerRoutes(host, serviceStub())
  const { state } = routesOf(host)
  const headers = { host: '127.0.0.1:60443', 'sec-fetch-site': 'same-origin' }
  assert.equal((await call(state, { headers: { ...headers, origin: 'https://127.0.0.1:60443' } })).response.status, 200)
  assert.equal((await call(state, { headers: { ...headers, origin: 'http://127.0.0.1:60443' } })).response.status, 403)
})

test('an unauthorised POST is rejected before the body is parsed or dispatched', async () => {
  const host = fakeHost({ connection: { requestRejection: () => 401 } })
  const service = serviceStub()
  registerRoutes(host, service)
  const { action } = routesOf(host)

  // Invalid JSON, a valid action and a wrong content type must all fail on auth,
  // never on 400/415/503 — that would prove the guard ran too late.
  for (const [body, contentType] of [
    ['{not json', 'application/json'],
    [JSON.stringify({ action: 'install' }), 'application/json'],
    [JSON.stringify({ action: 'stop' }), 'text/plain'],
  ]) {
    const result = await call(action, { method: 'POST', headers: { ...LOCAL_HEADERS, 'content-type': contentType }, body })
    assert.equal(result.response.status, 401)
    assert.equal(result.json.code, 'authorization')
  }
  assert.equal(service.calls.start + service.calls.stop, 0)

  const crossSite = await call(action, { method: 'POST', headers: { host: '127.0.0.1:60443', 'sec-fetch-site': 'cross-site' }, body: JSON.stringify({ action: 'stop' }) })
  assert.equal(crossSite.response.status, 403)
  assert.equal(service.calls.stop, 0)
})

test('the JSON body stays bounded and oversized bodies answer 413 without dispatch', async () => {
  const host = fakeHost({ connection: allowedConnection() })
  const service = serviceStub()
  registerRoutes(host, service)
  const { action } = routesOf(host)
  const big = JSON.stringify({ action: 'stop', filler: 'x'.repeat(8 * 1024 * 1024 + 1) })
  const result = await call(action, { method: 'POST', headers: LOCAL_HEADERS, body: big })
  assert.equal(result.response.status, 413)
  assert.equal(result.json.code, 'body-too-large')
  assert.equal(service.calls.stop, 0)
})
