/**
 * Multiplayer (M6) — transport abstraction + pure presence/sync helpers.
 *
 * This module is deliberately IMPORT-FREE: the pure helpers are unit
 * tested by scripts/collab-test.mjs (loaded through a data: URL, which
 * cannot resolve relative imports), and the transports receive their
 * Supabase client from the caller (components/Collab.jsx) instead of
 * importing lib/supabase.js.
 *
 * Transports (one interface, two implementations):
 *   channel = {
 *     send(msg),            // broadcast a JSON message to the room
 *     onMessage(fn),        // subscribe to broadcast messages
 *     track(presence),      // publish this client's presence state
 *     onPresence(fn),       // subscribe to the FLAT peer map {id: state}
 *     leave(),              // tear down (intervals, sockets, listeners)
 *   }
 * - Supabase: a Realtime channel `file:<id>` — presence via the
 *   channel's presence key, doc/cursor traffic via broadcast events.
 * - Local: a BroadcastChannel `canvastool:file:<id>` — tab-to-tab
 *   collaboration inside ONE browser. Presence needs a heartbeat
 *   (2 s) because BroadcastChannel has no presence primitive; peers
 *   expire after 5 s without one, and a {kind:'leave'} message on
 *   unload / leave() cleans up immediately.
 *
 * Presence state per peer:
 *   { identity: {id, name, color}, pageId, cursor: {x,y}|null,
 *     selection: [nodeIds], updatedAt,
 *     chat?: { text, expiresAt } | null }
 * Cursor coords are CANVAS coords on the peer's current page.
 * `chat` is the ephemeral cursor-chat bubble (depth-gap batch): it
 * rides presence AND a { kind: "cursor-chat" } broadcast (for
 * immediacy), lives CURSOR_CHAT_TTL_MS, and renderers prune it on
 * expiry — it is never persisted anywhere.
 *
 * Doc sync is whole-doc last-writer-wins on top of this (see
 * components/Collab.jsx) — a deliberate MVP simplification.
 */

/** Presence heartbeat period for the local transport. */
export const PRESENCE_HEARTBEAT_MS = 2000;
/** A local peer with no heartbeat for this long is considered gone. */
export const PRESENCE_TTL_MS = 5000;
/** Cursor presence is published at most this often. */
export const CURSOR_MIN_INTERVAL_MS = 50;
/** Doc broadcasts are throttled to at most one per this window. */
export const DOC_BROADCAST_MS = 150;

/**
 * The 8-colour peer palette (Phase 2 overlay language; index 0 is the
 * collab teal #12A594 the comment pins already use).
 */
export const PEER_PALETTE = [
  "#12A594", // collab teal
  "#E5484D", // red
  "#3B82F6", // blue
  "#F76B15", // orange
  "#8E4EC6", // purple
  "#E93D82", // pink
  "#30A46C", // green
  "#AD5700", // amber/brown
];

/** Small deterministic string hash (FNV-1a) — stable across sessions. */
export function hashId(id) {
  const s = String(id ?? "");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A peer's colour is a pure function of their id. */
export function colorForId(id) {
  return PEER_PALETTE[hashId(id) % PEER_PALETTE.length];
}

/**
 * Build an identity { id, name, color }. The NAME is supplied by the
 * caller (email prefix in configured mode, persisted guest name in
 * local mode); the colour is derived from the id so every client
 * agrees on it without exchanging anything.
 */
export function makeIdentity(id, name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return {
    id: String(id),
    name: trimmed || "Guest",
    color: colorForId(id),
  };
}

/**
 * Choose the transport mode. Supabase wins when configured AND signed
 * in; otherwise BroadcastChannel (tab-to-tab, same browser); otherwise
 * collaboration is off.
 */
export function selectCollabMode({ configured, hasSession, hasBroadcastChannel }) {
  if (configured && hasSession) return "supabase";
  if (hasBroadcastChannel) return "local";
  return "off";
}

// -- presence map helpers (maps are plain objects keyed by peer id) ------

/**
 * Reduce one presence event into a NEW map (the input is not mutated).
 * Events: { type: "join" | "update", peer } — peer is a presence state
 * whose identity.id is the key — or { type: "leave", id }.
 */
export function reducePresence(currentMap, event) {
  const map = { ...(currentMap ?? {}) };
  if (!event) return map;
  if (event.type === "leave") {
    delete map[event.id];
    return map;
  }
  if ((event.type === "join" || event.type === "update") && event.peer) {
    const id = event.peer.identity?.id ?? event.peer.id;
    if (id) map[id] = event.peer;
  }
  return map;
}

/**
 * Drop peers whose updatedAt is at least ttlMs older than `now`
 * (an entry exactly ttlMs old has expired — heartbeats run at 2 s, so
 * 5 s of silence means the tab is gone). Returns a new map.
 */
export function prunePresence(map, now, ttlMs = PRESENCE_TTL_MS) {
  const out = {};
  for (const [id, peer] of Object.entries(map ?? {})) {
    const updatedAt = peer?.updatedAt ?? 0;
    if (now - updatedAt < ttlMs) out[id] = peer;
  }
  return out;
}

// -- cursor chat ---------------------------------------------------------------

/** How long a cursor-chat bubble stays up, both locally and on peers. */
export const CURSOR_CHAT_TTL_MS = 4000;
/** Cursor chat is a glanceable bubble, not a message — keep it short. */
export const CURSOR_CHAT_MAX_LEN = 140;

/**
 * Sanitise cursor-chat text: control characters (newlines included)
 * become spaces, runs of whitespace collapse, the result is trimmed
 * and capped at CURSOR_CHAT_MAX_LEN. Non-strings and all-whitespace
 * input sanitise to "" (callers treat that as "nothing to send").
 */
export function sanitizeChatText(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CURSOR_CHAT_MAX_LEN);
}

