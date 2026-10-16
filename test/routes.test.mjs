import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'

import { registerRoutes } from '../lib/routes.js'

function fakeHost() {
  const routes = []
  return {
    routes,
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
  }
}

function fakeRequest({ method = 'GET', url = '/', headers = { 'content-type': 'application/json' }, body } = {}) {
  const request = new EventEmitter()
  request.method = method
  request.url = url
  request.headers = { 'content-type': 'application/json', ...headers }
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
  await route.handler(fakeRequest(options), response)
  let json = null
  try {
    json = JSON.parse(response.body)
  }
  catch { /* non-JSON */ }
  return { response, json }
}

const serviceStub = {
  async status({ verbose } = {}) {
    return { running: false, verbose: verbose === true }
  },
  async stop() {
    return { stopped: true, pid: 123 }
  },
  async readSettings() {
    return { mixedPort: 7890 }
  },
  async start() {
    return { started: true, pid: 4242 }
  },
}

test('registers the two same-origin routes and disposes them', () => {
  const host = fakeHost()
  const dispose = registerRoutes(host, serviceStub)
  assert.deepEqual(host.routes.map((route) => route.path), ['/tun-proxy/panel', '/tun-proxy/panel.js', '/tun-proxy/panel-style.js', '/tun-proxy/select.js', '/tun-proxy/state', '/tun-proxy/action'])
  assert.equal(typeof dispose, 'function')
})

test('GET /tun-proxy/state returns status', async () => {
  const host = fakeHost()
  registerRoutes(host, serviceStub)
  const { response, json } = await call(host.routes.find((route) => route.path === '/tun-proxy/state'), { method: 'GET', url: '/tun-proxy/state?verbose=1' })
  assert.equal(response.status, 200)
  assert.equal(json.ok, true)
  assert.equal(json.status.running, false)
  assert.equal(json.status.verbose, true)
})

test('GET /tun-proxy/state rejects other methods and cross-origin', async () => {
  const host = fakeHost()
  registerRoutes(host, serviceStub)
  const wrongMethod = await call(host.routes.find((route) => route.path === '/tun-proxy/state'), { method: 'POST' })
  assert.equal(wrongMethod.response.status, 405)
  const crossOrigin = await call(host.routes.find((route) => route.path === '/tun-proxy/state'), { headers: { origin: 'http://evil.example', host: '127.0.0.1:19387' } })
  assert.equal(crossOrigin.response.status, 403)
})

test('POST /tun-proxy/action dispatches and reports unknown actions as 400', async () => {
  const host = fakeHost()
  registerRoutes(host, serviceStub)
  const stop = await call(host.routes.find((route) => route.path === '/tun-proxy/action'), {
    method: 'POST',
    body: JSON.stringify({ action: 'stop' }),
    headers: { host: '127.0.0.1:19387' },
  })
  assert.equal(stop.response.status, 200)
  assert.equal(stop.json.result.stopped, true)

  const unknown = await call(host.routes.find((route) => route.path === '/tun-proxy/action'), {
    method: 'POST',
    body: JSON.stringify({ action: 'nope' }),
    headers: { host: '127.0.0.1:19387' },
  })
  assert.equal(unknown.response.status, 400)
  assert.equal(unknown.json.ok, false)
})
