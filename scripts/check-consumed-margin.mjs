import fs from "fs";

const c = fs.readFileSync("lib/snapshot-import.js", "utf8");
// Check what margin properties are in CONSUMED_CORE_PROPS
const match = c.match(/export const CONSUMED_CORE_PROPS = new Set\(\[([\s\S]*?)\]\);/);
if (match) {
  console.log("Contains margin:", match[1].includes("margin"));
}
