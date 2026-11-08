import fs from "fs";

const data = JSON.parse(fs.readFileSync("canvastool-files/file-mw5mdwrk-x0qii.json", "utf8"));
for (const [id, n] of Object.entries(data.nodes || {})) {
  if (n.type === "svg" || (n.childIds && n.childIds.length > 5)) {
    console.log(id, n.name, n.type, "w:", n.w, "h:", n.h, "children:", n.childIds?.length);
  }
}
