import fs from 'fs';
import { convertHtml } from '../lib/snapshot-import.js';

const html = fs.readFileSync('scripts/context7_card_section.html', 'utf8');
const result = convertHtml(html);

const f1 = result.all.find(n => n.id === 'node-mw8e0kyh-2' || n.name === 'Frame' && n.radius?.value === 24);
console.log('Frame 1 full object keys:', Object.keys(f1));
console.log('borders on f1:');
for (const k of Object.keys(f1)) {
  if (k.toLowerCase().includes('border') || k.toLowerCase().includes('stroke')) {
    console.log(k, f1[k]);
  }
}
