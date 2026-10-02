import type { BrandTokens } from '../models/brandMirrorModels'

export type TokenCategory = 'all' | 'color' | 'radius' | 'spacing' | 'type'
export type TokenKind = Exclude<TokenCategory, 'all'>

export interface TokenEntry {
  key: string
  label: string
  category: TokenKind
  /** 展示用的值，如 "#F15A47" / "12px" */
  value: string
  /** 数值类令牌的数值，颜色类为 null */
  numeric: number | null
  /** 颜色类令牌的 RGB，非颜色为 null */
  rgb: [number, number, number] | null
}

export interface NumberRange {
  min: number | null
  max: number | null
}

export interface ParsedSearch {
  text: string
  terms: string[]
  ranges: NumberRange[]
  /** 归一化后的 6 位 HEX */
  colors: string[]
  recent: boolean
  /** 是否存在能被识别的结构化筛选 */
  hasFilters: boolean
}

export interface HighlightSegment {
  text: string
  hit: boolean
}

export interface TokenMatch extends TokenEntry {
  segments: { label: HighlightSegment[]; key: HighlightSegment[]; value: HighlightSegment[] }
  valueHit: boolean
  colorCloseness: number | null
  colorDistance: number | null
  updatedAt: string | null
}

export interface EmptyHint {
  tone: 'category' | 'range' | 'color' | 'recent' | 'generic'
  title: string
  detail: string
  action: 'clear-category' | 'clear-search' | null
  actionLabel: string | null
}

const RECENT_TOKENS = ['最近', '最近改过', 'recent', 'recently']
const COLOR_DISTANCE_MAX = 255 * Math.sqrt(3)
/** 颜色接近的判定阈值：欧氏距离不超过最大值的 45%（相似度 ≥ 55%） */
export const COLOR_DISTANCE_THRESHOLD = COLOR_DISTANCE_MAX * 0.45

export function buildTokenEntries(tokens: BrandTokens): TokenEntry[] {
  const entries: TokenEntry[] = [
    makeColor('color.primary', '主色', tokens.primary),
    makeColor('color.secondary', '辅助色', tokens.secondary),
    ...tokens.radiusScale.map((value, index) => makeNumber(`radius.${index + 1}`, `圆角 ${index + 1}`, 'radius', value)),
    ...tokens.spacingScale.map((value, index) => makeNumber(`spacing.${index + 1}`, `间距 ${index + 1}`, 'spacing', value)),
    ...tokens.typeScale.map((value, index) => makeNumber(`type.${index + 1}`, `字体 ${index + 1}`, 'type', value)),
  ]
  return entries
}

function makeColor(key: string, label: string, hex: string): TokenEntry {
  return { key, label, category: 'color', value: hex.toUpperCase(), numeric: null, rgb: hexToRgb(hex) }
}

function makeNumber(key: string, label: string, category: TokenKind, numeric: number): TokenEntry {
  return { key, label, category, value: `${numeric}px`, numeric, rgb: null }
}

/**
 * 将搜索框内容解析为结构化筛选条件：
 * - 数值区间：`10-20`、`10~20`、`>=10`、`>10`、`<=20`、`<20`、`10+`
 * - 颜色：`#F15A47`、`f15a47`
 * - 最近改过：`最近` / `recent`
 * - 其余按空格切分，作为需要同时出现的文本片段
 */
export function parseSearch(raw: string): ParsedSearch {
  const text = raw.trim()
  const terms: string[] = []
  const ranges: NumberRange[] = []
  const colors: string[] = []
  let recent = false

  text.split(/\s+/).filter(Boolean).forEach((token) => {
    const normalized = token.toLowerCase()
    if (RECENT_TOKENS.includes(normalized)) {
      recent = true
      return
    }
    const color = matchColorToken(token)
    if (color) {
      colors.push(color)
      return
    }
    const range = matchRangeToken(token)
    if (range) {
      ranges.push(range)
      return
    }
    terms.push(normalized)
  })

  return {
    text,
    terms,
    ranges: mergeRanges(ranges),
    colors,
    recent,
    hasFilters: ranges.length > 0 || colors.length > 0 || recent,
  }
}

