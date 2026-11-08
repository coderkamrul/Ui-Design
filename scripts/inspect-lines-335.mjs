import fs from "fs";

const c = fs.readFileSync("components/CanvasNode.jsx", "utf8");
const lines = c.split("\n");
console.log(lines.slice(335, 370).join("\n"));
