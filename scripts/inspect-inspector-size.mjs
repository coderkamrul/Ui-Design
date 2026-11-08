import fs from "fs";

const c = fs.readFileSync("components/Inspector.jsx", "utf8");
const lines = c.split("\n");
lines.forEach((l, i) => {
  if (l.includes("setNodeSizing") || l.includes("node.size") || l.includes("setNodeSize") || l.includes("wMode") || l.includes("hMode")) {
    if (l.length < 120) console.log(`${i+1}: ${l.trim()}`);
  }
});
