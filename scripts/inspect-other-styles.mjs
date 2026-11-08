import fs from "fs";

const c = fs.readFileSync("components/Inspector.jsx", "utf8");
const lines = c.split("\n");
lines.forEach((l, i) => {
  if (l.toLowerCase().includes("other style") || l.includes("rawStyle")) {
    console.log(`${i+1}: ${l.trim()}`);
  }
});
