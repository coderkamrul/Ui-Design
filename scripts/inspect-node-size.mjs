import fs from "fs";

const c = fs.readFileSync("lib/snapshot-import.js", "utf8");
const lines = c.split("\n");
lines.forEach((l, i) => {
  if (l.includes(".size =") || l.includes("size:") || l.includes("size =")) {
    if (l.length < 120) console.log(`${i+1}: ${l.trim()}`);
  }
});
