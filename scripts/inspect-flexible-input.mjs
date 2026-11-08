import fs from 'fs';

const code = fs.readFileSync('components/LayoutSection.jsx', 'utf8');
const p = 1300;
console.log(code.slice(p, p + 1000));
