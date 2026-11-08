import fs from 'fs';

const html = fs.readFileSync('scripts/paper_design_context7.html', 'utf8');
const idx = html.indexOf('Paper is a design and vector');
console.log('Found at:', idx);
const start = Math.max(0, idx - 1500);
const end = Math.min(html.length, idx + 2500);
console.log('Snippet:\n', html.slice(start, end));
