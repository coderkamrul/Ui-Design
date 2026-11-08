import fs from "fs";
import { convertSnapshotToCanvasNodes } from "../lib/snapshot-import.js";

const html = fs.readFileSync("scripts/user_html.html", "utf-8");
console.log("HTML length:", html.length);

try {
  const res = await convertSnapshotToCanvasNodes(html, { measure: false, exactLayout: true });
  console.log("Success! Root IDs:", res.rootIds);
  console.log("Total nodes:", Object.keys(res.nodes).length);
  for (const rid of res.rootIds) {
    const root = res.nodes[rid];
    console.log(`Root ${rid}:`, root.type, root.name, `${root.w}x${root.h}`, root.layout);
    console.log(`Root childIds:`, root.childIds);
    for (const cid of root.childIds || []) {
      const child = res.nodes[cid];
      console.log(`  Child ${cid}:`, child.type, child.name, `${child.w}x${child.h}`, `pos: (${child.x}, ${child.y})`, child.layout, child.style?.customCss);
    }
  }
} catch (e) {
  console.error("Error running convertSnapshotToCanvasNodes:", e);
}
