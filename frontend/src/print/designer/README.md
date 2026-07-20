# Layout designer — setup notes

## What changed from the first version

The original version tied one template directly to a tenant + document
type — no name, no list, no way to have more than one design per document
type. That's been replaced with three pieces:

- **`useTemplateLibrary.js`** — named, saved templates. Create, edit,
  duplicate, delete. A template is just a design; it isn't tied to any
  specific trigger point by itself.
- **`useFunctionAssignments.js`** — maps a named "function" (a real trigger
  point in the app, e.g. `salesReceipt`) to whichever saved template is
  currently active for it. `KNOWN_FUNCTIONS` currently has one entry —
  add more here later (e.g. a kitchen ticket) without touching anything else.
- **`useAssignedTemplate.js`** — the one hook an actual print trigger point
  needs: resolves a function key straight to its assigned template.

**`useDocumentTemplate.js` is superseded** — kept in place, marked with a
comment, but nothing new should import it. Nothing else in this folder
references it anymore (`BlockPalette.jsx` now imports block constants from
the new `blockTypes.js` instead).

Paper size is no longer a named preset alone — every template stores
explicit `paperWidthMm` / `paperHeightMm`. "A4" / "Letter" / "Legal" are
just presets that fill those numbers in for convenience; picking "Custom"
lets you type any dimensions directly. The canvas and the eventual print
CSS only ever deal with real mm numbers, never a preset name.

## 1. Install (unchanged)

```bash
npm install react-rnd
```

## 2. File map

```
frontend/src/print/designer/
├── blockTypes.js              shared block constants (NEW)
├── useTemplateLibrary.js      saved templates CRUD (NEW)
├── useFunctionAssignments.js  function → template mapping (NEW)
├── useAssignedTemplate.js     lookup helper for real print triggers (NEW)
├── TemplateLibrary.jsx        top-level list/create/edit screen (NEW)
├── FunctionAssignmentPanel.jsx assignment screen (NEW)
├── TemplateDesigner.jsx       edits ONE template (rewritten — new props)
├── DesignerCanvas.jsx         canvas (rewritten — takes explicit mm dims)
├── BlockPalette.jsx           unchanged except import path
├── TemplateRenderer.jsx       unchanged — still renders a template + real data
├── designer.css               extended with library/assignment styles
├── useDocumentTemplate.js     SUPERSEDED — kept, not deleted, unused
└── README.md
```

## 3. Entry point

Mount `TemplateLibrary`, not `TemplateDesigner` directly — the library is
the top-level screen; it opens `TemplateDesigner` itself when you click
Edit or create a new template.

```jsx
import { TemplateLibrary } from './print/designer/TemplateLibrary';

<TemplateLibrary tenantId={tenantId} />
```

Somewhere nearby (a tab, a second screen), also mount:

```jsx
import { FunctionAssignmentPanel } from './print/designer/FunctionAssignmentPanel';

<FunctionAssignmentPanel tenantId={tenantId} />
```

This is where you decide which saved template is currently used for
"Sales Receipt."

## 4. Migrating the existing test route

`PrintDesignerDev.tsx` currently renders the old
`<TemplateDesigner tenantId={...} docType="invoice" />` directly. Update it
to render `<TemplateLibrary tenantId={tenantId} />` instead — that's the new
entry point. Any test data saved earlier under the old
`template:{tenantId}:{docType}` key is now orphaned (harmless, just
unused) — this was only test data from the click-through session, nothing
real is at risk.

## 5. Using the assigned template at actual print time

> Note: this is the intended integration pattern for when real sales data
> is wired in — not yet done (see section 6). Right now, "Preview & Test
> Print" using sampleData.js is the only way to test actual print output.

```jsx
import { useAssignedTemplate } from '../print/designer/useAssignedTemplate';
import { TemplateRenderer } from '../print/designer/TemplateRenderer';
import { PrintPreview } from '../print/PrintPreview';

const { template, loaded } = useAssignedTemplate(tenantId, 'salesReceipt');

if (!loaded) return <div>Loading…</div>;
if (!template) return <div>No receipt template assigned yet.</div>;

<PrintPreview
  settings={{
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    fontSize: 10,
    paperSize: `${template.paperWidthMm}mm ${template.paperHeightMm}mm`,
  }}
  documentTitle={`Receipt-${sale.id}`}
>
  <TemplateRenderer template={template} data={saleData} />
</PrintPreview>
```

`saleData` needs to match the shape `TemplateRenderer.jsx`'s
`renderBlockContent` expects — this still needs real field names from your
actual sales data, which is a separate discovery step, not something to
guess at here.

## 6. Still not handled

- No real sales data wired in yet — everything printable is placeholder
  sample data via "Preview & Test Print".
- No "Print Receipt" button in the real Sales/POS screens yet.
- No payment-info block (method, amount tendered, change due).
- Fixed-height line-items table doesn't handle variable-length real data
  (overflow/multi-page not solved).
- Deliberately deferred: undo/redo, hard duplicate-block prevention,
  silent/direct-to-printer printing, PDF generation, kitchen
  ticket/restaurant document type.
