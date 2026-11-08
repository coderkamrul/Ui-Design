import fs from 'fs';

const code = fs.readFileSync('components/CanvasNode.jsx', 'utf8');
const idx = code.indexOf('function TextNodeContent');
console.log('TextNodeContent found at:', idx);
console.log(code.slice(idx, idx + 2000));
