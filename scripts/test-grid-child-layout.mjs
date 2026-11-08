import { defaultGrid, gridContainerStyle, gridChildStyle, parseGridTracks, serializeGridTracks } from "../lib/grid.js";
import assert from "assert";

console.log("--- 1. Testing Grid Child Sizing Resolution ---");

const childFixed = {
  id: "c1",
  type: "rect",
  size: { w: { kind: "fixed", px: 120 }, h: { kind: "fixed", px: 80 } },
  gridLayout: { gridColumnStart: "1", gridRowStart: "1" },
  position: { absolute: false, x: 0, y: 0 },
};

const childFill = {
  id: "c2",
  type: "frame",
  size: { w: { kind: "fill" }, h: { kind: "fill" } },
  gridLayout: { gridColumn: "2 / span 2" },
  position: { absolute: false, x: 0, y: 0 },
};

const childFit = {
  id: "c3",
  type: "button",
  size: { w: { kind: "fit" }, h: { kind: "fit" } },
  gridLayout: { alignSelf: "center", justifySelf: "center" },
  position: { absolute: false, x: 0, y: 0 },
};

const styleFixed = gridChildStyle(childFixed);
console.log("Fixed child style:", styleFixed);
assert.strictEqual(styleFixed.width, "120px");
assert.strictEqual(styleFixed.height, "80px");
assert.strictEqual(styleFixed.gridColumn, "1");
assert.strictEqual(styleFixed.gridRow, "1");

const styleFill = gridChildStyle(childFill);
console.log("Fill child style:", styleFill);
assert.strictEqual(styleFill.width, "100%");
assert.strictEqual(styleFill.height, "100%");
assert.strictEqual(styleFill.gridColumn, "2 / span 2");

const styleFit = gridChildStyle(childFit);
console.log("Fit child style:", styleFit);
assert.strictEqual(styleFit.width, "fit-content");
assert.strictEqual(styleFit.height, "fit-content");
assert.strictEqual(styleFit.alignSelf, "center");
assert.strictEqual(styleFit.justifySelf, "center");

console.log("✓ All grid child sizing and placement assertions passed.");

console.log("\n--- 2. Testing Grid Container Dynamic Layout Settings ---");
const gridLayout = defaultGrid();
gridLayout.columns = "repeat(3, 1fr)";
gridLayout.columnGap = 24;
gridLayout.rowGap = 12;
gridLayout.alignItems = "center";
gridLayout.justifyItems = "stretch";

const containerStyle = gridContainerStyle(gridLayout);
console.log("Container style:", containerStyle);
assert.strictEqual(containerStyle.display, "grid");
assert.strictEqual(containerStyle.gridTemplateColumns, "repeat(3, 1fr)");
assert.strictEqual(containerStyle.columnGap, "24px");
assert.strictEqual(containerStyle.rowGap, "12px");
assert.strictEqual(containerStyle.alignItems, "center");
assert.strictEqual(containerStyle.justifyItems, "stretch");

console.log("✓ Grid container style builder assertions passed.");

console.log("\nALL GRID CHILD LAYOUT & SIZING TESTS PASSED!");
