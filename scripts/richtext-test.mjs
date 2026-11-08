import assert from "node:assert/strict";
import { parseStyleString, serializeStyleMap, cleanAndNormalizeHtml } from "../lib/richtext.js";

let passed = 0;
function check(desc, fn) {
  try {
    fn();
    console.log(`ok - ${desc}`);
    passed++;
  } catch (e) {
    console.error(`FAIL - ${desc}`);
    throw e;
  }
}

// 1. Style parsing and serialization
check("parse and serialize style string", () => {
  const map = parseStyleString("font-style: italic; color: rgb(227, 198, 244); font-weight: normal;");
  assert.equal(map["font-style"], "italic");
  assert.equal(map["color"], "rgb(227, 198, 244)");
  assert.equal(map["font-weight"], "normal");
  const serialized = serializeStyleMap(map);
  assert.equal(serialized, "color: rgb(227, 198, 244); font-style: italic");
});

// 2. Clean nested and empty spans
check("clean nested and empty spans from user example", () => {
  const raw = 'A <span style="font-style: italic; color: rgb(40, 43, 49);"></span><span style="color: rgb(231, 202, 250);"><span style="font-style: italic; color: rgb(227, 198, 244);">surprise</span></span> for you in the caption';
  const cleaned = cleanAndNormalizeHtml(raw);
  assert.equal(
    cleaned,
    'A <span style="color: rgb(227, 198, 244); font-style: italic">surprise</span> for you in the caption'
  );
});

console.log(`\n${passed} richtext checks passed`);
