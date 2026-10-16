import { PANEL_CSS } from './panel-style.js'
import { enhanceSelects } from './select.js'

export function mountPanel(root, call, back = () => {}) {
  const state = { tab: 'dashboard', settings: null, status: null, profiles: { items: [], activeId: '' }, catalog: [], groups: [], group: '', sort: 'default', search: '', chain: [], activity: { connections: [] }, history: [], rules: [], logs: '', delays: {}, editor: null, busy: false, error: '', notice: '', cancel: false, progress: '', paused: { connections: false, logs: false }, ip: null, ipBusy: false }
  const esc = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const el = (id) => root.querySelector(`[data-field="${id}"]`)
  const value = (id) => el(id)?.value ?? ''
  const checked = (id) => Boolean(el(id)?.checked)
  const btn = (label, action, attrs = '', cls = '') => `<button type="button" class="${cls}" data-action="${action}" ${attrs} ${(state.busy && action !== 'cancelTest') || (['delay', 'batchDelay'].includes(action) && !state.status?.running) ? 'disabled' : ''}>${label}</button>`
  const field = (label, key, content = '', type = 'text', extra = '') => `<label class="dp-field"><span>${label}</span><input data-field="${key}" type="${type}" value="${esc(content)}" ${extra}></label>`
  const toggle = (label, key, on) => `<label class="dp-toggle"><b>${label}</b><input data-field="${key}" type="checkbox" ${on ? 'checked' : ''}></label>`
  const select = (label, key, choices, selected) => `<label class="dp-field"><span>${label}</span><select data-field="${key}" aria-label="${label}">${choices.map(([id, title]) => `<option value="${esc(id)}" ${String(selected) === String(id) ? 'selected' : ''}>${esc(title)}</option>`).join('')}</select></label>`
  const card = (title, body, actions = '') => `<section class="dp-card"><header class="dp-card-head"><h2>${title}</h2><div class="dp-actions">${actions}</div></header>${body}</section>`
  const empty = (text = '暂无数据') => `<div class="dp-empty">${text}</div>`
  const bytes = (input = 0) => { let n = Number(input) || 0, i = 0; const units = ['B', 'KB', 'MB', 'GB', 'TB']; while (n >= 1024 && i < 4) { n /= 1024; i++ } return `${n.toFixed(i ? 1 : 0)} ${units[i]}` }
  const date = (input) => input ? new Date(input).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
  const metric = (label, content, key = '') => `<div class="dp-stat"><span>${label}</span><strong ${key ? `data-live="${key}"` : ''}>${content}</strong></div>`
  let disposeSelects = () => {}, disposed = false, polling = false

  function chart() {
    const samples = state.history, max = Math.max(1024, ...samples.map((item) => Math.max(item.up, item.down)))
    const points = (key) => samples.map((item, index) => `${index * 600 / Math.max(1, samples.length - 1)},${95 - 83 * item[key] / max}`).join(' ')
    return `<svg viewBox="0 0 600 108" class="dp-chart" aria-label="流量趋势"><path d="M0 32H600M0 64H600M0 96H600" stroke="currentColor" opacity=".08"/>${samples.length > 1 ? `<polyline points="${points('up')}" fill="none" class="dp-chart-up"/><polyline points="${points('down')}" fill="none" class="dp-chart-down"/>` : ''}</svg>`
  }
  /** Compact "where do I exit from" row — lives under the config card on the dashboard. */
  function exitIpCard() {
    const ip = state.ip
    const actions = `${btn(state.ipBusy ? '检测中…' : '检测', 'ipCheck')}`
    if (!ip) return card('出口 IP', empty(state.ipBusy ? '正在检测…' : '点「检测」查看出口 IP 与所在位置'), actions)
    if (ip.error) return card('出口 IP', `<div class="dp-message error">${esc(ip.error)}</div>`, actions)
    const p = ip.throughProxy ?? {}
    const detail = [p.location, p.isp, ip.exit?.selected ? `节点 ${ip.exit.selected}` : '', p.ms === undefined ? '' : `${p.ms} ms`].filter(Boolean).join(' · ')
    const row = (label, ipValue, extra, tag) => `<div class="dp-node"><div><b>${esc(ipValue)}</b><small>${esc([label, extra].filter(Boolean).join(' · '))}</small></div><span class="dp-tag">${esc(tag)}</span></div>`
    const rows = [row('', p.ip || '—', detail, ip.verdict === 'direct' ? '直连出口' : '代理出口')]
    if (ip.direct) rows.push(row('直连', ip.direct.ip, ip.direct.location || '', '本机'))
    return card('出口 IP', rows.join(''), actions)
  }
  async function checkIp() {
    if (state.ipBusy) return
    state.ipBusy = true; state.error = ''; render()
    try { state.ip = await call('ipCheck') }
    catch (error) { state.ip = { error: error.message } }
    finally { state.ipBusy = false; render() }
  }
  function dashboard() {
    const s = state.settings, a = state.activity, active = state.profiles.items.find((item) => item.id === state.profiles.activeId)
    return `<div class="dp-stats">${metric('上传', bytes(a.up) + '/s', 'up')}${metric('下载', bytes(a.down) + '/s', 'down')}${metric('连接', String(a.connections?.length ?? 0), 'count')}${metric('累计流量', bytes((a.uploadTotal ?? 0) + (a.downloadTotal ?? 0)), 'total')}</div>` + card('流量', `<div data-live="chart">${chart()}</div><div class="dp-chart-key"><span>↑ 上传</span><span>↓ 下载</span></div>`) + `<div class="dp-columns">${card('连接', `<div class="dp-connect"><span class="dp-pill ${state.status?.running ? 'on' : ''}"><i class="dp-dot"></i>${state.status?.running ? '运行中' : '已停止'}</span>${btn(state.status?.running ? '停止' : '启动', state.status?.running ? 'stop' : 'start', '', state.status?.running ? 'danger' : 'primary')}</div>${select('模式', 'mode', [['rule', '规则'], ['global', '全局'], ['direct', '直连']], s.mode)}${toggle('TUN', 'tunEnable', s.tunEnable)}${toggle('系统代理', 'systemProxy', s.systemProxy)}${toggle('自动启动', 'autoStart', s.autoStart)}${toggle('关 DSH 时关代理', 'stopOnExit', s.stopOnExit)}<div class="dp-actions dp-bottom">${btn('应用', 'saveConnection', '', 'primary')}${btn('重启', 'restart')}</div>`)}<div class="dp-stack">${card('配置', `<div class="dp-node"><div><b>${esc(active?.name || (s.profilePath || s.subscriptionConfigured ? '默认配置' : '未选择'))}</b><small>节点 ${state.catalog.length} · 端口 ${s.mixedPort} · 内核 ${esc(state.status?.kernel?.version || '未安装')}${s.chainEnabled ? ' · 链式 ' + s.chain.length + ' 跳' : ''}</small></div></div><div class="dp-actions dp-bottom">${btn('管理订阅', 'openProfiles')}${btn('更新内核', 'install')}</div>`)}${exitIpCard()}</div></div>`
  }
  function profilesView() {
    return card('订阅', state.profiles.items.length ? `<div class="dp-profiles">${state.profiles.items.map((item) => {
      const selected = state.profiles.activeId === item.id, info = item.info ?? {}
      return `<article class="dp-profile ${selected ? 'selected' : ''}"><div class="dp-profile-line"><div><b>${esc(item.name)}</b><small>${item.remote ? '订阅' : '本地'} · ${item.nodeCount} 节点 · ${date(item.updatedAt)}</small></div><span class="dp-profile-check">${selected ? '✓' : ''}</span></div>${info.total ? `<div class="dp-usage"><span>${bytes((info.upload ?? 0) + (info.download ?? 0))} / ${bytes(info.total)}</span>${info.expire ? `<span>${date(info.expire * 1000)}</span>` : ''}</div><progress max="${info.total}" value="${Math.min(info.total, (info.upload ?? 0) + (info.download ?? 0))}"></progress>` : ''}<div class="dp-actions">${btn(selected ? '已启用' : '启用', 'activateProfile', `data-id="${item.id}"`, selected ? '' : 'primary')}${item.remote ? btn('更新', 'refreshProfile', `data-id="${item.id}"`) : ''}${btn('编辑', 'editProfile', `data-id="${item.id}"`)}${btn('删除', 'removeProfile', `data-id="${item.id}"`, 'danger')}</div></article>`
    }).join('')}</div>` : empty('暂无订阅'), btn('全部更新', 'refreshAll')) + card('导入', `<div class="dp-grid">${field('名称', 'profileName')}${field('订阅 URL', 'subscriptionUrl', '', 'password', 'autocomplete="new-password"')}</div><div class="dp-actions">${btn('导入', 'importSubscription', '', 'primary')}</div><details class="dp-bottom"><summary>节点链接 / YAML</summary><textarea data-field="nodeUrls" rows="5" placeholder="ss://…"></textarea><div class="dp-actions dp-bottom">${btn('导入', 'importNodes', '', 'primary')}</div></details>`)
  }
  function currentGroup() { return state.groups.find((group) => group.name === state.group) ?? state.groups[0] ?? { name: 'DSH-PROXY', type: 'Selector', nodes: state.catalog.map((item) => item.name), now: state.settings?.selectedNode } }
  function visibleNodes() {
    const group = currentGroup(), catalog = new Map(state.catalog.map((node) => [node.name, node]))
    let nodes = group ? group.nodes.map((name) => catalog.get(name) ?? { name, type: '策略组' }) : [...state.catalog]
    const query = state.search.toLocaleLowerCase()
    nodes = nodes.filter((node) => `${node.name} ${node.type}`.toLocaleLowerCase().includes(query))
    if (state.sort === 'name') nodes.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    if (state.sort === 'delay') nodes.sort((a, b) => (state.delays[a.name] ?? Infinity) - (state.delays[b.name] ?? Infinity))
    return nodes
  }
  function nodeCards() {
    const group = currentGroup(), nodes = visibleNodes()
    return nodes.length ? nodes.map((node) => `<article class="dp-proxy ${group?.now === node.name ? 'selected' : ''}"><button type="button" class="dp-proxy-main" data-action="chooseNode" data-node="${esc(node.name)}" ${state.busy ? 'disabled' : ''}><span><b>${esc(node.name)}</b><small>${esc(node.type)}</small></span><span class="dp-delay ${state.delays[node.name] > 0 ? 'good' : ''}">${state.delays[node.name] === undefined ? '—' : state.delays[node.name] > 0 ? state.delays[node.name] + ' ms' : '超时'}</span></button><div class="dp-proxy-actions">${btn('测速', 'delay', `data-node="${esc(node.name)}"`)}${btn('加入链式', 'addHop', `data-node="${esc(node.name)}"`)}</div></article>`).join('') : empty('暂无节点')
  }
  function proxiesView() {
    return card('代理', `<div class="dp-toolbar">${state.groups.length ? select('策略组', 'group', state.groups.map((group) => [group.name, group.name]), currentGroup()?.name) : ''}${select('排序', 'sort', [['default', '默认'], ['delay', '延迟'], ['name', '名称']], state.sort)}<label class="dp-field dp-grow"><span>搜索</span><input data-field="nodeSearch" value="${esc(state.search)}" placeholder="节点"></label></div>${state.progress ? `<div class="dp-test-progress">${esc(state.progress)} ${btn('取消', 'cancelTest')}</div>` : ''}<div class="dp-proxy-grid" data-region="nodes">${nodeCards()}</div>`, `${btn('批量测速', 'batchDelay')}${btn('刷新', 'catalog')}`) + card('手动节点', `${state.settings.manualProxies.map((node) => `<div class="dp-node"><div><b>${esc(node.name)}</b><small>${esc(node.type)} · ${esc(node.server)}:${node.port}</small></div>${btn('删除', 'removeProxy', `data-node="${esc(node.name)}"`, 'danger')}</div>`).join('')}<details><summary>添加节点</summary><div class="dp-grid">${field('名称', 'proxyName')}${field('服务器', 'proxyServer')}${select('协议', 'proxyType', [['socks5', 'SOCKS5'], ['http', 'HTTP']], 'socks5')}${field('端口', 'proxyPort', '1080', 'number')}${field('用户名', 'proxyUsername')}${field('密码', 'proxyPassword', '', 'password')}</div>${toggle('TLS', 'proxyTls', false)}<div class="dp-bottom">${btn('保存', 'upsertProxy', '', 'primary')}</div></details>`)
  }
  function chainView() {
    return card('链式', `${state.chain.length ? state.chain.map((name, index) => `<div class="dp-hop"><span class="dp-hop-number">${index + 1}</span><span class="dp-hop-name"><b>${esc(name)}</b><small>${index === 0 ? '入口' : index === state.chain.length - 1 ? '出口' : '中转'}</small></span><div class="dp-actions">${btn('↑', 'moveUp', `data-index="${index}" aria-label="上移"`)}${btn('↓', 'moveDown', `data-index="${index}" aria-label="下移"`)}${btn('移除', 'removeHop', `data-index="${index}"`)}</div></div>${index < state.chain.length - 1 ? '<div class="dp-arrow">↓</div>' : ''}`).join('') : empty('暂无链路')}<div class="dp-row dp-bottom"><select data-field="hopNode" aria-label="添加链式节点"><option value="">选择节点</option>${state.catalog.filter((node) => !state.chain.includes(node.name)).map((node) => `<option>${esc(node.name)}</option>`).join('')}</select>${btn('添加', 'appendHop')}</div>${toggle('启用', 'chainEnabled', state.settings.chainEnabled)}<div class="dp-actions dp-bottom">${btn('应用', 'saveChain', '', 'primary')}<span class="dp-tag">TCP · ${state.chain.length} 跳</span></div>`)
  }
  function connectionRows() {
    const query = value('connectionSearch').toLowerCase()
    const connections = (state.activity.connections ?? []).filter((item) => `${item.host} ${item.process} ${item.chains.join(' ')} ${item.rule}`.toLowerCase().includes(query))
    return connections.length ? `<div class="dp-table-scroll"><table><thead><tr><th>目标</th><th>进程</th><th>策略</th><th>↑ / ↓</th><th></th></tr></thead><tbody>${connections.map((item) => `<tr><td><b>${esc(item.host)}:${esc(item.port)}</b><small>${esc(item.network)}</small></td><td>${esc(item.process || '—')}</td><td>${esc(item.chains.join(' → '))}<small>${esc(item.rule)}</small></td><td class="dp-nowrap">${bytes(item.upload)} / ${bytes(item.download)}</td><td>${btn('断开', 'closeConnection', `data-id="${esc(item.id)}"`, 'danger')}</td></tr>`).join('')}</tbody></table></div>` : empty()
  }
  function connectionsView() { return card('连接', `<input class="dp-search" data-field="connectionSearch" placeholder="搜索目标、进程、策略"><div data-region="connections">${connectionRows()}</div>`, `${btn(state.paused[state.tab] ? '继续' : '暂停', 'pause')}${btn('断开全部', 'closeAll', '', 'danger')}`) }
  function rulesView() {
    const custom = state.settings.customRules.join('\n')
    return card('自定义规则', `<textarea data-field="customRules" rows="5" placeholder="DOMAIN-SUFFIX,example.com,DIRECT">${esc(custom)}</textarea><div class="dp-bottom">${btn('保存并应用', 'saveRules', '', 'primary')}</div>`) + card('运行规则', `<input class="dp-search" data-field="ruleSearch" placeholder="搜索规则"><div class="dp-table-scroll"><table><thead><tr><th>类型</th><th>内容</th><th>策略</th></tr></thead><tbody>${state.rules.map((rule) => `<tr data-rule="${esc(`${rule.type} ${rule.payload} ${rule.proxy}`.toLowerCase())}"><td>${esc(rule.type)}</td><td>${esc(rule.payload)}</td><td>${esc(rule.proxy)}</td></tr>`).join('')}</tbody></table>${state.rules.length ? '' : empty()}</div>`, btn('刷新', 'loadRules'))
  }
  function settingsView() {
    const s = state.settings
    return card('网络', `<div class="dp-grid">${field('混合端口', 'mixedPort', s.mixedPort, 'number')}${field('控制器端口', 'controllerPort', s.controllerPort, 'number')}${select('TUN 协议栈', 'tunStack', [['mixed', 'Mixed'], ['system', 'System'], ['gvisor', 'gVisor']], s.tunStack)}${field('MTU', 'mtu', s.mtu, 'number')}</div>${toggle('IPv6', 'ipv6', s.ipv6)}${toggle('严格路由', 'strictRoute', s.strictRoute)}<div class="dp-grid dp-bottom">${select('DNS 模式', 'dnsMode', [['redir-host', 'redir-host'], ['fake-ip', 'fake-ip']], s.dnsMode)}${field('DNS 监听', 'dnsListen', s.dnsListen)}${field('DNS', 'dnsServers', s.dnsServers.join(', '))}${field('下载镜像', 'githubMirror', s.githubMirror)}</div><div class="dp-bottom">${btn('保存并应用', 'saveAdvanced', '', 'primary')}</div>`) + card('测速', `<div class="dp-grid">${field('测试 URL', 'testUrl', s.testUrl)}${field('超时 (ms)', 'testTimeout', s.testTimeout, 'number')}</div>${btn('保存', 'saveTest', '', 'primary')}`) + card('内核', `<div class="dp-actions"><code>${esc(state.status?.kernel?.version || '未安装')}</code>${btn('检查配置', 'validate')}${btn('更新', 'install')}${btn('诊断', 'diagnose')}</div>`) + card('备份', `<div class="dp-actions">${btn('导出', 'exportBackup')}${btn('恢复', 'restoreFile')}<input data-field="backupFile" type="file" accept="application/json,.json" hidden></div>`)
  }
  function editor() {
    const data = state.editor
    if (!data) return ''
    return `<dialog class="dp-dialog"><header><h2>${esc(data.name)}</h2>${btn('关闭', 'closeEditor')}</header><div class="dp-grid">${field('名称', 'editName', data.name)}${field('更新间隔 (小时)', 'editInterval', data.autoUpdateHours, 'number')}</div><details><summary>配置</summary><textarea class="dp-code" data-field="editSource" rows="15">${esc(data.content)}</textarea></details><div class="dp-actions dp-bottom">${btn('保存', 'saveProfile', '', 'primary')}${btn('取消', 'closeEditor')}</div></dialog>`
  }
  function render() {
    if (disposed) return
    disposeSelects()
    const views = { dashboard, proxies: proxiesView, profiles: profilesView, chain: chainView, connections: connectionsView, rules: rulesView, settings: settingsView, logs: () => card('日志', `<pre data-region="logs">${esc(state.logs || '暂无日志')}</pre>`, `${btn(state.paused[state.tab] ? '继续' : '暂停', 'pause')}${btn('刷新', 'logs')}`) }
    root.innerHTML = `<style>${PANEL_CSS}</style><div class="dp"><button class="dp-back" data-action="back">← 返回</button><div class="dp-top"><h1>代理中心</h1><div class="dp-actions">${state.status?.pendingChanges ? btn('待应用', 'restart', '', 'primary') : ''}${btn('刷新', 'reload')}</div></div><nav class="dp-tabs" role="tablist">${[['dashboard','概览'],['proxies','代理'],['profiles','订阅'],['connections','连接'],['rules','规则'],['chain','链式'],['logs','日志'],['settings','设置']].map(([id, title]) => `<button role="tab" aria-selected="${id === state.tab}" class="${id === state.tab ? 'active' : ''}" data-tab="${id}">${title}</button>`).join('')}</nav>${state.error ? `<div class="dp-message error" role="alert">${esc(state.error)}</div>` : ''}${state.notice ? `<div class="dp-message notice" role="status">${esc(state.notice)}</div>` : ''}${state.settings ? views[state.tab]() : empty('连接中…')}${editor()}</div>`
    disposeSelects = enhanceSelects(root)
    const dialog = root.querySelector('dialog'); if (dialog) { dialog.showModal(); dialog.addEventListener('cancel', (event) => { event.preventDefault(); state.editor = null; render() }) }
  }
  async function loadCatalog() { state.catalog = (await call('catalog')).nodes }
  async function load() {
    state.profiles = await call('profiles')
    state.settings = await call('settings'); state.chain = [...state.settings.chain]
    state.status = await call('status')
    state.groups = state.status.running ? (await call('nodes')).groups : []
    if (!state.groups.some((group) => group.name === state.group)) state.group = state.groups.find((group) => group.name === 'DSH-PROXY')?.name || state.groups[0]?.name || ''
    await loadCatalog()
    // show where traffic currently leaves from without making the user hunt for a button
    if (state.status.running && !state.ip && !state.ipBusy) void checkIp()
  }
  async function save(patch, apply = true) {
    await call('set', { patch }); if (apply && state.status?.running) await call('restart')
    await load(); state.notice = '已保存'
  }
  async function refreshCurrentView() {
    if (state.tab === 'connections' || state.tab === 'dashboard') state.activity = await call('activity')
    if (state.tab === 'rules') { const result = await call('rules').catch(() => ({ rules: [] })); state.rules = result.rules }
    if (state.tab === 'logs') state.logs = (await call('logs')).tail
  }
  async function handle(action, target) {
    const id = target.dataset.id, node = target.dataset.node, index = Number(target.dataset.index)
    switch (action) {
      case 'view': await refreshCurrentView(); return
      case 'back': back(); return
      case 'reload': await load(); await refreshCurrentView(); return
      case 'openProfiles': state.tab = 'profiles'; return
      case 'start': if (!state.status.kernel.installed) await call('install'); await call('start'); await load(); return
      case 'stop': await call('stop'); await load(); return
      case 'restart': await call('restart'); await load(); return
      case 'saveConnection': { const mode = value('mode'); await save({ mode, tunEnable: checked('tunEnable'), systemProxy: checked('systemProxy'), autoStart: checked('autoStart'), stopOnExit: checked('stopOnExit'), ...(mode === 'direct' ? { chainEnabled: false } : {}) }); return }
      case 'importSubscription': case 'importNodes': await call('addProfile', { name: value('profileName'), source: value(action === 'importSubscription' ? 'subscriptionUrl' : 'nodeUrls') }); await load(); return
      case 'activateProfile': await call('activateProfile', { id }); if (state.status?.running) await call('restart'); await load(); return
      case 'refreshProfile': await call('refreshProfile', { id }); await load(); return
      case 'refreshAll': for (const item of state.profiles.items.filter((item) => item.remote)) await call('refreshProfile', { id: item.id }); await load(); return
      case 'removeProfile': await call('removeProfile', { id }); await load(); return
      case 'editProfile': { const item = state.profiles.items.find((item) => item.id === id); state.editor = { ...item, ...(await call('profileContent', { id })) }; return }
      case 'closeEditor': state.editor = null; return
      case 'saveProfile': { const input = { id: state.editor.id, name: value('editName'), autoUpdateHours: Number(value('editInterval')) }; if (value('editSource') !== state.editor.content) input.source = value('editSource'); await call('editProfile', { profile: input }); state.editor = null; await load(); return }
      case 'catalog': await loadCatalog(); if (state.status?.running) state.groups = (await call('nodes')).groups; return
      case 'chooseNode': { const group = currentGroup(); await call('select', { group: group.name, node }); state.settings = await call('settings'); if (state.status?.running) state.groups = (await call('nodes')).groups; return }
      case 'delay': { const result = await call('delay', { node }); state.delays[node] = result.ok ? result.delay : -1; return }
      case 'batchDelay': {
        const names = visibleNodes().map((item) => item.name); state.cancel = false
        for (let offset = 0; offset < names.length && !state.cancel; offset += 6) {
          state.progress = `${Math.min(offset + 6, names.length)} / ${names.length}`; render()
          const result = await call('batchDelay', { nodes: names.slice(offset, offset + 6) })
          for (const item of result.results) state.delays[item.node] = item.ok ? item.delay : -1
        }
        state.progress = ''; return
      }
      case 'addHop': if (!state.chain.includes(node)) state.chain.push(node); state.tab = 'chain'; return
      case 'appendHop': { const name = value('hopNode'); if (name && !state.chain.includes(name)) state.chain.push(name); return }
      case 'moveUp': if (index > 0) [state.chain[index - 1], state.chain[index]] = [state.chain[index], state.chain[index - 1]]; return
      case 'moveDown': if (index < state.chain.length - 1) [state.chain[index], state.chain[index + 1]] = [state.chain[index + 1], state.chain[index]]; return
      case 'removeHop': state.chain.splice(index, 1); return
      case 'saveChain': await save({ chain: state.chain, chainEnabled: checked('chainEnabled'), ...(checked('chainEnabled') && state.settings.mode === 'direct' ? { mode: 'global' } : {}) }); return
      case 'closeConnection': await call('closeConnections', { id }); state.activity = await call('activity'); return
      case 'closeAll': await call('closeConnections'); state.activity = await call('activity'); return
      case 'pause': state.paused[state.tab] = !state.paused[state.tab]; return
      case 'loadRules': state.rules = (await call('rules')).rules; return
      case 'saveRules': await save({ customRules: value('customRules').split(/\r?\n/).map((line) => line.trim()).filter(Boolean) }); if (state.status?.running) state.rules = (await call('rules')).rules; return
      case 'saveAdvanced': await save({ mixedPort: Number(value('mixedPort')), controllerPort: Number(value('controllerPort')), tunStack: value('tunStack'), mtu: Number(value('mtu')), ipv6: checked('ipv6'), strictRoute: checked('strictRoute'), dnsMode: value('dnsMode'), dnsListen: value('dnsListen'), dnsServers: value('dnsServers').split(',').map((s) => s.trim()).filter(Boolean), githubMirror: value('githubMirror') }); return
      case 'saveTest': await save({ testUrl: value('testUrl'), testTimeout: Number(value('testTimeout')) }, false); return
      case 'upsertProxy': { const proxy = { name: value('proxyName'), type: value('proxyType'), server: value('proxyServer'), port: Number(value('proxyPort')), username: value('proxyUsername'), tls: checked('proxyTls') }; if (value('proxyPassword')) proxy.password = value('proxyPassword'); await call('upsertProxy', { proxy }); await load(); return }
      case 'removeProxy': await call('removeProxy', { name: node }); await load(); return
      case 'validate': await call('validate'); state.notice = '配置正常'; return
      case 'diagnose': { const status = await call('status', { verbose: true }); state.notice = `${status.tun.adapter?.name || 'TUN 未启动'} · ${status.tun.defaultRoutes.length} 条路由`; return }
      case 'ipCheck': await checkIp(); return
      case 'install': await call('install'); await load(); return
      case 'exportBackup': {
        const data = await call('exportBackup')
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
        const link = document.createElement('a'); link.href = url; link.download = 'dsh-proxy-backup.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return
      }
      case 'restoreFile': el('backupFile').click(); return
      case 'logs': state.logs = (await call('logs')).tail; return
    }
  }
  async function run(action, target) {
    state.busy = true; state.error = ''; state.notice = ''
    root.setAttribute('aria-busy', 'true')
    for (const button of root.querySelectorAll('button')) if (button.dataset.action !== 'cancelTest') button.disabled = true
    try { await handle(action, target) }
    catch (error) { state.error = error.message }
    finally { state.busy = false; root.setAttribute('aria-busy', 'false'); render() }
  }
  const click = async (event) => {
    const target = event.target.closest('[data-action]')
    if (target?.dataset.action === 'cancelTest') { state.cancel = true; return }
    if (state.busy) return
    const tab = event.target.closest('[data-tab]')
    if (tab) { state.tab = tab.dataset.tab; state.notice = ''; state.error = ''; render(); await run('view', tab); return }
    if (target) await run(target.dataset.action, target)
  }
  const input = (event) => {
    if (event.target.dataset.field === 'editSource' && state.editor?.remote) {
      const save = root.querySelector('[data-action=saveProfile]')
      if (save) save.textContent = event.target.value === state.editor.content ? '保存' : '保存为本地'
    }
    if (event.target.dataset.field === 'nodeSearch') { state.search = event.target.value; root.querySelector('[data-region=nodes]').innerHTML = nodeCards() }
    if (event.target.dataset.field === 'connectionSearch') root.querySelector('[data-region=connections]').innerHTML = connectionRows()
    if (event.target.dataset.field === 'ruleSearch') for (const row of root.querySelectorAll('[data-rule]')) row.hidden = !row.dataset.rule.includes(event.target.value.toLowerCase())
  }
  const change = async (event) => {
    if (event.target.dataset.field === 'backupFile' && event.target.files[0]) {
      try {
        const file = event.target.files[0]; if (file.size > 8 * 1024 * 1024) throw new Error('文件过大')
        await call('restoreBackup', { backup: JSON.parse(await file.text()) }); await load(); state.notice = '已恢复'
      } catch (error) { state.error = error.message }
      render(); return
    }
    if (event.target.dataset.field === 'sort') { state.sort = event.target.value; render() }
    if (event.target.dataset.field === 'group') { state.group = event.target.value; render() }
  }
  const poll = async () => {
    if (polling || disposed || state.busy || state.paused[state.tab] || document.hidden || !state.settings) return
    polling = true
    try {
      if (state.tab === 'dashboard' || state.tab === 'connections') {
        state.activity = await call('activity'); state.history.push({ up: state.activity.up, down: state.activity.down }); state.history = state.history.slice(-40)
        const values = { up: bytes(state.activity.up) + '/s', down: bytes(state.activity.down) + '/s', count: String(state.activity.connections.length), total: bytes(state.activity.uploadTotal + state.activity.downloadTotal) }
        for (const [key, value] of Object.entries(values)) { const target = root.querySelector(`[data-live=${key}]`); if (target) target.textContent = value }
        const graph = root.querySelector('[data-live=chart]'); if (graph) graph.innerHTML = chart()
        const table = root.querySelector('[data-region=connections]'); if (table) table.innerHTML = connectionRows()
      }
      if (state.tab === 'logs') { state.logs = (await call('logs')).tail; const pre = root.querySelector('[data-region=logs]'); if (pre) pre.textContent = state.logs }
    } catch { /* disconnected kernel: preserve last visible sample */ }
    finally { polling = false }
  }
  // View loading is separate from rendering so polling never destroys drafts.
  root.addEventListener('click', click); root.addEventListener('input', input); root.addEventListener('change', change)
  render()
  void (async () => { try { await load(); await refreshCurrentView() } catch (error) { state.error = error.message } finally { render() } })()
  const timer = setInterval(poll, 2000)
  return () => { disposed = true; clearInterval(timer); disposeSelects(); root.removeEventListener('click', click); root.removeEventListener('input', input); root.removeEventListener('change', change); root.innerHTML = '' }
}
