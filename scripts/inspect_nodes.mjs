import fs from "fs";
import { convertSnapshotToCanvasNodes } from "../lib/snapshot-import.js";

const html = fs.readFileSync("scripts/user_prompt.html", "utf-8");
const res = await convertSnapshotToCanvasNodes(html, { measure: false, exactLayout: true });

console.log("=== NODES WITH customCss ===");
let countCustomCss = 0;
for (const [id, node] of Object.entries(res.nodes)) {
  if (node.style?.customCss) {
    countCustomCss++;
    const keys = Object.keys(node.style.customCss);
    if (keys.length > 0) {
      console.log(`Node ${id} (${node.name}, ${node.type}):`, keys.slice(0, 10));
    }
  }
}
console.log("Total nodes with customCss:", countCustomCss);

console.log("\n=== NODES WITH layout ===");
for (const [id, node] of Object.entries(res.nodes)) {
  if (node.type === "frame") {
    console.log(`Frame ${id} (${node.name}): layout mode=${node.layout?.mode}, dir=${node.layout?.direction}, w=${node.w}, h=${node.h}, children=${node.childIds?.length}`);
  }
}
