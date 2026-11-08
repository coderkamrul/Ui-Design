"use client";

/**
 * Version history panel (M7).
 *
 * Rendered over the canvas's right side, in the same Phase 2 overlay
 * language as the Comments panel (white content surface, 12px radius,
 * soft shadow, no backdrop dimming). Lists the file's versions newest
 * first — manual saves and 15-minute autosaves — each with Preview /
 * Restore / Rename / Delete, and hosts the "Save current version"
 * form at the top.
 *
 * Preview and Restore are store operations (setPreviewVersion /
 * restoreVersion in lib/store.js): preview swaps the canvas to the
 * snapshot read-only; restore appends a "Before restore" safety
 * version and applies the snapshot as a normal, undoable commit.
 */
import { useState } from "react";
import { useEditorStore } from "@/lib/store";
import { summarizeVersion, versionTitle } from "@/lib/versions";
import { effectiveVersionCap, planOf } from "@/lib/plans";

function timeAgo(ts) {
  const ms = Date.now() - new Date(ts).getTime();
  const secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(ts).toLocaleDateString();
}

const panelCls =
  "absolute top-3 right-3 z-40 flex max-h-[calc(100%-24px)] w-[300px] flex-col rounded-[var(--radius-xl)] border border-[var(--line)] bg-[var(--surface-content)] shadow-xl";
const headerCls =
  "flex items-center gap-2 border-b border-[var(--line)] px-3 py-2 font-medium";
const ghostBtnCls =
  "rounded-[var(--radius-md)] px-2 py-1 hover:bg-[var(--surface-hover)]";
const actionBtnCls =
  "rounded-[var(--radius-md)] border border-[var(--line)] px-2 py-0.5 text-[var(--type-micro)] hover:bg-[var(--surface-hover)] disabled:opacity-40";
const fieldCls =
  "h-[var(--row-field-h)] min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 outline-none focus:border-[var(--accent-focus)]";

export default function HistoryPanel() {
  const open = useEditorStore((s) => s.historyPanelOpen);
  const versions = useEditorStore((s) => s.versions);
  const previewVersionId = useEditorStore((s) => s.previewVersionId);
  // Platform batch: the kept-version cap follows the plan (Free 10 /
  // Pro 30) — the store prunes with lib/plans' effectiveVersionCap.
  const planId = useEditorStore((s) => s.planId);
  const [name, setName] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  if (!open) return null;
  const st = useEditorStore.getState();
  const previewing = !!previewVersionId;

  const save = () => {
    st.addVersion(name.trim() || null);
    setName("");
    st.showToast({ message: "Version saved" });
  };

  return (
    <div className={panelCls} data-history="panel">
      <div className={headerCls}>
        <span>Version history</span>
        <div className="flex-1" />
        <button
          className={ghostBtnCls}
          title="Close"
          onClick={() => st.setHistoryPanelOpen(false)}
        >
          ✕
        </button>
      </div>

      {/* Save current version */}
      <div className="flex flex-col gap-2 border-b border-[var(--line)] px-3 py-2">
        <div className="flex gap-1.5">
          <input
            value={name}
            placeholder="Version name (optional)"
            disabled={previewing}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") save();
            }}
            className={fieldCls}
          />
          <button
            className="h-[var(--row-field-h)] shrink-0 rounded-[var(--radius-md)] px-3 font-medium disabled:opacity-40"
            style={{
              background: "var(--btn-primary-bg)",
              color: "var(--btn-primary-text)",
            }}
            disabled={previewing}
            title={
              previewing
                ? "Exit the preview to save the current version"
                : "Snapshot the current document as a version"
            }
            onClick={save}
          >
            Save
          </button>
        </div>
        <p className="text-[var(--type-micro)] text-[var(--text-2)]">
          {previewing
            ? "You're previewing an older version — saving is disabled until you go back to the current one."
            : `Autosaves appear here every 15 minutes while you edit. Up to ${effectiveVersionCap(planId)} versions are kept on the ${planOf(planId).name} plan.`}
        </p>
      </div>

      {/* Version list, newest first */}
      <div className="overflow-y-auto">
        {versions.length === 0 && (
          <p className="px-3 py-3 text-[var(--text-2)]">
            No versions yet. Save the current state above, or keep
            editing — an autosave will appear here within 15 minutes.
          </p>
        )}
        {versions.map((v) => {
          const counts = summarizeVersion(v);
          const isPreviewed = v.id === previewVersionId;
          const renaming = renamingId === v.id;
          const confirming = confirmDeleteId === v.id;
          return (
            <div
              key={v.id}
              className="flex flex-col gap-1 border-b border-[var(--line)] px-3 py-2"
              style={
                isPreviewed
                  ? {
                      background:
                        "color-mix(in srgb, var(--accent) 10%, transparent)",
                    }
                  : undefined
              }
            >
              {renaming ? (
                <input
                  defaultValue={v.name ?? ""}
                  autoFocus
                  placeholder="Version name"
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => {
                    st.renameVersion(v.id, e.currentTarget.value);
                    setRenamingId(null);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                      e.currentTarget.value = v.name ?? "";
                      e.currentTarget.blur();
                    }
                  }}
                  className={fieldCls}
                />
              ) : (
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {versionTitle(v)}
                  </span>
                  {v.auto && (
                    <span className="shrink-0 text-[var(--type-micro)] text-[var(--text-2)]">
                      auto
                    </span>
                  )}
                  {isPreviewed && (
                    <span
                      className="shrink-0 text-[var(--type-micro)] font-semibold"
                      style={{ color: "var(--accent)" }}
                    >
                      previewing
                    </span>
                  )}
                </span>
              )}
              <span
                className="text-[var(--type-micro)] text-[var(--text-2)]"
                title={new Date(v.createdAt).toLocaleString()}
              >
                {timeAgo(v.createdAt)} · {v.authorName ?? "You"} ·{" "}
                {counts.pages} {counts.pages === 1 ? "page" : "pages"} ·{" "}
                {counts.nodes} {counts.nodes === 1 ? "node" : "nodes"}
              </span>
              {confirming ? (
                <span className="flex items-center gap-1.5">
                  <span className="flex-1 text-[var(--type-micro)]">
                    Delete this version?
                  </span>
                  <button
                    className={actionBtnCls}
                    style={{ color: "#C62F3B", borderColor: "#C62F3B" }}
                    onClick={() => {
                      st.deleteVersion(v.id);
                      setConfirmDeleteId(null);
                    }}
                  >
                    Delete
                  </button>
                  <button
                    className={actionBtnCls}
                    onClick={() => setConfirmDeleteId(null)}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <span className="flex flex-wrap items-center gap-1.5">
                  <button
                    className={actionBtnCls}
                    onClick={() =>
                      st.setPreviewVersion(isPreviewed ? null : v.id)
                    }
                  >
                    {isPreviewed ? "Exit preview" : "Preview"}
                  </button>
                  <button
                    className={actionBtnCls}
                    title="Replace the current document with this version (a safety version is saved first, and the restore can be undone)"
                    onClick={() => st.restoreVersion(v.id)}
                  >
                    Restore
                  </button>
                  {!v.auto && (
                    <button
                      className={actionBtnCls}
                      onClick={() => setRenamingId(v.id)}
                    >
                      Rename
                    </button>
                  )}
                  <button
                    className={actionBtnCls}
                    onClick={() => setConfirmDeleteId(v.id)}
                  >
                    Delete
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
