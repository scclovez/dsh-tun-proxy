/**
 * Two tiny network clients:
 *  - the mihomo external-controller REST API (loopback, bearer token), and
 *  - subscription / release downloads (global fetch, hard byte and time caps).
 */
import { request } from 'node:http'

export const DEFAULT_CONTROLLER_TIMEOUT_MS = 8000

/** Call the mihomo REST API. Resolves { ok, status, data } and never throws on HTTP status. */
export function controllerRequest({
  port,
  secret = '',
  path,
  method = 'GET',
  body,
  timeoutMs = DEFAULT_CONTROLLER_TIMEOUT_MS,
}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8')
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          ...(secret ? { authorization: `Bearer ${secret}` } : {}),
          ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = []
        let size = 0
        res.on('data', (chunk) => {
          size += chunk.length
          if (size > 32 * 1024 * 1024) {
            req.destroy(new Error('controller response too large'))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let data = null
          if (text !== '') {
            try {
              data = JSON.parse(text)
            }
            catch {
              data = text
            }
          }
          resolve({ ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300, status: res.statusCode ?? 0, data })
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error(`controller timeout after ${timeoutMs}ms`)))
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

/** Wait until the controller answers /version, or give up. */
export async function waitForController({ port, secret = '', timeoutMs = 25000, intervalMs = 400 }) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const res = await controllerRequest({ port, secret, path: '/version', timeoutMs: 2000 })
      if (res.ok) return res.data
      lastError = new Error(`controller responded ${res.status}`)
    }
    catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`external-controller 在 ${timeoutMs}ms 内没有就绪：${lastError?.message ?? 'unknown'}`)
}

export async function fetchText(url, { headers = {}, timeoutMs = 60000, maxBytes = 8 * 1024 * 1024 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'clash-verge/v2.0.0 dsh-tun-proxy/0.1.0',
        accept: '*/*',
        ...headers,
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText} — ${url}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxBytes) throw new Error(`响应体超过 ${maxBytes} 字节 — ${url}`)
    return { text: buffer.toString('utf8'), bytes: buffer.length, contentType: response.headers.get('content-type') ?? '', subscriptionInfo: response.headers.get('subscription-userinfo') ?? '' }
  }
  finally {
    clearTimeout(timer)
  }
}

export async function fetchJson(url, options = {}) {
  const { text } = await fetchText(url, options)
  return JSON.parse(text)
}

/** Stream a URL to a file, returning the byte count. */
export async function download(url, destination, { timeoutMs = 600000, onProgress } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const { createWriteStream } = await import('node:fs')
  const { pipeline } = await import('node:stream/promises')
  const { Readable } = await import('node:stream')
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'dsh-tun-proxy/0.1.0' },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText} — ${url}`)
    const total = Number(response.headers.get('content-length') ?? 0)
    let seen = 0
    const body = Readable.fromWeb(response.body)
    body.on('data', (chunk) => {
      seen += chunk.length
      onProgress?.({ seen, total })
    })
    await pipeline(body, createWriteStream(destination))
    return { bytes: seen, total }
  }
  finally {
    clearTimeout(timer)
  }
}
