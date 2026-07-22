// TemplateRenderer.jsx
//
// Takes a saved template (an array of positioned elements in mm) plus real
// document data and renders print-ready, PAGINATED output: N paper-sized
// `.print-page` containers, each with the same absolute mm coordinates the
// designer showed.
//
// Pagination model (see pagination.js): the pre-printed stock is identical on
// every sheet, so bandTop / band height / rowsPerPage are uniform. Line items
// chunk uniformly across pages and each page restarts the row counter at
// bandTop + n*repeatIntervalMm. Positioned elements carry a pageScope
// ('all' | 'first' | 'last'); header values default to every page, totals to the
// last page. CSS page breaks (break-after: page) drive the actual pagination
// through react-to-print — no react-to-print changes needed.
//
// `data` shape: { logoUrl, companyName, companyAddress, customerName,
// customerAddress, documentNumber, documentDate, lineItems, subtotal, tax,
// total, header }. `header` is keyed by RECEIPT_HEADER_SOURCES ids and is what
// header `field` cells resolve against; `lineItems` are raw rows resolved per
// row by a lineItemRow's cells.

import { TEXT_DEFAULTS } from './blockTypes';
import { resolveBindingValue, formatDate } from './columnResolution';
import { resolvePageScope, isOnPage, rowsPerPage, pageCount } from './pagination';

function renderBlockContent(blockType, data) {
  switch (blockType) {
    case 'logo':
      return data.logoUrl ? (
        <img src={data.logoUrl} alt="Company logo" style={{ maxWidth: '100%', maxHeight: '100%' }} />
      ) : null;

    case 'companyInfo':
      return (
        <div>
          <div>{data.companyName}</div>
          <div>{data.companyAddress}</div>
        </div>
      );

    case 'customerInfo':
      return (
        <div>
          <div>{data.customerName}</div>
          <div>{data.customerAddress}</div>
        </div>
      );

    case 'documentMeta':
      return (
        <div>
          <div>No. {data.documentNumber}</div>
          <div>{data.documentDate}</div>
        </div>
      );

    case 'totals':
      return (
        <div>
          <div>Subtotal: {data.subtotal}</div>
          <div>Tax: {data.tax}</div>
          <div>
            <strong>Total: {data.total}</strong>
          </div>
        </div>
      );

    default:
      return null;
  }
}

// Text-style props shared by text boxes and header field cells, with the same
// TEXT_DEFAULTS fallbacks the designer previews with.
function textStyle(el) {
  return {
    fontSize: `${el.fontSize ?? TEXT_DEFAULTS.fontSize}pt`,
    textAlign: el.align ?? TEXT_DEFAULTS.align,
    fontFamily: el.fontFamily ?? TEXT_DEFAULTS.fontFamily,
    color: el.color ?? TEXT_DEFAULTS.color,
  };
}

// Per-cell style inside a line-item row (coords relative to the row origin).
function cellStyle(cell) {
  return {
    position: 'absolute',
    left: `${cell.x}mm`,
    top: `${cell.y}mm`,
    width: `${cell.width}mm`,
    height: `${cell.height}mm`,
    overflow: 'hidden',
    fontSize: `${cell.fontSize ?? TEXT_DEFAULTS.fontSize}pt`,
    textAlign: cell.align ?? TEXT_DEFAULTS.align,
    fontFamily: cell.fontFamily ?? TEXT_DEFAULTS.fontFamily,
    color: cell.color ?? TEXT_DEFAULTS.color,
  };
}

// Resolve a header field's value, applying the date format for a date binding.
function fieldValue(el, header) {
  const raw = resolveBindingValue(el.binding, header);
  if (el.binding && !el.binding.composed && el.binding.source === 'date') {
    return formatDate(raw, el.dateFormat);
  }
  return raw;
}

// One page's worth of a repeating line-item row: the row counter restarts at 0,
// so every page's first item lands at the same bandTop.
function renderLineItemRowPage(el, pageItems) {
  const cells = Array.isArray(el.cells) ? el.cells : [];
  const pitch = el.repeatIntervalMm || 0;
  return pageItems.map((item, ri) => (
    <div
      key={ri}
      style={{
        position: 'absolute',
        left: `${el.x}mm`,
        top: `${el.y + ri * pitch}mm`,
        width: `${el.width ?? 0}mm`,
        height: `${pitch}mm`,
      }}
    >
      {cells.map((cell) => (
        <div key={cell.id} style={cellStyle(cell)}>
          {resolveBindingValue(cell.binding, item)}
        </div>
      ))}
    </div>
  ));
}

// A non-row element (text box, data block, or header field), absolutely positioned.
function renderStaticElement(el, data, header) {
  const base = {
    position: 'absolute',
    left: `${el.x}mm`,
    top: `${el.y}mm`,
    width: `${el.width}mm`,
    height: `${el.height}mm`,
    overflow: 'hidden',
  };
  if (el.kind === 'text') {
    return <div key={el.id} style={{ ...base, ...textStyle(el) }}>{el.content}</div>;
  }
  if (el.kind === 'field') {
    return <div key={el.id} style={{ ...base, ...textStyle(el) }}>{fieldValue(el, header)}</div>;
  }
  return <div key={el.id} style={base}>{renderBlockContent(el.blockType, data)}</div>;
}

export function TemplateRenderer({ template, data, calibration = {} }) {
  const { elements = [], paperWidthMm = 210, paperHeightMm = 297 } = template || {};
  const header = (data && data.header) || {};
  const lineItems = Array.isArray(data.lineItems) ? data.lineItems : [];

  // Print calibration offset (mm), applied to EVERY element so a pre-printed form
  // aligns globally: the template's own offset PLUS a per-terminal delta (feed
  // alignment varies by printer). One translate on each page's content wrapper.
  const calX = (template?.calibrationOffsetXMm ?? 0) + (calibration.x ?? 0);
  const calY = (template?.calibrationOffsetYMm ?? 0) + (calibration.y ?? 0);
  const contentStyle = { position: 'absolute', inset: 0, transform: `translate(${calX}mm, ${calY}mm)` };

  const row = elements.find((e) => e.kind === 'lineItemRow');
  const perPage = row ? rowsPerPage(row, paperHeightMm) : lineItems.length;
  const numPages = row ? pageCount(lineItems.length, perPage) : 1;

  const pages = [];
  for (let p = 0; p < numPages; p++) {
    const pageItems = row ? lineItems.slice(p * perPage, (p + 1) * perPage) : [];
    pages.push(
      <div
        key={p}
        className="print-page"
        style={{ position: 'relative', width: `${paperWidthMm}mm`, height: `${paperHeightMm}mm`, overflow: 'hidden' }}
      >
        <div className="print-page__content" style={contentStyle}>
          {elements.map((el) => {
            // The line-item row paginates on every page (its own chunk).
            if (el.kind === 'lineItemRow') {
              return <div key={el.id}>{renderLineItemRowPage(el, pageItems)}</div>;
            }
            // Static elements honour their page scope (header → all, totals → last).
            if (!isOnPage(resolvePageScope(el), p, numPages)) return null;
            return renderStaticElement(el, data, header);
          })}
        </div>
      </div>,
    );
  }

  return <>{pages}</>;
}