// -- cursor throttle --------------------------------------------------------

/** True when at least minIntervalMs elapsed since the last send. */
export function shouldSendCursor(lastSentAt, now, minIntervalMs = CURSOR_MIN_INTERVAL_MS) {
  if (!lastSentAt) return true;
  return now - lastSentAt >= minIntervalMs;
}

// -- doc-sync sequencing ------------------------------------------------------
// Every doc broadcast carries a per-sender monotonically increasing
// `seq`. A receiver tracks the last seq seen per sender and ignores
// anything older (duplicates, reordering) plus anything from itself.
// The tracker is a plain object { selfId, seqs: { senderId: lastSeq } }.

/** The next sequence number for a sender (seqs start at 1). */
export function nextSeq(lastSeq) {
  return (typeof lastSeq === "number" && Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
}

/**
 * Should this remote doc message be applied? `local` is the receiver's
 * tracker { selfId, seqs }. Rejects: malformed messages, our own
 * messages, and seq <= the last seq seen from that sender.
 */
export function shouldApplyRemote(local, msg) {
  if (!local || !msg || typeof msg !== "object") return false;
  const { senderId, seq } = msg;
  if (!senderId || typeof seq !== "number") return false;
  if (senderId === local.selfId) return false;
  const last = local.seqs?.[senderId] ?? 0;
  return seq > last;
}

/** Record a message's seq in the tracker (mutates and returns it). */
export function recordSeq(local, msg) {
  if (!local || !msg?.senderId || typeof msg.seq !== "number") return local;
  if (!local.seqs) local.seqs = {};
  if (msg.seq > (local.seqs[msg.senderId] ?? 0)) {
    local.seqs[msg.senderId] = msg.seq;
  }
  return local;
}

// -- transports ---------------------------------------------------------------

/**
 * Supabase Realtime transport. `sb` is the shared client from
 * lib/supabase.js (passed in — this module stays import-free).
 * Presence state is tracked under the identity's id as the presence
 * key; presence sync events are flattened to { peerId: state }.
 */
export function createSupabaseChannel(sb, fileId, identity, onStatus) {
  if (!sb) return null;
  const channel = sb.channel(`file:${fileId}`, {
    config: {
      broadcast: { self: false },
      presence: { key: identity.id },
    },
  });
  const msgFns = new Set();
  const presenceFns = new Set();
  let subscribed = false;
  let pendingPresence = null;

  channel.on("broadcast", { event: "msg" }, ({ payload }) => {
    for (const fn of msgFns) fn(payload);
  });
  channel.on("presence", { event: "sync" }, () => {
    const raw = channel.presenceState();
    const flat = {};
    for (const [key, metas] of Object.entries(raw ?? {})) {
      const meta = Array.isArray(metas) ? metas[metas.length - 1] : null;
      if (meta) flat[key] = meta;
    }
    for (const fn of presenceFns) fn(flat);
  });
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      subscribed = true;
      onStatus?.(true);
      if (pendingPresence) channel.track(pendingPresence);
    } else if (status === "CHANNEL_ERROR" || status === "CLOSED") {
      subscribed = false;
      onStatus?.(false);
    }
  });

  return {
    send(msg) {
      channel.send({ type: "broadcast", event: "msg", payload: msg });
    },
    onMessage(fn) {
      msgFns.add(fn);
      return () => msgFns.delete(fn);
    },
    track(state) {
      pendingPresence = state;
      if (subscribed) channel.track(state);
    },
    onPresence(fn) {
      presenceFns.add(fn);
      return () => presenceFns.delete(fn);
    },
    leave() {
      msgFns.clear();
      presenceFns.clear();
      sb.removeChannel(channel);
    },
  };
}

