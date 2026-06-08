# UI Standards

## Keyword Search Bar — Global Standard

Used on: Product Catalogue, Sales Ledger, and all future list/table views.

### Behavior
- Single search input field
- User types a keyword and hits Enter to commit it as an active filter tag
- The committed keyword appears as a dismissible tag/chip below or
  inside the search bar
- The input field clears and is immediately ready for the next keyword
- Multiple keywords can be active simultaneously
- The list filters in real time as the user types the next keyword
  (before hitting Enter) — results narrow to match the partial input
  plus all already-committed keywords
- Removing a tag (clicking its X) immediately updates the results
- All active keyword tags are ANDed together — results must match
  all active keywords, not just one

### Visual
- Active keyword tags are clearly visible and dismissible
- The search input sits inline with the tags, growing the tag list
  naturally as keywords are added
- A Clear All option dismisses all active tags at once

### Scope
- Keyword search spans all text-searchable fields relevant to the
  context (e.g. on the Product Catalogue: name, variant name, PID,
  SKU, barcode; on the Sales Ledger: sale PID, cashier name, etc.)
- The searchable fields per context are defined in each page's own
  spec file

### Implementation Notes
- Debounce the real-time filtering at 300ms to avoid excessive API calls
- Active keyword tags persist in the URL query string so the filtered
  state is shareable and survives a page refresh
- On mobile, the tag list wraps gracefully below the input