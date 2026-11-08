import fs from "fs";

const c = fs.readFileSync("components/Viewport.jsx", "utf8");
const lines = c.split("\n");
lines.forEach((l, i) => {
  if (l.includes("rgba(") || l.includes("#d") || l.includes("#e") || l.includes("#f") || l.includes("gap") || l.includes("pink") || l.includes("purple") || l.includes("guide")) {
    if (l.includes("color") || l.includes("background") || l.includes("border") || l.includes("stroke") || l.includes("fill")) {
      if (l.length < 120 && (l.includes("128") || l.includes("192") || l.includes("200") || l.includes("255") || l.includes("gap") || l.includes("pad"))) {
        console.log(`${i+1}: ${l.trim()}`);
      }
    }
  }
});
