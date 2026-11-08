import fs from "fs";

const s = fs.readFileSync("scripts/step_3984.html", "utf8");
console.log("Has svg count:", (s.match(/<svg/g) || []).length);
// Find text or tags inside
const tags = [...s.matchAll(/<([a-z0-9-]+)[^>]*>/gi)].map(m => m[0]);
console.log("Total tags:", tags.length);
tags.slice(0, 15).forEach(t => console.log(t.slice(0, 120)));
