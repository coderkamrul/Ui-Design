import fs from 'fs';

const html = fs.readFileSync('scripts/context7_paper_design.html', 'utf8');
const emeraldMatch = html.match(/class="[^"]*border-emerald[^"]*"/);
console.log('emerald match:', emeraldMatch ? emeraldMatch[0] : 'none');

// Find the Paper card element in html
const paperIndex = html.indexOf('Paper is a design and vector editing tool');
console.log('paper text index:', paperIndex);
if (paperIndex !== -1) {
  const start = Math.max(0, paperIndex - 500);
  const end = Math.min(html.length, paperIndex + 500);
  console.log('Surrounding HTML:\n', html.slice(start, end));
}
