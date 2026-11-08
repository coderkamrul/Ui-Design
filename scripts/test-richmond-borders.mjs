import fs from 'fs';
import { parseHtmlFragment, convertPlainTree, formatNodeForCanvasTool, parseBorders } from '../lib/snapshot-import.js';

let raw = fs.readFileSync('scripts/richmond_auto_raw.html', 'utf8');
const fragStart = raw.indexOf('<x-paper-html>');
const truncIdx = raw.indexOf('<truncated');
if (fragStart !== -1) {
  raw = raw.substring(fragStart, truncIdx !== -1 ? truncIdx : undefined);
}
raw += '</div></x-paper-html>';

const roots = parseHtmlFragment(raw);
const converted = convertPlainTree(roots);

let totalWithBorders = 0;
let borderSamples = [];

for (const [id, node] of converted.byId.entries()) {
  const f = formatNodeForCanvasTool(node);
  const bList = f.borders || f.style?.borders || [];
  if (bList.length > 0) {
    totalWithBorders++;
    if (borderSamples.length < 15) {
      borderSamples.push({
        id,
        name: node.name,
        tag: node.tag,
        borders: bList.map(b => ({ side: b.side, width: b.width, style: b.style, color: b.color })),
        rawBorderProps: {
          border: node.rawStyle?.border,
          borderStyle: node.rawStyle?.['border-style'],
          borderColor: node.rawStyle?.['border-color'],
          borderWidth: node.rawStyle?.['border-width'],
          borderTopWidth: node.rawStyle?.['border-top-width'],
          borderBottomWidth: node.rawStyle?.['border-bottom-width']
        }
      });
    }
  }
}

console.log(`Total nodes in converted: ${converted.byId.size}`);
console.log(`Total nodes with borders: ${totalWithBorders}`);
console.log('Sample nodes with borders:');
console.log(JSON.stringify(borderSamples, null, 2));
