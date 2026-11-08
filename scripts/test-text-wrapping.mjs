import fs from 'fs';
import { convertHtml } from '../lib/snapshot-import.js';
import { flexChildStyle, flowSizeCss } from '../lib/flex.js';

const html = fs.readFileSync('scripts/context7_card_section.html', 'utf8');
const result = convertHtml(html);

// Find the long text node
const textNodes = result.all.filter(n => n.type === 'text' && n.text?.content?.includes('Paper is a design'));
console.log('Found description text nodes:', textNodes.length);
if (textNodes.length) {
  const tn = textNodes[0];
  console.log('Text node:', {
    id: tn.id,
    content: tn.text.content,
    wrap: tn.text.wrap,
    wMode: tn.wMode,
    hMode: tn.hMode,
    w: tn.w,
    h: tn.h,
    size: tn.size,
  });

  // Test flex child style for this text node in a flex column parent
  const mockColumnLayout = { direction: 'column', gap: 20 };
  const style = flexChildStyle(tn, mockColumnLayout, [], false);
  console.log('Flex child style in column layout:', style);
}
