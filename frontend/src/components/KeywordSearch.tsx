import { useState, useEffect } from 'react'

interface KeywordSearchProps {
  tags: string[]
  onTagsChange: (tags: string[]) => void
  /** Called with debounced partial input (300 ms) for real-time pre-filter. */
  onPartialChange: (partial: string) => void
  placeholder?: string
  className?: string
}

/**
 * Global keyword search bar (UI Standards §Keyword Search Bar).
 *
 * - Enter commits the current input as a dismissible tag
 * - All committed tags are ANDed together in the parent's filter
 * - Real-time partial filtering fires via onPartialChange (debounced 300 ms)
 * - Tags persist in the URL as ?kw=… — handled by the parent page
 */
export default function KeywordSearch({
  tags,
  onTagsChange,
  onPartialChange,
  placeholder = 'Search…',
  className = '',
}: KeywordSearchProps) {
  const [input, setInput] = useState('')

  // Debounce partial input so the parent's filter runs at most every 300 ms
  useEffect(() => {
    const t = setTimeout(() => onPartialChange(input), 300)
    return () => clearTimeout(t)
  }, [input, onPartialChange])

  function commit() {
    const val = input.trim()
    if (!val) return
    if (!tags.includes(val)) {
      onTagsChange([...tags, val])
    }
    // Clear partial filter immediately so committed tag takes over
    onPartialChange('')
    setInput('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Backspace' && input === '' && tags.length > 0) {
      // Backspace on empty input removes the last tag
      onTagsChange(tags.slice(0, -1))
    }
  }

  function removeTag(tag: string) {
    onTagsChange(tags.filter(t => t !== tag))
  }

  function clearAll() {
    onTagsChange([])
    onPartialChange('')
    setInput('')
  }

  const hasActive = tags.length > 0 || input.trim() !== ''

  return (
    <div className={className}>
      {/* Tag container + inline input */}
      <div className="t-bg-input border t-border-strong rounded px-2 py-1.5
                      flex flex-wrap items-center gap-1 min-h-[34px]
                      focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
        {tags.map(tag => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 text-[11px] font-medium
                       bg-[var(--accent)]/10 t-accent-text border border-[var(--accent)]/30 rounded
                       px-1.5 py-0.5 leading-none whitespace-nowrap"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="t-accent-text hover:t-text-1 leading-none ml-0.5"
              aria-label={`Remove "${tag}"`}
            >
              ×
            </button>
          </span>
        ))}

        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? placeholder : '+ keyword…'}
          className="flex-1 min-w-[80px] bg-transparent border-0 outline-none
                     text-xs t-text-1 placeholder:t-text-3"
        />
      </div>

      {/* Clear All — only when there is something active */}
      {hasActive && (
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] t-text-3">
            {tags.length > 0 && `${tags.length} keyword${tags.length > 1 ? 's' : ''} active · AND`}
          </span>
          <button
            type="button"
            onClick={clearAll}
            className="text-[10px] t-text-3 hover:t-text-2 transition-colors"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  )
}
