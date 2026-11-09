import assert from 'node:assert';
import { isIgnoredOtherStyle, toReactStyleKey, convertHtml, formatNodeForCanvasTool } from '../lib/snapshot-import.js';
import { flexChildStyle } from '../lib/flex.js';

console.log('--- Starting Flex Flow & Import Fidelity Verification ---');

// 1. Verify isIgnoredOtherStyle filters noisy browser resets and core props
console.log('1. Testing isIgnoredOtherStyle...');
assert.strictEqual(isIgnoredOtherStyle('border-block-end-color', 'rgb(0, 0, 0)'), true, 'Should filter border-block-end-color');
assert.strictEqual(isIgnoredOtherStyle('caret-color', 'auto'), true, 'Should filter caret-color');
assert.strictEqual(isIgnoredOtherStyle('column-rule-color', 'rgb(0, 0, 0)'), true, 'Should filter column-rule-color');
assert.strictEqual(isIgnoredOtherStyle('flex-direction', 'row'), true, 'Should filter flex-direction (handled natively by flex layout)');
assert.strictEqual(isIgnoredOtherStyle('unicode-bidi', 'isolate'), true, 'Should filter unicode-bidi');
assert.strictEqual(isIgnoredOtherStyle('appearance', 'none'), true, 'Should filter appearance');
assert.strictEqual(isIgnoredOtherStyle('box-shadow', '0 4px 6px rgba(0,0,0,0.1)'), true, 'Should filter box-shadow from otherStyles as it is consumed into native effects');
assert.strictEqual(isIgnoredOtherStyle('backdrop-filter', 'blur(10px)'), false, 'Should keep backdrop-filter in otherStyles');
assert.strictEqual(isIgnoredOtherStyle('filter', 'grayscale(50%)'), false, 'Should keep filter in otherStyles');
console.log('✓ isIgnoredOtherStyle verified.');

// 2. Verify toReactStyleKey handles vendor and utility prefixes
console.log('2. Testing toReactStyleKey...');
assert.strictEqual(toReactStyleKey('background-color'), 'backgroundColor');
assert.strictEqual(toReactStyleKey('-webkit-backdrop-filter'), 'WebkitBackdropFilter');
assert.strictEqual(toReactStyleKey('-tw-shadow'), '', 'Single-dash Tailwind utility prefixes should return empty string');
console.log('✓ toReactStyleKey verified.');

// 3. Verify flexChildStyle cross-axis fit sizing
console.log('3. Testing flexChildStyle cross-axis fit sizing...');
const parentColumnLayout = {
  direction: 'column',
  align: 'start',
  justify: 'start',
  gap: 12,
  padding: { top: 0, right: 0, bottom: 0, left: 0 }
};

const textChild = {
  type: 'text',
  size: {
    w: { kind: 'fit' },
    h: { kind: 'fit' }
  },
  position: { absolute: false, x: 0, y: 0 }
};

const textStyle = flexChildStyle(textChild, parentColumnLayout);
assert.strictEqual(textStyle.width, 'fit-content', 'Text child with cross-axis fit in column flex should have width: fit-content');
assert.strictEqual(textStyle.maxWidth, '100%', 'Text child should have maxWidth: 100%');

const frameChild = {
  type: 'frame',
  size: {
    w: { kind: 'fit' },
    h: { kind: 'fill' }
  },
  position: { absolute: false, x: 0, y: 0 }
};

const frameStyle = flexChildStyle(frameChild, parentColumnLayout);
assert.strictEqual(frameStyle.width, 'fit-content', 'Frame child with cross-axis fit in column flex should have width: fit-content');
assert.strictEqual(frameStyle.flex, '1 1 0px', 'Child with main-axis fill in column flex should have flex: 1 1 0px');
console.log('✓ flexChildStyle verified.');

// 4. Verify convertHtml with display: flex and in-flow children
console.log('4. Testing convertHtml with display: flex, overflow: hidden, and child positioning...');
const sampleHtml = `
<div style="display: flex; flex-direction: column; gap: 16px; overflow: hidden; width: 600px; height: 400px; background-color: rgb(240, 240, 240);">
  <h2 style="font-size: 24px; font-weight: 700; width: 300px; height: 32px;">Heading Title</h2>
  <div style="display: flex; flex-direction: row; gap: 8px; align-items: center; width: 600px; height: 100px;">
    <button style="display: inline-flex; width: 120px; height: 40px; background-color: rgb(0, 100, 255);">Action Button</button>
  </div>
</div>
`;

const res = convertHtml(sampleHtml, { measure: false, exactLayout: true });
assert(res && res.roots && res.roots.length > 0, 'convertHtml should return roots');
const root = res.roots[0];

assert(root.flex, 'Root must have flex object');
assert.strictEqual(root.flex.direction, 'column', 'Root must have flex.direction: column');
assert.strictEqual(root.flex.gap.value, 16, 'Root must have flex.gap: 16');
assert.strictEqual(root.clipContent, true, 'Root with overflow: hidden must have clipContent: true');

assert.strictEqual(root.childIds.length, 2, 'Root should have 2 children');
const child1 = res.byId.get(root.childIds[0]);
const child2 = res.byId.get(root.childIds[1]);

assert.strictEqual(child1.x, 0, 'In-flow flex child 1 must have x: 0');
assert.strictEqual(child1.y, 0, 'In-flow flex child 1 must have y: 0');
assert.strictEqual(child1.absolutePosition, false, 'Child 1 must have absolutePosition: false');

assert(child2.flex, 'Child 2 must have flex object');
assert.strictEqual(child2.flex.direction, 'row', 'Child 2 must have flex.direction: row');
assert.strictEqual(child2.flex.gap.value, 8, 'Child 2 must have flex.gap: 8');
assert.strictEqual(child2.x, 0, 'In-flow flex child 2 must have x: 0');
assert.strictEqual(child2.y, 0, 'In-flow flex child 2 must have y: 0');

const buttonNode = res.byId.get(child2.childIds[0]);
assert.strictEqual(buttonNode.x, 0, 'Nested button must have x: 0');
assert.strictEqual(buttonNode.y, 0, 'Nested button must have y: 0');
assert.strictEqual(buttonNode.absolutePosition, false, 'Nested button must have absolutePosition: false');

// 5. Verify formatNodeForCanvasTool formats layout and positions
console.log('5. Testing formatNodeForCanvasTool...');
formatNodeForCanvasTool(root);
assert.strictEqual(root.layout.mode, 'flex', 'Formatted root layout mode must be flex');
assert.strictEqual(root.layout.direction, 'column', 'Formatted root layout direction must be column');
assert.strictEqual(root.layout.gap, 16, 'Formatted root layout gap must be 16');
assert.strictEqual(root.position.absolute, false, 'Formatted root position absolute must be false');

formatNodeForCanvasTool(child1);
assert.strictEqual(child1.position.x, 0, 'Formatted child1 position x must be 0');
assert.strictEqual(child1.position.y, 0, 'Formatted child1 position y must be 0');
assert.strictEqual(child1.position.absolute, false, 'Formatted child1 position absolute must be false');

console.log('✓ convertHtml flex layout, overflow clipping, and child positions verified.');

console.log('\n--- All Flex Flow & Import Fidelity Tests Passed! ---');
