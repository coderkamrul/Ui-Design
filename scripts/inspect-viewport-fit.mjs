import fs from 'fs';

const code = fs.readFileSync('components/Viewport.jsx', 'utf8');

const matches = [];
let pos = 0;
while ((pos = code.indexOf('Fit', pos)) !== -1) {
  matches.push(pos);
  pos += 1;
}
console.log('Matches for "Fit" in Viewport:', matches.length);
for (let i = 0; i < Math.min(5, matches.length); i++) {
  const p = matches[i];
  console.log(`--- Match ${i} at ${p} ---`);
  console.log(code.slice(Math.max(0, p - 60), Math.min(code.length, p + 160)));
}
