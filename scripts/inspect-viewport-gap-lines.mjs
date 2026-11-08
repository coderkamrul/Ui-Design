import fs from "fs";

const c = fs.readFileSync("components/Viewport.jsx", "utf8");
const lines = c.split("\n");
console.log(lines.slice(5750, 5825).join("\n"));
