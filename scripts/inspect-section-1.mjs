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

function printTree(nodeId, indent = 0) {
  const node = converted.byId.get(nodeId);
  if (!node) return;
  const f = formatNodeForCanvasTool(node);
  const pad = '  '.repeat(indent);
  console.log(`${pad}[${node.type}:${node.name}] id=${node.id} x=${node.x} y=${node.y} w=${node.w} h=${node.h} wMode=${node.wMode} hMode=${node.hMode} layout=${f.layout?.mode || 'none'}`);
  for (const cid of (node.childIds || [])) {
    printTree(cid, indent + 1);
  }
}

console.log('=== TREE OF SECTION 1 ===');
printTree(convRoot.childIds[1], 0);
