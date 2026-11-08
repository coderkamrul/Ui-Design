import fs from "fs";

function oklchToCss(oklch) {
  if (!oklch) return "#000000";
  if (typeof oklch === "string") return oklch;
  const val = oklch.value || oklch;
  if (val.mode === "oklch" || (val.l != null && val.c != null && val.h != null)) {
    const l = Math.round(val.l * 10000) / 10000;
    const c = Math.round(val.c * 10000) / 10000;
    const h = Math.round(val.h * 1000) / 1000;
    const a = val.alpha ?? 1;
    return a < 1 ? `oklch(${l} ${c} ${h} / ${a})` : `oklch(${l} ${c} ${h})`;
  }
  return val.hex || "#000000";
}

function extractTextFromPaperB(b) {
  if (!b) return "";
  if (typeof b === "string") return b;
  const parts = [];
  function walk(val) {
    if (typeof val === "string") parts.push(val);
    else if (Array.isArray(val)) {
      if (val[0] === "O" && val.length === 2) {
        walk(val[1]);
        return;
      }
      val.forEach(walk);
    } else if (val && typeof val === "object") {
      Object.values(val).forEach(walk);
    }
  }
  walk(b);
  return parts.join("");
}

console.log("OKLCH test:", oklchToCss({ value: { mode: "oklch", l: 0.66984, c: 0.18275, h: 249.224 } }));
console.log("Text B test:", extractTextFromPaperB({ "0": ["O", ["Kamrulhasan"]] }));
