import { convertSnapshotToCanvasNodes } from "../lib/snapshot-import.js";
import assert from "assert";

async function run() {
  console.log("--- Testing Individual SVG Element Decomposition on Import ---");

  const svgHtml = `
    <div style="width: 200px; height: 200px;">
      <svg width="100" height="100" viewBox="0 0 100 100" fill="none" stroke="#333333" stroke-width="2">
        <circle id="head" cx="50" cy="50" r="40" fill="#ff0000" />
        <rect id="body" x="10" y="10" width="30" height="20" rx="4" fill="#00ff00" />
        <line id="arm" x1="0" y1="0" x2="20" y2="20" stroke="#0000ff" stroke-width="3" />
        <polygon id="star" points="25,5 30,18 45,18 33,26 38,40 25,30 13,40 18,26 5,18 20,18" fill="#ffff00" />
        <g id="accessory" transform="rotate(45 50 50)">
          <path id="hat" d="M 40 40 L 60 40 L 50 20 Z" fill="#aa00aa" />
        </g>
      </svg>
    </div>
  `;

  const result = await convertSnapshotToCanvasNodes(svgHtml, { measure: false });
  console.log("Total nodes imported:", result.all.length);

  const svgNode = result.all.find((n) => n.type === "svg");
  assert(svgNode, "SVG container node must exist!");
  console.log("SVG node found:", svgNode.id, svgNode.name);
  console.log("SVG childIds:", svgNode.childIds);

  // Check that the top-level children include Circle, Rectangle, Line, Polygon, and Group
  const childNodes = svgNode.childIds.map((id) => result.nodes[id]);
  const circleNode = childNodes.find((c) => c.name === "Head" || c.name === "Circle");
  const rectNode = childNodes.find((c) => c.name === "Body" || c.name === "Rectangle");
  const lineNode = childNodes.find((c) => c.name === "Arm" || c.name === "Line" || c.name === "Path");
  const polygonNode = childNodes.find((c) => c.name === "Star" || c.name === "Polygon");
  const groupNode = childNodes.find((c) => c.name === "Accessory" || c.name === "Group");

  assert(circleNode, "Circle must be imported as an individual node!");
  assert(rectNode, "Rectangle must be imported as an individual node!");
  assert(lineNode, "Line must be imported as an individual node!");
  assert(polygonNode, "Polygon must be imported as an individual node!");
  assert(groupNode, "Group must be imported as an individual node!");

  console.log("✓ Circle node:", circleNode.id, "d:", circleNode.d, "fill:", circleNode.style?.fill?.color);
  console.log("✓ Rect node:", rectNode.id, "d:", rectNode.d, "fill:", rectNode.style?.fill?.color);
  console.log("✓ Line node:", lineNode.id, "d:", lineNode.d, "stroke:", lineNode.style?.stroke?.paint?.color);
  console.log("✓ Polygon node:", polygonNode.id, "d:", polygonNode.d, "fill:", polygonNode.style?.fill?.color);
  console.log("✓ Group node:", groupNode.id, "childIds:", groupNode.childIds);

  assert.strictEqual(circleNode.style?.fill?.color.toUpperCase(), "#FF0000", "Circle fill must be preserved as #FF0000");
  assert.strictEqual(rectNode.style?.fill?.color.toUpperCase(), "#00FF00", "Rect fill must be preserved as #00FF00");
  assert.strictEqual(lineNode.style?.stroke?.paint?.color.toUpperCase(), "#0000FF", "Line stroke must be preserved as #0000FF");
  assert.strictEqual(polygonNode.style?.fill?.color.toUpperCase(), "#FFFF00", "Polygon fill must be preserved as #FFFF00");

  const hatNode = result.nodes[groupNode.childIds[0]];
  assert(hatNode, "Hat node inside group must exist!");
  console.log("✓ Path node in group:", hatNode.id, hatNode.name, "fill:", hatNode.style?.fill?.color);
  assert.strictEqual(hatNode.style?.fill?.color.toUpperCase(), "#AA00AA", "Hat fill must be preserved as #AA00AA");

  console.log("\nALL SVG DECOMPOSITION ASSERTIONS PASSED!");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
