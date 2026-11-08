import fs from "fs";
import { convertHtml } from "../lib/snapshot-import.js";

const html = fs.readFileSync("scripts/context7_card_section.html", "utf8");
const result = convertHtml(html, { defaultWidth: 1200 });
const byId = {};
for (const n of result.all) byId[n.id] = n;

const root = result.roots[0];
for (let i = 0; i < root.childIds.length; i++) {
  const cid = root.childIds[i];
  const c = byId[cid];
  console.log(`\n--- Root Child ${i} (${c.id}) ---`);
  console.log("name:", c.name);
  console.log("classes:", c.classList || c.classes);
  console.log("fills:", c.fills);
  console.log("borders:", c.borders);
  console.log("childIds count:", c.childIds?.length);
  for (const ccid of (c.childIds || [])) {
    const cc = byId[ccid];
    console.log("   Subchild:", cc.id, cc.name, "fills:", cc.fills?.length, "borders:", cc.borders?.length, "style:", cc.style);
  }
}
