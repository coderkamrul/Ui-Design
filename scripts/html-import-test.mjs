#!/usr/bin/env node
/**
 * HTML import regression tests.
 * Tests the snapshot-import pipeline with various HTML structures.
 * Run: node scripts/html-import-test.mjs
 */
import { convertHtml } from '../lib/snapshot-import.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg || ''}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

/** Thin wrapper: run convertHtml and return the flat node array */
function importHtml(html) {
  return convertHtml(html).all;
}

console.log('\n== HTML Import Regression Tests ==\n');

// --- 1. Single text paragraph ---
console.log('1. Single text paragraph');
test('plain <p> becomes one text node', () => {
  const nodes = importHtml('<p style="font-size:16px;color:#333">Hello world</p>');
  const texts = nodes.filter(n => n.type === 'text');
  assert(texts.length >= 1, `Expected >=1 text node, got ${texts.length}`);
  assert(texts[0].text?.content?.includes('Hello world'), 'Missing text content');
});

// --- 2. Inline formatting stays one node ---
console.log('\n2. Mixed inline formatting');
test('bold+color spans in one <p> → single text node', () => {
  const html = `<p style="font-size:14px;color:#111">Normal <span style="font-weight:700">bold</span> and <span style="color:red">red</span></p>`;
  const nodes = importHtml(html);
  const texts = nodes.filter(n => n.type === 'text');
  assert(texts.length === 1, `Expected 1 text node, got ${texts.length} — inline spans should not create separate nodes`);
  const content = texts[0].text?.content || '';
  assert(content.includes('Normal') && content.includes('bold') && content.includes('red'), `Missing text parts in: ${content}`);
});

// --- 3. Flex container with children ---
console.log('\n3. Flex container');
test('flex container becomes a frame with flex layout', () => {
  const html = `<div style="display:flex;flex-direction:row;gap:8px;padding:16px"><span style="font-size:14px">Child A</span><span style="font-size:14px">Child B</span></div>`;
  const nodes = importHtml(html);
  const frames = nodes.filter(n => n.type === 'frame');
  assert(frames.length >= 1, 'Expected at least one frame');
  const flexFrame = frames.find(f => f.flex?.direction);
  assert(flexFrame, 'Expected a flex frame');
  assertEqual(flexFrame.flex.direction, 'row', 'flex-direction should be row');
});

// --- 4. Background color → fill ---
console.log('\n4. Background color');
test('background-color → node fill', () => {
  const html = `<div style="background-color:#ff0000;width:100px;height:100px"></div>`;
  const nodes = importHtml(html);
  const n = nodes.find(n => n.fills?.length > 0);
  assert(n, 'Expected a node with fills');
  const fill = n.fills[0];
  assert(fill.type === 'solid' || fill.kind === 'solid', `Expected solid fill, got ${fill.type || fill.kind}`);
});

// --- 5. Border radius ---
console.log('\n5. Border radius');
test('border-radius → node.radius', () => {
  const html = `<div style="border-radius:8px;width:100px;height:100px;background:#ccc"></div>`;
  const nodes = importHtml(html);
  const n = nodes.find(n => n.radius != null);
  assert(n, 'Expected a node with radius');
});

// --- 6. Nested containers ---
console.log('\n6. Nested containers');
test('nested divs → parent-child node hierarchy', () => {
  const html = `<div style="width:200px;height:200px"><div style="width:100px;height:100px;background:#eee"></div></div>`;
  const nodes = importHtml(html);
  assert(nodes.length >= 2, `Expected >=2 nodes, got ${nodes.length}`);
});

// --- 7. Box shadow ---
console.log('\n7. Box shadow');
test('box-shadow → node.shadows', () => {
  const html = `<div style="box-shadow:0 2px 4px rgba(0,0,0,0.2);width:100px;height:100px;background:#fff"></div>`;
  const nodes = importHtml(html);
  const n = nodes.find(n => n.shadows?.length > 0);
  assert(n, 'Expected a node with shadows');
});

// --- 8. Opacity ---
console.log('\n8. Opacity');
test('opacity:0.5 → node.opacity ~50 (0-100 scale)', () => {
  const html = `<div style="opacity:0.5;width:100px;height:100px;background:#000"></div>`;
  const nodes = importHtml(html);
  const n = nodes.find(n => n.opacity != null && n.opacity !== 100);
  assert(n, 'Expected a node with opacity != 100');
  assert(n.opacity >= 40 && n.opacity <= 60, `Expected ~50 opacity, got ${n.opacity}`);
});

// --- 9. Font weight preserved ---
console.log('\n9. Font weight');
test('font-weight:700 → text node text.fontWeight 700', () => {
  const html = `<p style="font-weight:700;font-size:16px">Bold text</p>`;
  const nodes = importHtml(html);
  const t = nodes.find(n => n.type === 'text');
  assert(t, 'Expected text node');
  assertEqual(t.text?.fontWeight, 700, 'fontWeight');
});

// --- 10. Gradient background ---
console.log('\n10. Gradient background');
test('linear-gradient → gradient fill', () => {
  const html = `<div style="background:linear-gradient(to right,#ff0,#f00);width:100px;height:100px"></div>`;
  const nodes = importHtml(html);
  const n = nodes.find(n => n.fills?.some(f => f.type === 'gradient' || f.kind === 'gradient'));
  assert(n, 'Expected a node with gradient fill');
});

// --- 11. Absolute positioning (at least two nodes) ---
console.log('\n11. Absolute positioning');
test('position:absolute child → >=2 nodes produced', () => {
  const html = `<div style="position:relative;width:200px;height:200px"><div style="position:absolute;top:10px;left:20px;width:50px;height:50px;background:#ccc"></div></div>`;
  const nodes = importHtml(html);
  assert(nodes.length >= 2, `Expected >=2 nodes, got ${nodes.length}`);
});

// --- 12. Text color ---
console.log('\n12. Text color');
test('color:#ff0000 → text fill color contains red', () => {
  const html = `<p style="color:#ff0000;font-size:16px">Red text</p>`;
  const nodes = importHtml(html);
  const t = nodes.find(n => n.type === 'text');
  assert(t, 'Expected text node');
  const fill = t.fills?.[0];
  assert(fill, 'Expected text fill');
  const colorStr = (fill.color || '').toUpperCase();
  assert(colorStr.includes('FF') && colorStr.includes('00'), `Expected red fill color, got ${fill.color}`);
});

// Summary
console.log(`\n== Results: ${passed} passed, ${failed} failed ==\n`);
if (failed > 0) process.exit(1);
