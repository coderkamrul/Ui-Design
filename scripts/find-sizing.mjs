import fs from 'fs';

const files = ['components/LayoutSection.jsx', 'components/Inspector.jsx', 'lib/store.js'];
for (const f of files) {
  if (fs.existsSync(f)) {
    const content = fs.readFileSync(f, 'utf8');
    const idx = content.indexOf('setNodeSizing');
    console.log(f, 'has setNodeSizing at:', idx);
    if (idx !== -1) {
      console.log(content.slice(idx, idx + 600));
    }
  }
}
