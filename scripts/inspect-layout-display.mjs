import fs from 'fs';

const code = fs.readFileSync('components/LayoutSection.jsx', 'utf8');
const idx = code.indexOf('sizing.kind === "fit"');
console.log('LayoutSection sizing.kind === "fit" context:');
console.log(code.slice(idx - 200, idx + 800));
