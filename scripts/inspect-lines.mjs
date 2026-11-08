import fs from "fs";

const c = fs.readFileSync("lib/snapshot-import.js", "utf8");
const lines = c.split("\n");
console.log("=== 2240-2280 ===");
console.log(lines.slice(2240, 2280).join("\n"));
console.log("=== 2720-2760 ===");
console.log(lines.slice(2720, 2760).join("\n"));
console.log("=== 2840-2880 ===");
console.log(lines.slice(2840, 2880).join("\n"));
