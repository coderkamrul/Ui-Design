import fs from "fs";

const c = fs.readFileSync("components/LayoutSection.jsx", "utf8");
const lines = c.split("\n");
console.log(lines.slice(2910, 2960).join("\n"));
