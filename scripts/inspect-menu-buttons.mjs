import fs from 'fs';

const code = fs.readFileSync('components/LayoutSection.jsx', 'utf8');
const p = 54500;
console.log(code.slice(p, p + 3500));
