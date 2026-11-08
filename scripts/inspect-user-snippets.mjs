import fs from "fs";

for (const f of ["scripts/user_full_snippet.html", "scripts/user_html.html", "scripts/user_prompt.html"]) {
  const s = fs.readFileSync(f, "utf8");
  console.log(f, "len:", s.length, "svgs:", (s.match(/<svg/g) || []).length);
  const match = s.match(/<x-paper-html>[\s\S]*?<\/x-paper-html>/);
  if (match) {
    console.log("  has x-paper-html!");
  }
}
