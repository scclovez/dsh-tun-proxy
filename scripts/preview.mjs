import { createServer } from 'node:http'
import { createService } from '../lib/core/service.js'
import { registerRoutes } from '../lib/routes.js'
const routes = []
const service = createService()
registerRoutes({ webServer: { register(route) { routes.push(route); return () => {} } } }, service)
const server = createServer((request, response) => {
  const route = routes.find((route) => route.path === new URL(request.url, 'http://localhost').pathname)
  if (!route) { response.writeHead(404); response.end(); return }
  Promise.resolve(route.handler(request, response)).catch(() => { if (!response.headersSent) response.writeHead(500); response.end() })
})
server.listen(19388, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:19388/tun-proxy/panel'))
