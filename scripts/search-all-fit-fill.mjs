import fs from "fs";
import path from "path";

function searchDir(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) searchDir(p);
    else if (p.endsWith(".jsx")) {
      const c = fs.readFileSync(p, "utf8");
      const lines = c.split("\n");
      lines.forEach((l, i) => {
        if (/["'`]Fit["'`]|["'`]Fill["'`]|["'`]Hug["'`]|>Fit<|>Fill<|>Hug</.test(l)) {
          console.log(`${p}:${i+1}: ${l.trim()}`);
        }
      });
    }
  }
}
searchDir("components");
