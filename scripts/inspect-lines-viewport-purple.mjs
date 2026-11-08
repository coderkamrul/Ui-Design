import fs from "fs";

const c = fs.readFileSync("components/Viewport.jsx", "utf8");
const lines = c.split("\n");
console.log(lines.slice(5770, 5875).join("\n"));
