import fs from 'fs';

const html = fs.readFileSync('scripts/paper_design_context7.html', 'utf8');
// Find occurrence in body
const matches = [];
let pos = 0;
while ((pos = html.indexOf('Paper is a design and vector', pos)) !== -1) {
  matches.push(pos);
  pos += 1;
}
console.log('Matches found at indices:', matches);

for (const m of matches) {
  console.log('--- MATCH AT', m, '---');
  console.log(html.slice(Math.max(0, m - 300), Math.min(html.length, m + 300)));
}
