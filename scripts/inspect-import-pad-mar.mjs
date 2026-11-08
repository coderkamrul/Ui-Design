import fs from "fs";

const c = fs.readFileSync("lib/snapshot-import.js", "utf8");
const lines = c.split("\n");
lines.forEach((l, i) => {
  if (l.includes("node.padding =") || l.includes("node.margin =") || l.includes("padding:") || l.includes("margin:")) {
    if (l.length < 100) console.log(`${i+1}: ${l.trim()}`);
  }
});
