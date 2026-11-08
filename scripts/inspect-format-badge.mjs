import fs from 'fs';

const code = fs.readFileSync('components/Viewport.jsx', 'utf8');
const idx = code.indexOf('function formatSizingBadge');
console.log('formatSizingBadge context:');
console.log(code.slice(idx, idx + 1000));
