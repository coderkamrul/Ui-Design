/**
 * Standalone checks for lib/collab.js (M6 multiplayer helpers) — run
 * with: node scripts/collab-test.mjs
 *
 * Loaded through a data: URL when a direct import fails (same pattern
 * as the other suites: the package has no "type": "module"). collab.js
 * is import-free precisely so this works.
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

const C = await load("../lib/collab.js");

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const peerState = (id, extra = {}) => ({
  identity: { id, name: `User ${id}`, color: C.colorForId(id) },
  pageId: "page-1",
  cursor: null,
  selection: [],
  updatedAt: 1000,
  ...extra,
});

check("colorForId is deterministic and always lands in the palette", () => {
  assert.equal(C.PEER_PALETTE.length, 8);
  assert.ok(C.PEER_PALETTE.includes("#12A594"), "palette includes collab teal");
  for (const id of ["tab-1", "user-42", "550e8400-e29b-41d4-a716-446655440000", "", "x"]) {
    const a = C.colorForId(id);
    assert.equal(a, C.colorForId(id), "same id, same colour, every call");
    assert.ok(C.PEER_PALETTE.includes(a), `${a} is a palette colour`);
  }
  // Different ids should not ALL collapse to one colour.
  const spread = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(C.colorForId));
  assert.ok(spread.size > 1, "palette is actually used");
});

check("makeIdentity trims names, defaults to Guest, colours by id", () => {
  const idn = C.makeIdentity("tab-9", "  Md  ");
  assert.equal(idn.id, "tab-9");
  assert.equal(idn.name, "Md");
  assert.equal(idn.color, C.colorForId("tab-9"));
  assert.equal(C.makeIdentity("tab-9", "   ").name, "Guest");
  assert.equal(C.makeIdentity("tab-9").name, "Guest");
});

check("reducePresence handles join, update and leave without mutating input", () => {
  let map = {};
  map = C.reducePresence(map, { type: "join", peer: peerState("p1") });
  assert.deepEqual(Object.keys(map), ["p1"]);
  const moved = peerState("p1", { cursor: { x: 5, y: 7 } });
  const after = C.reducePresence(map, { type: "update", peer: moved });
  assert.deepEqual(after.p1.cursor, { x: 5, y: 7 });
  assert.equal(map.p1.cursor, null, "input map untouched");
  const left = C.reducePresence(after, { type: "leave", id: "p1" });
  assert.deepEqual(left, {});
  // Unknown / malformed events are inert.
  assert.deepEqual(C.reducePresence(after, { type: "bogus" }), after);
  assert.deepEqual(C.reducePresence(after, null), after);
});

check("prunePresence expires peers exactly at the TTL boundary", () => {
  const now = 100_000;
  const map = {
    fresh: peerState("fresh", { updatedAt: now - 1 }),
    recent: peerState("recent", { updatedAt: now - C.PRESENCE_TTL_MS + 1 }),
    boundary: peerState("boundary", { updatedAt: now - C.PRESENCE_TTL_MS }),
    stale: peerState("stale", { updatedAt: now - C.PRESENCE_TTL_MS - 5000 }),
    timeless: peerState("timeless", { updatedAt: 0 }),
  };
  const pruned = C.prunePresence(map, now);
  assert.deepEqual(Object.keys(pruned).sort(), ["fresh", "recent"]);
  assert.equal(Object.keys(map).length, 5, "input map untouched");
  // A custom TTL is honoured: at 10 ms only the 1 ms-old peer survives;
  // at 1 ms even that peer is exactly at the boundary and expires.
  assert.deepEqual(Object.keys(C.prunePresence(map, now, 10)), ["fresh"]);
  assert.deepEqual(Object.keys(C.prunePresence(map, now, 1)), []);
});

check("shouldSendCursor enforces the 50 ms throttle (and custom intervals)", () => {
  assert.equal(C.shouldSendCursor(0, 1000), true, "never sent → send");
  assert.equal(C.shouldSendCursor(null, 1000), true);
  assert.equal(C.shouldSendCursor(1000, 1049), false, "49 ms is too soon");
  assert.equal(C.shouldSendCursor(1000, 1050), true, "50 ms is exactly enough");
  assert.equal(C.shouldSendCursor(1000, 5000), true);
  assert.equal(C.shouldSendCursor(1000, 1099, 100), false);
  assert.equal(C.shouldSendCursor(1000, 1100, 100), true);
});

check("doc seq guard rejects own + stale messages and accepts newer ones", () => {
  const tracker = { selfId: "me", seqs: {} };
  const doc = { kind: "doc", senderId: "peer-a", seq: 1, doc: {} };
  assert.equal(C.shouldApplyRemote(tracker, doc), true, "first message applies");
  C.recordSeq(tracker, doc);
  assert.equal(tracker.seqs["peer-a"], 1);
  assert.equal(
    C.shouldApplyRemote(tracker, { ...doc, seq: 1 }),
    false,
    "a replayed seq is stale",
  );
  assert.equal(
    C.shouldApplyRemote(tracker, { ...doc, seq: 0 }),
    false,
    "an older seq is stale",
  );
  assert.equal(C.shouldApplyRemote(tracker, { ...doc, seq: 2 }), true);
  assert.equal(
    C.shouldApplyRemote(tracker, { kind: "doc", senderId: "me", seq: 99 }),
    false,
    "our own messages never apply",
  );
  // A second sender has an independent seq space.
  assert.equal(
    C.shouldApplyRemote(tracker, { kind: "doc", senderId: "peer-b", seq: 1 }),
    true,
  );
  // Malformed messages are rejected, not thrown on.
  assert.equal(C.shouldApplyRemote(tracker, null), false);
  assert.equal(C.shouldApplyRemote(tracker, { senderId: "peer-a" }), false);
  assert.equal(C.shouldApplyRemote(null, doc), false);
});

check("nextSeq increments monotonically from any starting point", () => {
  assert.equal(C.nextSeq(0), 1);
  assert.equal(C.nextSeq(1), 2);
  assert.equal(C.nextSeq(41), 42);
  assert.equal(C.nextSeq(undefined), 1);
  assert.equal(C.nextSeq(NaN), 1);
});

check("cursor chat sanitising: newlines out, 140-char cap, blanks rejected", () => {
  assert.equal(C.CURSOR_CHAT_TTL_MS, 4000);
  assert.equal(C.CURSOR_CHAT_MAX_LEN, 140);
  assert.equal(C.sanitizeChatText("hello world"), "hello world");
  assert.equal(C.sanitizeChatText("line one\nline two"), "line one line two");
  assert.equal(C.sanitizeChatText("  padded\t\ttext  "), "padded text");
  assert.equal(C.sanitizeChatText("a\rb\rc"), "a b c");
  assert.equal(C.sanitizeChatText(""), "");
  assert.equal(C.sanitizeChatText("   \n  "), "");
  assert.equal(C.sanitizeChatText(null), "");
  assert.equal(C.sanitizeChatText(42), "");
  const capped = C.sanitizeChatText("x".repeat(300));
  assert.equal(capped.length, 140);
});

check("presence carries the ephemeral chat field through reduce + prune", () => {
  const withChat = peerState("p1", {
    chat: { text: "hi there", expiresAt: 4500 },
  });
  const map = C.reducePresence({}, { type: "join", peer: withChat });
  assert.deepEqual(map.p1.chat, { text: "hi there", expiresAt: 4500 });
  // The field survives the TTL prune while the peer itself is fresh —
  // expiry of the BUBBLE is a render-pass concern (peers stop
  // publishing it once their own 4 s are up).
  const pruned = C.prunePresence(map, 2000);
  assert.deepEqual(pruned.p1.chat, { text: "hi there", expiresAt: 4500 });
});

check("selectCollabMode prefers Supabase, falls back to local, else off", () => {
  assert.equal(
    C.selectCollabMode({ configured: true, hasSession: true, hasBroadcastChannel: true }),
    "supabase",
  );
  assert.equal(
    C.selectCollabMode({ configured: true, hasSession: false, hasBroadcastChannel: true }),
    "local",
  );
  assert.equal(
    C.selectCollabMode({ configured: false, hasSession: false, hasBroadcastChannel: true }),
    "local",
  );
  assert.equal(
    C.selectCollabMode({ configured: false, hasSession: false, hasBroadcastChannel: false }),
    "off",
  );
});

console.log(`${passed} collab checks passed`);
