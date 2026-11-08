import assert from "node:assert/strict";
import { parseGridTracks, serializeGridTracks, defaultGrid, gridContainerStyle, gridChildStyle } from "../lib/grid.js";
import { convertSnapshotToCanvasNodes } from "../lib/snapshot-import.js";

console.log("--- 1. Testing Grid Track Parser and Serializer ---");
const t1 = parseGridTracks("1fr 200px 30% auto");
assert.equal(t1.length, 4);
assert.equal(t1[0].size, 1);
assert.equal(t1[0].unit, "fr");
assert.equal(t1[1].size, 200);
assert.equal(t1[1].unit, "px");
assert.equal(t1[2].size, 30);
assert.equal(t1[2].unit, "%");
assert.equal(t1[3].unit, "auto");
console.log("✓ Basic track parsing passed.");

const rep = parseGridTracks("repeat(3, 1fr)");
assert.equal(rep.length, 3);
assert.equal(rep[0].unit, "fr");
assert.equal(serializeGridTracks(rep), "repeat(3, 1fr)");
console.log("✓ Repeat track parsing and serialization passed.");

console.log("\n--- 2. Testing Grid Container Style Builder ---");
const gridDef = defaultGrid();
const style = gridContainerStyle(gridDef);
assert.equal(style.display, "grid");
assert.equal(style.gridTemplateColumns, "repeat(2, 1fr)");
assert.equal(style.columnGap, "16px");
assert.equal(style.rowGap, "16px");
console.log("✓ Grid container style builder passed.");

console.log("\n--- 3. Testing HTML Snapshot Import for CSS Grid ---");
const gridHtml = `
<div style="display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: auto auto; column-gap: 24px; row-gap: 16px; justify-items: center; align-items: stretch; width: 600px; height: 400px; background-color: rgb(240, 240, 240);">
  <div style="grid-column: 1 / span 2; grid-row: 1; justify-self: start; background-color: rgb(255, 0, 0);">Child 1</div>
  <div style="grid-column: 3; grid-row: 1 / 3; background-color: rgb(0, 255, 0);">Child 2</div>
  <div style="grid-column: 1 / -1; grid-row: 2; background-color: rgb(0, 0, 255);">Child 3</div>
</div>
`;

const res = await convertSnapshotToCanvasNodes(gridHtml, { measure: false });
const root = res.roots[0];
assert.equal(root.layout.mode, "grid");
assert.equal(root.layout.display, "grid");
assert.equal(root.layout.columns, "repeat(3, 1fr)");
assert.equal(root.layout.rowGap, 16);
assert.equal(root.layout.columnGap, 24);
assert.equal(root.layout.justifyItems, "center");
assert.equal(root.layout.alignItems, "stretch");
console.log("✓ Grid container imported with native grid layout.");

// Check child placements
const kids = root.childIds.map((id) => res.all.find((n) => n.id === id));
assert.equal(kids.length, 3);
assert.equal(kids[0].gridLayout?.gridColumn, "1 / span 2");
assert.equal(kids[0].gridLayout?.gridRow, "1");
assert.equal(kids[0].gridLayout?.justifySelf, "start");

assert.equal(kids[1].gridLayout?.gridColumn, "3");
assert.equal(kids[1].gridLayout?.gridRow, "1 / 3");

assert.equal(kids[2].gridLayout?.gridColumn, "1 / -1");
assert.equal(kids[2].gridLayout?.gridRow, "2");
console.log("✓ Grid children imported with full gridLayout placement.");

console.log("\n--- 4. Checking Cleanliness of customCss (Other styles) ---");
const rootCustomCss = Object.keys(root.style?.customCss || {});
console.log("Root customCss keys:", rootCustomCss);
assert.ok(!rootCustomCss.includes("grid-template-columns"));
assert.ok(!rootCustomCss.includes("grid-template-rows"));
assert.ok(!rootCustomCss.includes("column-gap"));
assert.ok(!rootCustomCss.includes("row-gap"));
assert.ok(!rootCustomCss.includes("justify-items"));
assert.ok(!rootCustomCss.includes("align-items"));
console.log("✓ Grid properties correctly consumed from Other styles.");

console.log("\nALL GRID IMPORT & RUNTIME TESTS PASSED!");
