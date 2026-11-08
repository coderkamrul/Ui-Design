import fs from "fs";

const c = fs.readFileSync("components/LayoutSection.jsx", "utf8");
const lines = c.split("\n");
lines.forEach((l, i) => {
  if (l.includes("getCurrentFitPx")) {
    console.log(`${i+1}: ${l.trim()}`);
  }
});
