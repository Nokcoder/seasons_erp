# Print module — setup notes

## 1. Install the one new dependency

```bash
npm install react-to-print
```

`@tauri-apps/plugin-store` should already be installed from the earlier desktop
setup (used here for auth/session storage too) — this module reuses it, no
new Tauri plugin needed.

## 2. Copy files into your project

Drop these into wherever your print-related components live, e.g. `src/print/`:

- `print.css`
- `useLayoutSettings.js`
- `LayoutSettingsPanel.jsx` + `LayoutSettingsPanel.css`
- `PrintPreview.jsx`
- `ExampleInvoicePrint.jsx` — reference only, adapt per document type

## 3. Tauri config — confirm store permissions

You likely already added `tauri-plugin-store` for auth. Double check your
`src-tauri/capabilities/default.json` includes its permissions — the store
plugin's exact permission identifiers have shifted a little between Tauri v2
minor releases, so rather than me hand you a string that might be stale,
check what `tauri-plugin-store` generated for you under
`src-tauri/gen/schemas/` or the plugin's own docs, and confirm it's included
in your capabilities file. It typically looks like:

```json
{
  "identifier": "default",
  "permissions": [
    "store:default"
  ]
}
```

No new plugin registration is needed in `src-tauri/src/lib.rs` beyond what
you already added for the store plugin.

## 4. How it fits together

- **`useLayoutSettings(tenantId, docType, columnDefs)`** — loads/saves layout
  preferences (margins, font size, paper size, header/footer/logo toggles,
  column visibility) to a per-tenant, per-document-type key in
  `print-settings.json` via the store plugin. Debounced writes so dragging a
  margin field doesn't hammer disk I/O.
- **`LayoutSettingsPanel`** — the controls. Plain and functional on purpose —
  this is an internal tool for adjusting print output, not a customer-facing
  surface.
- **`PrintPreview`** — takes the settings + your document JSX as children,
  shows an on-screen "paper" preview, and triggers the native print dialog
  via `react-to-print` when the user clicks Print. `window.print()` under the
  hood works correctly inside Tauri's webview on both Windows (WebView2) and
  macOS (WKWebView) — no extra plugin required for this scope.
- **Per-document templates** (see `ExampleInvoicePrint.jsx`) — each document
  type (invoice, receipt, delivery note, etc.) gets its own small component
  that defines its columns and lays out its content inside `<PrintPreview>`.
  Boolean toggles (logo/header/footer/columns) are handled by conditional
  rendering in JSX rather than CSS — more reliable in React than trying to
  drive `display: none` per field through CSS variables. Margins/font
  size/paper size are the only things driven by CSS variables, since those
  are inherently layout/visual concerns.

## 5. Explicitly out of scope for this pass

- Silent/direct-to-printer output (needed for thermal receipt/label
  printers) — would require a Tauri Rust plugin talking to OS print APIs
  directly, bypassing the print dialog.
- PDF generation for pixel-consistent output across machines.

Both are additive later if a tenant needs them — not required to ship this.
