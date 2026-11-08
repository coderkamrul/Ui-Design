import fs from "fs";

const c = fs.readFileSync("components/Viewport.jsx", "utf8");
const lines = c.split("\n");
lines.forEach((l, i) => {
  if (l.includes("gap") || l.includes("Gap")) {
    if (l.includes("color") || l.includes("bg-") || l.includes("border") || l.includes("background")) {
      console.log(`${i+1}: ${l.trim()}`);
    }
  }
});
