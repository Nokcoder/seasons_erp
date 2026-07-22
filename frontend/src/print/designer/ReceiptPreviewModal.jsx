// ReceiptPreviewModal.jsx
//
// Phase 3 preview/print UI for a real sale's receipt. Fetches the Phase-1
// receipt-data, resolves the tenant's assigned template (or the built-in
// default), adapts receipt-data -> TemplateRenderer data through the generic
// column-composition path, and renders it in PrintPreview (react-to-print) so a
// cashier can confirm before printing.
//
// Phase 3 only: NOT wired into Workstation/SaleDetail — that is Phase 4.

import { useState, useEffect } from 'react';
import { PrintPreview } from '../PrintPreview';
import { TemplateRenderer } from './TemplateRenderer';
import { useResolvedReceiptTemplate } from './useReceiptSettings';
import { receiptDataToTemplateData } from './receiptAdapter';
import { salesApi } from '../../services/api';
import { getStore } from '../../lib/platformStore';
import './designer.css';

// Per-terminal print calibration is device-local, in the same store file as the
// other print settings, keyed per tenant.
const CAL_STORE_FILE = 'print-settings.json';
const calKey = (tid) => `printCalibration:${tid}`;

export function ReceiptPreviewModal({ saleId, tenantId, autoPrint = false, onClose }) {
  const { template, loaded: templateLoaded, isBuiltinDefault } = useResolvedReceiptTemplate(tenantId);
  const [receiptData, setReceiptData] = useState(null);
  const [error, setError] = useState('');
  const [loadingData, setLoadingData] = useState(true);
  const [cal, setCal] = useState({ x: 0, y: 0 });
  const [calLoaded, setCalLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingData(true);
    setError('');
    salesApi
      .receiptData(saleId)
      .then((d) => { if (!cancelled) { setReceiptData(d); setLoadingData(false); } })
      .catch((e) => { if (!cancelled) { setError(e?.message || 'Failed to load receipt data'); setLoadingData(false); } });
    return () => { cancelled = true; };
  }, [saleId]);

  // Per-terminal calibration (device-local), added to the template's own offset.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = await getStore(CAL_STORE_FILE);
      const saved = await store.get(calKey(tenantId));
      if (!cancelled) {
        setCal(saved && typeof saved.x === 'number' && typeof saved.y === 'number' ? saved : { x: 0, y: 0 });
        setCalLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  function updateCal(patch) {
    const next = { ...cal, ...patch };
    setCal(next);
    (async () => {
      const store = await getStore(CAL_STORE_FILE);
      await store.set(calKey(tenantId), next);
      await store.save();
    })();
  }

  const ready = templateLoaded && !loadingData && receiptData && template && calLoaded;
  const settings = template
    ? {
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        fontSize: 10,
        paperSize: `${template.paperWidthMm}mm ${template.paperHeightMm}mm`,
      }
    : null;
  const data = ready ? receiptDataToTemplateData(receiptData) : null;

  return (
    <div className="template-preview-modal">
      <div className="template-preview-modal__bar">
        <span>
          Receipt preview
          {isBuiltinDefault ? ' (default template)' : template ? ` — ${template.name}` : ''}
        </span>
        <div
          className="receipt-cal"
          title="Per-device print calibration — nudge to align with this printer's feed. Added to the template's offset and saved for this device."
        >
          <span>Device cal (mm)</span>
          <label>X<input type="number" step="0.5" value={cal.x} onChange={(e) => updateCal({ x: Number(e.target.value) })} /></label>
          <label>Y<input type="number" step="0.5" value={cal.y} onChange={(e) => updateCal({ y: Number(e.target.value) })} /></label>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      <div className="template-preview-modal__body">
        {error ? (
          <div className="designer-loading">{error}</div>
        ) : !ready ? (
          <div className="designer-loading">Loading receipt…</div>
        ) : (
          <PrintPreview
            settings={settings}
            documentTitle={`receipt-${receiptData.header.salePid || saleId}`}
            autoPrint={autoPrint}
            onAfterPrint={autoPrint ? onClose : undefined}
          >
            <TemplateRenderer template={template} data={data} calibration={cal} />
          </PrintPreview>
        )}
      </div>
    </div>
  );
}
