import fs from 'fs';

const code = fs.readFileSync('components/CanvasNode.jsx', 'utf8');

// Find text wrapping and sizing logic
const textMatches = [];
let pos = 0;
while ((pos = code.indexOf('node.type === "text"', pos)) !== -1) {
  textMatches.push(pos);
  pos += 1;
}
console.log('Matches for text node:', textMatches);

for (const p of textMatches) {
  console.log('--- Context at', p, '---');
  console.log(code.slice(Math.max(0, p - 100), Math.min(code.length, p + 500)));
}
