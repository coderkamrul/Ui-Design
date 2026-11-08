import fs from "fs";

const c = fs.readFileSync("components/LayoutSection.jsx", "utf8");
const lines = c.split("\n");
console.log("=== 2380-2430 ===");
console.log(lines.slice(2380, 2430).join("\n"));
console.log("=== 2660-2690 ===");
console.log(lines.slice(2660, 2690).join("\n"));
