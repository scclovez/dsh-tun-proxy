/**
 * The model-facing surface: six tools, all thin wrappers over the service.
 *
 * Every tool returns a JSON value (output schema `json`) and never throws for
 * expected failures — a failed start is data the model can act on, not an
 * exception that ends the step.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

export const TOOL_NAMES = Object.freeze({
  status: 'tun_proxy_status',
  install: 'tun_proxy_install',
  start: 'tun_proxy_start',
  stop: 'tun_proxy_stop',
  config: 'tun_proxy_config',
  nodes: 'tun_proxy_nodes',
  chain: 'tun_proxy_chain',
})

const jsonOutput = (description) => ({
  schema: { type: 'json' },
  render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2) }],
})

async function safe(action) {
  try {
    return { ok: true, ...(await action()) }
  }
  catch (error) {
    return { ok: false, error: error?.message ?? String(error), code: error?.code ?? 'error' }
  }
}

const settingsParameters = {
  systemProxy: { type: 'boolean', description: 'Windows 系统代理。' },
  customRules: { type: 'array', items: { type: 'string' }, description: '前置自定义规则。' },
  testUrl: { type: 'string', description: '延迟测试 URL。' },
  testTimeout: { type: 'number', description: '测速超时，毫秒。' },
  chainEnabled: { type: 'boolean', description: '启用多跳代理链；TCP 流量按 chain 的入口到出口顺序转发。' },
  chain: { type: 'array', items: { type: 'string' }, description: '入口到出口的节点名数组，2–8 跳。使用 tun_proxy_chain 查看可选节点。' },
  subscriptionUrl: { type: 'string', description: 'Clash/mihomo 订阅链接（支持 FlClash / Clash Verge 的订阅）。' },
  mixedPort: { type: 'number', description: 'HTTP/SOCKS 混合端口，默认 17890。' },
  controllerPort: { type: 'number', description: 'mihomo 控制器端口，默认 9090。' },
  mode: { type: 'string', description: 'rule / global / direct，默认 rule。' },
  tunStack: { type: 'string', description: 'TUN 协议栈：mixed / gvisor / system，默认 mixed。' },
  dnsMode: { type: 'string', description: 'fake-ip（默认，兼容规则分流）或 redir-host（让 DSH 自己的 web_fetch 在 TUN 下也能工作）。' },
  tunEnable: { type: 'boolean', description: '是否启用 TUN 虚拟网卡（全局代理的总开关）。' },
  tunDevice: { type: 'string', description: 'TUN 网卡名称，默认 dsh-tun。' },
  autoStart: { type: 'boolean', description: 'DSH 启动时自动拉起内核。' },
  stopOnExit: { type: 'boolean', description: '关闭 DSH（或停用本插件）时自动停止内核；只对正常退出有效，强杀 DSH 不会触发。' },
  refreshOnStart: { type: 'boolean', description: '每次启动时重新拉取订阅。' },
  allowLan: { type: 'boolean', description: '是否允许局域网访问混合端口。' },
  strictRoute: { type: 'boolean', description: 'TUN 严格路由（可能影响其他 VPN），默认关闭。' },
  mtu: { type: 'number', description: 'TUN MTU，默认 9000。' },
  ipv6: { type: 'boolean', description: '是否启用 IPv6。' },
  logLevel: { type: 'string', description: 'silent / error / warning / info / debug。' },
  kernelVersion: { type: 'string', description: '固定 mihomo 版本（如 v1.19.32）；留空用最新版。' },
  githubMirror: { type: 'string', description: 'GitHub 下载镜像前缀，如 https://gh-proxy.com。' },
  dnsServers: { type: 'array', items: { type: 'string' }, description: '主 DNS 列表，默认国内 DoH（doh.pub / dns.alidns.com）。' },
  dnsFallback: { type: 'array', items: { type: 'string' }, description: 'fallback DNS 列表（fake-ip 模式解析境外域名）。' },
  dnsBootstrap: { type: 'array', items: { type: 'string' }, description: '用于解析 DoH 域名的纯 IP DNS，默认 223.5.5.5 / 119.29.29.29。' },
  dnsListen: { type: 'string', description: '独立 DNS 监听地址，默认 127.0.0.1:10530；与其它 Clash 客户端冲突时改这里。' },
}

function settingsPatchFrom(args, { allowEmpty = false } = {}) {
  const patch = {}
  for (const key of Object.keys(settingsParameters)) {
    const value = args[key]
    if (value === undefined || value === null) continue
    if (value === '' && !allowEmpty) continue
    patch[key] = value
  }
  return patch
}

export function createTools(service) {
  const status = defineTool({
    name: TOOL_NAMES.status,
    description: '查看全局 TUN 代理的完整状态：内核是否安装/版本、进程是否在跑、控制器是否就绪、TUN 网卡与默认路由、当前订阅来源、以及需要注意的告警。任何 tun_proxy_* 操作前后都应先看它。',
    parameters: {
      verbose: { type: 'boolean', description: '附带内核日志尾部，便于排查启动失败。' },
    },
    output: jsonOutput(),
    async execute(args) {
      return safe(async () => ({ status: await service.status({ verbose: args.verbose === true }) }))
    },
  })

  const install = defineTool({
    name: TOOL_NAMES.install,
    description: '下载或更新 mihomo 内核（以及在 Windows 上创建 TUN 网卡所必需的 wintun.dll）。首次使用前必须执行一次；更新内核时把 force 设为 true。',
    parameters: {
      version: { type: 'string', description: '指定版本标签，如 v1.19.32；留空则用最新正式版。' },
      force: { type: 'boolean', description: '即使已安装同版本也重新下载。' },
    },
    output: jsonOutput(),
    async execute(args, exec) {
      return safe(async () => service.install({ version: args.version ?? '', force: args.force === true, onProgress: () => {} }))
    },
  })

  const start = defineTool({
    name: TOOL_NAMES.start,
    description: '生成 mihomo 配置并启动内核，打开 TUN 模式后整台电脑（浏览器、终端、其他软件，也包括 DSH 自己）的流量都会走代理。可以顺便传入订阅链接或本地配置路径。启动前会自动用 mihomo -t 校验配置，失败会返回日志。',
    parameters: {
      ...settingsParameters,
      skipInstallCheck: { type: 'boolean', description: '内核未安装时不自动安装，直接报错。' },
    },
    output: jsonOutput(),
    async execute(args) {
      return safe(async () => {
        const patch = settingsPatchFrom(args)
        if (Object.keys(patch).length > 0) service.updateSettings(patch)
        const settings = service.readSettings()
        const fs = await import('node:fs')
        if (settings.kernelPath === '' && !fs.existsSync(service.paths.kernel) && args.skipInstallCheck !== true) {
          await service.install({ onProgress: () => {} })
        }
        return await service.start({ onProgress: () => {} })
      })
    },
  })

  const stop = defineTool({
    name: TOOL_NAMES.stop,
    description: '停止 mihomo 内核并回收 TUN 网卡，让整台电脑恢复直连。',
    parameters: {},
    output: jsonOutput(),
    async execute() {
      return safe(async () => service.stop())
    },
  })

  const config = defineTool({
    name: TOOL_NAMES.config,
    description: '读写插件设置，或执行维护动作。action=get 返回当前设置；action=set 应用传入的设置项；action=import 直接导入订阅 URL 或分享链接；action=ip 检测当前出口 IP/地区/所属节点；action=update_subscription 立即刷新订阅缓存；action=logs 查看内核日志；action=uninstall 移除内核文件（purge=true 时连同设置一起删除）。',
    parameters: {
      action: { type: 'string', description: 'get / set / import / ip / profiles / activate_profile / refresh_profile / remove_profile / activity / rules / update_subscription / logs / uninstall' },
      source: { type: 'string', description: 'import 时传入订阅 URL 或节点分享链接（多节点每行一个）。' },
      id: { type: 'string', description: '订阅 ID。' },
      name: { type: 'string', description: '订阅名称。' },
      purge: { type: 'boolean', description: 'uninstall 时是否连设置与缓存一起删除。' },
      lines: { type: 'number', description: 'logs 动作返回的日志行数，默认 120。' },
      ...settingsParameters,
    },
    output: jsonOutput(),
    async execute(args) {
      return safe(async () => {
        const action = args.action ?? 'get'
        if (action === 'set') {
          const patch = settingsPatchFrom(args, { allowEmpty: true })
          if (Object.keys(patch).length === 0) return { action, changed: {}, note: '没有提供任何要修改的设置项' }
          const next = service.updateSettings(patch)
          const { publicSettings } = await import('./core/settings.js')
          return { action, changedKeys: Object.keys(patch), settings: publicSettings(next), note: '运行中的代理需要 restart 才会应用这些设置' }
        }
        if (action === 'ip' || action === 'ip_check') return { action: 'ip', ...(await service.ipCheck()) }
        if (action === 'profiles') return service.profileList()
        if (action === 'activate_profile') return service.activateProfile(args.id)
        if (action === 'remove_profile') return service.removeProfile(args.id)
        if (action === 'refresh_profile') return service.refreshProfile(args.id)
        if (action === 'activity') return service.activity()
        if (action === 'rules') return service.rules()
        if (action === 'import') return { action, ...(await service.importSource({ source: args.source, name: args.name })) }
        if (action === 'update_subscription') return { action, ...(await service.updateSubscription()) }
        if (action === 'logs') return { action, ...(await service.logs({ lines: args.lines ?? 120 })) }
        if (action === 'uninstall') return { action, ...(await service.uninstall({ purge: args.purge === true })) }
        const { publicSettings } = await import('./core/settings.js')
        return { action: 'get', settings: publicSettings(service.readSettings()), paths: service.paths }
      })
    },
  })

  const nodes = defineTool({
    name: TOOL_NAMES.nodes,
    description: '查看或操作 mihomo 的策略组与节点（需要内核正在运行）：action=list 列出策略组和当前选中节点；action=select 切换策略组节点；action=delay 测某个节点的延迟（毫秒）。',
    parameters: {
      action: { type: 'string', description: 'list / select / delay，默认 list。' },
      group: { type: 'string', description: '策略组名称，select 时必填。' },
      node: { type: 'string', description: '节点名称；delay 时必填，select 时留空表示用策略组默认策略。' },
      timeout: { type: 'number', description: '延迟测试超时毫秒数，默认 5000。' },
    },
    output: jsonOutput(),
    async execute(args) {
      return safe(async () => {
        const action = args.action ?? 'list'
        if (action === 'select') {
          if (!args.group) throw new Error('select 需要 group 参数')
          return { action, ...(await service.selectNode({ group: args.group, node: args.node ?? '' })) }
        }
        if (action === 'delay') {
          if (!args.node) throw new Error('delay 需要 node 参数')
          return { action, ...(await service.delay({ node: args.node, timeoutMs: args.timeout ?? 5000 })) }
        }
        return { action: 'list', ...(await service.nodes()) }
      })
    },
  })

  const chain = defineTool({
    name: TOOL_NAMES.chain,
    description: '管理全局或链式代理。catalog 查看可选节点；set 按本机→入口→中转→出口的顺序保存 chain（2–8 跳），enabled=true 启用；apply 校验后重新启动并应用配置。链式仅支持 TCP，UDP 会拒绝；不会修改原订阅。panel 返回图形面板位置。',
    parameters: {
      action: { type: 'string', description: 'catalog / set / apply / panel，默认 catalog' },
      chain: { type: 'array', items: { type: 'string' }, description: '按入口到出口排列的节点名' },
      enabled: { type: 'boolean', description: '是否启用链式代理' },
    },
    output: jsonOutput(),
    async execute(args) {
      return safe(async () => {
        if (args.action === 'panel') return { panel: 'DSH 左侧栏 → 代理中心', webPath: '/tun-proxy/panel' }
        if (args.action === 'apply') return service.restart()
        if (args.action === 'set') {
          const patch = {}
          if (args.chain !== undefined) patch.chain = args.chain
          if (args.enabled !== undefined) patch.chainEnabled = args.enabled
          const { publicSettings } = await import('./core/settings.js')
          return { settings: publicSettings(service.updateSettings(patch)), note: '调用 apply 应用配置' }
        }
        return service.catalog()
      })
    },
  })
  return [status, install, start, stop, config, nodes, chain]
}
