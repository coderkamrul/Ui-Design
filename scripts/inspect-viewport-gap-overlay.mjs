import fs from "fs";

const c = fs.readFileSync("components/Viewport.jsx", "utf8");
const lines = c.split("\n");
lines.forEach((l, i) => {
  if (l.includes("layout.gap") || l.includes("gapStrip") || l.includes("gapOverlay") || (l.includes("gap") && l.includes("render"))) {
    console.log(`${i+1}: ${l.trim()}`);
  }
});
