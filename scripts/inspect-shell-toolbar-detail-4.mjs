import fs from "fs";

const c = fs.readFileSync("components/EditorShell.jsx", "utf8");
const lines = c.split("\n");
console.log(lines.slice(2520, 2640).join("\n"));
