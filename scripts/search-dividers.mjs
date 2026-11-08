import fs from "fs";

const c = fs.readFileSync("lib/snapshot-import.js", "utf8");
const lines = c.split("\n");
lines.forEach((l, i) => {
  if (l.includes("hr") || l.includes("separator") || l.includes("divider") || l.includes("svg") || l.includes("#d") || l.includes("#c") || l.includes("#e")) {
    if (l.length < 100 && (l.includes("color") || l.includes("stroke") || l.includes("fill") || l.includes("tag ==="))) {
      console.log(`${i+1}: ${l.trim()}`);
    }
  }
});
