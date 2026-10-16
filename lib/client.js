window.__ModuleLoader__.load({id:'dsh-tun-proxy',factory(require){
const React=require('react');
// Host mode uses DSH's semantic tokens directly. Wallpaper Engine overrides
// these same tokens, so glass, accent and theme changes propagate without JS.
const PANEL_CSS = `
.dp{--text:var(--dsw-alias-label-primary);--muted:var(--dsw-alias-label-secondary);--tertiary:var(--dsw-alias-label-tertiary);--line:var(--dsw-alias-border-l2);--surface:var(--dsw-alias-bg-layer-3);--input:var(--dsw-alias-bg-layer-1);--hover:var(--dsw-alias-interactive-bg-hover);--accent:var(--dsw-alias-state-business-primary);--on-accent:var(--dsw-alias-state-business-on-primary,var(--dsw-alias-label-primary-foreground));--error:var(--dsw-alias-state-error-primary);--success:var(--dsw-alias-state-success-primary);box-sizing:border-box;height:100%;overflow:auto;display:flex;flex-direction:column;align-items:center;gap:0;padding:28px clamp(24px,4vw,48px) 48px;background:transparent;color:var(--text);font:inherit;font-size:13px;line-height:20px;color-scheme:inherit}
.dp>*{width:100%;max-width:760px;flex-shrink:0}.dp *{box-sizing:border-box}.dp button,.dp input,.dp select{font:inherit}.dp button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:5px 12px;border:1px solid var(--line);border-radius:7px;background:transparent;color:var(--text);font-size:13px;line-height:20px;cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s}.dp button:hover:not(:disabled){background:var(--hover)}.dp button:focus-visible,.dp input:focus-visible,.dp select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.dp button:disabled{opacity:.45;cursor:default}.dp button.primary{background:var(--accent);color:var(--on-accent);border-color:transparent}.dp button.primary:hover:not(:disabled){filter:brightness(.94)}.dp button.danger{color:var(--error)}.dp input:not([type=checkbox]),.dp select{width:100%;height:34px;padding:6px 10px;border:1px solid var(--line);border-radius:7px;background:var(--input);color:var(--text);outline:none;min-width:0}.dp input::placeholder{color:var(--tertiary)}.dp input:not([type=checkbox]):focus,.dp select:focus{border-color:var(--accent)}.dp h1{font-size:20px;font-weight:500;line-height:28px;letter-spacing:normal;margin:0}.dp h2{font-size:14px;line-height:22px;font-weight:550;margin:0}.dp p{color:var(--muted);font-size:13px;line-height:20px;margin:4px 0 0}.dp small{display:block;color:var(--tertiary);font-size:12px;line-height:18px}.dp b{font-weight:500}.dp-top{display:flex;justify-content:space-between;align-items:center;gap:20px;margin:16px 0 22px}.dp-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dp-tabs{display:flex;gap:4px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--line);margin-bottom:24px}.dp-tabs button{min-height:34px;padding:6px 12px;margin-bottom:-1px;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--muted)}.dp-tabs button:hover:not(:disabled){color:var(--text);background:transparent}.dp-tabs button.active{color:var(--text);border-bottom-color:var(--accent);font-weight:500}.dp-card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin-bottom:18px;box-shadow:none;min-width:0}.dp-card header{margin-bottom:16px}.dp-card header>p{margin-top:4px}.dp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:20px;row-gap:0}.dp-field{display:flex;flex-direction:column;gap:6px;margin:0 0 16px;font-size:12px;line-height:18px;min-width:0}.dp-field>span{font-weight:500;color:var(--muted)}.dp-toggle{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:14px 0;border-bottom:1px solid var(--line)}.dp-toggle:last-child{border-bottom:0}.dp-toggle b{font-size:13px;line-height:20px}.dp-toggle small{margin-top:3px;max-width:570px}.dp input[type=checkbox]{appearance:none;-webkit-appearance:none;position:relative;width:32px;height:18px;border:1px solid var(--line);border-radius:999px;flex:none;margin:0;background:var(--input);cursor:pointer;transition:background .18s,border-color .18s}.dp input[type=checkbox]::before{content:'';position:absolute;width:12px;height:12px;top:2px;left:2px;border-radius:50%;background:var(--muted);transition:transform .18s,background .18s}.dp input[type=checkbox]:checked{background:var(--accent);border-color:transparent}.dp input[type=checkbox]:checked::before{transform:translateX(14px);background:var(--dsw-alias-label-primary-foreground)}.dp input[type=checkbox]:disabled{opacity:.45;cursor:default}.dp-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;border:1px solid var(--line);border-radius:10px;background:var(--surface);margin-bottom:18px;overflow:hidden}.dp-stat{padding:14px 18px;position:relative;background:transparent;border:0;border-radius:0}.dp-stat+.dp-stat::before{content:'';position:absolute;top:18px;bottom:18px;left:0;border-left:1px solid var(--line)}.dp-stat strong{display:block;font-size:15px;line-height:24px;font-weight:500}.dp-stat span{display:block;color:var(--tertiary);font-size:12px;line-height:18px;margin-top:2px}.dp-pill{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:6px;font-size:12px;line-height:18px;background:var(--hover);color:var(--tertiary);white-space:nowrap}.dp-pill.on{background:color-mix(in srgb,var(--success) 10%,transparent);color:var(--success)}.dp-dot{width:6px;height:6px;border-radius:50%;background:currentColor}.dp-message{padding:10px 12px;border:1px solid var(--line);border-radius:8px;margin-bottom:16px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:19px}.dp-message.error{background:color-mix(in srgb,var(--error) 8%,transparent);border-color:color-mix(in srgb,var(--error) 25%,transparent);color:var(--error)}.dp-message.notice{background:color-mix(in srgb,var(--accent) 8%,transparent);border-color:color-mix(in srgb,var(--accent) 22%,transparent);color:var(--accent)}.dp-node{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 0;border-bottom:1px solid var(--line)}.dp-node:last-child{border:0}.dp-node>div:first-child{min-width:0}.dp-node b{font-size:13px;overflow-wrap:anywhere}.dp-node small{margin-top:3px}.dp-node .dp-actions{flex-wrap:nowrap}.dp-node select{max-width:280px}.dp-hop{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--line);border-radius:8px;margin:0;background:var(--input)}.dp-hop-number{display:grid;place-items:center;flex:none;width:26px;height:26px;border-radius:7px;background:color-mix(in srgb,var(--accent) 10%,transparent);color:var(--accent);font-size:12px;font-weight:500}.dp-hop-name{flex:1;min-width:0;overflow-wrap:anywhere}.dp-hop .dp-actions{gap:4px}.dp-hop button{min-height:26px;padding:2px 8px;font-size:12px}.dp-arrow{display:flex;align-items:center;height:24px;color:var(--tertiary);padding-left:25px;font-size:14px}.dp-empty{padding:26px 18px;color:var(--tertiary);text-align:center;border:1px dashed var(--line);border-radius:8px;font-size:12px}.dp pre{margin:14px 0 0;padding:14px;border:1px solid var(--line);border-radius:8px;max-height:520px;overflow:auto;background:var(--dsw-alias-markdown-code-block);color:var(--text);font:12px/19px ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.dp-search{margin-bottom:12px}.dp-footer{color:var(--tertiary);font-size:11px;line-height:18px;padding-top:2px}.dp details summary{cursor:pointer;color:var(--muted);font-size:13px;font-weight:500;margin-bottom:14px}.dp code{font:12px ui-monospace,Consolas,monospace;overflow-wrap:anywhere}.dp-nodes{max-height:420px;overflow:auto}.dp-row{display:flex;align-items:center;gap:8px}.dp-row>*:first-child{flex:1;min-width:0}.dp-source{overflow-wrap:anywhere}.dp button.dp-back{align-self:auto;justify-content:flex-start;width:100%;max-width:760px;min-height:20px;padding:0;margin:0;border:0;border-radius:0;background:transparent;color:var(--tertiary);font-size:12.5px}.dp button.dp-back:hover{color:var(--text);background:transparent}body[data-ds-dark-theme] .dp{color-scheme:dark}body[data-ds-dark-theme] .dp input[type=checkbox]::before{background:var(--dsw-alias-label-primary)}
.dp-select{display:flex;min-width:0;flex:1}.dp select[hidden]{display:none!important}.dp button.dp-select-trigger{width:100%;min-width:0;height:34px;justify-content:space-between;padding:6px 10px;background:var(--input);color:var(--text);font-weight:400}.dp-select-trigger[aria-expanded=true]{border-color:var(--accent)}.dp-select-trigger svg{flex:none;color:var(--tertiary);transition:transform .15s}.dp-select-trigger[aria-expanded=true] svg{transform:rotate(180deg)}.dp-select-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;flex:1}.dp>.dp-select-popup{position:fixed;inset:auto;z-index:2147483000;max-width:none;margin:0;padding:4px;background:var(--input);color:var(--text);border:1px solid var(--line);border-radius:9px;box-shadow:var(--dsw-shadow-lv2,0 8px 32px rgb(0 0 0 / .18));backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);overflow:hidden;display:flex;flex-direction:column;min-height:0}.dp-select-search-wrap{padding:4px 4px 8px;border-bottom:1px solid var(--line);flex:none}.dp input.dp-select-search{height:32px;background:transparent}.dp-select-list{overflow:auto;padding:3px;overscroll-behavior:contain;min-height:0;outline:none;scrollbar-width:thin;scrollbar-color:var(--tertiary) transparent}.dp-select-option{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:32px;padding:6px 9px;border-radius:5px;font-size:13px;line-height:20px;cursor:pointer;color:var(--text);white-space:normal;overflow-wrap:anywhere}.dp-select-option[data-active=true]{background:var(--hover)}.dp-select-option[aria-selected=true]{color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,transparent)}.dp-select-check{width:14px;flex:none;color:var(--accent)}.dp-select-empty{padding:20px 10px;text-align:center;color:var(--tertiary);font-size:12px}.dp-node .dp-select{width:240px;max-width:280px}
@media(max-width:850px){.dp-grid{grid-template-columns:1fr}.dp-top{align-items:flex-start;gap:12px}.dp-top>.dp-actions{justify-content:flex-end}.dp-stat{padding:12px}.dp-card{padding:16px}.dp-node .dp-actions{flex-wrap:wrap;justify-content:flex-end}}@media(max-width:560px){.dp{padding:20px 18px 32px}.dp-stats{grid-template-columns:repeat(2,1fr)}.dp-stat:nth-child(3)::before{display:none}.dp-top{flex-direction:column}.dp-tabs button{padding:6px 10px}}
@media(prefers-reduced-motion:reduce){.dp *{transition:none!important}}
.dp textarea{font:inherit;font-size:13px;line-height:20px;resize:vertical;width:100%;padding:9px 11px;background:var(--input);color:var(--text);border:1px solid var(--line);border-radius:7px;outline:none;min-height:100px}.dp textarea:focus{border-color:var(--accent)}.dp textarea::placeholder{color:var(--tertiary)}
.dp>*{max-width:960px}.dp button.dp-back{max-width:960px}.dp-top{margin-top:16px;margin-bottom:20px}.dp-tabs{margin-bottom:20px}.dp-card-head{display:flex;align-items:center;justify-content:space-between;gap:16px}.dp-card-head .dp-actions{flex-shrink:0}.dp-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.dp-chart{display:block;width:100%;height:120px;overflow:visible}.dp-chart polyline{stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.dp-chart-up{stroke:var(--accent)}.dp-chart-down{stroke:var(--success)}.dp-chart-key{display:flex;justify-content:flex-end;gap:18px;font-size:11px;color:var(--muted)}.dp-chart-key span:first-child{color:var(--accent)}.dp-chart-key span:last-child{color:var(--success)}.dp-connect{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}.dp-bottom{margin-top:16px}.dp-summary-name{font-size:18px;font-weight:500;line-height:28px;overflow-wrap:anywhere}.dp-kv{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:22px 0}.dp-kv dt{color:var(--tertiary)}.dp-kv dd{text-align:right;margin:0;font-variant-numeric:tabular-nums}.dp-profiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.dp-profile{padding:16px;border:1px solid var(--line);border-radius:9px;background:var(--input);min-width:0}.dp-profile.selected,.dp-proxy.selected{border-color:color-mix(in srgb,var(--accent) 65%,var(--line));background:color-mix(in srgb,var(--accent) 5%,var(--input))}.dp-profile-line{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:16px}.dp-profile-line b{font-size:14px;line-height:22px;overflow-wrap:anywhere}.dp-profile-line small{margin-top:3px}.dp-profile-check{color:var(--accent);font-size:17px}.dp-profile .dp-actions{gap:6px}.dp-profile .dp-actions button{font-size:12px;min-height:28px;padding:3px 9px}.dp-usage{display:flex;justify-content:space-between;gap:12px;font-size:11px;color:var(--tertiary)}.dp progress{accent-color:var(--accent);height:4px;width:100%;margin:9px 0 15px;border:0;border-radius:2px}.dp-toolbar{display:flex;align-items:end;gap:12px;margin-bottom:16px}.dp-toolbar .dp-field{margin:0;min-width:130px;flex:1}.dp-toolbar .dp-grow{flex:2}.dp-proxy-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.dp-proxy{border:1px solid var(--line);border-radius:9px;overflow:hidden;background:var(--input);min-width:0}.dp button.dp-proxy-main{border:0;border-radius:0;background:transparent;width:100%;min-height:62px;padding:12px;text-align:left;justify-content:space-between;gap:10px}.dp-proxy-main>span:first-child{min-width:0}.dp-proxy b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.dp-proxy small{font-size:11px;margin-top:3px}.dp-delay{font-size:11px;color:var(--tertiary);white-space:nowrap;flex-shrink:0;font-variant-numeric:tabular-nums}.dp-delay.good{color:var(--success)}.dp-proxy-actions{display:flex;justify-content:flex-end;border-top:1px solid var(--line);padding:4px 6px;gap:4px}.dp-proxy-actions button{border:0;background:transparent;font-size:11px;line-height:18px;padding:2px 6px;min-height:22px;color:var(--tertiary)}.dp-proxy-grid>.dp-empty{grid-column:1/-1}.dp-test-progress{display:flex;justify-content:space-between;align-items:center;color:var(--muted);font-size:12px;margin-bottom:12px}.dp-tag{color:var(--tertiary);font-size:11px;line-height:20px;padding:2px 7px;border-radius:5px;background:var(--hover)}.dp-table-scroll{width:100%;max-height:520px;overflow:auto;scrollbar-width:thin}.dp table{width:100%;border-collapse:collapse;font-size:12px;text-align:left}.dp th{position:sticky;top:0;background:var(--input);color:var(--tertiary);font-size:11px;font-weight:500;white-space:nowrap;padding:9px 10px;border-bottom:1px solid var(--line)}.dp td{padding:10px;border-bottom:1px solid var(--line);vertical-align:top;max-width:300px;overflow-wrap:anywhere}.dp td small{font-size:10px;margin-top:4px}.dp tr:last-child td{border-bottom:0}.dp td button{font-size:11px;min-height:26px;padding:2px 8px}.dp-nowrap{white-space:nowrap}.dp input.dp-search{margin-bottom:14px}.dp-dialog{box-sizing:border-box;position:fixed;inset:0;margin:auto!important;padding:24px;max-width:840px!important;width:calc(100vw - 48px)!important;max-height:85vh;height:max-content;overflow:auto;border:1px solid var(--line);border-radius:12px;background:var(--input);color:var(--text);box-shadow:var(--dsw-shadow-lv2)}.dp-dialog::backdrop{background:rgb(0 0 0 / .3);backdrop-filter:blur(3px)}.dp-dialog>header{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px}.dp textarea.dp-code{font:12px/19px ui-monospace,Consolas,monospace}.dp details{margin-top:14px}.dp-stats .dp-stat span{margin:0 0 3px}.dp-stats .dp-stat strong{font-size:18px;line-height:26px}@media(max-width:900px){.dp-proxy-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dp-toolbar{flex-wrap:wrap}.dp-card-head{align-items:flex-start}}@media(max-width:650px){.dp-columns,.dp-profiles{grid-template-columns:1fr}.dp-proxy-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dp-card-head{flex-wrap:wrap}.dp-toolbar .dp-field{min-width:100px}.dp-tabs button{padding:6px 9px}}
/* Standalone diagnostic page only. Never overrides the host's palette. */
body[data-proxy-standalone]{font:13px/20px system-ui,sans-serif;background:#fff;--dsw-alias-label-primary:#262626;--dsw-alias-label-secondary:#666;--dsw-alias-label-tertiary:#999;--dsw-alias-label-primary-foreground:#fff;--dsw-alias-border-l2:#e8e8e8;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-3:#fafafa;--dsw-alias-interactive-bg-hover:#f0f0f0;--dsw-alias-state-business-primary:#4d6bfe;--dsw-alias-state-business-on-primary:#fff;--dsw-alias-state-success-primary:#16a34a;--dsw-alias-state-error-primary:#dc4554;--dsw-alias-markdown-code-block:#f5f5f5;color-scheme:light}
@media(prefers-color-scheme:dark){body[data-proxy-standalone]:not([data-preview-theme=light]){background:#191919;--dsw-alias-label-primary:#ececec;--dsw-alias-label-secondary:#b0b0b0;--dsw-alias-label-tertiary:#777;--dsw-alias-border-l2:#383838;--dsw-alias-bg-layer-1:#212121;--dsw-alias-bg-layer-3:#252525;--dsw-alias-interactive-bg-hover:#333;--dsw-alias-state-business-primary:#7b8dff;--dsw-alias-state-success-primary:#52bb88;--dsw-alias-state-error-primary:#ff7484;--dsw-alias-markdown-code-block:#1c1c1c;color-scheme:dark}}
body[data-proxy-standalone][data-preview-theme=dark]{background:#191919;--dsw-alias-label-primary:#ececec;--dsw-alias-label-secondary:#b0b0b0;--dsw-alias-label-tertiary:#777;--dsw-alias-border-l2:#383838;--dsw-alias-bg-layer-1:#212121;--dsw-alias-bg-layer-3:#252525;--dsw-alias-interactive-bg-hover:#333;--dsw-alias-state-business-primary:#7b8dff;--dsw-alias-state-success-primary:#52bb88;--dsw-alias-state-error-primary:#ff7484;--dsw-alias-markdown-code-block:#1c1c1c;color-scheme:dark}
/* Dashboard right column: config card on top, exit-IP card underneath; the
   second card grows so both columns end at the same height as 连接. */
.dp-columns>.dp-stack{display:flex;flex-direction:column;gap:18px;min-width:0}
.dp-stack>.dp-card{min-width:0}
.dp-stack>.dp-card:last-child{flex:1}
.dp-stack>.dp-card:last-child .dp-node{margin-bottom:0}
`

// A DOM listbox avoids the operating system's unthemeable <option> popup.
function enhanceSelects(root) {
  let popup = null, cleanupPopup = null
  const close = (focus = false) => {
    if (!popup) return
    const trigger = popup.trigger
    cleanupPopup?.(); cleanupPopup = null
    if (popup.element.matches(':popover-open')) popup.element.hidePopover()
    popup.element.remove(); popup = null
    trigger.setAttribute('aria-expanded', 'false')
    if (focus) trigger.focus()
  }
  const cleanups = []
  for (const select of root.querySelectorAll('select')) {
    const name = select.getAttribute('aria-label') || select.closest('label')?.querySelector('span')?.textContent || select.dataset.field || '选择'
    const wrapper = document.createElement('div'); wrapper.className = 'dp-select'
    select.before(wrapper); wrapper.append(select); select.hidden = true; select.tabIndex = -1; select.setAttribute('aria-hidden', 'true')
    const trigger = document.createElement('button')
    trigger.type = 'button'; trigger.className = 'dp-select-trigger'; trigger.disabled = select.disabled
    trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-label', name)
    trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false')
    const label = document.createElement('span'); label.className = 'dp-select-label'; label.textContent = select.selectedOptions[0]?.textContent || '请选择'
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    arrow.setAttribute('viewBox', '0 0 16 16'); arrow.setAttribute('width', '14'); arrow.setAttribute('height', '14'); arrow.setAttribute('aria-hidden', 'true')
    arrow.innerHTML = '<path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'
    trigger.append(label, arrow); wrapper.append(trigger)
    const open = () => {
      if (trigger.disabled) return
      if (popup?.trigger === trigger) { close(true); return }
      close()
      const element = document.createElement('div'); element.className = 'dp-select-popup'
      element.setAttribute('popover', 'manual')
      const id = `dp-list-${Math.random().toString(36).slice(2)}`
      trigger.setAttribute('aria-controls', id); trigger.setAttribute('aria-expanded', 'true')
      const searchable = select.options.length > 8
      const search = document.createElement('input'); search.className = 'dp-select-search'; search.type = 'search'; search.placeholder = '搜索节点…'; search.setAttribute('aria-label', `${name}：搜索`)
      if (searchable) { const head = document.createElement('div'); head.className = 'dp-select-search-wrap'; head.append(search); element.append(head) }
      const list = document.createElement('div'); list.id = id; list.className = 'dp-select-list'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', name); list.tabIndex = -1
      element.append(list); root.querySelector('.dp').append(element)
      popup = { trigger, element }
      if (typeof element.showPopover === 'function') element.showPopover()
      let visible = [], active = -1
      const position = () => {
        const rect = trigger.getBoundingClientRect(), gap = 6, edge = 12
        const below = innerHeight - rect.bottom - edge, above = rect.top - edge
        const flip = below < 240 && above > below
        const height = Math.max(100, Math.min(344, flip ? above - gap : below - gap))
        element.style.width = `${Math.min(rect.width, innerWidth - edge * 2)}px`
        element.style.left = `${Math.max(edge, Math.min(rect.left, innerWidth - rect.width - edge))}px`
        element.style.maxHeight = `${height}px`
        list.style.maxHeight = `${height - (searchable ? 53 : 10)}px`
        element.style.top = flip ? '' : `${rect.bottom + gap}px`
        element.style.bottom = flip ? `${innerHeight - rect.top + gap}px` : ''
      }
      const highlight = (index, scroll = true) => {
        active = Math.max(0, Math.min(index, visible.length - 1))
        for (let i = 0; i < visible.length; i++) visible[i].element.dataset.active = String(i === active)
        const item = visible[active]?.element
        if (item) {
          (searchable ? search : trigger).setAttribute('aria-activedescendant', item.id)
          if (scroll) item.scrollIntoView({ block: 'nearest' })
        }
      }
      const choose = (index) => {
        const item = visible[index]; if (!item) return
        select.value = item.option.value; label.textContent = item.option.textContent
        select.dispatchEvent(new Event('change', { bubbles: true }))
        close(true)
      }
      const draw = () => {
        list.replaceChildren(); visible = []
        const query = search.value.trim().toLocaleLowerCase()
        for (const [index, option] of [...select.options].entries()) {
          if (option.disabled || (query && !option.textContent.toLocaleLowerCase().includes(query))) continue
          const item = document.createElement('div'); item.className = 'dp-select-option'; item.id = `${id}-${index}`
          item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(option.selected))
          const text = document.createElement('span'); text.textContent = option.textContent
          const check = document.createElement('span'); check.className = 'dp-select-check'; check.textContent = option.selected ? '✓' : ''
          item.append(text, check); const row = visible.length
          item.addEventListener('pointermove', () => highlight(row, false))
          item.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); choose(row) })
          list.append(item); visible.push({ option, element: item })
        }
        if (!visible.length) { const empty = document.createElement('div'); empty.className = 'dp-select-empty'; empty.textContent = '没有匹配的节点'; list.append(empty) }
        highlight(Math.max(0, visible.findIndex((item) => item.option.selected)), false)
        position()
      }
      search.addEventListener('input', draw)
      const keydown = (event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) }
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          highlight(event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : active + (event.key === 'ArrowDown' ? 1 : -1))
        } else if (event.key === 'Enter') { event.preventDefault(); choose(active) }
        else if (event.key === 'Tab') close()
      }
      const outside = (event) => { if (!element.contains(event.target) && !wrapper.contains(event.target)) close() }
      const reposition = () => position()
      document.addEventListener('pointerdown', outside, true)
      element.addEventListener('keydown', keydown); trigger.addEventListener('keydown', keydown)
      window.addEventListener('resize', reposition)
      root.querySelector('.dp').addEventListener('scroll', reposition)
      cleanupPopup = () => {
        document.removeEventListener('pointerdown', outside, true); trigger.removeEventListener('keydown', keydown)
        window.removeEventListener('resize', reposition); root.querySelector('.dp')?.removeEventListener('scroll', reposition)
        trigger.removeAttribute('aria-activedescendant')
      }
      draw(); (searchable ? search : list).focus()
      visible[active]?.element.scrollIntoView({ block: 'nearest' })
    }
    const onClick = (event) => { event.preventDefault(); event.stopPropagation(); open() }
    const onKey = (event) => {
      if (trigger.getAttribute('aria-expanded') === 'false' && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); open() }
    }
    trigger.addEventListener('click', onClick); trigger.addEventListener('keydown', onKey)
    cleanups.push(() => { trigger.removeEventListener('click', onClick); trigger.removeEventListener('keydown', onKey) })
  }
  return () => { close(); for (const dispose of cleanups) dispose() }
}




