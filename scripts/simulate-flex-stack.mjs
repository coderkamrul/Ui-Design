import fs from 'fs';
import { parseHtmlFragment, convertPlainTree, formatNodeForCanvasTool } from '../lib/snapshot-import.js';
import { flexChildStyle } from '../lib/flex.js';

let raw = fs.readFileSync('scripts/richmond_auto_raw.html', 'utf8');
const fragStart = raw.indexOf('<x-paper-html>');
const truncIdx = raw.indexOf('<truncated');
if (fragStart !== -1) {
  raw = raw.substring(fragStart, truncIdx !== -1 ? truncIdx : undefined);
}
raw += '</div></x-paper-html>';

const roots = parseHtmlFragment(raw);
const converted = convertPlainTree(roots);
const convRoot = converted.roots[0];
const fRoot = formatNodeForCanvasTool(convRoot);

console.log('ROOT LAYOUT:', fRoot.layout);

let simulatedStackY = 0;
for (let i = 0; i < convRoot.childIds.length; i++) {
  const kid = converted.byId.get(convRoot.childIds[i]);
  const fKid = formatNodeForCanvasTool(kid);
  const flexStyle = flexChildStyle(fKid, fRoot.layout, {});
  
  // Calculate internal content height of this section
  let maxChildBottom = 0;
  for (const cid of (kid.childIds || [])) {
    const c = converted.byId.get(cid);
    const fc = formatNodeForCanvasTool(c);
    maxChildBottom = Math.max(maxChildBottom, (c.y || 0) + (c.h || 0));
  }
  
  console.log(`\nSection [${i}] ${kid.name}:`);
  console.log(`  flexStyle:`, flexStyle);
  console.log(`  declared size.h:`, fKid.size.h);
  console.log(`  actual children bottom: ${maxChildBottom}px`);
  console.log(`  allocated height in flex column: ${flexStyle.flex === '0 0 auto' ? (fKid.size.h.kind === 'fixed' ? fKid.size.h.px : 'fit-content -> 100px') : 'unknown'}`);
}
