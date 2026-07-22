// DesignerCanvas.jsx
//
// Renders the paper as a sized canvas with a visible grid, and each placed
// element as a draggable/resizable box that snaps to that grid via
// react-rnd's dragGrid/resizeGrid props. Coordinates are stored in mm and
// converted to px only for on-screen display.
//
// Grid spacing and offset are configurable — this is what lets a template
// be calibrated to align with a specific pre-printed form. Snapping to that
// grid is toggleable (`snapEnabled`): off = free ~0.1mm positioning for fine
// alignment. The toggle governs EVERY element type uniformly (text boxes, data
// blocks, the line-item row band, and its cells).
//
// Text boxes use edit-on-double-click: by default the inner <textarea> is
// read-only with pointer-events:none, so mouse-downs pass through to react-rnd
// and the box drags like a data block. Double-clicking a text box enters edit
// mode (focus the textarea, re-enable pointer events, disable dragging);
// blurring / clicking away exits back to the draggable state. react-rnd does NOT
// forward onDoubleClick, so it lives on a wrapper element inside the Rnd.
//
// A lineItemRow is a positioned band (one "row slot", height = repeatIntervalMm)
// holding repeating cells. The band is itself a react-rnd element dragged via its
// header handle (dragHandleClassName) — so the whole row repositions like a text
// box, while its cells (their own react-rnd boxes) drag independently within it.
// Cells are bounded to the band (one pitch tall); to give cells more vertical
// room, raise repeatIntervalMm and the band grows with it. Selecting the header
// (or bare band background) selects the row; selecting a cell selects the cell.
// Faint ghost bands below the editable one visualise the repeat pitch.

import { useState, useRef, useEffect } from 'react';
import { Rnd } from 'react-rnd';
import { BLOCK_LABELS, TEXT_DEFAULTS } from './blockTypes';
import { describeBinding, resolveBindingValue, formatDate } from './columnResolution';
import { getSampleData } from './sampleData';
import './designer.css';

const PX_PER_MM = 3.7795275591;

// Upper bound on ghost slots rendered, so an extreme maxRows can't spawn thousands.
const GHOST_HARD_MAX = 200;

// How far (mm) elements may be positioned beyond the paper edges, for aligning to
// pre-printed stock. The print page still CLIPS at the paper edge (.print-page
// overflow:hidden), and the designer flags anything outside the paper in red.
const BLEED_MM = 20;

// Width-only resize handles for the row band; height stays tied to repeatIntervalMm.
const BAND_RESIZE_HANDLES = {
  top: false, right: true, bottom: false, left: true,
  topRight: false, bottomRight: false, bottomLeft: false, topLeft: false,
};

function mmToPx(mm) {
  return mm * PX_PER_MM;
}
function pxToMm(px) {
  return px / PX_PER_MM;
}

