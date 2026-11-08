import fs from 'fs';

const code = fs.readFileSync('components/LayoutSection.jsx', 'utf8');
const p = 50900;
console.log(code.slice(p, p + 2500));
