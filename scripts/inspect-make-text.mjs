import fs from 'fs';

const code = fs.readFileSync('lib/snapshot-import.js', 'utf8');
const idx = code.indexOf('function makeTextNode');
console.log('makeTextNode found at:', idx);
console.log(code.slice(idx, idx + 1500));
