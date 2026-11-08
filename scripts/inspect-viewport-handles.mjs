import fs from "fs";

const c = fs.readFileSync("components/Viewport.jsx", "utf8");
const lines = c.split("\n");
lines.slice(5400, 6000).forEach((l, i) => {
  if (l.includes("handle") || l.includes("gap") || l.includes("Pill") || l.includes("pill") || l.includes("line")) {
    console.log(`${5401 + i}: ${l.trim()}`);
  }
});
