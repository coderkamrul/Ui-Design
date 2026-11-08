import fs from 'fs';

const code = fs.readFileSync('components/LayoutSection.jsx', 'utf8');
const idx = code.indexOf('const renderSizingField =');
console.log(code.slice(idx + 1800, idx + 3500));
