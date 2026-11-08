import { convertSnapshotToCanvasNodes, parseBorders } from '../lib/snapshot-import.js';

console.log('=== 1. Checking parseBorders on various styles ===');
console.log('Empty style:', parseBorders({}));
console.log('Tailwind reset style (border-style: solid, but no width):', parseBorders({ 'border-style': 'solid' }));
console.log('Zero width:', parseBorders({ 'border-width': '0px', 'border-style': 'solid' }));
console.log('Explicit 1px border:', parseBorders({ 'border': '1px solid #ff0000' }));
console.log('Button user-agent style simulation:', parseBorders({ 'border-width': '2px', 'border-style': 'outset', 'border-color': 'rgb(118, 118, 118)' }));

console.log('\n=== 2. Checking HTML conversion of Button with nested icon & text ===');
const buttonHtml = `
<button style="display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; background-color: rgb(37, 99, 235); color: white; border-radius: 6px;">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect width="24" height="24" fill="none" />
    <path d="M5 12h14" />
  </svg>
  <span>Submit Button</span>
</button>
`;

convertSnapshotToCanvasNodes(buttonHtml, { measure: false }).then((res) => {
  console.log(`Imported ${res.all.length} nodes:`);
  for (const n of res.all) {
    console.log(`- [${n.type}] "${n.name}" (id: ${n.id}, parent: ${n.parentId})`);
    console.log(`   fill:`, n.style?.fill);
    console.log(`   borders:`, n.style?.borders);
    console.log(`   outline:`, n.style?.outline);
    console.log(`   rawStyle:`, n.rawStyle);
  }
});
