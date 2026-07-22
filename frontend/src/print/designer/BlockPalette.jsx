// BlockPalette.jsx
//
// The sidebar list of things you can add to the canvas: the fixed set of
// data blocks (one of each makes sense per document), plus free-text boxes
// (unlimited, since each one is independent custom text).

import { AVAILABLE_BLOCKS, BLOCK_LABELS } from './blockTypes';
import './designer.css';

export function BlockPalette({ onAddBlock, onAddTextBox, onAddLineItemRow, onAddField, usedBlockTypes = [], hasLineItemRow = false }) {
  return (
    <div className="designer-palette">
      <h4>Data blocks</h4>
      {AVAILABLE_BLOCKS.map((blockType) => {
        const alreadyUsed = usedBlockTypes.includes(blockType);
        return (
          <button
            key={blockType}
            type="button"
            className="designer-palette__item"
            disabled={alreadyUsed}
            onClick={() => onAddBlock(blockType)}
            title={alreadyUsed ? 'Already placed on the page' : `Add ${BLOCK_LABELS[blockType]}`}
          >
            {BLOCK_LABELS[blockType]}
          </button>
        );
      })}

      <h4>Line items</h4>
      <button
        type="button"
        className="designer-palette__item"
        disabled={hasLineItemRow}
        onClick={onAddLineItemRow}
        title={hasLineItemRow ? 'Already placed on the page' : 'Add the repeating line-item row'}
      >
        + Line item row
      </button>

      <h4>Fields</h4>
      <button
        type="button"
        className="designer-palette__item"
        onClick={onAddField}
        title="Add a positioned header value cell (date, customer, receipt no, totals…)"
      >
        + Field
      </button>

      <h4>Custom</h4>
      <button type="button" className="designer-palette__item designer-palette__item--accent" onClick={onAddTextBox}>
        + Add text box
      </button>
    </div>
  );
}
