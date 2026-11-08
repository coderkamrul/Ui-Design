import fs from "fs";

const s = fs.readFileSync("scripts/user_prompt.html", "utf8");
// Let's see the SVGs and elements
const svgs = [...s.matchAll(/<svg[^>]*>[\s\S]*?<\/svg>/g)].map(m => m[0]);
console.log("SVGs count:", svgs.length);
svgs.slice(0, 10).forEach((svg, i) => {
  console.log(`SVG ${i}:`, svg.slice(0, 150));
});
