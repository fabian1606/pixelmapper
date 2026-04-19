/**
 * Computes the centroid of each mapped SVG element by temporarily rendering
 * the SVG in the DOM and calling getBBox() — reliable for all shape types
 * including <path>, <circle>, <polygon>, etc.
 *
 * Returns normalized [0,1] positions relative to the SVG's viewBox.
 * Elements not found in the SVG are omitted from the result.
 */
export function computeHeadElementCentroids(
  svgData: string,
  headToElementMap: Record<string, string>,
): Record<string, { x: number; y: number }> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgData, 'image/svg+xml');
  const svgEl = doc.documentElement as unknown as SVGSVGElement;

  if (doc.querySelector('parsererror')) return {};

  // Parse viewBox for normalisation
  const vbRaw = svgEl.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const [vbMinX = 0, vbMinY = 0, vbWidth = 500, vbHeight = 500] = vbRaw ?? [];
  if (!vbWidth || !vbHeight) return {};

  // Append an off-screen SVG to get layout-based bboxes.
  const wrapper = document.createElement('div');
  wrapper.style.cssText =
    'position:fixed;top:-9999px;left:-9999px;width:500px;height:500px;visibility:hidden;pointer-events:none;';
  const svgClone = svgEl.cloneNode(true) as SVGSVGElement;
  // Give it explicit size so the browser can compute bboxes
  svgClone.setAttribute('width', '500');
  svgClone.setAttribute('height', '500');
  wrapper.appendChild(svgClone);
  document.body.appendChild(wrapper);

  const result: Record<string, { x: number; y: number }> = {};

  for (const [headKey, elementId] of Object.entries(headToElementMap)) {
    if (!elementId) continue;
    const el = svgClone.getElementById(elementId) as SVGGraphicsElement | null;
    if (!el) continue;
    try {
      const bbox = el.getBBox();
      if (!bbox.width && !bbox.height) continue; // invisible / unmeasurable
      const cx = (bbox.x + bbox.width / 2 - vbMinX) / vbWidth;
      const cy = (bbox.y + bbox.height / 2 - vbMinY) / vbHeight;
      result[headKey] = { x: cx, y: cy };
    } catch {
      // getBBox() can throw for hidden elements — skip
    }
  }

  document.body.removeChild(wrapper);
  return result;
}