function matchColorToken(token: string): string | null {
  const withHash = /^#?([0-9a-fA-F]{6})$/.exec(token.trim())
  if (withHash) return expandHex(withHash[1].toUpperCase())
  const short = /^#([0-9a-fA-F]{3})$/.exec(token.trim())
  if (short) return expandHex(short[1].split('').map((char) => char + char).join('').toUpperCase())
  return null
}

function expandHex(digits: string): string {
  return `#${digits}`
}

function matchRangeToken(token: string): NumberRange | null {
  const comparator = /^(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)$/.exec(token)
  if (comparator) {
    const value = Number(comparator[2])
    if (comparator[1] === '>=') return { min: value, max: null }
    if (comparator[1] === '<=') return { min: null, max: value }
    if (comparator[1] === '>') return { min: value, max: null }
    return { min: null, max: value }
  }
  const between = /^(-?\d+(?:\.\d+)?)\s*[-~～]\s*(-?\d+(?:\.\d+)?)$/.exec(token)
  if (between) {
    const left = Number(between[1])
    const right = Number(between[2])
    return { min: Math.min(left, right), max: Math.max(left, right) }
  }
  const openEnded = /^(-?\d+(?:\.\d+)?)\+$/.exec(token)
  if (openEnded) return { min: Number(openEnded[1]), max: null }
  return null
}

function mergeRanges(ranges: NumberRange[]): NumberRange[] {
  if (ranges.length <= 1) return ranges
  const mins = ranges.map((range) => range.min).filter((value): value is number => value !== null)
  const maxes = ranges.map((range) => range.max).filter((value): value is number => value !== null)
  return [{ min: mins.length > 0 ? Math.max(...mins) : null, max: maxes.length > 0 ? Math.min(...maxes) : null }]
}

export function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '')
  const digits = normalized.length === 3 ? normalized.split('').map((char) => char + char).join('') : normalized
  return [
    Number.parseInt(digits.slice(0, 2), 16),
    Number.parseInt(digits.slice(2, 4), 16),
    Number.parseInt(digits.slice(4, 6), 16),
  ]
}

export function colorDistance(first: [number, number, number], second: [number, number, number]): number {
  return Math.sqrt((first[0] - second[0]) ** 2 + (first[1] - second[1]) ** 2 + (first[2] - second[2]) ** 2)
}

export function colorCloseness(distance: number): number {
  return Math.max(0, Math.min(1, 1 - distance / COLOR_DISTANCE_MAX))
}

/**
 * 按解析后的条件过滤令牌。数值区间只作用于数值类令牌，颜色只作用于颜色类令牌，
 * 文本片段需要同时命中，最近改过只返回有修改时间的令牌。
 */
export function searchTokens(entries: TokenEntry[], parsed: ParsedSearch, category: TokenCategory, updatedAt: Record<string, string>): TokenMatch[] {
  const nearestByKey = new Map<string, { distance: number; closeness: number }>()
  parsed.colors.forEach((color) => {
    const target = hexToRgb(color)
    entries.filter((entry) => entry.category === 'color' && entry.rgb).forEach((entry) => {
      const distance = colorDistance(entry.rgb as [number, number, number], target)
      const current = nearestByKey.get(entry.key)
      if (!current || distance < current.distance) {
        nearestByKey.set(entry.key, { distance, closeness: colorCloseness(distance) })
      }
    })
  })

  const matches = entries.map((entry) => {
    const inCategory = category === 'all' || entry.category === category
    if (!inCategory) return null

    const haystack = `${entry.key} ${entry.label} ${entry.value}`.toLowerCase()
    const textHit = parsed.terms.every((term) => haystack.includes(term))
    if (!textHit) return null

    const nearest = parsed.colors.length > 0 ? nearestByKey.get(entry.key) ?? null : null
    if (parsed.colors.length > 0) {
      if (entry.category !== 'color' || !nearest || nearest.distance > COLOR_DISTANCE_THRESHOLD) return null
    }

    if (parsed.ranges.length > 0) {
      if (entry.numeric === null) return null
      const inside = parsed.ranges.every((range) =>
        (range.min === null || (entry.numeric as number) >= range.min)
        && (range.max === null || (entry.numeric as number) <= range.max))
      if (!inside) return null
    }

    const stamp = updatedAt[entry.key] ?? null
    if (parsed.recent && !stamp) return null

    return buildMatch(entry, parsed, nearest, stamp)
  }).filter((match): match is TokenMatch => match !== null)

  matches.sort((first, second) => {
    if (parsed.colors.length > 0 && first.colorDistance !== null && second.colorDistance !== null) {
      return first.colorDistance - second.colorDistance
    }
    if (parsed.recent) {
      return String(second.updatedAt).localeCompare(String(first.updatedAt))
    }
    return 0
  })
  return matches
}

