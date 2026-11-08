import fs from 'fs';

const code = fs.readFileSync('lib/snapshot-import.js', 'utf8');
const idx = code.indexOf('function makeTextNode');
console.log(code.slice(idx + 2400, idx + 4000));
