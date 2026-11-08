import fs from 'fs';

const code = fs.readFileSync('components/LayoutSection.jsx', 'utf8');
const idx = code.indexOf('const renderSizingField =');
console.log('renderSizingField context:');
console.log(code.slice(idx, idx + 2500));
