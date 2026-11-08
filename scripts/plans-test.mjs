/**
 * Standalone checks for lib/plans.js (platform batch — plans/billing
 * demo state) — run with: node scripts/plans-test.mjs
 *
 * Loaded through a data: URL when a direct import fails (same pattern
 * as the other suites). plans.js is import-free precisely so this
 * works. Only the pure helpers are exercised here; the localStorage
 * helpers are client-only and return safe defaults under node.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

async function load(rel) {
  try {
    return await import(rel);
  } catch {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    return import(`data:text/javascript,${encodeURIComponent(src)}`);
  }
}

const { PLANS, planOf, effectiveVersionCap, withinLimit, loadPlanId } =
  await load("../lib/plans.js");

let checks = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks++;
};

// -- plan records --------------------------------------------------------
ok(PLANS.free.priceMonthly === 0 && PLANS.pro.priceMonthly === 15, "plan prices (own pricing)");
ok(PLANS.pro.priceYearly === 12, "pro yearly is $12/mo billed yearly");
ok(
  PLANS.free.maxFiles === 5 && PLANS.free.aiPerDay === 5,
  "free limits: 5 files, 5 AI/day",
);

// -- planOf fallbacks ------------------------------------------------------
ok(planOf("pro").id === "pro", "planOf('pro') → pro");
ok(planOf("free").id === "free", "planOf('free') → free");
ok(planOf("enterprise").id === "free", "planOf(unknown) → free fallback");
ok(planOf(undefined).id === "free", "planOf(undefined) → free fallback");
ok(planOf(null).id === "free", "planOf(null) → free fallback");
ok(planOf(42).id === "free", "planOf(non-string) → free fallback");

// -- effectiveVersionCap ---------------------------------------------------
ok(effectiveVersionCap("free") === 10, "free version cap is 10");
ok(effectiveVersionCap("pro") === 30, "pro version cap is 30");
ok(effectiveVersionCap("bogus") === 10, "unknown plan → free cap");

// -- withinLimit boundaries --------------------------------------------------
ok(withinLimit("free", "maxFiles", 4) === true, "free files: 4 of 5 fits one more");
ok(withinLimit("free", "maxFiles", 5) === false, "free files: 5 of 5 is full");
ok(withinLimit("free", "maxFiles", 6) === false, "free files: over the cap stays blocked");
ok(withinLimit("pro", "maxFiles", 100000) === true, "pro files: Infinity never blocks");
ok(withinLimit("free", "aiPerDay", 4) === true, "free AI: 4 of 5 fits one more");
ok(withinLimit("free", "aiPerDay", 5) === false, "free AI: 5 of 5 is used up");
ok(withinLimit("pro", "aiPerDay", 99999) === true, "pro AI: Infinity never blocks");
ok(withinLimit("free", "versionCap", 9) === true, "free versions: 9 of 10 fits");
ok(withinLimit("free", "versionCap", 10) === false, "free versions: 10 of 10 is full");
ok(withinLimit("pro", "versionCap", 29) === true, "pro versions: 29 of 30 fits");
ok(withinLimit("pro", "versionCap", 30) === false, "pro versions: 30 of 30 is full");

// -- storage helper safety under node (no window) -----------------------------
ok(loadPlanId() === "free", "loadPlanId defaults to free without localStorage");

console.log(`\n${checks} plans checks passed`);
