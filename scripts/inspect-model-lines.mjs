import fs from "fs";

const c = fs.readFileSync("lib/model.js", "utf8");
const lines = c.split("\n");
console.log(lines.slice(420, 520).join("\n"));
