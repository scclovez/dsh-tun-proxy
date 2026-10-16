// A DOM listbox avoids the operating system's unthemeable <option> popup.
export function enhanceSelects(root) {
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
