// DesignerCanvas.jsx
//
// Renders the paper as a sized canvas with a visible grid, and each placed
// element as a draggable/resizable box that snaps to that grid via
// react-rnd's dragGrid/resizeGrid props. Coordinates are stored in mm and
// converted to px only for on-screen display.
//
// Grid spacing and offset are configurable — this is what lets a template
// be calibrated to align with a specific pre-printed form.

import { Rnd } from 'react-rnd';
import { BLOCK_LABELS } from './blockTypes';
import './designer.css';

const PX_PER_MM = 3.7795275591;

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

function BlockPlaceholder({ blockType }) {
  if (blockType === 'lineItemsTable') {
    return (
      <div className="designer-block-placeholder designer-block-placeholder--table">
        <div className="designer-fake-row designer-fake-row--head" />
        <div className="designer-fake-row" />
        <div className="designer-fake-row" />
        <div className="designer-fake-row" />
      </div>
    );
  }
  return <div className="designer-block-placeholder">{BLOCK_LABELS[blockType] || blockType}</div>;
}

export function DesignerCanvas({
  elements,
  paperWidthMm,
  paperHeightMm,
  gridSpacingMm = 5,
  gridOffsetXMm = 0,
  gridOffsetYMm = 0,
  selectedId,
  onSelect,
  onUpdate,
  onDeselect,
}) {
  const canvasWidthPx = mmToPx(paperWidthMm);
  const canvasHeightPx = mmToPx(paperHeightMm);
  const gridPx = mmToPx(gridSpacingMm);
  const offsetPxX = mmToPx(gridOffsetXMm);
  const offsetPxY = mmToPx(gridOffsetYMm);

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
          if (e.target === e.currentTarget) onDeselect();
        }}
      >
        {elements.map((el) => (
          <Rnd
            key={el.id}
            size={{ width: mmToPx(el.width), height: mmToPx(el.height) }}
            position={{ x: mmToPx(el.x), y: mmToPx(el.y) }}
            dragGrid={[gridPx, gridPx]}
            resizeGrid={[gridPx, gridPx]}
            bounds="parent"
            minWidth={gridPx}
            minHeight={gridPx}
            onDragStop={(e, d) => {
              const rawX = pxToMm(d.x);
              const rawY = pxToMm(d.y);
              onUpdate(el.id, {
                x: snapToOffsetGrid(rawX, gridSpacingMm, gridOffsetXMm),
                y: snapToOffsetGrid(rawY, gridSpacingMm, gridOffsetYMm),
              });
            }}
            onResizeStop={(e, dir, ref, delta, pos) => {
              const rawWidth = pxToMm(ref.offsetWidth);
              const rawHeight = pxToMm(ref.offsetHeight);
              const rawX = pxToMm(pos.x);
              const rawY = pxToMm(pos.y);
              onUpdate(el.id, {
                width: Math.max(gridSpacingMm, snapToOffsetGrid(rawWidth, gridSpacingMm)),
                height: Math.max(gridSpacingMm, snapToOffsetGrid(rawHeight, gridSpacingMm)),
                x: snapToOffsetGrid(rawX, gridSpacingMm, gridOffsetXMm),
                y: snapToOffsetGrid(rawY, gridSpacingMm, gridOffsetYMm),
              });
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              onSelect(el.id);
            }}
            className={`designer-element${selectedId === el.id ? ' designer-element--selected' : ''}`}
          >
            {el.kind === 'text' ? (
              <textarea
                className="designer-text-box"
                style={{ fontSize: el.fontSize, textAlign: el.align }}
                value={el.content}
                onChange={(e) => onUpdate(el.id, { content: e.target.value })}
                onMouseDown={(e) => e.stopPropagation()}
              />
            ) : (
              <BlockPlaceholder blockType={el.blockType} />
            )}
          </Rnd>
        ))}
      </div>
    </div>
  );
}
