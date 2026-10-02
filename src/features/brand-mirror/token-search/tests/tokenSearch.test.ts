import { describe, expect, it } from 'vitest'
import { buildEmptyHints, buildTokenEntries, colorCloseness, formatRelativeTime, highlightSegments, parseSearch, searchTokens } from '../tokenSearch'
import { INITIAL_TOKENS } from '../../models/brandMirrorModels'

const entries = buildTokenEntries(INITIAL_TOKENS)

describe('parseSearch', () => {
  it('parses numeric ranges, comparators and open-ended values', () => {
    expect(parseSearch('10-20').ranges).toEqual([{ min: 10, max: 20 }])
    expect(parseSearch('>=12').ranges).toEqual([{ min: 12, max: null }])
    expect(parseSearch('<40').ranges).toEqual([{ min: null, max: 40 }])
    expect(parseSearch('12+').ranges).toEqual([{ min: 12, max: null }])
  })

  it('merges overlapping comparator constraints', () => {
    expect(parseSearch('>=10 <=20').ranges).toEqual([{ min: 10, max: 20 }])
  })

  it('recognizes hex colors with or without the hash', () => {
    expect(parseSearch('#f15a47').colors).toEqual(['#F15A47'])
    expect(parseSearch('F15A47').colors).toEqual(['#F15A47'])
  })

  it('recognizes the recent keyword in Chinese and English', () => {
    expect(parseSearch('最近').recent).toBe(true)
    expect(parseSearch('recent').recent).toBe(true)
  })

  it('keeps remaining tokens as required text terms', () => {
    const parsed = parseSearch('主色 10-20')
    expect(parsed.terms).toEqual(['主色'])
    expect(parsed.ranges).toHaveLength(1)
  })
})

describe('searchTokens numeric ranges', () => {
  it('returns only numeric tokens inside the interval', () => {
    const matches = searchTokens(entries, parseSearch('10-20'), 'all', {})
    expect(matches.map((entry) => entry.key)).toContain('radius.2')
    expect(matches.every((entry) => entry.numeric !== null && entry.numeric >= 10 && entry.numeric <= 20)).toBe(true)
    expect(matches.some((entry) => entry.category === 'color')).toBe(false)
  })

  it('marks structured value hits for highlighting', () => {
    const matches = searchTokens(entries, parseSearch('>=30'), 'all', {})
    expect(matches.every((entry) => entry.valueHit)).toBe(true)
  })
})

describe('searchTokens color proximity', () => {
  it('matches near colors sorted by distance with closeness', () => {
    const matches = searchTokens(entries, parseSearch('#F15A47'), 'all', {})
    expect(matches.map((entry) => entry.key)[0]).toBe('color.primary')
    expect(matches[0].colorCloseness).toBe(1)
    expect(matches.some((entry) => entry.key === 'color.secondary')).toBe(false)
  })

  it('reports closeness as a fraction consistent with the distance', () => {
    const matches = searchTokens(entries, parseSearch('#F15A46'), 'all', {})
    expect(matches).toHaveLength(1)
    expect(matches[0].colorCloseness).toBeGreaterThan(0.99)
    expect(colorCloseness(0)).toBe(1)
  })
})

describe('searchTokens text with highlight', () => {
  it('highlights the matched portion case-insensitively', () => {
    const matches = searchTokens(entries, parseSearch('primary'), 'all', {})
    expect(matches).toHaveLength(1)
    expect(matches[0].segments.key.some((segment) => segment.hit && segment.text === 'primary')).toBe(true)
  })

  it('requires all whitespace-separated terms', () => {
    expect(searchTokens(entries, parseSearch('color primary'), 'all', {})).toHaveLength(1)
    expect(searchTokens(entries, parseSearch('primary nope'), 'all', {})).toHaveLength(0)
  })

  it('highlights bare numeric terms inside the token value', () => {
    const matches = searchTokens(entries, parseSearch('12'), 'spacing', {})
    expect(matches.some((entry) => entry.segments.value.some((segment) => segment.hit && segment.text === '12'))).toBe(true)
  })

  it('merges overlapping highlight ranges', () => {
    const segments = highlightSegments('primary primary', ['primary'])
    expect(segments.filter((segment) => segment.hit)).toHaveLength(2)
    expect(segmentsToText(segments)).toBe('primary primary')
  })
})

describe('searchTokens recently changed', () => {
  it('returns only changed tokens, newest first', () => {
    const updatedAt = {
      'color.primary': '2026-10-02T10:00:00.000Z',
      'type.1': '2026-10-02T12:00:00.000Z',
    }
    const matches = searchTokens(entries, parseSearch('最近'), 'all', updatedAt)
    expect(matches.map((entry) => entry.key)).toEqual(['type.1', 'color.primary'])
    expect(matches[0].updatedAt).toBe(updatedAt['type.1'])
  })

  it('respects the active category when showing recent tokens', () => {
    const updatedAt = { 'color.primary': '2026-10-02T10:00:00.000Z', 'type.1': '2026-10-02T12:00:00.000Z' }
    const matches = searchTokens(entries, parseSearch('最近'), 'type', updatedAt)
    expect(matches.map((entry) => entry.key)).toEqual(['type.1'])
  })
})

describe('buildEmptyHints', () => {
  it('suggests clearing the category when matches exist elsewhere', () => {
    const hints = buildEmptyHints(parseSearch('primary'), 'type', entries, {})
    expect(hints[0].tone).toBe('category')
    expect(hints[0].detail).toContain('颜色')
    expect(hints[0].action).toBe('clear-category')
  })

  it('explains out-of-range numeric searches with the available span', () => {
    const hints = buildEmptyHints(parseSearch('100-200'), 'all', entries, {})
    expect(hints[0].tone).toBe('range')
    expect(hints[0].detail).toContain('4–40')
  })

  it('points out that ranges only apply to numeric categories', () => {
    const hints = buildEmptyHints(parseSearch('10-20'), 'color', entries, {})
    expect(hints.some((hint) => hint.tone === 'category')).toBe(true)
    expect(hints.some((hint) => hint.detail.includes('只对圆角 / 间距 / 字体生效'))).toBe(true)
  })

  it('reports the closest color when nothing is close enough', () => {
    const hints = buildEmptyHints(parseSearch('#999999'), 'all', entries, {})
    expect(hints[0].tone).toBe('color')
    expect(hints[0].detail).toMatch(/相似/)
  })

  it('guides first-time recent searches without edit history', () => {
    const hints = buildEmptyHints(parseSearch('最近'), 'all', entries, {})
    expect(hints[0].tone).toBe('recent')
    expect(hints[0].detail).toContain('调整任意')
  })
})

describe('formatRelativeTime', () => {
  const now = new Date('2026-10-02T12:00:00.000Z')
  it('formats recent edits in friendly Chinese units', () => {
    expect(formatRelativeTime('2026-10-02T11:59:55.000Z', now)).toBe('刚刚')
    expect(formatRelativeTime('2026-10-02T11:58:00.000Z', now)).toBe('2 分钟前')
    expect(formatRelativeTime('2026-10-02T10:00:00.000Z', now)).toBe('2 小时前')
  })
})

function segmentsToText(segments: { text: string }[]): string {
  return segments.map((segment) => segment.text).join('')
}
