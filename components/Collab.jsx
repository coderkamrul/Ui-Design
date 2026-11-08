"use client";

/**
 * Multiplayer UI + session wiring (M6).
 *
 * useCollab(fileId, loaded) owns the room lifecycle for the editor:
 * identity, transport choice, presence publishing, doc sync.
 *
 * IDENTITY, per tab on purpose:
 * - id lives in sessionStorage ("canvastool:tab-id"), minted once per
 *   TAB. Two tabs of the same browser must appear as two peers — if the
 *   id were per-browser, they would collapse into one presence entry.
 * - name persists per BROWSER (localStorage "canvastool:guest-name")
 *   in local mode; in configured mode it is the account email's prefix.
 * - colour is derived from the id (lib/collab.js colorForId), so every
 *   client paints a peer the same colour without negotiating.
 *
 * DOC SYNC — whole-doc last-writer-wins (deliberate simplification):
 * a store subscription watches doc changes (the same seam the autosave
 * uses). Local changes are broadcast throttled to one message per
 * 150 ms, trailing-edge, carrying a per-sender increasing `seq`.
 * Remote docs are applied via store.applyRemoteDoc, which tags the
 * change lastDocOrigin="remote"; the subscription sees that tag,
 * consumes it and skips broadcasting — that flag + the seq guard are
 * the loop prevention. Trade-off, stated plainly: syncing rides the
 * generic doc-change subscription instead of the store's discrete
 * commit points, so transient drag states are included (throttled) —
 * collaborators see drags roughly live, at the cost of more traffic
 * than an op-based protocol. Yjs/CRDT is the production path (README).
 *
 * CURSOR CHAT (depth-gap batch): store.sendCursorChat broadcasts a
 * { kind: "cursor-chat" } message AND raises store.localChat, which
 * the presence publish below carries as an ephemeral chat field.
 * Receivers merge both sources into the peer map (broadcast = fast,
 * presence = catches anyone who missed it); bubbles render for 4 s
 * and are pruned on expiry in the Viewport's render pass.
 */
import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/lib/store";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { useSession } from "@/lib/auth";
import {
  CURSOR_CHAT_TTL_MS,
  DOC_BROADCAST_MS,
  joinCollab,
  makeIdentity,
  nextSeq,
  recordSeq,
  sanitizeChatText,
  shouldApplyRemote,
} from "@/lib/collab";

const TAB_ID_KEY = "canvastool:tab-id";
const GUEST_NAME_KEY = "canvastool:guest-name";

function tabId() {
  let id = sessionStorage.getItem(TAB_ID_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(TAB_ID_KEY, id);
  }
  return id;
}

function localGuestName(id) {
  let name = localStorage.getItem(GUEST_NAME_KEY);
  if (!name) {
    name = `Guest-${id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase()}`;
    localStorage.setItem(GUEST_NAME_KEY, name);
  }
  return name;
}

