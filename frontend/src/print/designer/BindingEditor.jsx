// BindingEditor.jsx
//
// Shared single/composed binding editor for a positioned value cell. Fed the
// ordered source list for the cell's scope — RECEIPT_LINE_ITEM_SOURCES for
// line-item row cells, RECEIPT_HEADER_SOURCES for header field cells — so the
// exact same UI drives both. `binding` is { source } | { composed:{sources[],
// separator} }; calls onChange(nextBinding) with the whole binding object.

export function BindingEditor({ sources, binding, onChange }) {
  const mode = binding && binding.composed ? 'composed' : 'single';
  const first = sources[0] ? sources[0].id : '';
  const composedSources = (binding && binding.composed && binding.composed.sources) || [];

  function setMode(m) {
    if (m === 'composed') onChange({ composed: { sources: [first], separator: ' ' } });
    else onChange({ source: first });
  }
  function patchComposed(patch) {
    const composed = (binding && binding.composed) || { sources: [], separator: ' ' };
    onChange({ composed: { ...composed, ...patch } });
  }

  return (
    <>
      <label className="designer-toolbar__field">
        <span>Type</span>
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="single">Single field</option>
          <option value="composed">Composed</option>
        </select>
      </label>

      {mode === 'single' ? (
        <label className="designer-toolbar__field">
          <span>Field</span>
          <select
            value={(binding && binding.source) ?? ''}
            onChange={(e) => onChange({ source: e.target.value })}
          >
            {sources.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
      ) : (
        <div className="designer-binding-editor">
          {composedSources.map((sid, idx) => (
            <div key={idx} className="designer-binding-editor__row">
              <select
                value={sid}
                onChange={(e) => {
                  const arr = [...composedSources];
                  arr[idx] = e.target.value;
                  patchComposed({ sources: arr });
                }}
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => patchComposed({ sources: composedSources.filter((_, i) => i !== idx) })}
                title="Remove field"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="designer-binding-editor__add"
            onClick={() => patchComposed({ sources: [...composedSources, first] })}
          >
            + field
          </button>
          <label className="designer-toolbar__field">
            <span>Separator</span>
            <input
              type="text"
              value={(binding && binding.composed && binding.composed.separator) ?? ' '}
              onChange={(e) => patchComposed({ separator: e.target.value })}
            />
          </label>
        </div>
      )}
    </>
  );
}
