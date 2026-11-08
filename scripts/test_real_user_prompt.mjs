import fs from "fs";
import { convertSnapshotToCanvasNodes } from "../lib/snapshot-import.js";

const html = fs.readFileSync("scripts/user_prompt.html", "utf-8");
console.log("User prompt HTML length:", html.length);

try {
  const res = await convertSnapshotToCanvasNodes(html, { measure: false, exactLayout: true });
  console.log("Success! Root IDs:", res.rootIds);
  console.log("Total nodes created:", Object.keys(res.nodes).length);
  for (const rid of res.rootIds) {
    const root = res.nodes[rid];
    console.log(`Root ${rid}:`, root.type, root.name, `${root.w}x${root.h}`, root.layout);
    console.log(`Root childIds count:`, root.childIds?.length);
  }
} catch (e) {
  console.error("Error running convertSnapshotToCanvasNodes:", e);
}
