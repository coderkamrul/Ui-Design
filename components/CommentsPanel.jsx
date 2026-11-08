"use client";

import { useEffect, useRef, useState } from "react";
import {
  MessageSquare,
  Check,
  CheckCheck,
  RotateCcw,
  Trash2,
  Edit2,
  X,
  Send,
  CornerDownRight,
  MapPin,
} from "lucide-react";
import { useEditorStore } from "@/lib/store";

function timeAgo(ts) {
  if (!ts) return "just now";
  const secs = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function CommentsPanel({ embedded = false }) {
  const doc = useEditorStore((s) => s.doc);
  const draft = useEditorStore((s) => s.commentDraft);
  const activeCommentId = useEditorStore((s) => s.activeCommentId);
  const listOpen = useEditorStore((s) => s.commentsPanelOpen);
  const showResolved = useEditorStore((s) => s.showResolvedComments);
  const activePageId = useEditorStore((s) => s.activePageId);

  const comments = doc.comments ?? [];
  const openCount = comments.filter((c) => !c.resolved).length;
  const allResolved = comments.length > 0 && openCount === 0;

  // New comment input
  const [newCommentText, setNewCommentText] = useState("");
  const inputRef = useRef(null);

  // Per-comment edit state { [commentId]: { msgId, text } }
  const [editingMsg, setEditingMsg] = useState(null);

  // Per-comment reply input text { [commentId]: string }
  const [replyTexts, setReplyTexts] = useState({});

  useEffect(() => {
    if (draft) {
      inputRef.current?.focus();
    }
  }, [draft]);

  const handleCreateComment = () => {
    const val = newCommentText.trim();
    if (!val) return;
    const st = useEditorStore.getState();
    const pageId = draft?.pageId || activePageId || doc.pages[0]?.id;
    const x = draft?.x ?? 200;
    const y = draft?.y ?? 200;
    const nodeId = draft?.nodeId ?? null;
    const relX = draft?.relX ?? null;
    const relY = draft?.relY ?? null;

    st.addComment({ pageId, x, y, text: val, nodeId, relX, relY });
    setNewCommentText("");
    st.setCommentDraft(null);
    st.setActiveTool("move");
  };

  const handleCancelDraft = () => {
    const st = useEditorStore.getState();
    st.setCommentDraft(null);
    setNewCommentText("");
    if (st.activeTool === "comment") {
      st.setActiveTool("move");
      st.setCommentsPanelOpen(false);
    }
  };

  const handleClosePanel = () => {
    const st = useEditorStore.getState();
    st.setCommentsPanelOpen(false);
    st.setActiveCommentId(null);
    st.setCommentDraft(null);
    if (st.activeTool === "comment") {
      st.setActiveTool("move");
    }
  };

  const handleResolveAll = () => {
    const st = useEditorStore.getState();
    if (allResolved) {
      st.reopenAllComments();
    } else {
      st.resolveAllComments();
    }
  };

  const jumpToComment = (c) => {
    const s = useEditorStore.getState();
    s.setActivePage(c.pageId);
    const { canvasSize, viewport } = s;
    if (canvasSize.w > 0) {
      s.setViewport({
        zoom: viewport.zoom,
        x: canvasSize.w / 2 - c.x * viewport.zoom,
        y: canvasSize.h / 2 - c.y * viewport.zoom,
      });
    }
    s.setActiveCommentId(c.id);
  };

  const handlePostReply = (commentId) => {
    const text = (replyTexts[commentId] ?? "").trim();
    if (!text) return;
    const st = useEditorStore.getState();
    st.addCommentMessage(commentId, text);
    setReplyTexts((prev) => ({ ...prev, [commentId]: "" }));
  };

  const handleSaveEdit = (commentId, messageId) => {
    if (!editingMsg || !editingMsg.text.trim()) return;
    const st = useEditorStore.getState();
    st.updateCommentMessage(commentId, messageId, editingMsg.text.trim());
    setEditingMsg(null);
  };

  const pageName = (id) => doc.pages.find((p) => p.id === id)?.name ?? "";

  const visibleComments = comments
    .filter((c) => !c.pageId || c.pageId === activePageId)
    .filter((c) => showResolved || !c.resolved)
    .slice()
    .sort((a, b) => {
      if (Boolean(a.resolved) !== Boolean(b.resolved)) {
        return Number(a.resolved) - Number(b.resolved);
      }
      return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    });

  const containerCls = embedded
    ? "flex flex-col h-full w-full bg-[var(--surface-panel)] overflow-hidden"
    : "absolute top-3 right-3 z-40 flex max-h-[calc(100%-24px)] w-[320px] flex-col rounded-[var(--radius-xl)] border border-[var(--line)] bg-[var(--surface-content)] shadow-xl overflow-hidden";

  return (
    <div className={containerCls}>
      {/* Top Header */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--line)] px-3 bg-[var(--surface-content)]">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-[var(--accent)]" />
          <span className="font-semibold text-xs text-[var(--text-1)]">Comments</span>
          {openCount > 0 && (
            <span
              className="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
              style={{ background: "var(--accent-collab)" }}
            >
              {openCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {comments.length > 0 && (
            <button
              onClick={handleResolveAll}
              title={allResolved ? "Reopen all comments" : "Resolve all active comments"}
              className="flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[11px] font-medium text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] transition-colors cursor-pointer"
            >
              {allResolved ? (
                <>
                  <RotateCcw size={12} />
                  <span>Reopen all</span>
                </>
              ) : (
                <>
                  <CheckCheck size={13} className="text-emerald-500" />
                  <span>Resolve all</span>
                </>
              )}
            </button>
          )}

          <button
            onClick={handleClosePanel}
            title="Close comments"
            className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] transition-colors cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Top Input / Composer for new comment */}
      <div className="shrink-0 border-b border-[var(--line)] p-3 bg-[var(--surface-content)]">
        {draft ? (
          <div className="mb-2 flex items-center justify-between rounded-[var(--radius-sm)] bg-[var(--accent)]/10 px-2 py-1 text-[11px] text-[var(--accent)] font-medium">
            <span className="flex items-center gap-1.5 truncate">
              <MapPin size={12} className="shrink-0" />
              <span>Pin at ({draft.x}, {draft.y})</span>
            </span>
            <button
              onClick={handleCancelDraft}
              className="hover:opacity-75 cursor-pointer ml-1 text-xs"
              title="Cancel pin"
            >
              ✕
            </button>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <textarea
            ref={inputRef}
            value={newCommentText}
            onChange={(e) => setNewCommentText(e.target.value)}
            placeholder={
              draft
                ? "Type comment for this place…"
                : "Type a new comment… (or pick C to drop a pin)"
            }
            rows={2}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleCreateComment();
              }
            }}
            className="w-full resize-none rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-panel)] p-2 text-xs text-[var(--text-1)] placeholder-[var(--text-3)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/20 transition-all"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[var(--text-3)]">
              Ctrl+Enter to post
            </span>
            <div className="flex items-center gap-1.5">
              {draft && (
                <button
                  type="button"
                  onClick={handleCancelDraft}
                  className="rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium text-[var(--text-2)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                disabled={!newCommentText.trim()}
                onClick={handleCreateComment}
                className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white shadow-2xs hover:opacity-90 disabled:opacity-40 transition-opacity cursor-pointer"
              >
                <Send size={12} />
                <span>Post</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filter / Toggle Bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--line)] px-3 py-1.5 text-[11px] text-[var(--text-2)] bg-[var(--surface-panel)]">
        <span>{visibleComments.length} {visibleComments.length === 1 ? "comment" : "comments"}</span>
        <label className="flex items-center gap-1.5 cursor-pointer hover:text-[var(--text-1)] select-none">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => useEditorStore.getState().setShowResolvedComments(e.target.checked)}
            className="rounded border-[var(--line)] text-[var(--accent)] focus:ring-0 cursor-pointer h-3.5 w-3.5"
          />
          <span>Show resolved</span>
        </label>
      </div>

      {/* Comments List (Threads) */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 no-scrollbar">
        {visibleComments.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center text-[var(--text-3)]">
            <MessageSquare size={28} className="mb-2 stroke-[1.5] opacity-40" />
            <p className="text-xs font-medium text-[var(--text-2)]">No comments yet</p>
            <p className="mt-1 text-[11px]">
              Click on the canvas with the Comment tool (C) to place a pin and comment.
            </p>
          </div>
        ) : (
          visibleComments.map((c, idx) => {
            const isActive = activeCommentId === c.id;
            const rootMsg = c.messages[0];
            const replies = c.messages.slice(1);
            const isEditingRoot = editingMsg && editingMsg.commentId === c.id && editingMsg.msgId === rootMsg?.id;

            return (
              <div
                key={c.id}
                className={`group flex flex-col rounded-[var(--radius-lg)] border transition-all ${
                  isActive
                    ? "border-[var(--accent)] bg-[var(--surface-content)] shadow-sm ring-1 ring-[var(--accent)]/30"
                    : "border-[var(--line)] bg-[var(--surface-content)] hover:border-[var(--border-hover)] hover:shadow-2xs"
                } ${c.resolved ? "opacity-75" : ""}`}
              >
                {/* Comment Card Header */}
                <div
                  onClick={() => jumpToComment(c)}
                  className="flex items-center justify-between border-b border-[var(--line)]/60 px-2.5 py-1.5 cursor-pointer bg-[var(--surface-panel)]/50 rounded-t-[var(--radius-lg)]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-2xs"
                      style={{
                        background: c.resolved
                          ? "#71717a"
                          : "var(--accent-collab, #0D99FF)",
                      }}
                    >
                      {idx + 1}
                    </span>
                    <span className="truncate text-xs font-semibold text-[var(--text-1)]">
                      {rootMsg?.author ?? "Comment"}
                    </span>
                    <span className="text-[10px] text-[var(--text-3)] shrink-0">
                      {timeAgo(rootMsg?.ts || c.createdAt)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                    {c.resolved ? (
                      <span className="flex items-center gap-0.5 rounded-[var(--radius-sm)] bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        <Check size={10} />
                        Resolved
                      </span>
                    ) : null}

                    {/* Resolve / Reopen toggle */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const st = useEditorStore.getState();
                        st.setCommentResolved(c.id, !c.resolved);
                      }}
                      title={c.resolved ? "Reopen comment" : "Resolve comment"}
                      className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] transition-colors cursor-pointer"
                    >
                      {c.resolved ? <RotateCcw size={12} /> : <Check size={13} className="text-emerald-500" />}
                    </button>

                    {/* Edit button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingMsg({
                          commentId: c.id,
                          msgId: rootMsg.id,
                          text: rootMsg.text,
                        });
                      }}
                      title="Edit comment"
                      className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] transition-colors cursor-pointer"
                    >
                      <Edit2 size={12} />
                    </button>

                    {/* Delete button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        useEditorStore.getState().deleteComment(c.id);
                      }}
                      title="Delete comment"
                      className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-2)] hover:bg-red-500/10 hover:text-red-500 transition-colors cursor-pointer"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {/* Root Message Content */}
                <div className="p-2.5">
                  {isEditingRoot ? (
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={editingMsg.text}
                        onChange={(e) => setEditingMsg((prev) => ({ ...prev, text: e.target.value }))}
                        rows={2}
                        className="w-full resize-none rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--surface-panel)] p-2 text-xs text-[var(--text-1)] outline-none"
                      />
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingMsg(null)}
                          className="rounded-[var(--radius-sm)] px-2 py-0.5 text-xs text-[var(--text-2)] hover:bg-[var(--surface-hover)] cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(c.id, rootMsg.id)}
                          className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-2.5 py-0.5 text-xs font-medium text-white hover:opacity-90 cursor-pointer"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-xs text-[var(--text-1)] leading-relaxed">
                      {rootMsg?.text}
                    </p>
                  )}
                </div>

                {/* Thread Replies */}
                {replies.length > 0 && (
                  <div className="border-t border-[var(--line)]/50 bg-[var(--surface-panel)]/40 p-2 space-y-2">
                    {replies.map((r) => {
                      const isEditingReply = editingMsg && editingMsg.commentId === c.id && editingMsg.msgId === r.id;
                      return (
                        <div key={r.id} className="group/reply pl-2 border-l-2 border-[var(--line)]">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-semibold text-[var(--text-1)]">{r.author}</span>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-[var(--text-3)]">{timeAgo(r.ts)}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setEditingMsg({ commentId: c.id, msgId: r.id, text: r.text })
                                }
                                title="Edit reply"
                                className="opacity-0 group-hover/reply:opacity-100 hover:text-[var(--text-1)] p-0.5 cursor-pointer transition-opacity"
                              >
                                <Edit2 size={10} />
                              </button>
                              <button
                                type="button"
                                onClick={() => useEditorStore.getState().deleteCommentMessage(c.id, r.id)}
                                title="Delete reply"
                                className="opacity-0 group-hover/reply:opacity-100 hover:text-red-500 p-0.5 cursor-pointer transition-opacity"
                              >
                                <Trash2 size={10} />
                              </button>
                            </div>
                          </div>
                          {isEditingReply ? (
                            <div className="mt-1 flex flex-col gap-1.5">
                              <textarea
                                value={editingMsg.text}
                                onChange={(e) => setEditingMsg((prev) => ({ ...prev, text: e.target.value }))}
                                rows={2}
                                className="w-full resize-none rounded border border-[var(--accent)] bg-[var(--surface-content)] p-1.5 text-xs text-[var(--text-1)]"
                              />
                              <div className="flex justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => setEditingMsg(null)}
                                  className="px-2 py-0.5 text-[11px] text-[var(--text-2)] hover:bg-[var(--surface-hover)] rounded"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSaveEdit(c.id, r.id)}
                                  className="px-2 py-0.5 text-[11px] font-medium bg-[var(--accent)] text-white rounded"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="mt-0.5 whitespace-pre-wrap text-xs text-[var(--text-2)]">
                              {r.text}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Quick Reply Bar */}
                <div className="flex items-center gap-1.5 border-t border-[var(--line)]/60 p-2 bg-[var(--surface-content)] rounded-b-[var(--radius-lg)]">
                  <CornerDownRight size={13} className="text-[var(--text-3)] shrink-0" />
                  <input
                    type="text"
                    value={replyTexts[c.id] ?? ""}
                    onChange={(e) => setReplyTexts((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handlePostReply(c.id);
                      }
                    }}
                    placeholder="Reply…"
                    className="flex-1 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-panel)] px-2 py-1 text-xs text-[var(--text-1)] placeholder-[var(--text-3)] outline-none focus:border-[var(--accent)] transition-colors"
                  />
                  <button
                    type="button"
                    disabled={!(replyTexts[c.id] ?? "").trim()}
                    onClick={() => handlePostReply(c.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent)] text-white disabled:opacity-30 hover:opacity-90 transition-opacity cursor-pointer shrink-0"
                    title="Send reply"
                  >
                    <Send size={11} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