function buildMatch(entry: TokenEntry, parsed: ParsedSearch, nearest: { distance: number; closeness: number } | null, stamp: string | null): TokenMatch {
  return {
    ...entry,
    segments: {
      label: highlightSegments(entry.label, parsed.terms),
      key: highlightSegments(entry.key, parsed.terms),
      value: highlightSegments(entry.value, parsed.terms),
    },
    valueHit: parsed.ranges.length > 0 || parsed.colors.length > 0 || parsed.recent,
    colorCloseness: nearest ? nearest.closeness : null,
    colorDistance: nearest ? nearest.distance : null,
    updatedAt: stamp,
  }
}

/** 大小写不敏感地在一段文本里标出所有命中片段，自动合并重叠区间。 */
export function highlightSegments(text: string, terms: string[]): HighlightSegment[] {
  const haystack = text.toLowerCase()
  const ranges: Array<[number, number]> = []
  terms.forEach((term) => {
    if (!term) return
    let start = haystack.indexOf(term)
    while (start !== -1) {
      ranges.push([start, start + term.length])
      start = haystack.indexOf(term, start + term.length)
    }
  })
  if (ranges.length === 0) return [{ text, hit: false }]
  ranges.sort((first, second) => first[0] - second[0] || first[1] - second[1])
  const merged: Array<[number, number]> = []
  ranges.forEach((range) => {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1])
    } else {
      merged.push([...range] as [number, number])
    }
  })

  const segments: HighlightSegment[] = []
  let cursor = 0
  merged.forEach(([start, end]) => {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), hit: false })
    segments.push({ text: text.slice(start, end), hit: true })
    cursor = end
  })
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false })
  return segments
}

export function formatRange(range: NumberRange): string {
  if (range.min !== null && range.max !== null) return `${range.min}–${range.max}px`
  if (range.min !== null) return `≥ ${range.min}px`
  return `≤ ${range.max}px`
}

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const thenTime = new Date(iso).getTime()
  if (!Number.isFinite(thenTime)) return ''
  const seconds = Math.max(0, Math.round((now.getTime() - thenTime) / 1000))
  if (seconds < 10) return '刚刚'
  if (seconds < 60) return `${seconds} 秒前`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(iso).toLocaleDateString('zh-CN')
}

/**
 * 空结果诊断：按当前类别之外是否有命中、数值区间、颜色、最近改过等情况，
 * 给出可操作的提示，而不是一句笼统的“没有匹配”。
 */
