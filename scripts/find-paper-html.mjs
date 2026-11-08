import fs from 'fs';

for (const f of ['scripts/paper_design_context7.html', 'scripts/context7_paper.html', 'scripts/step_4128.html', 'scripts/prompt10_exact.html', 'scripts/user_full_snippet.html', 'scripts/user_pasted_html.html']) {
  if (fs.existsSync(f)) {
    const content = fs.readFileSync(f, 'utf8');
    const idx = content.indexOf('Paper is a design and vector');
    console.log(f, 'length:', content.length, 'contains Paper docs:', idx !== -1);
  }
}
