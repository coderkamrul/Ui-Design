import { parseHtmlFragment, serializePlain, svgDimensions } from '../lib/snapshot-import.js';

const roots = parseHtmlFragment('<svg viewBox="0 0 24 24" width="18" height="18"><polygon points="4 3 11 20 14 13 21 10 4 3" /></svg>');
console.log('el attrs:', roots[0].attrs);
const plain = serializePlain(roots[0]);
console.log('serializePlain:', plain);
console.log('svgDimensions:', svgDimensions(plain));
