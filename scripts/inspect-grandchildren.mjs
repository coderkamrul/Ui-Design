import fs from 'fs';
import { parseHtmlFragment, convertPlainTree, formatNodeForCanvasTool } from '../lib/snapshot-import.js';

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

for (let i = 0; i < Math.min(3, convRoot.childIds.length); i++) {
  const kid = converted.byId.get(convRoot.childIds[i]);
  console.log(`\n================== CHILD ${i}: ${kid.name} (${kid.id}) ==================`);
  console.log(`w: ${kid.w}, h: ${kid.h}, wMode: ${kid.wMode}, hMode: ${kid.hMode}, layout: ${kid.layout?.mode}`);
  console.log(`Number of grandchildren: ${kid.childIds?.length}`);

  for (let j = 0; j < Math.min(10, kid.childIds.length); j++) {
    const g = converted.byId.get(kid.childIds[j]);
    const fg = formatNodeForCanvasTool(g);
    console.log(`  [${j}] ${g.name} (${g.type}): x=${g.x}, y=${g.y}, w=${g.w}, h=${g.h}, wMode=${g.wMode}, hMode=${g.hMode}, layout=${fg.layout?.mode}, borders=${fg.borders?.length || 0}`);
    console.log(`      size:`, fg.size, `position:`, g.position);
    if (g.borders?.length) {
      console.log(`      borders:`, g.borders);
    }
  }
}
