import { parseProfile, profileYaml } from './chain.js'

const decode64 = (value) => Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
const decode = (value) => decodeURIComponent(value ?? '')
const numberPort = (value, fallback = 443) => {
  const port = value === '' || value === undefined ? fallback : Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('节点端口无效')
  return port
}

function transport(proxy, type, path, host, serviceName) {
  if (!type || type === 'tcp') return
  if (type === 'ws') { proxy.network = 'ws'; proxy['ws-opts'] = { path: path || '/', ...(host ? { headers: { Host: host } } : {}) } }
  else if (type === 'grpc') { proxy.network = 'grpc'; proxy['grpc-opts'] = { 'grpc-service-name': serviceName || path || '' } }
  else throw new Error(`节点链接暂不支持 ${type} 传输，请使用 Clash 格式订阅`)
}

export function parseNodeUrl(raw, index = 1) {
  if (raw.startsWith('vmess://')) {
    const node = JSON.parse(decode64(raw.slice(8)))
    if (!node.add || !node.id) throw new Error('VMess 节点缺少服务器或 UUID')
    const proxy = { name: node.ps || `VMess ${index}`, type: 'vmess', server: node.add, port: numberPort(node.port), uuid: node.id, alterId: Number(node.aid ?? 0), cipher: node.scy || 'auto', tls: node.tls === 'tls', udp: true }
    if (node.sni || node.host) proxy.servername = node.sni || node.host
    transport(proxy, node.net, node.path, node.host, node.path)
    return proxy
  }
  if (raw.startsWith('ss://')) {
    let body = raw.slice(5), name = ''
    const hash = body.indexOf('#'); if (hash >= 0) { name = decode(body.slice(hash + 1)); body = body.slice(0, hash) }
    if (!body.includes('@')) body = decode64(body)
    const url = new URL(`ss://${body}`)
    if (url.searchParams.has('plugin')) throw new Error('SS plugin 分享链接请使用 Clash 格式订阅导入')
    const auth = url.password ? `${decode(url.username)}:${decode(url.password)}` : decode64(decode(url.username))
    const colon = auth.indexOf(':'); if (colon < 1) throw new Error('SS 节点认证格式无效')
    return { name: name || `SS ${index}`, type: 'ss', server: url.hostname.replace(/^\[|\]$/g, ''), port: numberPort(url.port), cipher: auth.slice(0, colon), password: auth.slice(colon + 1), udp: true }
  }
  const url = new URL(raw), type = url.protocol.slice(0, -1), query = url.searchParams
  const proxy = { name: decode(url.hash.slice(1)) || `${type.toUpperCase()} ${index}`, type: type === 'hy2' ? 'hysteria2' : type, server: url.hostname.replace(/^\[|\]$/g, ''), port: numberPort(url.port), udp: true }
  if (!proxy.server) throw new Error('节点缺少服务器')
  if (type === 'vless') {
    proxy.uuid = decode(url.username); proxy.tls = ['tls', 'reality'].includes(query.get('security'))
    if (query.get('flow')) proxy.flow = query.get('flow')
    if (query.get('security') === 'reality') {
      if (!query.get('pbk')) throw new Error('REALITY 节点缺少 public key')
      proxy['reality-opts'] = { 'public-key': query.get('pbk'), 'short-id': query.get('sid') || '' }
    }
  } else if (type === 'trojan') { proxy.password = decode(url.username); proxy.tls = true }
  else if (['hy2', 'hysteria2'].includes(type)) {
    proxy.password = decode(url.username) + (url.password ? ':' + decode(url.password) : '')
    if (query.get('obfs')) proxy.obfs = query.get('obfs')
    if (query.get('obfs-password')) proxy['obfs-password'] = query.get('obfs-password')
  } else if (type === 'tuic') {
    proxy.uuid = decode(url.username); proxy.password = decode(url.password)
    if (query.get('congestion_control')) proxy['congestion-controller'] = query.get('congestion_control')
  } else throw new Error(`节点链接协议 ${type} 暂不支持，请使用 Clash/mihomo 订阅`)
  const sni = query.get('sni') || query.get('peer')
  if (sni) proxy[type === 'vless' || type === 'trojan' ? 'servername' : 'sni'] = sni
  if (query.get('fp')) proxy['client-fingerprint'] = query.get('fp')
  if (query.has('insecure') || query.has('allowInsecure')) proxy['skip-cert-verify'] = ['1', 'true'].includes(query.get('insecure') || query.get('allowInsecure'))
  if (query.get('alpn')) proxy.alpn = query.get('alpn').split(',')
  if (type === 'vless' || type === 'trojan') transport(proxy, query.get('type'), query.get('path'), query.get('host'), query.get('serviceName'))
  return proxy
}

export function normalizeSubscription(input) {
  let text = String(input).trim().replace(/^\uFEFF/, '')
  if (text.length > 8 * 1024 * 1024) throw new Error('订阅超过 8 MB')
  if (/^(proxies|proxy-providers|proxy-groups|rules)\s*:/m.test(text)) {
    const profile = parseProfile(text)
    if (!Array.isArray(profile.proxies) && !profile['proxy-providers']) throw new Error('订阅没有节点')
    return profileYaml(profile)
  }
  if (!text.includes('://')) text = decode64(text)
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) throw new Error('订阅为空')
  const names = new Set()
  const proxies = lines.map((line, index) => {
    let proxy
    try { proxy = parseNodeUrl(line, index + 1) }
    catch (error) { throw new Error(`第 ${index + 1} 个节点无法导入：${error instanceof SyntaxError || error.message.includes('Invalid URL') ? '链接格式无效' : error.message}`) }
    const original = proxy.name; let suffix = 2
    while (names.has(proxy.name)) proxy.name = `${original} (${suffix++})`
    names.add(proxy.name); return proxy
  })
  return profileYaml({ proxies })
}
