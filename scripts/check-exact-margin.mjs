import fs from "fs";

const c = fs.readFileSync("lib/snapshot-import.js", "utf8");
const match = c.match(/export const CONSUMED_CORE_PROPS = new Set\(\[([\s\S]*?)\]\);/);
if (match) {
  const props = match[1].split("\n").map(l => l.trim().replace(/[",]/g, "")).filter(Boolean);
  console.log("Margin props in CONSUMED_CORE_PROPS:", props.filter(p => p.includes("margin")));
}