export function useCollab(fileId, loaded) {
  const { user } = useSession();
  const configured = isSupabaseConfigured();
  const userKey = configured ? (user?.id ?? null) : "local";

  useEffect(() => {
    if (!loaded || typeof window === "undefined") return;
    // Configured mode without a user is gated to /login by the shell;
    // the room would have no identity to present, so stay out.
    if (configured && !user) return;

    const store = useEditorStore;
    const st = store.getState();

    const id = tabId();
    const name =
      configured && user?.email
        ? user.email.split("@")[0]
        : localGuestName(id);
    const identity = makeIdentity(id, name);
    st.setIdentity(identity);

    const { mode, channel } = joinCollab({
      fileId,
      identity,
      supabaseClient: configured && user ? getSupabase() : null,
      hasSession: Boolean(user),
      onStatus: (connected) => store.getState().setCollabConnected(connected),
    });
    st.setCollabMode(mode);
    if (!channel) return;
    // Let store actions (cursor chat) broadcast on this transport.
    st.setCollabSend((msg) => channel.send(msg));

    // -- presence: receive -------------------------------------------------
    // Cursor chat arrives BOTH ways: inside presence states (the
    // durable-enough copy) and as a cursor-chat broadcast (immediate).
    // The chatRef merge makes a broadcast show up even before the
    // sender's next presence publish lands.
    const presenceRef = { current: {} };
    const chatRef = { current: {} }; // peerId -> { text, expiresAt }
    const pushPeers = () => {
      const now = Date.now();
      for (const id of Object.keys(chatRef.current)) {
        if (chatRef.current[id].expiresAt <= now) delete chatRef.current[id];
      }
      const out = {};
      for (const [id, peer] of Object.entries(presenceRef.current)) {
        if (id === identity.id || !peer) continue;
        const chat =
          peer.chat && peer.chat.expiresAt > now
            ? peer.chat
            : (chatRef.current[id] ?? null);
        out[id] = chat ? { ...peer, chat } : peer;
      }
      store.getState().setPeers(out);
    };
    channel.onPresence((map) => {
      presenceRef.current = map ?? {};
      pushPeers();
    });

    // -- presence: publish (cursor / selection / page / name / chat) ------
    let lastPresenceKey = "";
    const publish = () => {
      const s = store.getState();
      const current = {
        identity: s.identity ?? identity,
        pageId: s.activePageId,
        cursor: s.localCursor,
        selection: s.selection,
        // Cursor chat rides presence while unexpired (peers who miss
        // the broadcast still see it; expiry prunes it everywhere).
        chat:
          s.localChat && s.localChat.expiresAt > Date.now()
            ? s.localChat
            : null,
        updatedAt: Date.now(),
      };
      // updatedAt always changes; diff on the meaningful fields only.
      const key = JSON.stringify({ ...current, updatedAt: 0 });
      if (key === lastPresenceKey) return;
      lastPresenceKey = key;
      channel.track(current);
    };
    publish();
    const unsubPresence = store.subscribe(publish);

    // Our own bubble expires: clear localChat at expiresAt so the
    // presence publish above drops the chat field for everyone.
    let chatTimer = null;
    const unsubChat = store.subscribe((s, prev) => {
      if (s.localChat === prev.localChat) return;
      if (chatTimer) clearTimeout(chatTimer);
      chatTimer = null;
      if (s.localChat) {
        chatTimer = setTimeout(
          () => store.getState().setLocalChat(null),
          Math.max(0, s.localChat.expiresAt - Date.now()),
        );
      }
    });

    // -- messages: doc sync + cursor chat --------------------------------
    const tracker = { selfId: identity.id, seqs: {} };
    channel.onMessage((msg) => {
      if (!msg) return;
      if (msg.kind === "cursor-chat") {
        if (!msg.senderId || msg.senderId === identity.id) return;
        const text = sanitizeChatText(msg.text);
        if (!text) return;
        chatRef.current[msg.senderId] = {
          text,
          expiresAt: Date.now() + CURSOR_CHAT_TTL_MS,
        };
        pushPeers();
        return;
      }
      if (msg.kind !== "doc") return;
      if (!shouldApplyRemote(tracker, msg)) return;
      recordSeq(tracker, msg);
      if (msg.doc) store.getState().applyRemoteDoc(msg.doc);
    });

    let seq = 0;
    let broadcastTimer = null;
    const unsubDoc = store.subscribe((s, prev) => {
      if (s.doc === prev.doc) return;
      if (s.fileId !== fileId) return;
      // A remotely-applied doc: never echo it back (loop prevention).
      // The autosave subscription handles persisting it.
      if (s.lastDocOrigin === "remote") {
        s.consumeRemoteOrigin();
        return;
      }
      // Throttle: at most one broadcast per DOC_BROADCAST_MS, and the
      // trailing send always carries the LATEST doc.
      if (broadcastTimer) return;
      broadcastTimer = setTimeout(() => {
        broadcastTimer = null;
        seq = nextSeq(seq);
        channel.send({
          kind: "doc",
          seq,
          senderId: identity.id,
          doc: store.getState().doc,
        });
      }, DOC_BROADCAST_MS);
    });

    return () => {
      unsubPresence();
      unsubChat();
      unsubDoc();
      if (chatTimer) clearTimeout(chatTimer);
      if (broadcastTimer) clearTimeout(broadcastTimer);
      channel.leave();
      const s = store.getState();
      s.setCollabSend(null);
      s.setPeers({});
      s.setCollabConnected(false);
      s.setCollabMode("off");
    };
    // userKey stands in for the user object (new identity per render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, loaded, configured, userKey]);
}

// -- top-bar presence UI -----------------------------------------------------

function initials(name) {
  const parts = String(name ?? "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

const MODE_LABEL = {
  supabase: "Live · Supabase",
  local: "Live · this browser only",
  off: "Solo",
};

/**
 * Avatar stack + status dot for the top bar. Clicking opens a popover
 * listing everyone in the room; in local mode it also hosts the
 * guest-name editor (the name persists per browser; the id does not).
 */
export function CollabAvatars() {
  const identity = useEditorStore((s) => s.identity);
  const peers = useEditorStore((s) => s.peers);
  const collabMode = useEditorStore((s) => s.collabMode);
  const collabConnected = useEditorStore((s) => s.collabConnected);
  const pages = useEditorStore((s) => s.doc.pages);
  const activePageId = useEditorStore((s) => s.activePageId);
  const setIdentity = useEditorStore((s) => s.setIdentity);
  const [open, setOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const peerList = Object.values(peers ?? {});
  const everyone = [
    ...(identity ? [{ presence: { identity }, self: true }] : []),
    ...peerList.map((p) => ({ presence: p, self: false })),
  ];
  const shown = everyone.slice(0, 5);
  const overflow = everyone.length - shown.length;

  const connecting = collabMode !== "off" && !collabConnected;
  const dotColor =
    collabMode === "off"
      ? "var(--text-2)"
      : connecting
        ? "#F5A623"
        : "#30A46C";
  const statusText =
    collabMode === "supabase" && connecting
      ? "Connecting · Supabase"
      : MODE_LABEL[collabMode] ?? "Solo";

  const pageName = (pageId) =>
    pages.find((p) => p.id === pageId)?.name ?? "Unknown page";

  const saveGuestName = () => {
    const next = nameDraft.trim();
    if (!next || !identity) return;
    localStorage.setItem(GUEST_NAME_KEY, next);
    setIdentity(makeIdentity(identity.id, next));
    setNameDraft("");
  };

  return (
    <div className="relative" data-collab="avatars" data-collab-mode={collabMode}>
      <button
        className="flex items-center gap-2 rounded-[var(--radius-lg)] px-1.5 py-1 hover:bg-[var(--surface-hover)]"
        title={statusText}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: dotColor }}
          data-collab-status={collabMode}
        />
        <span className="flex -space-x-1.5">
          {shown.map(({ presence, self }) => (
            <span
              key={presence.identity.id}
              title={self ? `${presence.identity.name} (you)` : presence.identity.name}
              className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-[var(--surface-panel)]"
              style={{ background: presence.identity.color }}
            >
              {initials(presence.identity.name)}
            </span>
          ))}
          {overflow > 0 && (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--surface-hover)] text-[10px] font-semibold text-[var(--text-2)] ring-2 ring-[var(--surface-panel)]">
              +{overflow}
            </span>
          )}
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 w-[280px] rounded-[var(--radius-xl)] border border-[var(--line)] bg-[var(--surface-content)] p-3 shadow-xl">
            <div className="mb-2 flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: dotColor }}
              />
              <span className="font-medium">{statusText}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {everyone.map(({ presence, self }) => (
                <div key={presence.identity.id} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: presence.identity.color }}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {presence.identity.name}
                    {self && <span className="text-[var(--text-2)]"> (you)</span>}
                  </span>
                  <span className="shrink-0 text-[var(--type-micro)] text-[var(--text-2)]">
                    {self ? pageName(activePageId) : presence.pageId ? pageName(presence.pageId) : ""}
                  </span>
                </div>
              ))}
              {everyone.length === 0 && (
                <p className="text-[var(--type-micro)] text-[var(--text-2)]">
                  Nobody else is here yet.
                </p>
              )}
            </div>
            {collabMode === "local" && identity && (
              <div className="mt-3 border-t border-[var(--line)] pt-3">
                <label className="mb-1 block text-[var(--type-micro)] text-[var(--text-2)]">
                  Your display name (this browser)
                </label>
                <div className="flex gap-1.5">
                  <input
                    value={nameDraft}
                    placeholder={identity.name}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") saveGuestName();
                    }}
                    className="h-7 min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 outline-none"
                  />
                  <button
                    className="h-7 shrink-0 rounded-[var(--radius-md)] border border-[var(--line)] px-2 hover:bg-[var(--surface-hover)] disabled:opacity-40"
                    disabled={!nameDraft.trim()}
                    onClick={saveGuestName}
                  >
                    Save
                  </button>
                </div>
                <p className="mt-1.5 text-[var(--type-micro)] text-[var(--text-2)]">
                  Local mode syncs between tabs of this browser only.
                  Open this file in another tab to try it.
                </p>
              </div>
            )}
            {collabMode === "supabase" && (
              <p className="mt-3 border-t border-[var(--line)] pt-2 text-[var(--type-micro)] text-[var(--text-2)]">
                Everyone signed in with this file open is in the room.
              </p>
            )}
            {collabMode === "off" && (
              <p className="mt-3 border-t border-[var(--line)] pt-2 text-[var(--type-micro)] text-[var(--text-2)]">
                Collaboration is unavailable in this browser.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
