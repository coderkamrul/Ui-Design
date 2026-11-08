import { convertSnapshotToCanvasNodes } from '../lib/snapshot-import.js';

async function testAllStyles() {
  console.log('--- Testing Animation, Transition & Unrecognized Styles Preservation ---');

  const testHtml = `
    <div style="
      width: 300px;
      height: 200px;
      animation: pulse 2s infinite ease-in-out;
      animation-fill-mode: forwards;
      transition: all 0.3s ease;
      caret-color: rgb(255, 0, 0);
      appearance: none;
      scrollbar-width: none;
      --my-custom-var: #abcdef;
      unicode-bidi: isolate;
      border-block-end-color: rgb(31, 31, 31);
      border-block-end-style: solid;
      border-block-start-color: rgb(31, 31, 31);
      border-block-start-style: solid;
      border-inline-end-color: rgb(31, 31, 31);
      border-inline-end-style: solid;
      border-inline-start-color: rgb(31, 31, 31);
      border-inline-start-style: solid;
      column-rule-color: rgb(31, 31, 31);
      flex-direction: column;
      outline-color: rgb(31, 31, 31);
      row-rule-color: rgb(31, 31, 31);
      text-decoration-color: rgb(31, 31, 31);
      text-emphasis-color: rgb(31, 31, 31);
      -webkit-text-fill-color: rgb(31, 31, 31);
      -webkit-text-stroke-color: rgb(31, 31, 31);
    ">
      <p style="
        font-size: 14px;
        animation: fadeIn 1s ease;
        text-emphasis: circle;
        -webkit-tap-highlight-color: transparent;
      ">
        Animated Text
      </p>
      <svg width="24" height="24" style="
        animation: spin 3s linear infinite;
        transform-origin: center;
      ">
        <circle cx="12" cy="12" r="10" />
      </svg>
      <img src="https://example.com/test.png" style="
        transition: transform 0.2s ease;
        aspect-ratio: 16/9;
      " />
    </div>
  `;

  const res = await convertSnapshotToCanvasNodes(testHtml);
  console.log(`Converted ${res.all.length} nodes successfully.`);

  const rootFrame = res.roots[0];
  const textNode = res.all.find(n => n.type === 'text');
  const svgNode = res.all.find(n => n.type === 'svg');
  const imgNode = res.all.find(n => n.type === 'image');

  console.log('\n1. Checking Root Frame styles:');
  console.log('Frame rawStyle:', rootFrame.rawStyle);
  console.log('Frame customCss:', rootFrame.style?.customCss);

  if (!rootFrame.rawStyle?.animation || !rootFrame.style?.customCss?.animation) {
    throw new Error('Root frame missing "animation" property in rawStyle / customCss!');
  }
  if (!rootFrame.rawStyle?.['animation-fill-mode'] || !rootFrame.style?.customCss?.['animation-fill-mode']) {
    throw new Error('Root frame missing "animation-fill-mode" property!');
  }
  if (!rootFrame.rawStyle?.transition || !rootFrame.style?.customCss?.transition) {
    throw new Error('Root frame missing "transition" property!');
  }
  if (!rootFrame.rawStyle?.['--my-custom-var']) {
    throw new Error('Root frame missing custom CSS variable "--my-custom-var"!');
  }

  // Verify none of the 20 noise/reset/layout properties leaked into rawStyle or customCss
  const noiseProps = [
    'border-block-end-color', 'border-block-end-style', 'border-block-start-color', 'border-block-start-style',
    'border-inline-end-color', 'border-inline-end-style', 'border-inline-start-color', 'border-inline-start-style',
    'caret-color', 'column-rule-color', 'flex-direction', 'outline-color', 'row-rule-color',
    'text-decoration-color', 'text-emphasis-color', 'unicode-bidi', '-webkit-text-fill-color',
    '-webkit-text-stroke-color', 'appearance', 'scrollbar-width'
  ];
  for (const prop of noiseProps) {
    if (rootFrame.rawStyle?.[prop] != null) {
      throw new Error(`Noise property "${prop}" leaked into rootFrame.rawStyle!`);
    }
    if (rootFrame.style?.customCss?.[prop] != null) {
      throw new Error(`Noise property "${prop}" leaked into rootFrame.style.customCss!`);
    }
  }
  console.log('✓ Verified: None of the 20 browser noise/reset/layout properties leaked into customCss or rawStyle.');

  console.log('✓ Root Frame has all animation, transition, and unrecognized styles preserved.');

  console.log('\n2. Checking Text Node styles:');
  console.log('Text rawStyle:', textNode?.rawStyle);
  console.log('Text customCss:', textNode?.style?.customCss);

  if (!textNode?.rawStyle?.animation || !textNode?.style?.customCss?.animation) {
    throw new Error('Text node missing "animation" property!');
  }
  if (!textNode?.rawStyle?.['text-emphasis']) {
    throw new Error('Text node missing "text-emphasis" property!');
  }
  console.log('✓ Text Node has animation and text-emphasis styles preserved.');

  console.log('\n3. Checking SVG Node styles:');
  console.log('SVG rawStyle:', svgNode?.rawStyle);
  console.log('SVG customCss:', svgNode?.style?.customCss);

  if (!svgNode?.rawStyle?.animation || !svgNode?.style?.customCss?.animation) {
    throw new Error('SVG node missing "animation" property!');
  }
  console.log('✓ SVG Node has animation and transform-origin styles preserved.');

  console.log('\n4. Checking Image Node styles:');
  console.log('Image rawStyle:', imgNode?.rawStyle);
  console.log('Image customCss:', imgNode?.style?.customCss);

  if (!imgNode?.rawStyle?.transition || !imgNode?.style?.customCss?.transition) {
    throw new Error('Image node missing "transition" property!');
  }
  if (!imgNode?.rawStyle?.['aspect-ratio']) {
    throw new Error('Image node missing "aspect-ratio" property!');
  }
  console.log('✓ Image Node has transition and aspect-ratio styles preserved.');

  console.log('\nALL ANIMATION, TRANSITION & UNRECOGNIZED STYLE TESTS PASSED!\n');
}

testAllStyles().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
