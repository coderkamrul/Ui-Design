import fs from 'fs';

const html = fs.readFileSync('scripts/paper_design_context7.html', 'utf8');
const start = 17800;
const end = 35000;
console.log('Snippet length:', end - start);
fs.writeFileSync('scripts/context7_card_section.html', html.slice(start, end));
console.log('Written to scripts/context7_card_section.html');
