import fs from 'fs';

const html = fs.readFileSync('scripts/context7_card_section.html', 'utf8');
console.log(html.slice(0, 3000));
