import fs from "fs";

const c = fs.readFileSync("components/LayoutSection.jsx", "utf8");
const lines = c.split("\n");
console.log(lines.slice(1800, 1860).join("\n"));