export function buildEmptyHints(
  parsed: ParsedSearch,
  category: TokenCategory,
  allEntries: TokenEntry[],
  updatedAt: Record<string, string>,
): EmptyHint[] {
  const hints: EmptyHint[] = []

  if (category !== 'all') {
    const unrestricted = searchTokens(allEntries, parsed, 'all', updatedAt)
    if (unrestricted.length > 0) {
      const categories = new Set(unrestricted.map((entry) => entry.category))
      hints.push({
        tone: 'category',
        title: '可能被当前类别筛掉了',
        detail: `去掉「${categoryLabel(category)}」筛选后，还有 ${unrestricted.length} 个命中（${[...categories].map(categoryLabel).join('、')}）`,
        action: 'clear-category',
        actionLabel: '查看全部类别',
      })
    }
  }

  const range = parsed.ranges[0]
  if (range && (range.min !== null || range.max !== null)) {
    const numericEntries = allEntries.filter((entry) => entry.numeric !== null && (category === 'all' || entry.category === category))
    const span = numericSpan(numericEntries)
    const detail = span === null
      ? `当前类别下没有可比较的数值令牌，数值区间 ${formatRange(range)} 只对圆角 / 间距 / 字体生效`
      : `当前类别数值范围是 ${span.min}–${span.max}px，没有令牌落在 ${formatRange(range)} 内`
    hints.push({ tone: 'range', title: '数值可能超出范围', detail, action: hints.length === 0 ? 'clear-search' : null, actionLabel: hints.length === 0 ? '清空区间' : null })
  }

  if (parsed.colors.length > 0) {
    const colorEntries = allEntries.filter((entry) => entry.category === 'color')
    const best = nearestColor(colorEntries, parsed.colors[0])
    if (best) {
      const percent = Math.round(best.closeness * 100)
      const sameCategory = category === 'all' || category === 'color'
      const detail = best.closeness >= 0.55
        ? `最接近的「${best.entry.label}」也只有 ${percent}% 相似，当前阈值要求 ≥ 55%`
        : `最接近的颜色是 ${best.entry.value}（${percent}% 相似），差距较大`
      hints.push({ tone: 'color', title: '颜色可能不够接近', detail: sameCategory ? detail : `${detail}，且它属于颜色类别`, action: hints.length === 0 ? 'clear-search' : null, actionLabel: hints.length === 0 ? '换个颜色' : null })
    }
  }

  if (parsed.recent) {
    const recentCount = Object.keys(updatedAt).filter((key) => category === 'all' || key.startsWith(`${category}.`)).length
    hints.push({
      tone: 'recent',
      title: recentCount === 0 ? '还没有改动记录' : '该类别下没有最近改过的令牌',
      detail: recentCount === 0 ? '调整任意颜色或尺度后，它会自动出现在这里' : `其他类别共有 ${Object.keys(updatedAt).length} 个改过的令牌`,
      action: hints.length === 0 ? 'clear-search' : null,
      actionLabel: hints.length === 0 ? '退出最近改动' : null,
    })
  }

  if (parsed.terms.length > 0 && hints.length === 0) {
    hints.push({
      tone: 'generic',
      title: '没有找到匹配的文字',
      detail: `没有令牌的名称或值包含 “${parsed.terms.join(' ')}”，可以试试更短的关键词，或用 #颜色、数值区间、最近 来找`,
      action: 'clear-search',
      actionLabel: '清空搜索',
    })
  }

  if (hints.length === 0) {
    hints.push({ tone: 'generic', title: '没有匹配的令牌', detail: '换个关键词试试，或清空筛选条件浏览全部令牌', action: 'clear-search', actionLabel: '清空搜索' })
  }

  return hints
}

function numericSpan(entries: TokenEntry[]): { min: number; max: number } | null {
  const values = entries.map((entry) => entry.numeric).filter((value): value is number => value !== null)
  if (values.length === 0) return null
  return { min: Math.min(...values), max: Math.max(...values) }
}

function nearestColor(entries: TokenEntry[], hex: string): { entry: TokenEntry; closeness: number } | null {
  const target = hexToRgb(hex)
  let best: { entry: TokenEntry; closeness: number } | null = null
  entries.forEach((entry) => {
    if (!entry.rgb) return
    const closeness = colorCloseness(colorDistance(entry.rgb, target))
    if (!best || closeness > best.closeness) best = { entry, closeness }
  })
  return best
}

export function categoryLabel(category: TokenKind): string {
  switch (category) {
    case 'color': return '颜色'
    case 'radius': return '圆角'
    case 'spacing': return '间距'
    case 'type': return '字体'
  }
}
