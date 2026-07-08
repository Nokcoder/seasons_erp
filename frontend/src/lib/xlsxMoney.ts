import * as XLSX from 'xlsx'

// Currency cells keep 2 decimals; percentage-like numeric columns (e.g. a
// discount stored as the plain number 15 meaning 15%) use the same decimal
// precision without a thousands separator, matching the backend's
// xlsxwriter convention in procurement/router.py's shipment invoice export.
export const MONEY_FORMAT = '#,##0.00'
export const PCT_FORMAT = '0.00'

/**
 * Stamps a number format on a rectangular block of already-written numeric
 * cells (e.g. after XLSX.utils.sheet_add_json at a non-zero origin), so they
 * display like currency while remaining true numbers underneath. Cells that
 * aren't numeric (blank or text) are left untouched.
 */
export function stampNumberFormat(
  ws: XLSX.WorkSheet,
  startRow: number,
  colIdxs: number[],
  rowCount: number,
  format: string = MONEY_FORMAT,
): void {
  for (let r = 0; r < rowCount; r++) {
    for (const c of colIdxs) {
      const addr = XLSX.utils.encode_cell({ r: startRow + r, c })
      const cell = ws[addr]
      if (cell && cell.t === 'n') cell.z = format
    }
  }
}

/**
 * Builds a worksheet from row objects (same input shape as
 * XLSX.utils.json_to_sheet) via aoa_to_sheet, then stamps a number format on
 * the given columns so those cells display like currency/percentages while
 * remaining true numbers (SUM()-able, formula-ready).
 *
 * Column order is the union of keys across all rows in first-seen order, so
 * rows that conditionally omit a key still line up under the right header
 * for the rows that do have it.
 *
 * A value of `undefined` on any column produces a genuinely blank cell —
 * use that (not `''` and not a text placeholder) for "not applicable" data
 * (no credit limit set, no promo price, no cost data, etc.).
 */
export function jsonToFormattedSheet(
  rows: Record<string, unknown>[],
  colFormats: Record<string, string>,
): XLSX.WorkSheet {
  const headers: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) { seen.add(key); headers.push(key) }
    }
  }
  const aoa: unknown[][] = [headers, ...rows.map(row => headers.map(h => row[h]))]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const colIdxsByFormat = new Map<string, number[]>()
  headers.forEach((h, i) => {
    const format = colFormats[h]
    if (!format) return
    const idxs = colIdxsByFormat.get(format) ?? []
    idxs.push(i)
    colIdxsByFormat.set(format, idxs)
  })
  colIdxsByFormat.forEach((idxs, format) => {
    stampNumberFormat(ws, 1, idxs, rows.length, format)
  })
  return ws
}
