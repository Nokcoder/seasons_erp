// TemplatePreviewModal.jsx
import { PrintPreview } from '../PrintPreview';
import { TemplateRenderer } from './TemplateRenderer';
import { getSampleData } from './sampleData';
import './designer.css';

export function TemplatePreviewModal({ template, onClose }) {
  const settings = {
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    fontSize: 10,
    paperSize: `${template.paperWidthMm}mm ${template.paperHeightMm}mm`,
  };
  const sampleData = getSampleData(template.docType);

  return (
    <div className="template-preview-modal">
      <div className="template-preview-modal__bar">
        <span>Previewing &ldquo;{template.name}&rdquo; with sample data</span>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="template-preview-modal__body">
        <PrintPreview settings={settings} documentTitle={`${template.name}-sample`}>
          <TemplateRenderer template={template} data={sampleData} />
        </PrintPreview>
      </div>
    </div>
  );
}
