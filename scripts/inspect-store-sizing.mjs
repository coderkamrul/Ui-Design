import fs from 'fs';

const code = fs.readFileSync('lib/store.js', 'utf8');
const idx = code.indexOf('setNodeSizing: (id, axis, sizing)');
console.log('setNodeSizing in lib/store.js:');
console.log(code.slice(idx, idx + 2500));
