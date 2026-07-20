// LayoutSettingsPanel.jsx
//
// Controls for the layout settings produced by useLayoutSettings.
// Uses a small internal <ToggleRow> for boolean settings instead of raw
// checkboxes — same underlying <input type="checkbox"> for accessibility,
// styled as a switch.

import './LayoutSettingsPanel.css';

const PAPER_SIZES = ['A4', 'Letter', 'Legal'];

function ToggleRow({ label, checked, onChange }) {
  return (
    <label className="toggle-row">
      <span className="toggle-row__label">{label}</span>
      <span className="toggle">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-track">
          <span className="toggle-thumb" />
        </span>
      </span>
    </label>
  );
}

export function LayoutSettingsPanel({ settings, onUpdate, onUpdateColumn, onReset, columnDefs = [] }) {
  const setMargin = (side, value) => {
    const parsed = Number(value);
    if (Number.isNaN(parsed) || parsed < 0) return;
    onUpdate({ margin: { ...settings.margin, [side]: parsed } });
  };

  return (
    <div className="layout-settings-panel">
      <div className="layout-settings-panel__header">
        <h3>Layout</h3>
        <button type="button" className="layout-settings-panel__reset" onClick={onReset}>
          Reset to default
        </button>
      </div>

      <section className="layout-settings-panel__section">
        <h4>Margins (mm)</h4>
        <div className="layout-settings-panel__margin-grid">
          {['top', 'right', 'bottom', 'left'].map((side) => (
            <label key={side} className="layout-settings-panel__field">
              <span>{side}</span>
              <input
                type="number"
                min="0"
                value={settings.margin[side]}
                onChange={(e) => setMargin(side, e.target.value)}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="layout-settings-panel__section">
        <h4>Text & paper</h4>
        <label className="layout-settings-panel__field">
          <span>Font size (pt)</span>
          <input
            type="number"
            min="6"
            max="24"
            value={settings.fontSize}
            onChange={(e) => onUpdate({ fontSize: Number(e.target.value) })}
          />
        </label>
        <label className="layout-settings-panel__field">
          <span>Paper size</span>
          <select value={settings.paperSize} onChange={(e) => onUpdate({ paperSize: e.target.value })}>
            {PAPER_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="layout-settings-panel__section">
        <h4>Sections</h4>
        <ToggleRow
          label="Show logo"
          checked={settings.showLogo}
          onChange={(checked) => onUpdate({ showLogo: checked })}
        />
        <ToggleRow
          label="Show header text"
          checked={settings.showHeader}
          onChange={(checked) => onUpdate({ showHeader: checked })}
        />
        {settings.showHeader && (
          <input
            type="text"
            className="layout-settings-panel__text-input"
            placeholder="Header text"
            value={settings.headerText}
            onChange={(e) => onUpdate({ headerText: e.target.value })}
          />
        )}
        <ToggleRow
          label="Show footer text"
          checked={settings.showFooter}
          onChange={(checked) => onUpdate({ showFooter: checked })}
        />
        {settings.showFooter && (
          <input
            type="text"
            className="layout-settings-panel__text-input"
            placeholder="Footer text"
            value={settings.footerText}
            onChange={(e) => onUpdate({ footerText: e.target.value })}
          />
        )}
      </section>

      {columnDefs.length > 0 && (
        <section className="layout-settings-panel__section">
          <h4>Columns</h4>
          {columnDefs.map((col) => (
            <ToggleRow
              key={col.key}
              label={col.label}
              checked={settings.columns[col.key] ?? true}
              onChange={(checked) => onUpdateColumn(col.key, checked)}
            />
          ))}
        </section>
      )}
    </div>
  );
}