function snapToOffsetGrid(value, spacing, offset = 0) {
  if (!spacing) return value;
  return offset + Math.round((value - offset) / spacing) * spacing;
}
function round1(v) {
  return Math.round(v * 10) / 10;
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function BlockPlaceholder({ blockType }) {
  return <div className="designer-block-placeholder">{BLOCK_LABELS[blockType] || blockType}</div>;
}

export function DesignerCanvas({
  elements,
  paperWidthMm,
  paperHeightMm,
  gridSpacingMm = 5,
  gridOffsetXMm = 0,
  gridOffsetYMm = 0,
  snapEnabled = true,
  selectedId,
  onSelect,
  onUpdate,
  onUpdateCell,
  onDeselect,
}) {
  // Which text box (if any) is currently in edit mode.
  const [editingId, setEditingId] = useState(null);
  const textRefs = useRef({});

  // Focus the textarea when a box enters edit mode, caret at end.
  useEffect(() => {
    if (editingId && textRefs.current[editingId]) {
      const ta = textRefs.current[editingId];
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, [editingId]);

  const canvasWidthPx = mmToPx(paperWidthMm);
  const canvasHeightPx = mmToPx(paperHeightMm);
  const gridPx = mmToPx(gridSpacingMm);
  const offsetPxX = mmToPx(gridOffsetXMm);
  const offsetPxY = mmToPx(gridOffsetYMm);

  // Snap-aware drag/resize step for react-rnd, plus value snappers used in the
  // stop handlers. Snapping off → free 1px movement, coordinates stored to 0.1mm
  // (precise enough to align to a pre-printed form). snapX/snapY apply the grid
  // OFFSET (page-space); snapDim (widths/heights and row-relative cell coords) does
  // not. Applied uniformly to every draggable element so the toggle is consistent.
  const moveGrid = snapEnabled ? [gridPx, gridPx] : [1, 1];
  const minPx = snapEnabled ? gridPx : mmToPx(1);
  const minDimMm = snapEnabled ? gridSpacingMm : 1;
  const snapX = (rawMm) => (snapEnabled ? snapToOffsetGrid(rawMm, gridSpacingMm, gridOffsetXMm) : round1(rawMm));
  const snapY = (rawMm) => (snapEnabled ? snapToOffsetGrid(rawMm, gridSpacingMm, gridOffsetYMm) : round1(rawMm));
  const snapDim = (rawMm) => (snapEnabled ? snapToOffsetGrid(rawMm, gridSpacingMm) : round1(rawMm));

  // Positioning is no longer floored at 0 — elements may sit off the paper (for
  // pre-printed-form alignment), bounded to a bleed margin so they stay reachable.
  const clampBleedX = (mm) => clamp(mm, -BLEED_MM, paperWidthMm + BLEED_MM);
  const clampBleedY = (mm) => clamp(mm, -BLEED_MM, paperHeightMm + BLEED_MM);
  const isOutsidePaper = (x, y, w, h) => x < 0 || y < 0 || x + w > paperWidthMm || y + h > paperHeightMm;

  // Sample document data for on-canvas previews (ghost rows + header field cells).
  const sample = getSampleData('receipt');
  const sampleHeader = sample.header || {};

  // Resolved sample value for a header field cell (with date formatting), falling
  // back to the binding label when unbound/empty so the cell is still identifiable.
  function fieldPreview(el) {
    const raw = resolveBindingValue(el.binding, sampleHeader);
    const v =
      el.binding && !el.binding.composed && el.binding.source === 'date'
        ? formatDate(raw, el.dateFormat)
        : raw;
    return v === '' || v == null ? describeBinding(el.binding, 'header') : v;
  }

  // A positioned, repeating line-item row: a draggable band (one row slot) with cells.
  function renderLineItemRow(el) {
    const pitch = el.repeatIntervalMm || gridSpacingMm;
    const cells = Array.isArray(el.cells) ? el.cells : [];
    const isRowSelected = selectedId === el.id;
    const pitchPx = mmToPx(pitch);

    // Band width is now an explicit, resizable property (like text boxes), stored
    // on the element. It can never be narrower than the cells it contains
    // (cellExtentMm), so the band always visually holds its cells; older rows with
    // no stored width fall back to that extent instead of the full paper width.
    const cellExtentMm = cells.length
      ? Math.max(gridSpacingMm, ...cells.map((c) => c.x + c.width))
      : Math.max(gridSpacingMm, paperWidthMm - el.x);
    const bandWidthMm = Math.max(cellExtentMm, el.width ?? cellExtentMm);
    const isRowOutside = isOutsidePaper(el.x, el.y, bandWidthMm, pitch);

    // Ghost slots below the editable row visualise the repeat. The count reflects
    // the user's declared maxRows (declared − 1 ghosts); when uncapped it shows how
    // many additional rows actually fit on the remaining page, so real capacity is
    // visible against a pre-printed form. Hard-capped to bound the node count.
    const fitSlots = pitch > 0 ? Math.max(1, Math.floor((paperHeightMm - el.y) / pitch)) : 1;
    const declaredSlots = el.maxRows != null ? Math.max(1, el.maxRows) : fitSlots;
    const ghostCount = Math.max(0, Math.min(declaredSlots - 1, GHOST_HARD_MAX));

    // Representative sample so ghosts preview what real repeated rows look like
    // (reuses the same sample data the Preview & Test Print uses).
    const sampleItems = sample.lineItems || [];

    return (
      <div key={el.id}>
        {Array.from({ length: ghostCount }).map((_, i) => {
          const sampleRow = sampleItems.length ? sampleItems[(i + 1) % sampleItems.length] : {};
          return (
            <div
              key={`ghost-${i}`}
              className="designer-row-ghost"
              style={{
                left: mmToPx(el.x),
                top: mmToPx(el.y + (i + 1) * pitch),
                width: mmToPx(bandWidthMm),
                height: pitchPx,
              }}
            >
              {cells.map((cell) => (
                <div
                  key={cell.id}
                  className="designer-row-ghost__cell"
                  style={{
                    left: mmToPx(cell.x),
                    top: mmToPx(cell.y),
                    width: mmToPx(cell.width),
                    height: mmToPx(cell.height),
                    fontSize: `${cell.fontSize ?? TEXT_DEFAULTS.fontSize}pt`,
                    textAlign: cell.align ?? TEXT_DEFAULTS.align,
                    fontFamily: cell.fontFamily ?? TEXT_DEFAULTS.fontFamily,
                    color: cell.color ?? TEXT_DEFAULTS.color,
                  }}
                >
                  {resolveBindingValue(cell.binding, sampleRow)}
                </div>
              ))}
            </div>
          );
        })}
        <Rnd
          className={`designer-row-band${isRowSelected ? ' designer-row-band--selected' : ''}${isRowOutside ? ' designer-row-band--outside' : ''}`}
          size={{ width: mmToPx(bandWidthMm), height: pitchPx }}
          position={{ x: mmToPx(el.x), y: mmToPx(el.y) }}
          // Only the header handle initiates a band drag, so clicking a cell (or
          // bare band background) never drags the whole row.
          dragHandleClassName="designer-row-band__handle"
          dragGrid={moveGrid}
          resizeGrid={moveGrid}
          // Width-only resize (left/right); height stays tied to repeatIntervalMm.
          // minWidth clamps to the cells' extent so the band can't be shrunk
          // narrower than its cells.
          enableResizing={BAND_RESIZE_HANDLES}
          minWidth={mmToPx(cellExtentMm)}
          onResizeStop={(e, dir, ref, delta, pos) => {
            onUpdate(el.id, {
              width: Math.max(cellExtentMm, snapDim(pxToMm(ref.offsetWidth))),
              x: clampBleedX(snapX(pxToMm(pos.x))),
            });
          }}
          onDragStop={(e, d) => {
            onUpdate(el.id, {
              x: clampBleedX(snapX(pxToMm(d.x))),
              y: clampBleedY(snapY(pxToMm(d.y))),
            });
          }}
          // Fires for the handle and bare-background mousedowns (cells stop
          // propagation) — either way, select the row.
          onMouseDown={() => {
            onSelect(el.id);
            setEditingId(null);
          }}
        >
          <div
            className={`designer-row-band__handle${isRowSelected ? ' designer-row-band__handle--selected' : ''}`}
            title="Drag to move the whole row; click to edit row settings"
          >
            <span className="designer-row-band__grip" aria-hidden="true">⠿</span>
            Line item row
          </div>
          {cells.map((cell) => (
            <Rnd
              key={cell.id}
              size={{ width: mmToPx(cell.width), height: mmToPx(cell.height) }}
              position={{ x: mmToPx(cell.x), y: mmToPx(cell.y) }}
              dragGrid={moveGrid}
              resizeGrid={moveGrid}
              bounds="parent"
              minWidth={minPx}
              minHeight={minPx}
              onDragStop={(e, d) => {
                onUpdateCell(el.id, cell.id, {
                  x: Math.max(0, snapDim(pxToMm(d.x))),
                  y: Math.max(0, snapDim(pxToMm(d.y))),
                });
              }}
              onResizeStop={(e, dir, ref, delta, pos) => {
                onUpdateCell(el.id, cell.id, {
                  width: Math.max(minDimMm, snapDim(pxToMm(ref.offsetWidth))),
                  height: Math.max(minDimMm, snapDim(pxToMm(ref.offsetHeight))),
                  x: Math.max(0, snapDim(pxToMm(pos.x))),
                  y: Math.max(0, snapDim(pxToMm(pos.y))),
                });
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                onSelect(cell.id);
                setEditingId(null);
              }}
              className={`designer-cell${selectedId === cell.id ? ' designer-cell--selected' : ''}`}
            >
              <div
                className="designer-cell__label"
                style={{
                  fontSize: `${cell.fontSize ?? TEXT_DEFAULTS.fontSize}pt`,
                  textAlign: cell.align ?? TEXT_DEFAULTS.align,
                  fontFamily: cell.fontFamily ?? TEXT_DEFAULTS.fontFamily,
                }}
              >
                {describeBinding(cell.binding)}
              </div>
            </Rnd>
          ))}
        </Rnd>
      </div>
    );
  }

  return (
    <div className="designer-canvas-scroll">
      <div
        className="designer-canvas"
        style={{
          width: canvasWidthPx,
          height: canvasHeightPx,
          backgroundSize: `${gridPx}px ${gridPx}px`,
          backgroundPosition: `${offsetPxX}px ${offsetPxY}px`,
        }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            onDeselect();
            setEditingId(null);
          }
        }}
      >
        {elements.map((el) => {
          if (el.kind === 'lineItemRow') {
            return renderLineItemRow(el);
          }
          const isEditing = el.kind === 'text' && editingId === el.id;
          return (
            <Rnd
              key={el.id}
              size={{ width: mmToPx(el.width), height: mmToPx(el.height) }}
              position={{ x: mmToPx(el.x), y: mmToPx(el.y) }}
              dragGrid={moveGrid}
              resizeGrid={moveGrid}
              // No bounds: elements may be positioned off the paper (into the bleed)
              // for pre-printed-form alignment; the clamp keeps them reachable and
              // the --outside class flags that they'll clip at print.
              minWidth={minPx}
              minHeight={minPx}
              // While editing text, dragging would fight mouse text-selection.
              disableDragging={isEditing}
              onDragStop={(e, d) => {
                onUpdate(el.id, {
                  x: clampBleedX(snapX(pxToMm(d.x))),
                  y: clampBleedY(snapY(pxToMm(d.y))),
                });
              }}
              onResizeStop={(e, dir, ref, delta, pos) => {
                onUpdate(el.id, {
                  width: Math.max(minDimMm, snapDim(pxToMm(ref.offsetWidth))),
                  height: Math.max(minDimMm, snapDim(pxToMm(ref.offsetHeight))),
                  x: clampBleedX(snapX(pxToMm(pos.x))),
                  y: clampBleedY(snapY(pxToMm(pos.y))),
                });
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                onSelect(el.id);
              }}
              className={`designer-element${selectedId === el.id ? ' designer-element--selected' : ''}${
                isOutsidePaper(el.x, el.y, el.width, el.height) ? ' designer-element--outside' : ''
              }`}
            >
              {el.kind === 'text' ? (
                // Wrapper carries the double-click (react-rnd doesn't forward it)
                // and stays pointer-interactive so mouse-downs reach react-rnd's
                // drag handling while the textarea itself is inert until editing.
                <div
                  className="designer-text-wrap"
                  onDoubleClick={() => setEditingId(el.id)}
                >
                  <textarea
                    ref={(node) => {
                      if (node) textRefs.current[el.id] = node;
                      else delete textRefs.current[el.id];
                    }}
                    className="designer-text-box"
                    style={{
                      // pt (not a bare px number) so the on-screen preview
                      // matches TemplateRenderer's print output exactly.
                      fontSize: `${el.fontSize ?? TEXT_DEFAULTS.fontSize}pt`,
                      textAlign: el.align ?? TEXT_DEFAULTS.align,
                      fontFamily: el.fontFamily ?? TEXT_DEFAULTS.fontFamily,
                      color: el.color ?? TEXT_DEFAULTS.color,
                      pointerEvents: isEditing ? 'auto' : 'none',
                    }}
                    readOnly={!isEditing}
                    value={el.content}
                    onChange={(e) => onUpdate(el.id, { content: e.target.value })}
                    onMouseDown={(e) => e.stopPropagation()}
                    onBlur={() => setEditingId((cur) => (cur === el.id ? null : cur))}
                  />
                </div>
              ) : el.kind === 'field' ? (
                <div
                  className="designer-field-content"
                  style={{
                    fontSize: `${el.fontSize ?? TEXT_DEFAULTS.fontSize}pt`,
                    textAlign: el.align ?? TEXT_DEFAULTS.align,
                    fontFamily: el.fontFamily ?? TEXT_DEFAULTS.fontFamily,
                    color: el.color ?? TEXT_DEFAULTS.color,
                  }}
                >
                  {fieldPreview(el)}
                </div>
              ) : (
                <BlockPlaceholder blockType={el.blockType} />
              )}
            </Rnd>
          );
        })}
      </div>
    </div>
  );
}
