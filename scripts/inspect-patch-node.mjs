import fs from 'fs';

const code = fs.readFileSync('lib/store.js', 'utf8');
const idx = code.indexOf('patchNode: (id, patch)');
console.log('patchNode context:');
console.log(code.slice(idx, idx + 1500));
