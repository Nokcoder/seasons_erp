// Reusable skeleton loaders (ui_standards §5)

export function SkeletonRow({ cols = 5 }: { cols?: number }) {
  return (
    <tr className="border-b border-gray-800 animate-pulse">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-3 py-2.5">
          <div className="h-3 bg-gray-800 rounded w-full" />
        </td>
      ))}
    </tr>
  )
}

export function SkeletonTable({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} cols={cols} />
      ))}
    </>
  )
}

export function SkeletonCard() {
  return (
    <div className="animate-pulse bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
      <div className="h-4 bg-gray-800 rounded w-1/3" />
      <div className="h-3 bg-gray-800 rounded w-2/3" />
      <div className="h-3 bg-gray-800 rounded w-1/2" />
    </div>
  )
}

export function SkeletonField() {
  return (
    <div className="animate-pulse space-y-1">
      <div className="h-2.5 bg-gray-800 rounded w-16" />
      <div className="h-8 bg-gray-800 rounded w-full" />
    </div>
  )
}

export function SkeletonFields({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonField key={i} />
      ))}
    </div>
  )
}

// Thin "background refresh" indicator bar shown at top of page
export function FetchingBar({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-0.5 bg-blue-600 animate-pulse" />
  )
}
