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

function findElementByTag(tag, predicate) {
  for (const [id, node] of converted.byId.entries()) {
    if ((node.tag === tag || node.attrs?.['paper-snapshot-original-tag'] === tag) && (!predicate || predicate(node))) {
      return node;
    }
  }
  return null;
}

const bodyNode = converted.roots[0];
const sectionNode = converted.byId.get(bodyNode.childIds[1]);
const innerDiv = converted.byId.get(sectionNode?.childIds[0]);
const gridOrFlexRow = converted.byId.get(innerDiv?.childIds[0]);

console.log('--- REPRESENTATIVE ELEMENT TRACE ---');
console.log('1. BODY (Root):', {
  id: bodyNode.id,
  tag: bodyNode.tag,
  w: bodyNode.w,
  h: bodyNode.h,
  wMode: bodyNode.wMode,
  hMode: bodyNode.hMode,
  layout: bodyNode.layout
});

console.log('2. SECTION (Child 1):', {
  id: sectionNode?.id,
  tag: sectionNode?.tag,
  w: sectionNode?.w,
  h: sectionNode?.h,
  wMode: sectionNode?.wMode,
  hMode: sectionNode?.hMode,
  layout: sectionNode?.layout
});

console.log('3. INNER WRAPPER (Grandchild 0):', {
  id: innerDiv?.id,
  tag: innerDiv?.tag,
  w: innerDiv?.w,
  h: innerDiv?.h,
  wMode: innerDiv?.wMode,
  hMode: innerDiv?.hMode,
  layout: innerDiv?.layout
});

console.log('4. ROW (Great-grandchild 0):', {
  id: gridOrFlexRow?.id,
  tag: gridOrFlexRow?.tag,
  w: gridOrFlexRow?.w,
  h: gridOrFlexRow?.h,
  wMode: gridOrFlexRow?.wMode,
  hMode: gridOrFlexRow?.hMode,
  layout: gridOrFlexRow?.layout
});
