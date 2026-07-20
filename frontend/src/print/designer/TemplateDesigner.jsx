// TemplateDesigner.jsx
//
// Edits a single template's layout: name, paper size (including custom
// dimensions), grid calibration (spacing + offset, for aligning to
// pre-printed forms), and placed elements. Takes the template object plus
// an onChange callback — the caller (TemplateLibrary) owns persistence.

import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { BlockPalette } from './BlockPalette';
import { DesignerCanvas } from './DesignerCanvas';
import { PAPER_PRESETS_MM } from './useTemplateLibrary';
import './designer.css';
import { TemplatePreviewModal } from './TemplatePreviewModal';

const PAPER_PRESET_OPTIONS = ['A4', 'Letter', 'Legal', 'Custom'];

export function TemplateDesigner({ template, onChange, onClose }) {
  const [selectedId, setSelectedId] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const elements = template.elements || [];
  const usedBlockTypes = elements.filter((el) => el.kind === 'block').map((el) => el.blockType);
  const selectedElement = elements.find((el) => el.id === selectedId);

  const gridSpacingMm = template.gridSpacingMm ?? 5;
  const gridOffsetXMm = template.gridOffsetXMm ?? 0;
  const gridOffsetYMm = template.gridOffsetYMm ?? 0;

  function updateElements(nextElements) {
    onChange({ elements: nextElements });
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
      fontSize: 10,
      align: 'left',
      x: 10,
      y: 10,
      width: 60,
      height: 15,
    };
    updateElements([...elements, newEl]);
    setSelectedId(newEl.id);
  }

  function updateElement(id, patch) {
    updateElements(elements.map((el) => (el.id === id ? { ...el, ...patch } : el)));
  }

  function removeElement(id) {
    updateElements(elements.filter((el) => el.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
  }

  function setPaperPreset(preset) {
    if (preset === 'Custom') {
      onChange({ paperPreset: 'Custom' });
    } else {
      const dims = PAPER_PRESETS_MM[preset];
      onChange({ paperPreset: preset, paperWidthMm: dims.width, paperHeightMm: dims.height });
    }
  }

  function setSelectedNumericField(field, value) {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) return;
    updateElement(selectedElement.id, { [field]: parsed });
  }

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

        <div className="designer-toolbar__actions">
          {selectedElement && (
            <button type="button" className="designer-toolbar__delete" onClick={() => removeElement(selectedElement.id)}>
              Delete selected
            </button>
          )}

          <button type="button" className="designer-toolbar__preview-print" onClick={() => setPreviewOpen(true)}>
            Preview &amp; Test Print
          </button>
        </div>
      </div>

      <div className="designer-body">
        <BlockPalette onAddBlock={addBlock} onAddTextBox={addTextBox} usedBlockTypes={usedBlockTypes} />

        <DesignerCanvas
          elements={elements}
          paperWidthMm={template.paperWidthMm}
          paperHeightMm={template.paperHeightMm}
          gridSpacingMm={gridSpacingMm}
          gridOffsetXMm={gridOffsetXMm}
          gridOffsetYMm={gridOffsetYMm}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onUpdate={updateElement}
          onDeselect={() => setSelectedId(null)}
        />

        {selectedElement && (
          <div className="designer-inspector">
            <h4>Position &amp; size (mm)</h4>
            <label className="designer-toolbar__field">
              <span>X</span>
              <input
                type="number"
                step="0.5"
                value={selectedElement.x}
                onChange={(e) => setSelectedNumericField('x', e.target.value)}
              />
            </label>
            <label className="designer-toolbar__field">
              <span>Y</span>
              <input
                type="number"
                step="0.5"
                value={selectedElement.y}
                onChange={(e) => setSelectedNumericField('y', e.target.value)}
              />
            </label>
            <label className="designer-toolbar__field">
              <span>Width</span>
              <input
                type="number"
                step="0.5"
                min={gridSpacingMm}
                value={selectedElement.width}
                onChange={(e) => setSelectedNumericField('width', e.target.value)}
              />
            </label>
            <label className="designer-toolbar__field">
              <span>Height</span>
              <input
                type="number"
                step="0.5"
                min={gridSpacingMm}
                value={selectedElement.height}
                onChange={(e) => setSelectedNumericField('height', e.target.value)}
              />
            </label>

            {selectedElement.kind === 'text' && (
              <>
                <h4>Text box</h4>
                <label className="designer-toolbar__field">
                  <span>Font size (pt)</span>
                  <input
                    type="number"
                    min="6"
                    max="36"
                    value={selectedElement.fontSize}
                    onChange={(e) => updateElement(selectedElement.id, { fontSize: Number(e.target.value) })}
                  />
                </label>
                <label className="designer-toolbar__field">
                  <span>Alignment</span>
                  <select
                    value={selectedElement.align}
                    onChange={(e) => updateElement(selectedElement.id, { align: e.target.value })}
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
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
