import { toReactStyleKey, convertSnapshotToCanvasNodes } from "../lib/snapshot-import.js";
import fs from "fs";

async function run() {
  const html = fs.readFileSync("scripts/user_full_snippet.html", "utf8");
  const result = await convertSnapshotToCanvasNodes(html, { measure: false });
  let hasError = false;

  for (const n of result.all) {
    const rawProps = n.style?.customCss || {};
    for (const key of Object.keys(rawProps)) {
      const reactKey = toReactStyleKey(key);
      if (reactKey.startsWith("-") && !reactKey.startsWith("--")) {
        console.error("INVALID REACT PROP KEY:", reactKey, "from CSS prop:", key, "on node:", n.name);
        hasError = true;
      }
    }
  }

  if (!hasError) {
    console.log("SUCCESS: All", result.all.length, "nodes have valid React style keys!");
  }
  console.log("toReactStyleKey('--tw-shadow') =", toReactStyleKey("--tw-shadow"));
  console.log("toReactStyleKey('-webkit-appearance') =", toReactStyleKey("-webkit-appearance"));
  console.log("toReactStyleKey('letter-spacing') =", toReactStyleKey("letter-spacing"));
  console.log("toReactStyleKey('-ms-transform') =", toReactStyleKey("-ms-transform"));
  console.log("toReactStyleKey('-moz-osx-font-smoothing') =", toReactStyleKey("-moz-osx-font-smoothing"));

  // Check specific test cases for --tw-shadow
  if (toReactStyleKey("--tw-shadow") !== "--tw-shadow") {
    throw new Error("--tw-shadow must NOT be converted to -TwShadow!");
  }
  if (toReactStyleKey("-webkit-appearance") !== "WebkitAppearance") {
    throw new Error("-webkit-appearance must be WebkitAppearance!");
  }
  console.log("ALL ASSERTIONS PASSED!");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
