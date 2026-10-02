import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { BrandTokens, MirrorStatus } from '../models/brandMirrorModels'
import {
  buildTokenEntries,
  diagnoseEmptySearch,
  formatRelativeTime,
  isEditingStatus,
  isRecentlyModified,
  parseSearchQuery,
  searchTokens,
  type MatchedEntry,
  type TokenCategory,
  type TokenEntry,
} from './tokenSearch'

const filters: { id: TokenCategory; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'color', label: '颜色' },
  { id: 'radius', label: '圆角' },
  { id: 'spacing', label: '间距' },
  { id: 'type', label: '字体' },
]

interface TokenExplorerProps {
  tokens: BrandTokens
  status: MirrorStatus
}

export function TokenExplorer({ tokens, status }: TokenExplorerProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<TokenCategory>('all')
  const [recentOnly, setRecentOnly] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const updatedAt = useRef(new Map<string, number>())
  const previousEntries = useRef<TokenEntry[] | null>(null)

  const entries = useMemo<TokenEntry[]>(() => buildTokenEntries(tokens), [tokens])

  // 仅在用户编辑（而非初始化 / 从本地恢复）时记录改动时间
  useEffect(() => {
    const previous = previousEntries.current
    previousEntries.current = entries
    if (!previous || !isEditingStatus(status)) return
    const changedAt = Date.now()
    previous.forEach((previousEntry) => {
      const currentEntry = entries.find((candidate) => candidate.key === previousEntry.key)
      if (currentEntry && currentEntry.value !== previousEntry.value) {
        updatedAt.current.set(previousEntry.key, changedAt)
      }
    })
  }, [entries, status])

  // “最近改过”徽章上的相对时间需要随时间刷新
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const parsed = useMemo(() => parseSearchQuery(query), [query])
  const recentActive = recentOnly || parsed.recent
  const parsedWithRecent = useMemo(() => ({ ...parsed, recent: recentActive }), [parsed, recentActive])

  const matches = useMemo(
    () => searchTokens({ entries, category, parsed: parsedWithRecent, now, updatedAt: updatedAt.current }),
    [entries, category, parsedWithRecent, now],
  )

  const anyFilterActive = query.trim() !== '' || category !== 'all' || recentActive
  const diagnosis = useMemo(
    () => (matches.length === 0 && anyFilterActive
      ? diagnoseEmptySearch({ entries, category, parsed: parsedWithRecent, now, updatedAt: updatedAt.current })
      : null),
    [matches.length, anyFilterActive, entries, category, parsedWithRecent, now],
  )

  const handleQueryChange = (value: string) => {
    setQuery(value)
    // 搜索框清空后，筛选状态回到正常
    if (value.trim() === '') {
      setCategory('all')
      setRecentOnly(false)
    }
  }

  const clearAll = () => {
    setQuery('')
    setCategory('all')
    setRecentOnly(false)
  }

  return (
    <section className="control-section token-explorer">
      <div className="section-label">
        <span>令牌搜索</span>
        <span className="muted">{matches.length} / {entries.length}</span>
      </div>
      <label className="token-search">
        <span>⌕</span>
        <input
          aria-label="搜索令牌"
          placeholder="primary / 主色 / 10-20 / #F15A47 / 最近"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
        />
        {query && (
          <button aria-label="清空搜索" type="button" onClick={() => handleQueryChange('')}>×</button>
        )}
      </label>

      <div className="filter-chips">
        {filters.map((filter) => (
          <button
            className={category === filter.id ? 'active' : ''}
            key={filter.id}
            type="button"
            onClick={() => setCategory(filter.id)}
            aria-pressed={category === filter.id}
          >
            {filter.label}
          </button>
        ))}
        <button
          className={`recent-chip ${recentActive ? 'active' : ''}`}
          type="button"
          onClick={() => setRecentOnly((value) => !value)}
          aria-pressed={recentActive}
        >
          ⏱ 最近改过
        </button>
      </div>

      <ActiveModeTags parsed={parsedWithRecent} recentOnly={recentOnly} onClearQuery={() => handleQueryChange('')} />

      <div className="token-search-hint">支持 名称 · 数值区间（10-20、≥16）· 颜色（#F15A47）· 「最近」</div>

      <div className="token-results" aria-live="polite">
        {matches.length > 0 ? (
          matches.map((match) => (
            <TokenResult key={match.entry.key} match={match} now={now} updatedAt={updatedAt.current.get(match.entry.key) ?? null} recentActive={recentActive} />
          ))
        ) : diagnosis ? (
          <div className="token-no-result detailed">
            <strong>{diagnosis.title}</strong>
            <ul>
              {diagnosis.hints.map((hint) => (
                <li key={hint}>{renderHint(hint)}</li>
              ))}
            </ul>
            <div className="no-result-actions">
              {diagnosis.blockedByCategory && (
                <button type="button" className="primary" onClick={() => setCategory('all')}>查看全部类别</button>
              )}
              <button type="button" onClick={clearAll}>清除全部筛选</button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

/** 把提示中的 `代码` 片段渲染成 <code> */
function renderHint(hint: string): ReactNode {
  const parts = hint.split('`')
  return parts.map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : <span key={index}>{part}</span>))
}

function ActiveModeTags({ parsed, recentOnly, onClearQuery }: {
  parsed: ReturnType<typeof parseSearchQuery>
  recentOnly: boolean
  onClearQuery: () => void
}) {
  const tags: { label: string; onDismiss: () => void }[] = []
  if (parsed.range) tags.push({ label: `数值区间 ${parsed.range.description}`, onDismiss: onClearQuery })
  if (parsed.color) tags.push({ label: `颜色接近 ${parsed.color.hex}`, onDismiss: onClearQuery })
  // 关键词「最近」触发时给出可移除的标签；由独立开关触发时不重复显示
  if (parsed.recent && !recentOnly) tags.push({ label: '最近改过', onDismiss: onClearQuery })
  if (tags.length === 0) return null
  return (
    <div className="search-modes">
      {tags.map((tag) => (
        <span className="search-mode-tag" key={tag.label}>
          {tag.label}
          <button type="button" aria-label={`取消${tag.label}`} onClick={tag.onDismiss}>×</button>
        </span>
      ))}
    </div>
  )
}

function TokenResult({ match, now, updatedAt, recentActive }: { match: MatchedEntry; now: number; updatedAt: number | null; recentActive: boolean }) {
  const { entry, highlights, similarity } = match
  const changedRecently = isRecentlyModified(updatedAt, now)
  return (
    <div className="token-result">
      <span>
        <strong>
          {entry.colorValue && <i className="token-swatch" style={{ background: entry.colorValue }} aria-hidden="true" />}
          <Highlighted text={entry.label} field="label" highlights={highlights} />
        </strong>
        <small><Highlighted text={entry.key} field="key" highlights={highlights} /></small>
      </span>
      <span className="token-result-meta">
        {changedRecently && updatedAt !== null && (
          <em className={`recent-badge ${recentActive ? 'on' : ''}`}>
            ⏱ {formatRelativeTime(updatedAt, now)}
          </em>
        )}
        {similarity !== null && <em className="similarity-badge">{similarity}% 相似</em>}
        <code>
          <Highlighted text={entry.value} field="value" highlights={highlights} />
        </code>
      </span>
    </div>
  )
}

function Highlighted({ text, field, highlights }: { text: string; field: 'label' | 'key' | 'value'; highlights: MatchedEntry['highlights'] }) {
  const match = highlights.find((item) => item.field === field)
  if (!match || match.ranges.length === 0) return <>{text}</>
  const nodes: ReactNode[] = []
  let cursor = 0
  match.ranges.forEach((range, index) => {
    if (range.start > cursor) nodes.push(text.slice(cursor, range.start))
    nodes.push(<mark key={`${field}-${index}`}>{text.slice(range.start, range.end)}</mark>)
    cursor = range.end
  })
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return <>{nodes}</>
}
