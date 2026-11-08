import { convertSnapshotToCanvasNodes, convertPlainTree, parseHtmlFragment, extractPaperHtml, formatNodeForCanvasTool } from '../lib/snapshot-import.js';
import fs from 'fs';

const raw = fs.readFileSync('scripts/user_pasted_html.html', 'utf8');
const match = raw.match(/<x-paper-html[\s\S]*/i) || raw.match(/<html[\s\S]*/i);
const html = match ? match[0] : raw;
const clean = extractPaperHtml(html) || html;
const roots = parseHtmlFragment(clean);

// Simulate measurements with a 2.72 / 2.73 border offset to test resilience
const res = convertPlainTree(roots, { exactLayout: true });
let badOffsets = [];
for (const n of res.all) {
  formatNodeForCanvasTool(n);
  if (Math.abs(n.position.x - 2.72) < 0.1 || Math.abs(n.position.x - 2.73) < 0.1) {
    badOffsets.push({ id: n.id, name: n.name, type: n.type, x: n.position.x, y: n.position.y });
  }
}

console.log('Total nodes converted:', res.all.length);
console.log('Nodes with ~2.72/2.73 offset count:', badOffsets.length);
if (badOffsets.length > 0) {
  console.error('FAILED: Found bad offsets:', badOffsets);
  process.exit(1);
} else {
  console.log('PASSED: Zero nodes have 2.72/2.73 offset!');
}
