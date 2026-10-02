import type { BrandTokens, MirrorStatus } from '../models/brandMirrorModels'

export type TokenCategory = 'all' | 'color' | 'radius' | 'spacing' | 'type'
export type EntryCategory = Exclude<TokenCategory, 'all'>

export interface TokenEntry {
  key: string
  label: string
  category: EntryCategory
  value: string
  numericValue: number | null
  colorValue: string | null
}

export interface RangeFilter {
  kind: 'range'
  min: number | null
  max: number | null
  /** 命中时用于标注的数值区间说明，如 10–20 / ≥16 */
  description: string
}

export interface ColorFilter {
  kind: 'color'
  hex: string
  rgb: { r: number; g: number; b: number }
}

export interface ParsedQuery {
  text: string
  recent: boolean
  range: RangeFilter | null
  color: ColorFilter | null
}

export interface TextRange {
  start: number
  end: number
}

export interface MatchedEntry {
  entry: TokenEntry
  /** 需要在结果中标注的字段与区间 */
  highlights: { field: 'label' | 'key' | 'value'; ranges: TextRange[] }[]
  /** 颜色接近度 0–100，仅颜色类命中时存在 */
  similarity: number | null
}

export interface SearchDiagnosis {
  title: string
  hints: string[]
  /** 在其它类别里其实有命中（说明可能是类别筛选挡掉了） */
  blockedByCategory: boolean
  /** 颜色搜索时离查询颜色最近的令牌 */
  nearest: { entry: TokenEntry; similarity: number } | null
}

export const CATEGORY_LABELS: Record<TokenCategory, string> = {
  all: '全部',
  color: '颜色',
  radius: '圆角',
  spacing: '间距',
  type: '字体',
}

const RECENT_WINDOW_MS = 5 * 60 * 1000
/** RedMean 距离的最大可能值，用于换算接近度百分比 */
const MAX_COLOR_DISTANCE = 764.8
/** 距离小于该值视为“颜色接近” */
const COLOR_MATCH_DISTANCE = 120

const RECENT_PATTERN = /最近|改过|刚改|recent/gi
const HEX_PATTERN = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/
const NUMBER_PART = '-?\\d+(?:\\.\\d+)?'
const RANGE_PATTERNS: { pattern: RegExp; build: (first: string, second?: string) => RangeFilter }[] = [
  {
    // 闭区间要放在 > / < 之前，避免 10-20 被当成 ≤20
    pattern: new RegExp(`(${NUMBER_PART})\\s*(?:-|–|—|~|至)\\s*(${NUMBER_PART})`),
    build: (first, second) => {
      const low = Math.min(Number(first), Number(second))
      const high = Math.max(Number(first), Number(second))
      return { kind: 'range', min: low, max: high, description: `${formatNumber(low)}–${formatNumber(high)}` }
    },
  },
  { pattern: new RegExp(`>=?\\s*(${NUMBER_PART})`), build: (value) => ({ kind: 'range', min: Number(value), max: null, description: `≥${formatNumber(Number(value))}` }) },
  { pattern: new RegExp(`<=?\\s*(${NUMBER_PART})`), build: (value) => ({ kind: 'range', min: null, max: Number(value), description: `≤${formatNumber(Number(value))}` }) },
]

export function buildTokenEntries(tokens: BrandTokens): TokenEntry[] {
  const toScale = (category: EntryCategory, scale: number[]) =>
    scale.map((value, index) => ({
      key: `${category}.${index + 1}`,
      label: `${CATEGORY_LABELS[category]} ${index + 1}`,
      category,
      value: `${value}px`,
      numericValue: value,
      colorValue: null,
    }))
  return [
    { key: 'color.primary', label: '主色', category: 'color', value: tokens.primary, numericValue: null, colorValue: tokens.primary },
    { key: 'color.secondary', label: '辅助色', category: 'color', value: tokens.secondary, numericValue: null, colorValue: tokens.secondary },
    ...toScale('radius', tokens.radiusScale),
    ...toScale('spacing', tokens.spacingScale),
    ...toScale('type', tokens.typeScale),
  ]
}

export function isRecentlyModified(updatedAt: number | null, now: number = Date.now()): boolean {
  return updatedAt !== null && now - updatedAt <= RECENT_WINDOW_MS
}

