// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { INITIAL_TOKENS } from '../models/brandMirrorModels'
import type { BrandTokens } from '../models/brandMirrorModels'
import { TokenExplorer } from './TokenExplorer'

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

function render(tokens: BrandTokens = INITIAL_TOKENS, status: 'ready' | 'editing' = 'ready') {
  act(() => {
    root.render(<TokenExplorer tokens={tokens} status={status} />)
  })
}

function searchInput(): HTMLInputElement {
  return container.querySelector('input[aria-label="搜索令牌"]') as HTMLInputElement
}

function typeQuery(value: string) {
  const input = searchInput()
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function chip(label: string): HTMLButtonElement {
  return [...container.querySelectorAll('.filter-chips button')].find((button) => button.textContent?.includes(label)) as HTMLButtonElement
}

function resultLabels(): string[] {
  return [...container.querySelectorAll('.token-result strong')].map((node) => node.textContent ?? '')
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('TokenExplorer', () => {
  it('renders every token initially', () => {
    render()
    expect(container.querySelectorAll('.token-result')).toHaveLength(17)
  })

  it('filters by numeric range and marks the matched value', () => {
    render()
    typeQuery('>=20')
    const values = [...container.querySelectorAll('.token-result code')].map((node) => node.textContent)
    expect(values.length).toBeGreaterThan(0)
    expect(values.every((value) => Number((value ?? '').replace('px', '')) >= 20)).toBe(true)
    expect(container.querySelector('.search-mode-tag')?.textContent).toContain('≥20')
    expect(container.querySelectorAll('.token-result mark').length).toBeGreaterThan(0)
  })

  it('finds colors by proximity and shows a similarity badge', () => {
    render()
    typeQuery('#F15A48')
    const results = container.querySelectorAll('.token-result')
    expect(results).toHaveLength(1)
    expect(resultLabels()[0]).toContain('主色')
    expect(container.querySelector('.similarity-badge')?.textContent).toContain('% 相似')
  })

  it('diagnoses an empty result caused by the category filter and offers a quick fix', () => {
    render()
    act(() => chip('颜色').click())
    typeQuery('16')
    const empty = container.querySelector('.token-no-result.detailed')
    expect(empty).not.toBeNull()
    expect(empty?.textContent).toContain('类别')
    const allCategories = [...container.querySelectorAll('.no-result-actions button')].find((button) => button.textContent?.includes('全部类别'))
    expect(allCategories).toBeDefined()
    act(() => (allCategories as HTMLButtonElement | undefined)?.click())
    expect(container.querySelectorAll('.token-result').length).toBeGreaterThan(0)
  })

  it('explains that an out-of-range query exceeds the available scale', () => {
    render()
    typeQuery('100-200')
    expect(container.querySelector('.token-no-result.detailed')?.textContent).toContain('超出了范围')
  })

  it('clears the query and resets category and recent filters via the clear button', () => {
    render()
    act(() => chip('圆角').click())
    typeQuery('最近')
    expect(container.querySelectorAll('.token-result')).toHaveLength(0)
    const clear = container.querySelector('button[aria-label="清空搜索"]') as HTMLButtonElement
    act(() => clear.click())
    expect(searchInput().value).toBe('')
    expect(chip('全部').classList.contains('active')).toBe(true)
    expect(chip('最近改过').classList.contains('active')).toBe(false)
    expect(container.querySelectorAll('.token-result')).toHaveLength(17)
  })

  it('lists tokens edited while editing, ordered with the newest first', () => {
    render(INITIAL_TOKENS, 'ready')
    const edited: BrandTokens = { ...INITIAL_TOKENS, primary: '#123456', spacingScale: [9, 8, 12, 20, 32] }
    render(edited, 'editing')
    act(() => chip('最近改过').click())
    const labels = resultLabels()
    expect(labels).toContain('主色')
    expect(labels).toContain('间距 1')
    expect(labels).not.toContain('圆角 1')
    expect(container.querySelector('.recent-badge')?.textContent).toContain('刚刚')
  })

  it('does not mark restored documents as recently changed', () => {
    render({ ...INITIAL_TOKENS, primary: '#ABCDEF' }, 'ready')
    act(() => chip('最近改过').click())
    expect(container.querySelectorAll('.token-result')).toHaveLength(0)
    expect(container.querySelector('.token-no-result.detailed')?.textContent).toContain('5 分钟')
  })
})
