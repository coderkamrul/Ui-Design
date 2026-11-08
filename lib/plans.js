/**
 * Plans & billing — plan definitions and limit helpers (platform batch).
 *
 * Import-free on purpose, like lib/versions.js and lib/collab.js, so
 * scripts/plans-test.mjs can load this file directly under node.
 *
 * HONEST SCOPE: plan state is LOCAL DEMO STATE. `planId` persists in
 * this browser (localStorage key `canvastool:plan`) in BOTH modes —
 * the Supabase backend deliberately carries no plan column. A real
 * deployment gets billing state from the payment provider (webhooks →
 * server-side entitlement), never from the client; anything the client
 * asserts about its own plan is a UI hint, not an entitlement. The
 * upgrade checkout in components/UpgradeDialog.jsx is a demo form: it
 * processes nothing and takes no payment.
 *
 * Prices below are THIS product's own (Pro: $15 monthly, or $12/mo
 * billed yearly) — they are not copied from any other tool.
 */

/** The two plans. `Infinity` limits mean "no cap" for that plan. */
export const PLANS = {
  free: {
    id: "free",
    name: "Free",
    priceMonthly: 0,
    priceYearly: 0,
    maxFiles: 5,
    versionCap: 10,
    aiPerDay: 5,
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceMonthly: 15,
    priceYearly: 12,
    maxFiles: Infinity,
    versionCap: 30,
    aiPerDay: Infinity,
  },
};

export const DEFAULT_PLAN_ID = "free";

/** localStorage keys (client-only helpers below guard on `window`). */
export const PLAN_STORAGE_KEY = "canvastool:plan";
export const AI_USAGE_STORAGE_KEY = "canvastool:ai-usage";

/**
 * Look up a plan by id. Unknown / missing / malformed ids fall back to
 * Free — a corrupt stored plan must never accidentally grant Pro.
 * @param {string} [id]
 * @returns {Object} the plan record (PLANS.free for anything unknown)
 */
export function planOf(id) {
  return typeof id === "string" && PLANS[id] ? PLANS[id] : PLANS.free;
}

/**
 * The version-history cap for a plan — the value the store passes to
 * versions.pruneVersions in place of the MAX_VERSIONS default, so the
 * M7 behaviour is unchanged for Pro (30) and tighter for Free (10).
 * @param {string} [planId]
 * @returns {number}
 */
export function effectiveVersionCap(planId) {
  return planOf(planId).versionCap;
}

/**
 * Is `count` (the CURRENT total, before adding one more) within the
 * plan's limit for `kind` ("maxFiles" | "versionCap" | "aiPerDay")?
 * True when one more still fits: count < limit. Infinity limits are
 * always within. Unknown kinds are treated as unlimited (fail-open for
 * typos in UI code; the three real call-sites use the real kinds).
 * @param {string} planId @param {string} kind @param {number} count
 * @returns {boolean}
 */
export function withinLimit(planId, kind, count) {
  const limit = planOf(planId)[kind];
  if (typeof limit !== "number") return true;
  if (!Number.isFinite(limit)) return true;
  return typeof count === "number" && count < limit;
}

// ===========================================================================
// Client-only storage helpers (localStorage). Server / node callers get
// the safe defaults — plan state is a browser concern by design.
// ===========================================================================

function storage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The persisted plan id ("free" unless a demo upgrade stored "pro"). */
export function loadPlanId() {
  const raw = storage()?.getItem(PLAN_STORAGE_KEY);
  return raw && PLANS[raw] ? raw : DEFAULT_PLAN_ID;
}

/** Persist the plan id (demo upgrade / downgrade). */
export function savePlanId(planId) {
  const id = planOf(planId).id;
  storage()?.setItem(PLAN_STORAGE_KEY, id);
  return id;
}

/** Local calendar day key for the AI usage counter. */
function todayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * AI generations used today: { date, count }. A stored record from a
 * previous day reads as zero — the counter resets at local midnight
 * (well, UTC midnight; close enough for a demo quota).
 */
export function readAiUsage(now = new Date()) {
  const date = todayKey(now);
  try {
    const raw = storage()?.getItem(AI_USAGE_STORAGE_KEY);
    if (!raw) return { date, count: 0 };
    const parsed = JSON.parse(raw);
    if (parsed?.date !== date || typeof parsed?.count !== "number") {
      return { date, count: 0 };
    }
    return { date, count: Math.max(0, Math.floor(parsed.count)) };
  } catch {
    return { date, count: 0 };
  }
}

/** Record one AI generation; returns today's new count. */
export function recordAiUsage(now = new Date()) {
  const usage = readAiUsage(now);
  const next = { date: usage.date, count: usage.count + 1 };
  try {
    storage()?.setItem(AI_USAGE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota/denied storage: the in-memory count still reports honestly.
  }
  return next.count;
}

/** Generations left today for a plan (Infinity on Pro). */
export function aiGenerationsLeft(planId, now = new Date()) {
  const limit = planOf(planId).aiPerDay;
  if (!Number.isFinite(limit)) return Infinity;
  return Math.max(0, limit - readAiUsage(now).count);
}
