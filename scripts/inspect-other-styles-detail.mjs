import fs from "fs";

const c = fs.readFileSync("components/Inspector.jsx", "utf8");
const lines = c.split("\n");
console.log(lines.slice(3620, 3670).join("\n"));
