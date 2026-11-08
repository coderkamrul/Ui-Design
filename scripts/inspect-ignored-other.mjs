import fs from "fs";

const c = fs.readFileSync("components/Inspector.jsx", "utf8");
const lines = c.split("\n");
console.log(lines.slice(3570, 3625).join("\n"));
