import fs from "fs";

const c = fs.readFileSync("lib/snapshot-import.js", "utf8");
const lines = c.split("\n");
console.log(lines.slice(3335, 3370).join("\n"));
