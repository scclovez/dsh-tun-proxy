/**
 * Local HTTP surface under /tun-proxy/*.
 * State and actions require both a strict browser-origin fence and the official
 * Host Connection session/Peer authorization. Host/Origin headers are not an
 * identity credential; missing or broken Connection authorization fails closed.
 */
import { dispatch } from './actions.js'
import { readFileSync } from 'node:fs'

const MAX_BODY_BYTES = 8 * 1024 * 1024

function sendJson(response, status, value, extraHeaders = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  })
  response.end(JSON.stringify(value))
}

/** Reject ambiguous/non-local authorities and inconsistent browser markers. */
function sameOrigin(request, protocol = 'http:') {
  const headers = request.headers
  if (!headers || !['http:', 'https:'].includes(protocol)) return false
  const authority = headers.host
  if (typeof authority !== 'string') return false
  const match = /^(localhost|127\.0\.0\.1|\[::1\])(?::([1-9]\d{0,4}))?$/i.exec(authority)
  if (!match || (match[2] && Number(match[2]) > 65535)) return false
  // Node may discard duplicate Host/Origin fields instead of exposing an array.
  for (const name of ['host', 'origin', 'sec-fetch-site']) {
    const count = (request.rawHeaders ?? []).filter((value, index) => index % 2 === 0 && value.toLowerCase() === name).length
    if (count > 1) return false
  }
  const site = headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false
  const origin = headers.origin
  // Native clients and browser GETs may omit Origin; official auth is still mandatory.
  if (origin === undefined) return true
  if (typeof origin !== 'string' || origin === '') return false
  try {
    const parsed = new URL(origin)
    // A serialized Origin has no credentials, path, query or fragment.
    if (!['http:', 'https:'].includes(parsed.protocol) || origin.toLowerCase() !== parsed.origin.toLowerCase()) return false
    return parsed.origin === new URL(`${protocol}//${authority}`).origin
  }
  catch { return false }
}

/** Authorization always precedes status reads, body parsing and dispatch. */
async function authorize(host, request, response) {
  try {
    if (!sameOrigin(request, host.webServer.protocol ?? 'http:')) {
      sendJson(response, 403, { ok: false, code: 'origin' })
      return false
    }
    // Official Host Connection gate: browser session cookie, launch token or
    // API credential plus its own Host/Origin fence. Anything else: no access.
    const connection = typeof host.get === 'function' ? host.get('connection') : host.connection
    if (typeof connection?.requestRejection !== 'function') throw new Error('Connection authorization unavailable')
    const rejection = await connection.requestRejection(request)
    if (rejection === undefined) return true
    sendJson(response, rejection === 401 ? 401 : 403, { ok: false, code: 'authorization' })
  }
  catch {
    sendJson(response, 403, { ok: false, code: 'authorization' })
  }
  return false
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    request.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        fail(Object.assign(new Error('request body too large'), { code: 'body-too-large' }))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (settled) return
      settled = true
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      }
      catch (error) {
        reject(error)
      }
    })
    request.on('error', fail)
  })
}

/**
 * @param {{ webServer: { register(route: object): () => void } }} host
 * @param {ReturnType<import('./core/service.js').createService>} service
 * @returns {() => void} disposer
 */
export function registerRoutes(host, service) {
  const disposers = [
    ...[
      ['/tun-proxy/panel', '../web/panel.html', 'text/html; charset=utf-8'],
      ['/tun-proxy/panel.js', './panel.js', 'text/javascript; charset=utf-8'],
      ['/tun-proxy/panel-style.js', './panel-style.js', 'text/javascript; charset=utf-8'],
      ['/tun-proxy/select.js', './select.js', 'text/javascript; charset=utf-8'],
    ].map(([path, file, type]) => host.webServer.register({
      kind: 'exact', path,
      handler(request, response) {
        if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
        response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN' })
        response.end(readFileSync(new URL(file, import.meta.url), 'utf8'))
      },
    })),
    host.webServer.register({
      kind: 'exact',
      path: '/tun-proxy/state',
      handler: async (request, response) => {
        if (request.method !== 'GET') {
          response.writeHead(405, { allow: 'GET' })
          response.end()
          return
        }
        if (!await authorize(host, request, response)) return
        try {
          const verbose = new URL(request.url ?? '/', 'http://localhost').searchParams.get('verbose') === '1'
          sendJson(response, 200, { ok: true, status: await service.status({ verbose }) })
        }
        catch (error) {
          sendJson(response, 503, { ok: false, error: String(error?.message ?? error) })
        }
      },
    }),
    host.webServer.register({
      kind: 'exact',
      path: '/tun-proxy/action',
      handler: async (request, response) => {
        if (request.method !== 'POST') {
          response.writeHead(405, { allow: 'POST' })
          response.end()
          return
        }
        if (!await authorize(host, request, response)) return
        try {
          if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
            sendJson(response, 415, { ok: false, error: 'Content-Type 必须为 application/json' })
            return
          }
          const body = await readJsonBody(request)
          const action = String(body?.action ?? '')
          const result = await dispatch(service, action, body ?? {})
          sendJson(response, 200, { ok: true, action, result })
        }
        catch (error) {
          if (error?.code === 'body-too-large') {
            // Answer, then let Node close the socket: the unread remainder must
            // not be parsed as a second request on this connection.
            sendJson(response, 413, { ok: false, code: 'body-too-large', error: '请求正文超过 8 MiB 上限' }, { connection: 'close' })
            response.on?.('finish', () => request.destroy())
            return
          }
          const code = error?.code === 'bad-action' ? 400 : 503
          sendJson(response, code, { ok: false, error: String(error?.message ?? error), code: error?.code })
        }
      },
    }),
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
}
