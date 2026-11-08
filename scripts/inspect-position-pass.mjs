import fs from "fs";

const c = fs.readFileSync("lib/snapshot-import.js", "utf8");
const lines = c.split("\n");
lines.forEach((l, i) => {
  if (l.includes("function position") || l.includes("layoutBlock") || l.includes("layoutFlex") || l.includes("function nodeHeight") || l.includes("Positioning pass")) {
    console.log(`${i+1}: ${l.trim()}`);
  }
});
