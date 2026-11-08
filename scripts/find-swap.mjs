import fs from 'fs';

const code = fs.readFileSync('components/LayoutSection.jsx', 'utf8');

// Find all places where wMenu or hMenu options for "fill" and "fit" are rendered
const matches = [];
let pos = 0;
while ((pos = code.indexOf('setNodeSizing(node.id, axis, { kind:', pos)) !== -1) {
  matches.push(pos);
  pos += 1;
}
console.log('Matches for setNodeSizing in LayoutSection:', matches);

for (const p of matches) {
  console.log('--- Context around', p, '---');
  console.log(code.slice(Math.max(0, p - 200), Math.min(code.length, p + 300)));
}
