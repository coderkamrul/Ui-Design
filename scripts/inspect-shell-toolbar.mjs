import fs from "fs";

const c = fs.readFileSync("components/EditorShell.jsx", "utf8");
const lines = c.split("\n");
lines.forEach((l, i) => {
  if (l.includes("462") || l.includes("lucide") || (l.includes("cursor") && l.includes("hand")) || l.includes("ToolBar") || l.includes("toolbar") || l.includes("leftToolbar")) {
    if (l.length < 120) console.log(`${i+1}: ${l.trim()}`);
  }
});
