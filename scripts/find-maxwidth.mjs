import fs from "fs";

function searchDir(dir) {
  for (const f of fs.readdirSync(dir)) {
    if (f === "node_modules" || f === ".next" || f === ".git") continue;
    const p = dir + "/" + f;
    if (fs.statSync(p).isDirectory()) searchDir(p);
    else if (p.endsWith(".js") || p.endsWith(".jsx")) {
      const c = fs.readFileSync(p, "utf8");
      const lines = c.split("\n");
      lines.forEach((l, i) => {
        if (l.includes("maxWidth")) console.log(`${p}:${i+1}: ${l.trim()}`);
      });
    }
  }
}
searchDir(".");
