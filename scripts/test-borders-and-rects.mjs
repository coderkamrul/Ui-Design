import { convertSnapshotToCanvasNodes } from '../lib/snapshot-import.js';

async function run() {
  const samples = [
    { name: 'Plain Button (no border in style)', html: '<button>Click Me</button>' },
    { name: 'Button with class', html: '<button class="btn primary">Save</button>' },
    { name: 'Plain Div', html: '<div>Just text</div>' },
    { name: 'SVG with rect', html: '<svg width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" fill="red"/><path d="M0 0 L10 10"/></svg>' },
    { name: 'Frame with nested button and SVG', html: '<div class="card"><button><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg><span>Label</span></button></div>' }
  ];

  for (const s of samples) {
    console.log(`\n=================== ${s.name} ===================`);
    const res = await convertSnapshotToCanvasNodes(s.html, { measure: false });
    for (const n of res.all) {
      console.log(`Node [${n.type}] "${n.name}" (id: ${n.id})`);
      if (n.borders && n.borders.length) {
        console.log(`  node.borders:`, JSON.stringify(n.borders));
      }
      if (n.style?.borders && n.style.borders.length) {
        console.log(`  node.style.borders:`, JSON.stringify(n.style.borders));
      }
      if (n.style?.outline || n.rawStyle?.outline) {
        console.log(`  outline:`, n.style?.outline || n.rawStyle?.outline);
      }
      if (n.rawStyle) {
        console.log(`  rawStyle:`, JSON.stringify(n.rawStyle));
      }
      if (n.childIds && n.childIds.length) {
        console.log(`  childIds:`, n.childIds);
      }
    }
  }
}

run();
