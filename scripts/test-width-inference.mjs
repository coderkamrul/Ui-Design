import { convertSnapshotToCanvasNodes, convertPlainTree, parseHtmlFragment } from '../lib/snapshot-import.js';

async function run() {
  console.log('--- Test 1: User Prompt Example ---');
  const html1 = '<div style="width: 280px; padding: 14px; box-sizing: border-box;"><div style="display: flex; flex-direction: column;"><div>Content</div></div></div>';
  const res1 = await convertSnapshotToCanvasNodes(html1);
  console.log('Nodes count:', res1.all.length);
  res1.all.forEach(n => {
    console.log(`[${n.type}] name: "${n.name}" wMode: ${n.wMode} wPx: ${n.size?.w?.px} wKind: ${n.size?.w?.kind}`);
  });

  const parent = res1.all[0];
  const innerFlex = res1.all[1];
  const textChild = res1.all[2];

  if (parent.size.w.px !== 280) throw new Error(`Parent width expected 280, got ${parent.size.w.px}`);
  if (innerFlex.size.w.px !== 252) throw new Error(`Inner flex width expected 252, got ${innerFlex.size.w.px}`);
  if (innerFlex.wMode !== 'Fill') throw new Error(`Inner flex wMode expected Fill, got ${innerFlex.wMode}`);
  if (textChild.wMode !== 'Fit') throw new Error(`Text child wMode expected Fit, got ${textChild.wMode}`);

  console.log('Test 1 PASSED: parent 280px, inner flex 252px Fill, text Fit.\n');

  console.log('--- Test 2: Inline vs Block vs Button Intrinsic Sizing ---');
  const html2 = `
    <div style="width: 500px; padding: 20px; box-sizing: border-box;">
      <div style="display: block;">Block div</div>
      <span style="display: inline;">Inline span</span>
      <button style="display: inline-flex;">Button</button>
      <div style="display: flex; flex-direction: row;">
        <div style="width: 100px;">Fixed 100px</div>
        <div style="flex-grow: 1;">Grow 1</div>
        <div>Default item</div>
      </div>
    </div>
  `;
  const res2 = await convertSnapshotToCanvasNodes(html2);
  const root = res2.all[0];
  const blockDiv = res2.all.find(n => n.name === 'Frame' && n !== root && n.parentId === root.id);
  const inlineSpan = res2.all.find(n => n.type === 'text' && n.text?.content?.includes('Inline span'));
  const button = res2.all.find(n => n.name === 'Button');
  const rowFlex = res2.all.find(n => n.layout?.direction === 'row');
  const fixedChild = res2.all.find(n => n.text?.content?.includes('Fixed 100px') || (n.size?.w?.px === 100 && n.size?.w?.kind === 'fixed'));
  const growChild = res2.all.find(n => n.size?.w?.kind === 'fill' && n.parentId === rowFlex?.id);

  console.log(`Root: ${root.size.w.px}px (Content: 460px)`);
  console.log(`Block div wMode: ${blockDiv.wMode}, wPx: ${blockDiv.size.w.px}`);
  if (blockDiv.size.w.px !== 460 || blockDiv.wMode !== 'Fill') {
    throw new Error(`Block div should be Fill 460px, got ${blockDiv.wMode} ${blockDiv.size.w.px}`);
  }

  console.log(`Button wMode: ${button.wMode}`);
  if (button.wMode !== 'Fit') {
    throw new Error(`Button should be Fit, got ${button.wMode}`);
  }

  console.log('Test 2 PASSED!\n');

  console.log('--- Test 3: Absolute Positioning Constraints ---');
  const html3 = `
    <div style="width: 400px; height: 300px; position: relative;">
      <div style="position: absolute; left: 20px; right: 30px; top: 10px; height: 50px;">Stretched</div>
      <div style="position: absolute; left: 20px; top: 80px; width: 60px; height: 40px;">Fixed</div>
      <div style="position: absolute; left: 20px; top: 150px;">Hug Content</div>
    </div>
  `;
  const res3 = await convertSnapshotToCanvasNodes(html3);
  const absStretched = res3.all.find(n => n.text?.content?.includes('Stretched') || (n.wMode === 'Fixed' && n.size?.w?.px === 350));
  const absFixed = res3.all.find(n => n.text?.content?.includes('Fixed') || (n.size?.w?.px === 60));
  const absHug = res3.all.find(n => n.text?.content?.includes('Hug Content'));

  console.log(`Stretched abs width: ${absStretched?.size?.w?.px} (expected 350)`);
  if (absStretched?.size?.w?.px !== 350) {
    throw new Error(`Stretched abs expected 350, got ${absStretched?.size?.w?.px}`);
  }

  console.log('Test 3 PASSED!\n');

  console.log('--- Test 4: Nested Flex Columns with Cards (User HTML Snippet) ---');
  const snippetHtml = `
    <x-paper-html>
      <div style="display: flex; flex-direction: column; width: 280px; height: 162px; padding: 14px; box-sizing: border-box; row-gap: 20px;">
        <div style="display: flex; flex-direction: column; row-gap: 8px;">
          <div>Page</div>
          <div style="display: flex; flex-direction: row; width: 100%; height: 30px;">Input Card</div>
        </div>
        <div style="display: flex; flex-direction: column; row-gap: 8px;">
          <div>MCP</div>
          <div style="display: flex; width: 100%; height: 32px;">Connect your agent</div>
        </div>
      </div>
    </x-paper-html>
  `;
  const res4 = await convertSnapshotToCanvasNodes(snippetHtml);
  
  const rootFrame = res4.roots[0];
  const card1 = res4.all[1]; // First card frame containing Page and input
  const card2 = res4.all.find(n => n !== card1 && n !== rootFrame && n.parentId === rootFrame.id);

  console.log(`Root Frame: ${rootFrame.size.w.px}px x ${rootFrame.size.h.px}px, layout: ${rootFrame.layout.mode}`);
  console.log(`Card 1: wMode: ${card1.wMode}, kind: ${card1.size.w.kind}, px: ${card1.size.w.px}`);
  console.log(`Card 2: wMode: ${card2.wMode}, kind: ${card2.size.w.kind}, px: ${card2.size.w.px}`);

  if (card1.size.w.kind !== 'fill' || card1.size.w.px !== 252) {
    throw new Error(`Card 1 expected fill 252px, got ${card1.size.w.kind} ${card1.size.w.px}`);
  }
  if (card2.size.w.kind !== 'fill' || card2.size.w.px !== 252) {
    throw new Error(`Card 2 expected fill 252px, got ${card2.size.w.kind} ${card2.size.w.px}`);
  }

  console.log('Test 4 PASSED: Both card containers fill the 252px content width perfectly!\n');
  console.log('ALL TESTS PASSED SUCCESSFULLY!');
}

run().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
