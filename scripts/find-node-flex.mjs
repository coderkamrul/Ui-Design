import fs from "fs";

const c = fs.readFileSync("lib/snapshot-import.js", "utf8");
const lines = c.split("\n");
lines.forEach((l, i) => {
  if (l.includes("node.flex =") || l.includes("node.flex = {") || l.includes("conv.stats.flex +=")) {
    console.log(`${i+1}: ${l.trim()}`);
  }
});
