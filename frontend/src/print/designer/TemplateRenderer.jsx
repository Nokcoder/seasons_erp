// TemplateRenderer.jsx
//
// Takes a saved template (same shape TemplateDesigner produces: an array of
// positioned elements in mm) plus real document data, and renders the final
// print-ready layout using absolute positioning — the same coordinates the
// designer showed, now filled with real content instead of placeholders.
//
// Use this as the children of PrintPreview (see print/PrintPreview.jsx):
//   <PrintPreview settings={minimalSettings}>
//     <TemplateRenderer template={savedTemplate} data={invoiceData} />
//   </PrintPreview>
//
// `data` shape is yours to define per document type — adapt the cases in
// renderBlockContent below to your actual field names. The shape assumed
// here: { logoUrl, companyName, companyAddress, customerName,
// customerAddress, documentNumber, documentDate, columns, lineItems,
// subtotal, tax, total }

function renderBlockContent(blockType, data) {
  switch (blockType) {
    case 'logo':
      return data.logoUrl ? (
        <img src={data.logoUrl} alt="Company logo" style={{ maxWidth: '100%', maxHeight: '100%' }} />
      ) : null;

    case 'companyInfo':
      return (
        <div>
          <div>{data.companyName}</div>
          <div>{data.companyAddress}</div>
        </div>
      );

    case 'customerInfo':
      return (
        <div>
          <div>{data.customerName}</div>
          <div>{data.customerAddress}</div>
        </div>
      );

    case 'documentMeta':
      return (
        <div>
          <div>No. {data.documentNumber}</div>
          <div>{data.documentDate}</div>
        </div>
      );

    case 'lineItemsTable':
      return (
        <table className="print-table">
          <thead>
            <tr>
              {(data.columns || []).map((col) => (
                <th key={col.key}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data.lineItems || []).map((item) => (
              <tr key={item.id}>
                {(data.columns || []).map((col) => (
                  <td key={col.key}>{item[col.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );

    case 'totals':
      return (
        <div>
          <div>Subtotal: {data.subtotal}</div>
          <div>Tax: {data.tax}</div>
          <div>
            <strong>Total: {data.total}</strong>
          </div>
        </div>
      );

    default:
      return null;
  }
}

export function TemplateRenderer({ template, data }) {
  const { elements = [] } = template || {};

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {elements.map((el) => (
        <div
          key={el.id}
          style={{
            position: 'absolute',
            left: `${el.x}mm`,
            top: `${el.y}mm`,
            width: `${el.width}mm`,
            height: `${el.height}mm`,
            overflow: 'hidden',
            fontSize: el.kind === 'text' ? `${el.fontSize}pt` : undefined,
            textAlign: el.kind === 'text' ? el.align : undefined,
          }}
        >
          {el.kind === 'text' ? el.content : renderBlockContent(el.blockType, data)}
        </div>
      ))}
    </div>
  );
}
