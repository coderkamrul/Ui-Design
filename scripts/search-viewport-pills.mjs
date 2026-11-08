import fs from "fs";

const c = fs.readFileSync("components/Viewport.jsx", "utf8");
const lines = c.split("\n");
lines.forEach((l, i) => {
  if (l.includes("rgba(") || l.includes("bg-[") || l.includes("bg-[#")) {
    if (l.length < 120 && (l.includes("purple") || l.includes("pink") || l.includes("magenta") || l.includes("violet") || l.includes("E") || l.includes("F") || l.includes("D") || l.includes("C") || l.includes("240") || l.includes("250"))) {
      console.log(`${i+1}: ${l.trim()}`);
    }
  }
});
