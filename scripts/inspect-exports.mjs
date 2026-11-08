import fs from "fs";

const c = fs.readFileSync("lib/snapshot-import.js", "utf8");
const lines = c.split("\n");
lines.forEach((l, i) => {
  if (l.startsWith("export ")) {
    console.log(`${i+1}: ${l.slice(0, 80)}`);
  }
});