/**
 * Local transport over BroadcastChannel — tab-to-tab collaboration in
 * one browser. Presence is hand-rolled: our state is announced on
 * track() and re-announced by a 2 s heartbeat; peers are pruned after
 * PRESENCE_TTL_MS of silence; leave() / page unload post an explicit
 * leave message. BroadcastChannel never echoes to the sender, but
 * envelopes still carry `from` so foreign messages can't spoof cleanup.
 */
export function createLocalChannel(fileId, identity, onStatus) {
  if (typeof BroadcastChannel === "undefined") return null;
  const bc = new BroadcastChannel(`canvastool:file:${fileId}`);
  const msgFns = new Set();
  const presenceFns = new Set();
  let peers = {};
  let state = {
    identity,
    pageId: null,
    cursor: null,
    selection: [],
    updatedAt: Date.now(),
  };
  let closed = false;

  const emitPresence = () => {
    const snapshot = { ...peers };
    for (const fn of presenceFns) fn(snapshot);
  };
  const announce = () => {
    state = { ...state, updatedAt: Date.now() };
    bc.postMessage({ kind: "presence", from: identity.id, state });
  };

  bc.onmessage = (ev) => {
    const m = ev.data;
    if (!m || typeof m !== "object" || m.from === identity.id) return;
    if (m.kind === "presence" && m.state) {
      peers = reducePresence(peers, { type: "update", peer: m.state });
      emitPresence();
    } else if (m.kind === "leave") {
      peers = reducePresence(peers, { type: "leave", id: m.from });
      emitPresence();
    } else if (m.kind === "msg") {
      for (const fn of msgFns) fn(m.payload);
    }
  };

  const heartbeat = setInterval(() => {
    if (closed) return;
    announce();
  }, PRESENCE_HEARTBEAT_MS);
  const pruner = setInterval(() => {
    if (closed) return;
    const pruned = prunePresence(peers, Date.now(), PRESENCE_TTL_MS);
    if (Object.keys(pruned).length !== Object.keys(peers).length) {
      peers = pruned;
      emitPresence();
    }
  }, 1000);

  const onUnload = () => {
    try {
      bc.postMessage({ kind: "leave", from: identity.id });
    } catch {
      /* channel already closed */
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", onUnload);
  }

  // Announce immediately so existing tabs learn about us without
  // waiting for the first heartbeat (they reply via their own
  // heartbeats within 2 s).
  announce();
  onStatus?.(true);

  return {
    send(msg) {
      if (!closed) bc.postMessage({ kind: "msg", from: identity.id, payload: msg });
    },
    onMessage(fn) {
      msgFns.add(fn);
      return () => msgFns.delete(fn);
    },
    track(nextState) {
      state = { ...state, ...nextState, identity, updatedAt: Date.now() };
      if (!closed) {
        bc.postMessage({ kind: "presence", from: identity.id, state });
      }
    },
    onPresence(fn) {
      presenceFns.add(fn);
      fn({ ...peers });
      return () => presenceFns.delete(fn);
    },
    leave() {
      if (closed) return;
      closed = true;
      onUnload();
      clearInterval(heartbeat);
      clearInterval(pruner);
      if (typeof window !== "undefined") {
        window.removeEventListener("beforeunload", onUnload);
      }
      msgFns.clear();
      presenceFns.clear();
      bc.close();
    },
  };
}

/**
 * Join a file's room with the best available transport.
 * Returns { mode, channel } — channel is null when mode is "off".
 */
export function joinCollab({ fileId, identity, supabaseClient, hasSession, onStatus }) {
  const mode = selectCollabMode({
    configured: Boolean(supabaseClient),
    hasSession: Boolean(hasSession),
    hasBroadcastChannel: typeof BroadcastChannel !== "undefined",
  });
  if (mode === "supabase") {
    const channel = createSupabaseChannel(supabaseClient, fileId, identity, onStatus);
    return { mode: channel ? "supabase" : "off", channel };
  }
  if (mode === "local") {
    const channel = createLocalChannel(fileId, identity, onStatus);
    return { mode: channel ? "local" : "off", channel };
  }
  return { mode: "off", channel: null };
}
