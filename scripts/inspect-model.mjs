import fs from "fs";

const c = fs.readFileSync("lib/model.js", "utf8");
const lines = c.split("\n");
lines.forEach((l, i) => {
  if (l.includes("sizePx") || l.includes("normalizeNode") || l.includes("size") || l.includes("wMode")) {
    if (l.length < 120) console.log(`${i+1}: ${l.trim()}`);
  }
});
