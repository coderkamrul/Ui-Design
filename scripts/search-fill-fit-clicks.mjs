import fs from 'fs';

for (const file of ['components/LayoutSection.jsx', 'components/Inspector.jsx']) {
  const code = fs.readFileSync(file, 'utf8');
  const lines = code.split('\n');
  lines.forEach((line, i) => {
    if ((line.includes('Fill') || line.includes('fill')) && (line.includes('Fit') || line.includes('fit'))) {
      if (line.includes('onClick') || line.includes('button') || line.includes('Select') || line.includes('wMode') || line.includes('setNodeSizing') || line.includes('onChange')) {
        console.log(`${file}:${i+1} -> ${line.trim()}`);
      }
    }
  });
}
