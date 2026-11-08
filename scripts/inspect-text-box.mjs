import fs from 'fs';

const code = fs.readFileSync('components/CanvasNode.jsx', 'utf8');
const idx = code.indexOf('node.type === "text" && (nodeSize.w?.kind === "fit" || nodeSize.w?.kind === "auto")');
console.log('box sizing for text found at:', idx);
console.log(code.slice(idx - 100, idx + 800));
