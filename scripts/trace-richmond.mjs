import fs from 'fs';
import { parseHtmlFragment, convertPlainTree, formatNodeForCanvasTool, parseBorders } from '../lib/snapshot-import.js';

let raw = fs.readFileSync('scripts/richmond_auto_raw.html', 'utf8');
const fragStart = raw.indexOf('<x-paper-html>');
const truncIdx = raw.indexOf('<truncated');
if (fragStart !== -1) {
  raw = raw.substring(fragStart, truncIdx !== -1 ? truncIdx : undefined);
}
// Ensure closed tags
raw += '</div></x-paper-html>';

console.log('Processed HTML length:', raw.length);
const roots = parseHtmlFragment(raw);
console.log('Parsed roots count:', roots.length);

if (roots.length > 0) {
  const r0 = roots[0];
  console.log('Root 0 tag:', r0.tag, 'paper-snapshot-original-tag:', r0.attrs?.['paper-snapshot-original-tag']);
  console.log('Root 0 style keys count:', Object.keys(r0.style || {}).length);
  console.log('Root 0 display:', r0.style?.display);
  console.log('Root 0 flex-direction:', r0.style?.['flex-direction']);
  console.log('Root 0 width:', r0.style?.width, 'height:', r0.style?.height);

  const converted = convertPlainTree(roots);
  console.log('\nConverted roots count:', converted.roots.length);
  const convRoot = converted.roots[0];
  const fRoot = formatNodeForCanvasTool(convRoot);
  console.log('ConvRoot:', {
    id: convRoot.id,
    name: convRoot.name,
    w: convRoot.w,
    h: convRoot.h,
    wMode: convRoot.wMode,
    hMode: convRoot.hMode,
    size: fRoot.size,
    layout: fRoot.layout,
    childrenCount: convRoot.childIds?.length
  });

  console.log('\n--- ROOT CHILDREN ---');
  let totalChildHeight = 0;
  for (let i = 0; i < convRoot.childIds.length; i++) {
    const kid = converted.byId.get(convRoot.childIds[i]);
    const fKid = formatNodeForCanvasTool(kid);
    console.log(`\nChild [${i}] ${kid.name} (${kid.tag || kid.type})`);
    console.log({
      id: kid.id,
      x: kid.x, y: kid.y, w: kid.w, h: kid.h,
      wMode: kid.wMode, hMode: kid.hMode,
      size: fKid.size,
      layout: fKid.layout?.mode,
      borders: fKid.borders?.length || fKid.style?.borders?.length || 0,
      margin: fKid.margin || fKid.layout?.margin,
      hasPositionAbsolute: kid.position?.absolute || false
    });
    if (fKid.borders?.length) {
      console.log('  Borders sample:', fKid.borders.slice(0, 3));
    }
  }
}
