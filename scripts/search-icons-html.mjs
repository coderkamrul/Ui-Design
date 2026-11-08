import fs from "fs";

function search(file) {
  if (!fs.existsSync(file)) return;
  const s = fs.readFileSync(file, "utf8");
  // Check if it has 462 or tool names
  const hasIcons = s.includes("cursor") || s.includes("hand") || s.includes("rosette");
  if (hasIcons) {
    console.log(file, "has icons!");
  }
}

for (const f of fs.readdirSync("scripts")) {
  if (f.endsWith(".html")) search("scripts/" + f);
}
