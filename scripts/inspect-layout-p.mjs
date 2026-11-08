import fs from 'fs';

const code = fs.readFileSync('components/LayoutSection.jsx', 'utf8');
const p = 50986;
console.log(code.slice(Math.max(0, p - 300), Math.min(code.length, p + 700)));
