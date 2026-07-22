// TemplateDesigner.jsx
//
// Edits a single template's layout: name, paper size (including custom
// dimensions), grid calibration (spacing + offset, for aligning to
// pre-printed forms), and placed elements. Takes the template object plus
// an onChange callback — the caller (TemplateLibrary) owns persistence.

import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { BlockPalette } from './BlockPalette';
import { DesignerCanvas } from './DesignerCanvas';
import { TEXT_DEFAULTS, FONT_FAMILY_OPTIONS, BLOCK_LABELS } from './blockTypes';
import { RECEIPT_LINE_ITEM_SOURCES, RECEIPT_HEADER_SOURCES } from './receiptSources';
import { DEFAULT_LINE_ITEM_CELLS, DEFAULT_LINE_ITEM_ROW, describeBinding, DATE_FORMAT_OPTIONS } from './columnResolution';
import { BindingEditor } from './BindingEditor';
import { resolvePageScope, totalsOverlapBand } from './pagination';
import { PAPER_PRESETS_MM } from './useTemplateLibrary';
import './designer.css';
import { TemplatePreviewModal } from './TemplatePreviewModal';

const PAPER_PRESET_OPTIONS = ['A4', 'Letter', 'Legal', 'Custom'];

export function TemplateDesigner({ template, onChange, onClose }) {
  const [selectedId, setSelectedId] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);

  const elements = template.elements || [];
  const usedBlockTypes = elements.filter((el) => el.kind === 'block').map((el) => el.blockType);
  const hasLineItemRow = elements.some((el) => el.kind === 'lineItemRow');

  // Resolve the current selection, which may be a top-level element or a cell
  // inside a lineItemRow.
  const selectedElement = elements.find((el) => el.id === selectedId);
  let selectedCell = null;
  let selectedCellRow = null;
  if (!selectedElement) {
    for (const el of elements) {
      if (el.kind === 'lineItemRow' && Array.isArray(el.cells)) {
        const c = el.cells.find((cc) => cc.id === selectedId);
        if (c) {
          selectedCell = c;
          selectedCellRow = el;
          break;
        }
      }
    }
  }

  const gridSpacingMm = template.gridSpacingMm ?? 5;
  const gridOffsetXMm = template.gridOffsetXMm ?? 0;
  const gridOffsetYMm = template.gridOffsetYMm ?? 0;

  function updateElements(nextElements) {
    onChange({ elements: nextElements });
  }

  function updateElement(id, patch) {
    updateElements(elements.map((el) => (el.id === id ? { ...el, ...patch } : el)));
  }

  // Patch a single cell inside a lineItemRow.
  function updateCell(rowId, cellId, patch) {
    updateElements(
      elements.map((el) =>
        el.id === rowId
          ? { ...el, cells: el.cells.map((c) => (c.id === cellId ? { ...c, ...patch } : c)) }
          : el,
      ),
    );
  }

  function addBlock(blockType) {
    const newEl = { id: uuidv4(), kind: 'block', blockType, x: 10, y: 10, width: 60, height: 20 };
    updateElements([...elements, newEl]);
    setSelectedId(newEl.id);
  }

  function addTextBox() {
    const newEl = {
      id: uuidv4(),
      kind: 'text',
      content: 'Edit this text',
      fontSize: TEXT_DEFAULTS.fontSize,
      align: TEXT_DEFAULTS.align,
      fontFamily: TEXT_DEFAULTS.fontFamily,
      color: TEXT_DEFAULTS.color,
      x: 10,
      y: 10,
      width: 60,
      height: 15,
    };
    updateElements([...elements, newEl]);
    setSelectedId(newEl.id);
  }

  // Add a positioned header-value field cell (date, customer, receipt no, totals…),
  // defaulting to the date binding. Same drag/resize/binding interaction as a cell.
  function addField() {
    const newEl = {
      id: uuidv4(),
      kind: 'field',
      binding: { source: 'date' },
      dateFormat: 'raw',
      fontSize: TEXT_DEFAULTS.fontSize,
      align: TEXT_DEFAULTS.align,
      fontFamily: TEXT_DEFAULTS.fontFamily,
      color: TEXT_DEFAULTS.color,
      x: 10,
      y: 20,
      width: 50,
      height: 8,
    };
    updateElements([...elements, newEl]);
    setSelectedId(newEl.id);
  }

  // Add the repeating line-item row, pre-seeded with the default BIR-style cells
  // (Qty | Description | U/P | Amount) so it renders sensibly out of the box.
  function addLineItemRow() {
    const newEl = {
      id: uuidv4(),
      kind: 'lineItemRow',
      x: DEFAULT_LINE_ITEM_ROW.x,
      y: DEFAULT_LINE_ITEM_ROW.y,
      width: DEFAULT_LINE_ITEM_ROW.width,
      repeatIntervalMm: DEFAULT_LINE_ITEM_ROW.repeatIntervalMm,
      maxRows: DEFAULT_LINE_ITEM_ROW.maxRows,
      cells: DEFAULT_LINE_ITEM_CELLS.map((c) => ({
        ...c,
        id: uuidv4(),
        binding: c.binding.composed
          ? { composed: { ...c.binding.composed, sources: [...c.binding.composed.sources] } }
          : { ...c.binding },
      })),
    };
    updateElements([...elements, newEl]);
    setSelectedId(newEl.id);
  }

  // Add a new cell to a lineItemRow, placed just right of the existing cells
  // (clamped to the band) with a sensible default binding/size.
  function addCellToRow(rowId) {
    const row = elements.find((el) => el.id === rowId);
    if (!row) return;
    const pitch = row.repeatIntervalMm || 5;
    const bandWidthMm = Math.max(5, (template.paperWidthMm ?? 210) - row.x);
    const cells = Array.isArray(row.cells) ? row.cells : [];
    const maxRight = cells.reduce((m, c) => Math.max(m, c.x + c.width), 0);
    const width = 25;
    const newCell = {
      id: uuidv4(),
      x: Math.max(0, Math.min(maxRight, bandWidthMm - width)),
      y: 0,
      width,
      height: Math.min(5, pitch),
      binding: { source: RECEIPT_LINE_ITEM_SOURCES[0].id },
      align: 'left',
    };
    updateElement(rowId, { cells: [...cells, newCell] });
    setSelectedId(newCell.id);
  }

  function deleteSelected() {
    if (selectedCell) {
      updateElements(
        elements.map((el) =>
          el.id === selectedCellRow.id
            ? { ...el, cells: el.cells.filter((c) => c.id !== selectedCell.id) }
            : el,
        ),
      );
      setSelectedId(null);
      return;
    }
    if (selectedElement) {
      updateElements(elements.filter((el) => el.id !== selectedElement.id));
      setSelectedId(null);
    }
  }

  // Keyboard delete for any selection (row, cell, text box, data block). Guarded
  // so it never fires while typing in a field or editing a text box.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target;
      const tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
      if (!selectedElement && !selectedCell) return;
      e.preventDefault();
      deleteSelected();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, elements]); // eslint-disable-line react-hooks/exhaustive-deps

  function setPaperPreset(preset) {
    if (preset === 'Custom') {
      onChange({ paperPreset: 'Custom' });
    } else {
      const dims = PAPER_PRESETS_MM[preset];
      onChange({ paperPreset: preset, paperWidthMm: dims.width, paperHeightMm: dims.height });
    }
  }

  function setElementNumericField(id, field, value) {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) return;
    updateElement(id, { [field]: parsed });
  }

  function setCellNumericField(field, value) {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) return;
    updateCell(selectedCellRow.id, selectedCell.id, { [field]: parsed });
  }

  const showOverlapWarning = totalsOverlapBand(elements, template.paperHeightMm ?? 297);

  return (
    <div className="designer-layout">
      <div className="designer-toolbar">
        <button type="button" className="designer-toolbar__back" onClick={onClose}>
          &larr; Back to templates
        </button>

        <label className="designer-toolbar__field">
          <span>Name</span>
          <input type="text" value={template.name} onChange={(e) => onChange({ name: e.target.value })} />
        </label>

        <label className="designer-toolbar__field">
          <span>Paper</span>
          <select value={template.paperPreset} onChange={(e) => setPaperPreset(e.target.value)}>
            {PAPER_PRESET_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        {template.paperPreset === 'Custom' && (
          <>
            <label className="designer-toolbar__field">
              <span>Width (mm)</span>
              <input
                type="number"
                min="10"
                value={template.paperWidthMm}
                onChange={(e) => onChange({ paperWidthMm: Number(e.target.value) })}
              />
            </label>
            <label className="designer-toolbar__field">
              <span>Height (mm)</span>
              <input
                type="number"
                min="10"
                value={template.paperHeightMm}
                onChange={(e) => onChange({ paperHeightMm: Number(e.target.value) })}
              />
            </label>
          </>
        )}

        <label className="designer-toolbar__field" title="Grid line spacing">
          <span>Grid (mm)</span>
          <input
            type="number"
            min="0.5"
            step="0.5"
            value={gridSpacingMm}
            onChange={(e) => onChange({ gridSpacingMm: Number(e.target.value) })}
          />
        </label>

        <label className="designer-toolbar__field" title="Shifts the grid's origin to align with a pre-printed form">
          <span>Offset X (mm)</span>
          <input
            type="number"
            step="0.5"
            value={gridOffsetXMm}
            onChange={(e) => onChange({ gridOffsetXMm: Number(e.target.value) })}
          />
        </label>

        <label className="designer-toolbar__field">
          <span>Offset Y (mm)</span>
          <input
            type="number"
            step="0.5"
            value={gridOffsetYMm}
            onChange={(e) => onChange({ gridOffsetYMm: Number(e.target.value) })}
          />
        </label>

        <label
          className="designer-toolbar__field designer-toolbar__field--check"
          title="Snap dragging/resizing to the grid. Off = free ~0.1mm positioning for fine alignment to pre-printed forms."
        >
          <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} />
          <span>Snap to grid</span>
        </label>

        <label
          className="designer-toolbar__field"
          title="Print calibration X — shifts ALL elements at print time to align with pre-printed stock (per template). Add a per-device delta from the Receipt preview."
        >
          <span>Cal X (mm)</span>
          <input
            type="number"
            step="0.5"
            value={template.calibrationOffsetXMm ?? 0}
            onChange={(e) => onChange({ calibrationOffsetXMm: Number(e.target.value) })}
          />
        </label>
        <label className="designer-toolbar__field" title="Print calibration Y — shifts ALL elements at print time (per template).">
          <span>Cal Y (mm)</span>
          <input
            type="number"
            step="0.5"
            value={template.calibrationOffsetYMm ?? 0}
            onChange={(e) => onChange({ calibrationOffsetYMm: Number(e.target.value) })}
          />
        </label>

        <div className="designer-toolbar__actions">
          {(selectedElement || selectedCell) && (
            <button type="button" className="designer-toolbar__delete" onClick={deleteSelected}>
              {selectedCell ? 'Delete cell' : 'Delete selected'}
            </button>
          )}

          <button type="button" className="designer-toolbar__preview-print" onClick={() => setPreviewOpen(true)}>
            Preview &amp; Test Print
          </button>
        </div>
      </div>

      {showOverlapWarning && (
        <div className="designer-warning">
          ⚠ A last-page element (totals) overlaps the line-item band region. On a full
          last page it will print over the rows — move the totals below the band, or
          lower Rows / page.
        </div>
      )}

      <div className="designer-body">
        <BlockPalette
          onAddBlock={addBlock}
          onAddTextBox={addTextBox}
          onAddLineItemRow={addLineItemRow}
          onAddField={addField}
          usedBlockTypes={usedBlockTypes}
          hasLineItemRow={hasLineItemRow}
        />

        <DesignerCanvas
          elements={elements}
          paperWidthMm={template.paperWidthMm}
          paperHeightMm={template.paperHeightMm}
          gridSpacingMm={gridSpacingMm}
          gridOffsetXMm={gridOffsetXMm}
          gridOffsetYMm={gridOffsetYMm}
          snapEnabled={snapEnabled}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onUpdate={updateElement}
          onUpdateCell={updateCell}
          onDeselect={() => setSelectedId(null)}
        />

        {(selectedElement || selectedCell) && (
          <div className="designer-inspector">
            {/* Selection-type banner: makes row-vs-cell (and which cell) obvious. */}
            <div
              className={`designer-inspector__kind designer-inspector__kind--${
                selectedCell ? 'cell' : selectedElement?.kind === 'lineItemRow' ? 'row' : 'element'
              }`}
            >
              {selectedCell
                ? `Cell: ${describeBinding(selectedCell.binding)}`
                : selectedElement?.kind === 'lineItemRow'
                ? 'Line item row'
                : selectedElement?.kind === 'text'
                ? 'Text box'
                : selectedElement?.kind === 'field'
                ? `Field: ${describeBinding(selectedElement.binding, 'header')}`
                : `Block: ${BLOCK_LABELS[selectedElement?.blockType] ?? selectedElement?.blockType}`}
            </div>
            {/* ── Cell selected ─────────────────────────────────────────── */}
            {selectedCell && (
              <>
                <h4>Cell position &amp; size (mm)</h4>
                <p className="designer-inspector__hint">Relative to the row's top-left.</p>
                <label className="designer-toolbar__field">
                  <span>X</span>
                  <input type="number" step="0.5" value={selectedCell.x} onChange={(e) => setCellNumericField('x', e.target.value)} />
                </label>
                <label className="designer-toolbar__field">
                  <span>Y</span>
                  <input type="number" step="0.5" value={selectedCell.y} onChange={(e) => setCellNumericField('y', e.target.value)} />
                </label>
                <label className="designer-toolbar__field">
                  <span>Width</span>
                  <input type="number" step="0.5" min={gridSpacingMm} value={selectedCell.width} onChange={(e) => setCellNumericField('width', e.target.value)} />
                </label>
                <label className="designer-toolbar__field">
                  <span>Height</span>
                  <input type="number" step="0.5" min={gridSpacingMm} value={selectedCell.height} onChange={(e) => setCellNumericField('height', e.target.value)} />
                </label>

                <h4>Binding</h4>
                <BindingEditor
                  sources={RECEIPT_LINE_ITEM_SOURCES}
                  binding={selectedCell.binding}
                  onChange={(b) => updateCell(selectedCellRow.id, selectedCell.id, { binding: b })}
                />

                <h4>Text style</h4>
                <label className="designer-toolbar__field">
                  <span>Font family</span>
                  <select
                    value={selectedCell.fontFamily ?? TEXT_DEFAULTS.fontFamily}
                    onChange={(e) => updateCell(selectedCellRow.id, selectedCell.id, { fontFamily: e.target.value })}
                  >
                    {FONT_FAMILY_OPTIONS.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </label>
                <label className="designer-toolbar__field">
                  <span>Font size (pt)</span>
                  <input
                    type="number"
                    min="6"
                    max="36"
                    value={selectedCell.fontSize ?? TEXT_DEFAULTS.fontSize}
                    onChange={(e) => updateCell(selectedCellRow.id, selectedCell.id, { fontSize: Number(e.target.value) })}
                  />
                </label>
                <label className="designer-toolbar__field">
                  <span>Color</span>
                  <input
                    type="color"
                    value={selectedCell.color ?? TEXT_DEFAULTS.color}
                    onChange={(e) => updateCell(selectedCellRow.id, selectedCell.id, { color: e.target.value })}
                  />
                </label>
                <label className="designer-toolbar__field">
                  <span>Alignment</span>
                  <select
                    value={selectedCell.align ?? TEXT_DEFAULTS.align}
                    onChange={(e) => updateCell(selectedCellRow.id, selectedCell.id, { align: e.target.value })}
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </label>
              </>
            )}

            {/* ── Line-item row selected ────────────────────────────────── */}
            {!selectedCell && selectedElement?.kind === 'lineItemRow' && (
              <>
                <h4>Row position &amp; size (mm)</h4>
                <p className="designer-inspector__hint">Click a cell to edit its binding. Width can't go below the cells' extent.</p>
                <label className="designer-toolbar__field">
                  <span>X</span>
                  <input type="number" step="0.5" value={selectedElement.x} onChange={(e) => setElementNumericField(selectedElement.id, 'x', e.target.value)} />
                </label>
                <label className="designer-toolbar__field">
                  <span>Y</span>
                  <input type="number" step="0.5" value={selectedElement.y} onChange={(e) => setElementNumericField(selectedElement.id, 'y', e.target.value)} />
                </label>
                <label className="designer-toolbar__field" title="Resizable on the canvas too. Clamped to the cells' extent.">
                  <span>Width</span>
                  <input
                    type="number"
                    step="0.5"
                    value={selectedElement.width ?? ''}
                    placeholder="auto"
                    onChange={(e) => setElementNumericField(selectedElement.id, 'width', e.target.value)}
                  />
                </label>

                <h4>Repeat</h4>
                <label className="designer-toolbar__field" title="Vertical pitch between successive line items">
                  <span>Interval (mm)</span>
                  <input
                    type="number"
                    step="0.5"
                    min={gridSpacingMm}
                    value={selectedElement.repeatIntervalMm}
                    onChange={(e) => setElementNumericField(selectedElement.id, 'repeatIntervalMm', e.target.value)}
                  />
                </label>
                <label className="designer-toolbar__field" title="Rows per page. Overflow spills to the next page. Blank = fit to the page.">
                  <span>Rows / page</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={selectedElement.maxRows ?? ''}
                    placeholder="fit page"
                    onChange={(e) => {
                      const v = e.target.value;
                      updateElement(selectedElement.id, { maxRows: v === '' ? null : Math.max(1, Number(v)) });
                    }}
                  />
                </label>

                <h4>Cells</h4>
                <button
                  type="button"
                  className="designer-inspector__add-cell"
                  onClick={() => addCellToRow(selectedElement.id)}
                >
                  + Add cell
                </button>
                <p className="designer-inspector__hint">Click a cell on the canvas to edit or delete it.</p>
              </>
            )}

            {/* ── Text / block element selected ─────────────────────────── */}
            {!selectedCell && selectedElement && selectedElement.kind !== 'lineItemRow' && (
              <>
                <h4>Position &amp; size (mm)</h4>
                <label className="designer-toolbar__field">
                  <span>X</span>
                  <input type="number" step="0.5" value={selectedElement.x} onChange={(e) => setElementNumericField(selectedElement.id, 'x', e.target.value)} />
                </label>
                <label className="designer-toolbar__field">
                  <span>Y</span>
                  <input type="number" step="0.5" value={selectedElement.y} onChange={(e) => setElementNumericField(selectedElement.id, 'y', e.target.value)} />
                </label>
                <label className="designer-toolbar__field">
                  <span>Width</span>
                  <input type="number" step="0.5" min={gridSpacingMm} value={selectedElement.width} onChange={(e) => setElementNumericField(selectedElement.id, 'width', e.target.value)} />
                </label>
                <label className="designer-toolbar__field">
                  <span>Height</span>
                  <input type="number" step="0.5" min={gridSpacingMm} value={selectedElement.height} onChange={(e) => setElementNumericField(selectedElement.id, 'height', e.target.value)} />
                </label>

                {selectedElement.kind === 'field' && (
                  <>
                    <h4>Binding</h4>
                    <BindingEditor
                      sources={RECEIPT_HEADER_SOURCES}
                      binding={selectedElement.binding}
                      onChange={(b) => updateElement(selectedElement.id, { binding: b })}
                    />
                    {selectedElement.binding && !selectedElement.binding.composed && selectedElement.binding.source === 'date' && (
                      <label className="designer-toolbar__field" title="How the date value is formatted (the pre-printed 'Date:' label stays on the paper)">
                        <span>Date format</span>
                        <select
                          value={selectedElement.dateFormat ?? 'raw'}
                          onChange={(e) => updateElement(selectedElement.id, { dateFormat: e.target.value })}
                        >
                          {DATE_FORMAT_OPTIONS.map((f) => (
                            <option key={f.id} value={f.id}>{f.label}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </>
                )}

                {(selectedElement.kind === 'text' || selectedElement.kind === 'field') && (
                  <>
                    <h4>Text style</h4>
                    <label className="designer-toolbar__field">
                      <span>Font family</span>
                      <select
                        value={selectedElement.fontFamily ?? TEXT_DEFAULTS.fontFamily}
                        onChange={(e) => updateElement(selectedElement.id, { fontFamily: e.target.value })}
                      >
                        {FONT_FAMILY_OPTIONS.map((f) => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                    </label>
                    <label className="designer-toolbar__field">
                      <span>Font size (pt)</span>
                      <input
                        type="number"
                        min="6"
                        max="36"
                        value={selectedElement.fontSize ?? TEXT_DEFAULTS.fontSize}
                        onChange={(e) => updateElement(selectedElement.id, { fontSize: Number(e.target.value) })}
                      />
                    </label>
                    <label className="designer-toolbar__field">
                      <span>Color</span>
                      <input
                        type="color"
                        value={selectedElement.color ?? TEXT_DEFAULTS.color}
                        onChange={(e) => updateElement(selectedElement.id, { color: e.target.value })}
                      />
                    </label>
                    <label className="designer-toolbar__field">
                      <span>Alignment</span>
                      <select
                        value={selectedElement.align ?? TEXT_DEFAULTS.align}
                        onChange={(e) => updateElement(selectedElement.id, { align: e.target.value })}
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                  </>
                )}

                <h4>Page scope</h4>
                <label className="designer-toolbar__field" title="Which pages this element prints on. Header values default to all pages; totals to the last page.">
                  <span>Show on</span>
                  <select
                    value={resolvePageScope(selectedElement)}
                    onChange={(e) => updateElement(selectedElement.id, { pageScope: e.target.value })}
                  >
                    <option value="all">All pages</option>
                    <option value="first">First page</option>
                    <option value="last">Last page</option>
                  </select>
                </label>
              </>
            )}
          </div>
        )}
      </div>

      {previewOpen && <TemplatePreviewModal template={template} onClose={() => setPreviewOpen(false)} />}
    </div>
  );
}
