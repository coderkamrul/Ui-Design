import fs from "fs";

for (const f of ["scripts/step_3984.html", "scripts/step_4058.html", "scripts/step_4128.html"]) {
  const s = fs.readFileSync(f, "utf8");
  console.log(f, "length:", s.length, "first 200:", s.slice(0, 200).replace(/\n/g, " "));
}