function mountPanel(root, call, back = () => {}) {
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

const schema={parse(value){if(typeof value!=='string')throw new Error('Expected JSON string');return value}};
const codec={mode:'strict',typeSymbol:'dsh-tun-proxy#JSON',schema,create:()=>schema};
const descriptor={id:'dsh-tun-proxy#tunProxy/invoke',service:'tunProxy',namespace:'tunProxy',method:'invoke',invocation:{kind:'direct'},parameters:[{name:'payload',wire:'payload',source:'json',codec}],result:codec};
function Page(props){const ref=React.useRef(null);React.useEffect(()=>mountPanel(ref.current,props.call,props.back),[props.call,props.back]);return React.createElement('div',{ref,style:{height:'100%',minHeight:0,flex:1}})}
return {inject:['slots','remote','layout'],apply(ctx){
const mount=ctx.remote.$mount({package:'dsh-tun-proxy',descriptors:[descriptor]});
const call=async(action,data={})=>{await mount;const response=await ctx.get('remote.tunProxy').invoke(JSON.stringify({...data,action}));if(!response.ok)throw new Error(response.error?.message||'DSH connection failed');const result=JSON.parse(response.value);if(!result.ok)throw new Error(result.error);return result.result};
const back=()=>ctx.get('layout')?.selectPanel(null);
ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'dsh-proxy-center',order:3,label:()=> '代理中心'},()=>React.createElement('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.5,'aria-hidden':true},React.createElement('circle',{cx:12,cy:12,r:9}),React.createElement('path',{d:'M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18'}))));
ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'dsh-proxy-center',inject:()=>({call,back})},Page));
}};
}});
