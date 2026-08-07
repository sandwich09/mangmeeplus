import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planDocumentRaster } from './document-raster.logic';
import { A4_USABLE_WIDTH_PT } from './image-pdf.logic';

describe('planDocumentRaster', () => {
  it('renders a vector form full-page at print resolution', () => {
    // The claim form is an 850-wide SVG: no fixed resolution, so it should fill the page crisply.
    const plan = planDocumentRaster({ naturalWidth: 850, naturalHeight: 1202, vector: true });
    assert.ok(Math.abs(plan.maxDrawWidthPt - A4_USABLE_WIDTH_PT) < 0.5, 'fills the usable page width');
    assert.ok(plan.effectiveDpi >= 290, `expected ~300 DPI, got ${plan.effectiveDpi}`);
    assert.ok(plan.rasterScale > 2, 'renders the vector well beyond its CSS size');
  });

  it('draws a low-resolution receipt smaller instead of stretching it soft', () => {
    // 470px across a 7.6in page is 62 DPI — the blur users see. Cap the draw width instead.
    const plan = planDocumentRaster({ naturalWidth: 470, naturalHeight: 349, vector: false });
    assert.ok(plan.maxDrawWidthPt < A4_USABLE_WIDTH_PT, 'does not fill the page');
    assert.ok(Math.abs(plan.maxDrawWidthPt - (470 / 150) * 72) < 0.5, 'capped at 150 DPI of the source');
    assert.ok(plan.effectiveDpi >= 290, `expected ~300 DPI, got ${plan.effectiveDpi}`);
  });

  it('keeps a phone photo inside the canvas limits mobile browsers enforce', () => {
    // 3024x4032 at a blind 2x is 48M pixels — over iOS Safari's ceiling, where the canvas comes
    // back blank and the download silently produces a white page.
    const plan = planDocumentRaster({ naturalWidth: 3024, naturalHeight: 4032, vector: false });
    assert.ok(plan.canvasWidth * plan.canvasHeight <= 12_000_000, 'within the pixel budget');
    assert.ok(Math.max(plan.canvasWidth, plan.canvasHeight) <= 4096, 'within the per-edge budget');
    assert.ok(plan.rasterScale <= 1, 'a photo that already exceeds print resolution is not enlarged');
  });

  it('never shrinks a source below its own pixels', () => {
    const plan = planDocumentRaster({ naturalWidth: 2480, naturalHeight: 3508, vector: false });
    assert.ok(plan.rasterScale >= 1 || plan.canvasWidth <= 2480, 'scale only reduces to respect canvas limits');
    assert.ok(plan.canvasWidth > 0 && plan.canvasHeight > 0);
  });

  it('survives a source with no intrinsic size', () => {
    const plan = planDocumentRaster({ naturalWidth: 0, naturalHeight: 0, vector: true });
    assert.ok(Number.isFinite(plan.rasterScale) && plan.canvasWidth >= 1 && plan.canvasHeight >= 1);
  });
});
