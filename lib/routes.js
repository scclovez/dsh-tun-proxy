/**
 * Same-origin HTTP surface under /tun-proxy/*.
 *
 * These routes exist so the GUI (or any local script) can drive the proxy
 * without going through the model: `curl http://127.0.0.1:<dsh-port>/tun-proxy/state`.
 * They perform no authentication beyond the same-origin check, exactly like the
 * other bundled plugins that expose local control routes.
 */
import { dispatch } from './actions.js'
import { readFileSync } from 'node:fs'

const MAX_BODY_BYTES = 8 * 1024 * 1024

function sendJson(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

/** A present Origin must match the request Host (browser same-origin only). */
function sameOrigin(request) {
  if (request.headers.host) {
    try { if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(`http://${request.headers.host}`).hostname.toLowerCase())) return false }
    catch { return false }
  }
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined || origin === '') return true
  try {
    return request.headers.host !== undefined && new URL(origin).host === request.headers.host
  }
  catch {
    return false
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      }
      catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
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
        if (!sameOrigin(request)) {
          sendJson(response, 403, { ok: false, code: 'origin' })
          return
        }
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
        if (!sameOrigin(request)) {
          sendJson(response, 403, { ok: false, code: 'origin' })
          return
        }
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
