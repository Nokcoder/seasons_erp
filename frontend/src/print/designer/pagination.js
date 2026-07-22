// pagination.js
//
// Pure helpers for the multi-page (paginated) print model — no React/DOM, so
// unit-testable in isolation. The pre-printed stock is identical on every sheet,
// so bandTop, band height, and rowsPerPage are uniform across all pages; only
// positioned VALUE cells get filled (software draws no ruling/labels).

export const PAGE_SCOPES = ['all', 'first', 'last'];

// Header/field sources that are "totals" values — these default to the last page.
const TOTALS_SOURCES = ['grandTotal', 'subtotal', 'tax'];

// Effective page scope for an element: an explicit pageScope wins; otherwise a
// sensible default — the totals block and totals-valued fields print on the LAST
// page; everything else (header values, text, line-item rows) on ALL pages.
export function resolvePageScope(el) {
  if (el && PAGE_SCOPES.includes(el.pageScope)) return el.pageScope;
  if (el && el.kind === 'block' && el.blockType === 'totals') return 'last';
  if (
    el && el.kind === 'field' && el.binding && !el.binding.composed &&
    TOTALS_SOURCES.includes(el.binding.source)
  ) {
    return 'last';
  }
  return 'all';
}

export function isOnPage(scope, pageIndex, numPages) {
  if (scope === 'first') return pageIndex === 0;
  if (scope === 'last') return pageIndex === numPages - 1;
  return true; // 'all'
}

// Rows that fit on one page's band: explicit maxRows (now = rows-per-page) or,
// when unset, however many pitch-rows fit between the band top and the page bottom.
export function rowsPerPage(row, paperHeightMm) {
  if (!row) return 0;
  const pitch = row.repeatIntervalMm || 1;
  if (row.maxRows != null) return Math.max(1, row.maxRows);
  return Math.max(1, Math.floor((paperHeightMm - row.y) / pitch));
}

// Zero line items still yields one page; exact multiples do NOT add a spurious
// trailing page (ceil handles it) — totals then land on the last full page.
export function pageCount(itemCount, perPage) {
  return Math.max(1, Math.ceil((itemCount || 0) / Math.max(1, perPage)));
}

// The vertical band region [top, bottom] (mm) that line items occupy on a page.
export function bandRegion(row, paperHeightMm) {
  const pitch = row.repeatIntervalMm || 1;
  return { top: row.y, bottom: row.y + rowsPerPage(row, paperHeightMm) * pitch };
}

// True if any last-page element (totals block / totals-valued field) vertically
// overlaps the line-item band region — which would misprint on a full last page.
// Surfaced as a designer warning rather than silently mis-paginating.
export function totalsOverlapBand(elements, paperHeightMm) {
  const row = (elements || []).find((e) => e.kind === 'lineItemRow');
  if (!row) return false;
  const band = bandRegion(row, paperHeightMm);
  return (elements || []).some((el) => {
    if (el.kind === 'lineItemRow') return false;
    if (resolvePageScope(el) !== 'last') return false;
    const top = el.y;
    const bottom = el.y + (el.height || 0);
    return bottom > band.top && top < band.bottom;
  });
}
