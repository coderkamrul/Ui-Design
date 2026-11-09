import assert from 'node:assert/strict';
import { useEditorStore } from '../lib/store.js';
import * as G from '../lib/geometry.js';
import { flexChildStyle } from '../lib/flex.js';

console.log('=== Test Suite: Reparenting and Text Constraints ===\n');

// Reset store to a clean state with two frames and children
const store = useEditorStore;
const initialDoc = {
  pages: [
    {
      id: 'page-1',
      name: 'Page 1',
      rootNodeIds: ['frame-1', 'frame-2'],
    },
  ],
  nodes: {
    'frame-1': {
      id: 'frame-1',
      type: 'frame',
      name: 'Flex Container',
      parentId: null,
      position: { x: 100, y: 100 },
      x: 100,
      y: 100,
      w: 600,
      h: 400,
      size: { w: { kind: 'fixed', px: 600 }, h: { kind: 'fixed', px: 400 } },
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 16,
        padding: { t: 20, r: 20, b: 20, l: 20 },
      },
      childIds: ['card-fill', 'text-fill'],
    },
    'card-fill': {
      id: 'card-fill',
      type: 'frame',
      name: 'Fill Card',
      parentId: 'frame-1',
      position: { x: 0, y: 0 },
      x: 0,
      y: 0,
      w: 560,
      h: 120,
      wMode: 'Fill',
      hMode: 'Fixed',
      size: { w: { kind: 'fill' }, h: { kind: 'fixed', px: 120 } },
      childIds: [],
    },
    'text-fill': {
      id: 'text-fill',
      type: 'text',
      name: 'Fill Text',
      parentId: 'frame-1',
      position: { x: 0, y: 0 },
      x: 0,
      y: 0,
      w: 560,
      h: 40,
      wMode: 'Fill',
      hMode: 'Fit',
      size: { w: { kind: 'fill' }, h: { kind: 'fit' } },
      text: {
        content: 'Responsive text headline that fills the container',
        wrap: 'wrap',
      },
    },
    'frame-2': {
      id: 'frame-2',
      type: 'frame',
      name: 'Second Flex Container',
      parentId: null,
      position: { x: 800, y: 100 },
      x: 800,
      y: 100,
      w: 400,
      h: 400,
      size: { w: { kind: 'fixed', px: 400 }, h: { kind: 'fixed', px: 400 } },
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 10,
        padding: { t: 10, r: 10, b: 10, l: 10 },
      },
      childIds: [],
    },
  },
};

store.setState({ doc: initialDoc, activePageId: 'page-1', selection: [] });

// ---------------------------------------------------------------------------
// TEST 1: Moving Fill Frame to Canvas Root converts Fill to Fixed (preserving px width)
// ---------------------------------------------------------------------------
console.log('Test 1: Moving Fill Frame to canvas root converts Fill -> Fixed (preserving px)');
store.getState().reparentNode('card-fill', null, null, null);
const movedCard = store.getState().doc.nodes['card-fill'];

assert.equal(movedCard.parentId, null, 'Parent must be null (canvas root)');
assert.equal(movedCard.size.w.kind, 'fixed', 'W sizing kind must convert from fill to fixed on canvas root');
assert.equal(movedCard.wMode, 'Fixed', 'wMode must convert to Fixed');
assert.ok(movedCard.size.w.px > 0, 'Preserved width must be greater than 0');
assert.ok(movedCard.position.x >= 100, 'Visual canvas X coordinate must be preserved');
console.log('  Passed: card converted to Fixed px =', movedCard.size.w.px, 'at position =', movedCard.position);

// ---------------------------------------------------------------------------
// TEST 2: Moving Fill Text to Canvas Root converts Fill to Fit (auto content size)
// ---------------------------------------------------------------------------
console.log('Test 2: Moving Fill Text to canvas root converts Fill -> Fit');
store.getState().reparentNode('text-fill', null, null, null);
const movedText = store.getState().doc.nodes['text-fill'];

assert.equal(movedText.parentId, null, 'Parent must be null (canvas root)');
assert.equal(movedText.size.w.kind, 'fit', 'W sizing kind must convert to fit for text on canvas root');
assert.equal(movedText.wMode, 'Fit', 'wMode must convert to Fit');
assert.ok(movedText.position.x >= 100, 'Visual canvas X coordinate must be preserved');
console.log('  Passed: text converted to Fit at position =', movedText.position);

// ---------------------------------------------------------------------------
// TEST 3: Moving between two Flex containers retains Fill
// ---------------------------------------------------------------------------
console.log('Test 3: Moving a Fill element between two flex parents retains Fill');
// Put a Fill element in frame-1
store.setState((prev) => ({
  doc: {
    ...prev.doc,
    nodes: {
      ...prev.doc.nodes,
      'child-fill-2': {
        id: 'child-fill-2',
        type: 'frame',
        parentId: 'frame-1',
        position: { x: 0, y: 0 },
        size: { w: { kind: 'fill' }, h: { kind: 'fixed', px: 50 } },
        wMode: 'Fill',
        childIds: [],
      },
      'frame-1': {
        ...prev.doc.nodes['frame-1'],
        childIds: [...prev.doc.nodes['frame-1'].childIds, 'child-fill-2'],
      },
    },
  },
}));

store.getState().reparentNode('child-fill-2', 'frame-2');
const movedFillChild = store.getState().doc.nodes['child-fill-2'];
assert.equal(movedFillChild.parentId, 'frame-2');
assert.equal(movedFillChild.size.w.kind, 'fill', 'Fill must be retained when target parent is also flex');
assert.equal(movedFillChild.wMode, 'Fill');
console.log('  Passed: Fill retained in target flex container');

// ---------------------------------------------------------------------------
// TEST 4: Text flexChildStyle enforces parent width and natural wrapping
// ---------------------------------------------------------------------------
console.log('Test 4: Text flexChildStyle enforces maxWidth: 100% and wrapping');
const columnLayout = {
  direction: 'column',
  alignCross: 'center',
  padding: { l: 20, r: 20 },
};
const wrappingTextNode = {
  type: 'text',
  size: { w: { kind: 'fit' }, h: { kind: 'fit' } },
  text: {
    content: 'Long headline that must wrap within parent width',
    wrap: 'wrap',
  },
};
const style = flexChildStyle(wrappingTextNode, columnLayout, [], false);
assert.equal(style.maxWidth, '100%', 'maxWidth must be 100% of parent');
assert.equal(style.width, 'fit-content', 'width must be fit-content');
assert.equal(style.minWidth, 0, 'minWidth must be 0 to allow flex wrapping');
console.log('  Passed: flexChildStyle enforces maxWidth: 100% and minWidth: 0');

console.log('\nAll reparenting and text constraint tests passed!');
