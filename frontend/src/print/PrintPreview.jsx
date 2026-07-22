// PrintPreview.jsx
//
// Wraps document content, applies layout settings as CSS variables for the
// screen preview + actual print output, and triggers the native OS print
// dialog via react-to-print (window.print() under the hood — Tauri's webview
// opens the native dialog on both WebView2 and WKWebView, no extra plugin
// needed for this).
//
// Requires: npm install react-to-print

import { useRef, useEffect } from 'react';
import { useReactToPrint } from 'react-to-print';
import './print.css';

export function PrintPreview({ settings, documentTitle = 'document', autoPrint = false, onAfterPrint, children }) {
  const printRef = useRef(null);
  const autoFiredRef = useRef(false);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle,
    onAfterPrint,
  });

  // Auto-print path: fire the native print dialog once, as soon as the content
  // is mounted, without waiting for a manual click. Guarded so it fires exactly
  // once even across re-renders.
  useEffect(() => {
    if (autoPrint && !autoFiredRef.current && printRef.current) {
      autoFiredRef.current = true;
      handlePrint();
    }
  }, [autoPrint, handlePrint]);

  const cssVars = {
    '--print-margin-top': `${settings.margin.top}mm`,
    '--print-margin-right': `${settings.margin.right}mm`,
    '--print-margin-bottom': `${settings.margin.bottom}mm`,
    '--print-margin-left': `${settings.margin.left}mm`,
    '--print-font-size': `${settings.fontSize}pt`,
    '--print-paper-size': settings.paperSize,
  };

  return (
    <div>
      <div className="print-preview-toolbar">
        <button type="button" className="print-preview-toolbar__print-btn" onClick={handlePrint}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" />
          </svg>
          Print
        </button>
      </div>

      <div className="print-preview-canvas" style={cssVars}>
        <div ref={printRef} className="print-portal">
          <div className="print-root">{children}</div>
        </div>
      </div>
    </div>
  );
}
