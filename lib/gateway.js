import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { dispatch } from './actions.js'

const schema = { parse(value) { if (typeof value !== 'string') throw new Error('Expected JSON string'); return value } }
const codec = { mode: 'strict', typeSymbol: 'dsh-tun-proxy#JSON', schema, create: () => schema }
export const DESCRIPTOR = {
  id: 'dsh-tun-proxy#tunProxy/invoke', service: 'tunProxy', namespace: 'tunProxy', method: 'invoke',
  invocation: { kind: 'direct' },
  parameters: [{ name: 'payload', wire: 'payload', source: 'json', codec }], result: codec,
}
export const MANIFEST = { package: 'dsh-tun-proxy', face: 'host', schemas: [], invocations: [DESCRIPTOR] }

export class ProxyGateway extends TypertRemoteService {
  constructor(ctx, service) { super(ctx, 'tunProxy'); this.service = service }
  async invoke(payload) {
    if (payload.length > 8 * 1024 * 1024) throw new Error('请求过大')
    const body = JSON.parse(payload)
    try { return JSON.stringify({ ok: true, result: await dispatch(this.service, body.action, body) }) }
    catch (error) { return JSON.stringify({ ok: false, error: error.message }) }
  }
}