export function parseSearchQuery(rawQuery: string): ParsedQuery {
  const recent = /最近|改过|刚改|recent/i.test(rawQuery)
  const text = rawQuery.replace(RECENT_PATTERN, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return { text: '', recent, range: null, color: null }

  const hexMatch = text.match(HEX_PATTERN)
  if (hexMatch) {
    const hex = expandHex(hexMatch[0]).toUpperCase()
    return { text, recent, range: null, color: { kind: 'color', hex, rgb: hexToRgb(hex) } }
  }

  const range = parseRange(text)
  if (range) return { text, recent, range, color: null }

  return { text, recent, range: null, color: null }
}

function parseRange(text: string): RangeFilter | null {
  for (const { pattern, build } of RANGE_PATTERNS) {
    const match = text.match(pattern)
    if (match) return build(match[1], match[2])
  }
  return null
}

export function expandHex(value: string): string {
  if (value.length === 4) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
  }
  return value
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  }
}

/** RedMean 颜色距离，值越小越接近 */
export function colorDistance(hex: string, target: { r: number; g: number; b: number }): number {
  const rgb = hexToRgb(hex)
  const rMean = (rgb.r + target.r) / 2
  return Math.sqrt(
    (2 + rMean / 256) * (rgb.r - target.r) ** 2
      + 4 * (rgb.g - target.g) ** 2
      + (2 + (255 - rMean) / 256) * (rgb.b - target.b) ** 2,
  )
}

export function colorSimilarity(hex: string, target: { r: number; g: number; b: number }): number {
  const distance = colorDistance(hex, target)
  return Math.max(0, Math.round((1 - distance / MAX_COLOR_DISTANCE) * 100))
}

export function findTextRanges(haystack: string, needle: string): TextRange[] {
  if (!needle) return []
  const source = haystack.toLowerCase()
  const target = needle.toLowerCase()
  const ranges: TextRange[] = []
  let index = source.indexOf(target)
  while (index !== -1) {
    ranges.push({ start: index, end: index + target.length })
    index = source.indexOf(target, index + target.length)
  }
  return ranges
}

export interface SearchContext {
  entries: TokenEntry[]
  category: TokenCategory
  parsed: ParsedQuery
  now: number
  updatedAt: Map<string, number>
}

function rangeMatches(entry: TokenEntry, range: RangeFilter): boolean {
  if (entry.numericValue === null) return false
  if (range.min !== null && entry.numericValue < range.min) return false
  if (range.max !== null && entry.numericValue > range.max) return false
  return true
}

function textMatches(entry: TokenEntry, text: string): boolean {
  return `${entry.key} ${entry.label} ${entry.value}`.toLowerCase().includes(text.toLowerCase())
}

export function searchTokens({ entries, category, parsed, now, updatedAt }: SearchContext): MatchedEntry[] {
  const recentFilter = parsed.recent
  const matches: MatchedEntry[] = []

  for (const entry of entries) {
    if (category !== 'all' && entry.category !== category) continue
    if (recentFilter && !isRecentlyModified(updatedAt.get(entry.key) ?? null, now)) continue

    let similarity: number | null = null
    if (parsed.color) {
      if (!entry.colorValue) continue
      const distance = colorDistance(entry.colorValue, parsed.color.rgb)
      if (distance > COLOR_MATCH_DISTANCE) continue
      similarity = colorSimilarity(entry.colorValue, parsed.color.rgb)
    } else if (parsed.range) {
      if (!rangeMatches(entry, parsed.range)) continue
    } else if (parsed.text) {
      if (!textMatches(entry, parsed.text)) continue
    }

    matches.push({ entry, highlights: buildHighlights(entry, parsed), similarity })
  }

  if (parsed.color) {
    matches.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
  } else if (recentFilter) {
    matches.sort((a, b) => (updatedAt.get(b.entry.key) ?? 0) - (updatedAt.get(a.entry.key) ?? 0))
  }
  return matches
}

