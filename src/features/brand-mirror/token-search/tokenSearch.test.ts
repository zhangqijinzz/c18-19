import { describe, expect, it } from 'vitest'
import { INITIAL_TOKENS } from '../models/brandMirrorModels'
import {
  buildTokenEntries,
  colorDistance,
  colorSimilarity,
  diagnoseEmptySearch,
  findTextRanges,
  isRecentlyModified,
  parseSearchQuery,
  searchTokens,
} from '../token-search/tokenSearch'

const entries = buildTokenEntries(INITIAL_TOKENS)
const NOW = 1_000_000

function context(overrides: Parameters<typeof searchTokens>[0] extends infer T ? Partial<T> : never = {}) {
  return {
    entries,
    category: 'all' as const,
    parsed: parseSearchQuery(''),
    now: NOW,
    updatedAt: new Map<string, number>(),
    ...overrides,
  }
}

describe('parseSearchQuery', () => {
  it('keeps plain text queries', () => {
    const parsed = parseSearchQuery('主色')
    expect(parsed.text).toBe('主色')
    expect(parsed.range).toBeNull()
    expect(parsed.color).toBeNull()
    expect(parsed.recent).toBe(false)
  })

  it('parses closed numeric ranges', () => {
    const parsed = parseSearchQuery('10-20')
    expect(parsed.range).toEqual({ kind: 'range', min: 10, max: 20, description: '10–20' })
  })

  it('parses open-ended ranges with comparison operators and Chinese separators', () => {
    expect(parseSearchQuery('>=16').range).toMatchObject({ min: 16, max: null })
    expect(parseSearchQuery('<=8').range).toMatchObject({ min: null, max: 8 })
    expect(parseSearchQuery('12 至 28').range).toEqual({ kind: 'range', min: 12, max: 28, description: '12–28' })
    expect(parseSearchQuery('20px').range).toBeNull()
    expect(parseSearchQuery('20px').text).toBe('20px')
  })

  it('parses hex colors including shorthand', () => {
    expect(parseSearchQuery('#F15A47').color?.hex).toBe('#F15A47')
    expect(parseSearchQuery('#f47').color?.hex).toBe('#FF4477')
    expect(parseSearchQuery('#xyz').color).toBeNull()
  })

  it('detects recent-edit keywords without eating the rest of the query', () => {
    const parsed = parseSearchQuery('最近改过的 10-20')
    expect(parsed.recent).toBe(true)
    expect(parsed.range).toMatchObject({ min: 10, max: 20 })
  })
})

describe('searchTokens', () => {
  it('matches text and reports highlighted ranges', () => {
    const results = searchTokens(context({ parsed: parseSearchQuery('primary') }))
    expect(results).toHaveLength(1)
    expect(results[0].entry.key).toBe('color.primary')
    expect(results[0].highlights).toContainEqual({ field: 'key', ranges: [{ start: 6, end: 13 }] })
  })

  it('matches numeric ranges only on numeric tokens', () => {
    const results = searchTokens(context({ parsed: parseSearchQuery('10-20') }))
    const values = results.map((match) => match.entry.numericValue)
    expect(results.every((match) => match.entry.category !== 'color')).toBe(true)
    expect(values.every((value) => value !== null && value >= 10 && value <= 20)).toBe(true)
  })

  it('respects the active category filter', () => {
    const spacingResults = searchTokens(context({ category: 'spacing', parsed: parseSearchQuery('8') }))
    expect(spacingResults.every((match) => match.entry.category === 'spacing')).toBe(true)
  })

  it('ranks colors by proximity and attaches similarity', () => {
    const results = searchTokens(context({ parsed: parseSearchQuery('#F15A48') }))
    expect(results[0].entry.value).toBe('#F15A47')
    expect(results[0].similarity).toBeGreaterThan(95)
    expect(results[0].highlights).toContainEqual({ field: 'value', ranges: [{ start: 0, end: 7 }] })
  })

  it('treats far away colors as non-matches', () => {
    const results = searchTokens(context({ parsed: parseSearchQuery('#00FF00') }))
    expect(results).toHaveLength(0)
  })

  it('filters to recently modified tokens only', () => {
    const updatedAt = new Map([['spacing.1', NOW - 30_000], ['spacing.2', NOW - 10 * 60_000]])
    const results = searchTokens(context({ parsed: parseSearchQuery('最近'), updatedAt }))
    expect(results.map((match) => match.entry.key)).toEqual(['spacing.1'])
  })

  it('combines recent with text queries', () => {
    const updatedAt = new Map([['spacing.1', NOW - 1000]])
    const hit = searchTokens(context({ parsed: parseSearchQuery('最近 间距'), updatedAt }))
    expect(hit.map((match) => match.entry.key)).toEqual(['spacing.1'])
    const miss = searchTokens(context({ parsed: parseSearchQuery('最近 圆角'), updatedAt }))
    expect(miss).toHaveLength(0)
  })
})

describe('diagnoseEmptySearch', () => {
  it('hints that the category filter may be blocking results', () => {
    // 16 只在字体/间距尺度里，选中「颜色」类别时应当提示类别挡住
    const diagnosis = diagnoseEmptySearch(context({ category: 'color', parsed: parseSearchQuery('16') }))
    expect(diagnosis.blockedByCategory).toBe(true)
    expect(diagnosis.hints.join(' ')).toContain('颜色')
  })

  it('reports the covered numeric range when the query is out of bounds', () => {
    const diagnosis = diagnoseEmptySearch(context({ parsed: parseSearchQuery('100-200') }))
    expect(diagnosis.hints.join(' ')).toContain('超出了范围')
  })

  it('does not claim out-of-range when the range is valid but hidden behind a category', () => {
    // 16 是合法区间，但「颜色」类别下没有数值令牌
    const diagnosis = diagnoseEmptySearch(context({ category: 'color', parsed: parseSearchQuery('10-20') }))
    expect(diagnosis.blockedByCategory).toBe(true)
    expect(diagnosis.hints.join(' ')).not.toContain('超出了范围')
  })

  it('suggests the nearest color token', () => {
    const diagnosis = diagnoseEmptySearch(context({ category: 'color', parsed: parseSearchQuery('#FAFAFA') }))
    expect(diagnosis.nearest).not.toBeNull()
    expect(diagnosis.hints.join(' ')).toContain('最接近的是')
  })

  it('explains itself when nothing was recently changed', () => {
    const diagnosis = diagnoseEmptySearch(context({ parsed: parseSearchQuery('最近') }))
    expect(diagnosis.hints.join(' ')).toContain('最近 5 分钟')
  })
})

describe('helpers', () => {
  it('finds all text range occurrences case-insensitively', () => {
    expect(findTextRanges('color.primary', 'PRIMARY')).toEqual([{ start: 6, end: 13 }])
    expect(findTextRanges('aaa', 'a')).toEqual([{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }])
  })

  it('bounds the recent-edit window to five minutes', () => {
    expect(isRecentlyModified(NOW - 4 * 60_000, NOW)).toBe(true)
    expect(isRecentlyModified(NOW - 6 * 60_000, NOW)).toBe(false)
    expect(isRecentlyModified(null, NOW)).toBe(false)
  })

  it('computes a high similarity for near-identical colors and low for distant ones', () => {
    expect(colorSimilarity('#F15A47', { r: 0xf1, g: 0x5a, b: 0x48 })).toBeGreaterThan(95)
    expect(colorDistance('#FFFFFF', { r: 0, g: 0, b: 0 })).toBeGreaterThan(700)
  })
})
