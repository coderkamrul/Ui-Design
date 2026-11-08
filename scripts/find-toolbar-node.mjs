import fs from "fs";

for (const f of ["canvastool-files/file-landing.json", "canvastool-files/file-mw5mdwrk-x0qii.json"]) {
  if (fs.existsSync(f)) {
    const data = JSON.parse(fs.readFileSync(f, "utf8"));
    console.log(f, "nodes count:", Object.keys(data.nodes || {}).length);
    // Find node with 40 width or 462 height or type svg or containing pen/hand
    for (const [id, n] of Object.entries(data.nodes || {})) {
      if (n.w === 40 || n.h === 462 || (n.w >= 38 && n.w <= 42)) {
        console.log("Found toolbar-like node:", id, n.name, n.type, "w:", n.w, "h:", n.h, "children:", n.childIds?.length);
      }
    }
  }
}