function buildHighlights(entry: TokenEntry, parsed: ParsedQuery): MatchedEntry['highlights'] {
  if (parsed.color) {
    return [{ field: 'value', ranges: [{ start: 0, end: entry.value.length }] }]
  }
  if (parsed.range) {
    // 整个数值部分命中（如 16px 中的 16）
    const numberLength = entry.value.replace(/px$/, '').length
    return [{ field: 'value', ranges: [{ start: 0, end: numberLength }] }]
  }
  if (parsed.text) {
    const fields: MatchedEntry['highlights'] = []
    for (const field of ['label', 'key', 'value'] as const) {
      const ranges = findTextRanges(entry[field], parsed.text)
      if (ranges.length > 0) fields.push({ field, ranges })
    }
    return fields
  }
  return []
}

export function diagnoseEmptySearch(context: SearchContext): SearchDiagnosis {
  const { entries, category, parsed, now, updatedAt } = context
  const acrossAll = searchTokens({ entries, category: 'all', parsed, now, updatedAt })
  const hints: string[] = []
  let blockedByCategory = false
  let nearest: SearchDiagnosis['nearest'] = null

  if (acrossAll.length > 0 && category !== 'all') {
    blockedByCategory = true
    const otherLabels = [...new Set(acrossAll.map((match) => CATEGORY_LABELS[match.entry.category]))]
    hints.push(`「${CATEGORY_LABELS[category]}」类别下没有匹配，但 ${otherLabels.join('、')} 类别里有 ${acrossAll.length} 个，切到「全部」看看`)
  }

  if (parsed.range) {
    const scaleEntries = entries.filter((entry) => entry.numericValue !== null)
    const numericMatches = searchTokens({
      entries: scaleEntries,
      category: 'all',
      parsed: { ...parsed, recent: false },
      now,
      updatedAt,
    })
    if (numericMatches.length === 0) {
      const min = Math.min(...scaleEntries.map((entry) => entry.numericValue as number))
      const max = Math.max(...scaleEntries.map((entry) => entry.numericValue as number))
      hints.push(`当前数值令牌只覆盖 ${min}–${max}px，区间 ${parsed.range.description} 超出了范围`)
      if (parsed.range.min !== null && parsed.range.max !== null) {
        hints.push('区间写法支持 `10-20`、`>=16`、`<=8`')
      }
    }
  }

  const colorFilter = parsed.color
  if (colorFilter) {
    const colorEntries = entries.filter((entry) => entry.colorValue !== null)
    const scored = colorEntries
      .map((entry) => ({ entry, similarity: colorSimilarity(entry.colorValue as string, colorFilter.rgb) }))
      .sort((a, b) => b.similarity - a.similarity)
    nearest = scored[0] ?? null
    // 被类别筛选挡住时上面已经给了切换提示，不再重复“最接近”
    if (nearest && !blockedByCategory) {
      hints.push(`最接近的是 ${nearest.entry.label}（${nearest.entry.value}，相似度 ${nearest.similarity}%），可在颜色面板直接取用`)
    } else if (!nearest) {
      hints.push('颜色需要以 # 开头的 3 位或 6 位 HEX，例如 #F15A47 或 #f47')
    }
  }

  if (parsed.recent) {
    const changedCount = entries.filter((entry) => isRecentlyModified(updatedAt.get(entry.key) ?? null, now)).length
    hints.push(changedCount === 0 ? '最近 5 分钟内没有改动过令牌，先在上方调一个颜色或数值试试' : `共有 ${changedCount} 个最近改过的令牌，但可能被类别筛选挡住了`)
  }

  if (!parsed.range && !parsed.color && !parsed.recent && parsed.text) {
    hints.push('换个关键词试试：令牌名（primary）、中文名（主色）或数值（16）')
    hints.push('也可以直接搜区间（10-20）、颜色（#F15A47）或输入「最近」查看刚改过的令牌')
  }

  return {
    title: parsed.range ? `没有落在 ${parsed.range.description} 区间内的数值令牌` : parsed.color ? '没有找到足够接近的颜色令牌' : parsed.recent ? '没有最近改过的令牌' : '没有匹配的令牌',
    hints,
    blockedByCategory,
    nearest,
  }
}

export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const diffSeconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (diffSeconds < 10) return '刚刚'
  if (diffSeconds < 60) return `${diffSeconds} 秒前`
  const diffMinutes = Math.round(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`
  const diffHours = Math.round(diffMinutes / 60)
  return `${diffHours} 小时前`
}

export function isEditingStatus(status: MirrorStatus): boolean {
  return status === 'editing'
}

function formatNumber(value: number): string {
  return String(value)
}
