/**
 * DSH plugin entry.
 *
 * Registers:
 *  - the six `tun_proxy_*` tools (requires the `tools` service),
 *  - the /tun-proxy/* HTTP routes (requires `webServer`),
 *  - an autostart hook that starts the kernel on boot when settings.autoStart.
 *
 * Both services are acquired with optional injection: a headless profile
 * without a web server still gets the tools, and a profile without dsh-tools
 * still serves the routes instead of failing to load the bundle.
 */
import Schema from '@deepseek-ai/schemastery'

import { createService } from './core/service.js'
import { createTools } from './tools.js'
import { registerRoutes } from './routes.js'
import { ProxyGateway, MANIFEST } from './gateway.js'

export const name = 'dsh-tun-proxy'

export const Config = Schema.object({
  autoStart: Schema.boolean().default(false).description('首次运行时把「DSH 启动时自动拉起内核」写进设置'),
}).default({})

function readConfig(config) {
  if (config && typeof config.get === 'function') return config.get() ?? {}
  return config ?? {}
}

export function apply(ctx, config) {
  const values = readConfig(config)
  const service = createService({ bundleConfig: values })

  ctx.inject(['typert'], (host) => {
    new ProxyGateway(host, service)
    host.effect(() => host.typert.register(MANIFEST), 'dsh-tun-proxy: panel gateway')
  })

  ctx.inject(['tools'], (toolCtx) => {
    for (const tool of createTools(service)) toolCtx.tools.register(tool)
  })

  // Routes read the official `connection` service at request time and fail
  // closed when it is absent; registering unconditionally keeps the panel
  // reachable while never serving state or actions without a live Peer.
  ctx.inject(['webServer'], (host) => {
    host.effect(() => registerRoutes(host, service), 'dsh-tun-proxy: http routes')
  })

  ctx.effect(() => {
    let cancelled = false
    const refreshTimer = setInterval(() => { if (!cancelled) void service.syncProfiles().catch(() => {}) }, 15 * 60 * 1000)
    refreshTimer.unref?.()
    void (async () => {
      try {
        const settings = service.readSettings()
        await service.recover()
        if (cancelled || !settings.autoStart) return
        const current = await service.status()
        if (cancelled || current.running) return
        if (!current.kernel.installed) return
        const result = await service.start({ auto: true, onProgress: () => {} })
        console.log(`[dsh-tun-proxy] autostart: ${result.started ? `pid ${result.pid}` : 'already running'}`)
      }
      catch (error) {
        console.error('[dsh-tun-proxy] autostart failed:', error?.message ?? error)
      }
    })()
    return () => {
      cancelled = true
      clearInterval(refreshTimer)
      // opt-in: follow DSH out the door (a force-killed DSH cannot run this at all)
      let stopOnExit = false
      try {
        stopOnExit = service.readSettings().stopOnExit === true
      }
      catch { /* settings unreadable during teardown: do nothing */ }
      if (!stopOnExit) return
      // The async path restores the Windows system proxy and removes the
      // adapter; the exit hook retries process termination and proxy restoration.
      void service.stop().catch(() => {})
      process.once('exit', () => {
        try { service.stopSync() } catch { /* best effort */ }
      })
    }
  }, 'dsh-tun-proxy: autostart')
}
