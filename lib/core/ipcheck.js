/**
 * Exit-IP detection.
 *
 * The point of the whole plugin is "traffic leaves from somewhere else", so the
 * panel offers a one-click answer to "where does it leave from right now?".
 * The probe deliberately goes through the local mixed port, so the answer
 * reflects the kernel's current node / chain selection rather than this
 * process's own route.
 *
 * Endpoints are plain HTTP on purpose: the request is a hand-rolled
 * absolute-form HTTP-proxy request (see net.js proxyGetText), which keeps the
 * diagnostic dependency-free — no TLS tunnel, no extra package.
 */
export const IP_ENDPOINTS = Object.freeze([
  { id: 'ip-api', url: 'http://ip-api.com/json/?fields=status,country,regionName,city,isp,query' },
  { id: 'ipip', url: 'http://myip.ipip.net' },
  { id: 'aws', url: 'http://checkip.amazonaws.com' },
])

const IPV4 = /\b((?:\d{1,3}\.){3}\d{1,3})\b/u

/**
 * Pull `{ ip, location, isp }` out of whatever an endpoint answered: JSON
 * (`{"query":"1.2.3.4",...}`), a bare address, or a text line such as
 * `当前 IP：1.2.3.4 来自于：中国 江西 上饶 移动`.
 *
 * @returns {{ip: string, location: string, isp: string} | null}
 */
export function parseIpPayload(text) {
  const raw = String(text ?? '').trim()
  if (raw === '') return null
  if (raw.startsWith('{')) {
    try {
      const value = JSON.parse(raw)
      const ip = String(value.query ?? value.ip ?? value.address ?? '').trim()
      if (!IPV4.test(ip)) return null
      const location = [value.country, value.regionName, value.city].filter(Boolean).join(' ').trim()
      return { ip, location, isp: String(value.isp ?? value.org ?? '').trim() }
    }
    catch {
      return null
    }
  }
  const match = IPV4.exec(raw)
  if (match === null) return null
  const tail = raw.split(/来自于|from/iu)[1] ?? raw.replace(match[0], '')
  const location = tail.replace(/[：:]/gu, ' ').replace(/\s+/gu, ' ').replace(/^[^\p{L}\p{N}]+/u, '').trim().slice(0, 80)
  return { ip: match[1], location, isp: '' }
}
