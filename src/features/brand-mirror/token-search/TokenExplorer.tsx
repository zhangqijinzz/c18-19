import { useMemo, useState } from 'react'
import type { BrandTokens } from '../models/brandMirrorModels'
import { buildEmptyHints, buildTokenEntries, formatRelativeTime, parseSearch, searchTokens, type HighlightSegment, type TokenCategory, type TokenMatch } from './tokenSearch'

const filters: { id: TokenCategory; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'color', label: '颜色' },
  { id: 'radius', label: '圆角' },
  { id: 'spacing', label: '间距' },
  { id: 'type', label: '字体' },
]

const RECENT_QUERY = '最近'
const QUICK_SYNTAX: { label: string; query: string }[] = [
  { label: '10–20', query: '10-20' },
  { label: '#F15A47', query: '#F15A47' },
  { label: '最近改过', query: RECENT_QUERY },
]

interface TokenExplorerProps {
  tokens: BrandTokens
  updatedAt?: Record<string, string>
}

export function TokenExplorer({ tokens, updatedAt = {} }: TokenExplorerProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<TokenCategory>('all')

  const entries = useMemo(() => buildTokenEntries(tokens), [tokens])
  const parsed = useMemo(() => parseSearch(query), [query])
  const visibleEntries = useMemo(
    () => searchTokens(entries, parsed, category, updatedAt),
    [entries, parsed, category, updatedAt],
  )
  const isFiltering = query.trim().length > 0 || category !== 'all'

  const resetAll = () => {
    setQuery('')
    setCategory('all')
  }

  const toggleRecent = () => {
    setQuery((current) => (parseSearch(current).recent ? '' : RECENT_QUERY))
  }

  return (
    <section className="control-section token-explorer">
      <div className="section-label"><span>令牌搜索</span><span className="muted">{visibleEntries.length} / {entries.length}</span></div>

      <label className="token-search">
        <span>⌕</span>
        <input
          aria-label="搜索令牌"
          placeholder="名称 / 10-20 / #F15A47 / 最近"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && <button aria-label="清空搜索" type="button" onClick={resetAll}>×</button>}
      </label>

      <div className="search-syntax">
        {QUICK_SYNTAX.map((item) => (
          <button
            className={item.query === RECENT_QUERY && parsed.recent ? 'active' : ''}
            disabled={item.query === RECENT_QUERY && parsed.recent}
            key={item.label}
            type="button"
            onClick={() => setQuery(item.query)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="filter-chips">
        {filters.map((filter) => (
          <button className={category === filter.id ? 'active' : ''} key={filter.id} type="button" onClick={() => setCategory(filter.id)}>{filter.label}</button>
        ))}
        <button className={`recent-chip ${parsed.recent ? 'active' : ''}`} type="button" onClick={toggleRecent} aria-pressed={parsed.recent}>
          <span className="recent-dot" />最近改过
        </button>
      </div>

      {parsed.hasFilters && (
        <div className="active-filters">
          {parsed.ranges.map((range, index) => <span className="filter-tag" key={`range-${index}`}>区间 {range.min ?? '…'}–{range.max ?? '…'}px</span>)}
          {parsed.colors.map((color) => <span className="filter-tag color-tag" key={color}><i style={{ background: color }} />≈ {color}</span>)}
          {parsed.recent && <span className="filter-tag recent-tag"><span className="recent-dot" />最近改过</span>}
        </div>
      )}

      <div className="token-results">
        {visibleEntries.length > 0 ? (
          visibleEntries.map((entry) => <TokenResultRow entry={entry} key={entry.key} showTime={parsed.recent} />)
        ) : (
          <EmptyState parsed={parsed} category={category} entries={entries} updatedAt={updatedAt} onClearCategory={() => setCategory('all')} onClearSearch={resetAll} />
        )}
      </div>

      {isFiltering && visibleEntries.length > 0 && (
        <button className="reset-filters" type="button" onClick={resetAll}>清除全部筛选，回到全部令牌</button>
      )}
    </section>
  )
}

function TokenResultRow({ entry, showTime }: { entry: TokenMatch; showTime: boolean }) {
  return (
    <div className="token-result">
      <span className="token-result-text">
        <strong><Segments parts={entry.segments.label} /></strong>
        <small><Segments parts={entry.segments.key} /></small>
        {(showTime || entry.colorCloseness !== null) && (
          <span className="result-badges">
            {entry.colorCloseness !== null && <em className="closeness-badge" title={`RGB 距离 ${Math.round(entry.colorDistance ?? 0)}`}>相似度 {Math.round(entry.colorCloseness * 100)}%</em>}
            {entry.updatedAt && <em className="modified-badge"><span className="recent-dot" />{formatRelativeTime(entry.updatedAt)}</em>}
          </span>
        )}
      </span>
      <span className="token-result-value">
        {entry.category === 'color' && <i className="token-swatch" style={{ background: entry.value }} />}
        <code className={entry.valueHit ? 'value-hit' : ''}><Segments parts={entry.segments.value} /></code>
      </span>
    </div>
  )
}

function Segments({ parts }: { parts: HighlightSegment[] }) {
  return <>{parts.map((part, index) => part.hit ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</>
}

interface EmptyStateProps {
  parsed: ReturnType<typeof parseSearch>
  category: TokenCategory
  entries: ReturnType<typeof buildTokenEntries>
  updatedAt: Record<string, string>
  onClearCategory: () => void
  onClearSearch: () => void
}

function EmptyState({ parsed, category, entries, updatedAt, onClearCategory, onClearSearch }: EmptyStateProps) {
  const hints = buildEmptyHints(parsed, category, entries, updatedAt)
  return (
    <div className="token-no-result">
      <strong>没有匹配的令牌</strong>
      <ul>
        {hints.map((hint) => (
          <li className={`hint-${hint.tone}`} key={`${hint.tone}-${hint.title}`}>
            <p><b>{hint.title}</b>{hint.detail}</p>
            {hint.action === 'clear-category' && <button type="button" onClick={onClearCategory}>{hint.actionLabel}</button>}
            {hint.action === 'clear-search' && <button type="button" onClick={onClearSearch}>{hint.actionLabel}</button>}
          </li>
        ))}
      </ul>
    </div>
  )
}
