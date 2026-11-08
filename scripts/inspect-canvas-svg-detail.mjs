import fs from "fs";

const c = fs.readFileSync("components/CanvasNode.jsx", "utf8");
const lines = c.split("\n");
console.log(lines.slice(1665, 1715).join("\n"));
