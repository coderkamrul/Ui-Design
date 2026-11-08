import { parseHtmlFragment, flattenElements } from "../lib/snapshot-import.js";
import fs from "fs";

let html = fs.readFileSync("scripts/user_paste.html", "utf-8");
html = html.replace(/<USER_REQUEST>/g, "").replace(/<\/USER_REQUEST>/g, "").trim();

const plainRoots = parseHtmlFragment(html);
console.log("plainRoots count:", plainRoots.length);
console.log("plainRoots[0] tag:", plainRoots[0]?.tag);
console.log("plainRoots[0] child count:", plainRoots[0]?.children?.length);
console.log("plainRoots[0] attrs style:", plainRoots[0]?.attrs?.style?.slice(0, 100));
