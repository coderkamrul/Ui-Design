import fs from "fs";

const c = fs.readFileSync("components/CanvasNode.jsx", "utf8");
const lines = c.split("\n");
lines.forEach((l, i) => {
  if (l.includes("flexCtx")) {
    console.log(`${i+1}: ${l.trim()}`);
  }
});
