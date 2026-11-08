import fs from "fs";
import { convertHtml } from "../lib/snapshot-import.js";

const html = fs.readFileSync("scripts/context7_card_section.html", "utf8");
const result = convertHtml(html, { defaultWidth: 1200 });
const byId = {};
for (const n of result.all) byId[n.id] = n;

// Find any node that had search card or p-4 or rounded-2xl
for (const n of result.all) {
  if (n.borders && n.borders.length > 0) {
    console.log("Node with borders:", n.id, n.name, "fills count:", n.fills?.length, "fills:", n.fills, "borders:", n.borders.map(b => `${b.side} ${b.width}px ${b.color}`));
  }
}
