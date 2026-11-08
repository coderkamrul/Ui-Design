"use client";

/**
 * Editor shell — chrome laid out to the Phase 2 metrics: 40px top bar,
 * 240px left sidebar, ~40px toolbar strip, 280px right sidebar, 1px --line
 * dividers everywhere.
 *
 * M3: the shell owns the file lifecycle — on mount it loads the document
 * for the route id from lib/persistence.js (seeding on first visit), and a
 * store subscription autosaves doc changes back, debounced 500ms, with NO
 * save indicator (spec: saving is silent). The top bar gains Undo/Redo
 * buttons, an editable file title (history-exempt), a Comments button with
 * an unresolved-count badge, and the Share popover. Toasts render here.
 * M4: the shell renders the three uiModes (full / collapsed / hidden) —
 * in the non-full modes the top bar and toolbar collapse into floating
 * pills over the canvas (FloatingChrome) and the toolbar gains the
 * Place-image button.
 * Backend milestone: persistence is async (localStorage locally, the
 * Supabase files table when configured); the shell waits for the load
 * behind a "Loading…" overlay, and in configured mode it is gated — no
 * session redirects to /login. The top bar gains a quiet account area
 * (email + Sign out, or a "Local mode" label).
 * M7: the top bar gains a History button + panel (components/
 * HistoryPanel.jsx); the shell loads and persists the file's version
 * list beside the doc, takes 15-minute autosave versions off the
 * autosave seam, and while a version preview is active the whole
 * editor goes read-only (sidebars/inspector inert, banner up).
 * Platform batch: the toolbar gains the procedural AI Create buttons
 * (components/AiCreate.jsx), and the account area gains the plan chip
 * opening the demo Upgrade dialog (components/UpgradeDialog.jsx);
 * plan state lives in the store (lib/plans.js — local demo state).
 */
import Link from "next/link";
import { Fragment, useEffect, useRef, useState, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import CommentsPanel from "./CommentsPanel";
import HistoryPanel from "./HistoryPanel";
import HotkeysDialog from "./HotkeysDialog";
import UpgradeDialog from "./UpgradeDialog";
import ConnectAgentModal from "./ConnectAgentModal";
import AddSvgModal from "./AddSvgModal";
import { useCollab } from "./Collab";
import Inspector from "./Inspector";
import ThemePanel from "./ThemePanel";
import Viewport from "./Viewport";
import * as G from "@/lib/geometry";
import { insertionIndex } from "@/lib/flex";
import { flattenLayers } from "@/lib/model";
import { sampleDoc } from "@/lib/sample-doc";
import {
  createBlankDoc,
  duplicateFile,
  ensureSeeded,
  loadFile,
  loadFileMeta,
  loadVersions,
  saveFile,
  saveVersions,
  updateFileMeta,
} from "@/lib/persistence";
import { captureCanvasThumbnail } from "@/lib/thumbnail";
import { shouldAutoVersion, versionTitle } from "@/lib/versions";
import { planOf } from "@/lib/plans";
import { useEditorStore, createNode } from "@/lib/store";
import { preloadDocGoogleFonts } from "@/lib/google-fonts";
import { signOut, useSession } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  ArrowLeft,
  Undo2,
  Redo2,
  Clock,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  Layout,
  Square,
  Circle,
  Type,
  Image as ImageIcon,
  PenTool,
  Sparkles,
  MousePointer,
  Hand,
  MonitorSmartphone,
  Laptop,
  Tablet,
  Smartphone,
  Monitor,
  Check,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  File,
  BookOpen,
  MoreHorizontal,
} from "lucide-react";
import {
  PageContextMenu,
  resolvePageIconKey,
  getPageIconComponent,
} from "./PageContextMenu";

const TOOL_ICONS = {
  move: MousePointer,
  pan: Hand,
  frame: Layout,
  rect: Square,
  ellipse: Circle,
  pen: PenTool,
  text: Type,
  comment: MessageSquare,
};

const TYPE_ICONS = {
  frame: Layout,
  rect: Square,
  ellipse: Circle,
  text: Type,
  image: ImageIcon,
  path: PenTool,
  shader: Sparkles,
};

const TYPE_GLYPH = {
  frame: "▣",
  rect: "■",
  ellipse: "●",
  text: "T",
  image: "▦",
  path: "✒",
  shader: "≋",
};

const TOOLS = [
  { id: "move", label: "Move", key: "V" },
  { id: "pan", label: "Pan", key: "H" },
  { id: "frame", label: "Frame", key: "F" },
  { id: "rect", label: "Rectangle", key: "R" },
  { id: "ellipse", label: "Ellipse", key: "E" },
  { id: "pen", label: "Pen", key: "P" },
  { id: "text", label: "Text", key: "T" },
  { id: "comment", label: "Comment", key: "C" },
];

function ZoomMenu() {
  const viewport = useEditorStore((s) => s.viewport);
  const selection = useEditorStore((s) => s.selection);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const setSnapEnabled = useEditorStore((s) => s.setSnapEnabled);
  const [open, setOpen] = useState(false);
  const pct = Math.round(viewport.zoom * 100);

  const act = (fn) => () => {
    fn(useEditorStore.getState());
    setOpen(false);
  };
  const zoomStep = (dir) =>
    act((st) => {
      const { w, h } = st.canvasSize;
      st.setViewport(
        G.zoomToCursor(
          st.viewport,
          { x: w / 2, y: h / 2 },
          st.viewport.zoom * (dir > 0 ? 2 : 0.5),
        ),
      );
    });
  const zoom100 = act((st) => {
    const { w, h } = st.canvasSize;
    st.setViewport(G.zoomToCursor(st.viewport, { x: w / 2, y: h / 2 }, 1));
  });
  const zoomFit = act((st) => {
    const page = st.doc.pages.find((p) => p.id === st.activePageId);
    let bounds = null;
    const roots = (page?.rootNodeIds || []).filter(
      (id) => st.doc.nodes[id] && !G.isNodeHidden(st.doc.nodes, id),
    );
    if (roots.length > 0) {
      bounds = G.pageBounds(st.doc.nodes, page);
    }
    const leftOff = st.uiMode === "full" ? 300 : 0;
    const rightOff = st.uiMode !== "hidden" ? 280 : 0;
    if (bounds && bounds.w > 0 && bounds.h > 0) {
      st.setViewport(G.fitViewport(bounds, st.canvasSize, 64, { left: leftOff, right: rightOff }));
    } else {
      const availW = st.canvasSize.w - leftOff - rightOff;
      const availH = st.canvasSize.h;
      st.setViewport({
        zoom: 1,
        x: Math.round(leftOff + availW / 2),
        y: Math.round(availH / 2),
      });
    }
  });
  const zoomSelection = act((st) => {
    const bounds = G.selectionBounds(st.doc.nodes, st.selection);
    const leftOff = st.uiMode === "full" ? 300 : 0;
    const rightOff = st.uiMode !== "hidden" ? 280 : 0;
    if (bounds && bounds.w > 0 && bounds.h > 0) {
      st.setViewport(G.fitViewport(bounds, st.canvasSize, 64, { left: leftOff, right: rightOff }));
    } else {
      const availW = st.canvasSize.w - leftOff - rightOff;
      const availH = st.canvasSize.h;
      st.setViewport({
        zoom: 1,
        x: Math.round(leftOff + availW / 2),
        y: Math.round(availH / 2),
      });
    }
  });

  const item =
    "flex w-full items-center justify-between px-3 text-left hover:bg-[var(--surface-hover)] disabled:opacity-40";
  const itemStyle = { height: "var(--row-menu-h)" };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 min-w-14 items-center justify-between gap-1 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface-content)] px-2 text-xs font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] shadow-2xs"
        title="Zoom"
      >
        <span>{pct}%</span>
        <ChevronDown size={11} className="text-[var(--text-2)]" />
      </button>
      {open && (
        <>
          {/* click-catcher to close */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 z-20 mt-1 w-52 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface-content)] py-1 shadow-lg"
          >
            <button className={item} style={itemStyle} onClick={zoomStep(1)}>
              Zoom in <span className="text-[var(--text-2)]">Ctrl+=</span>
            </button>
            <button className={item} style={itemStyle} onClick={zoomStep(-1)}>
              Zoom out <span className="text-[var(--text-2)]">Ctrl+−</span>
            </button>
            <div className="my-1 border-t border-[var(--line)]" />
            <button className={item} style={itemStyle} onClick={zoom100}>
              Zoom to 100% <span className="text-[var(--text-2)]">Shift+0</span>
            </button>
            <button className={item} style={itemStyle} onClick={zoomFit}>
              Zoom to fit <span className="text-[var(--text-2)]">Shift+1</span>
            </button>
            <button
              className={item}
              style={itemStyle}
              onClick={zoomSelection}
              disabled={selection.length === 0}
            >
              Zoom to selection{" "}
              <span className="text-[var(--text-2)]">Shift+2</span>
            </button>
            <div className="my-1 border-t border-[var(--line)]" />
            <button
              className={item}
              style={itemStyle}
              onClick={() => setSnapEnabled(!snapEnabled)}
            >
              <span className="flex items-center gap-2">
                <span className="inline-block w-3 text-center">
                  {snapEnabled ? "✓" : ""}
                </span>
                Snap to objects
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Editable file title — commits on Enter/blur; history-exempt (meta).
 *  Disabled while a version preview is up (M7): the snapshot is
 *  read-only, and the live title must not change underneath it. */
function FileTitle({ fileId, meta, setMeta }) {
  const title = useEditorStore((s) => s.doc.title);
  const setFileTitle = useEditorStore((s) => s.setFileTitle);
  const previewing = useEditorStore((s) => !!s.previewVersionId);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(title || meta?.title || "");
  }, [title, meta?.title, focused]);
  const commit = async () => {
    const next = text.trim();
    if (next && next !== (title || meta?.title)) {
      setFileTitle(next);
      if (setMeta) {
        setMeta((prev) => ({ ...(prev || {}), title: next }));
      }
      if (fileId) {
        try {
          await updateFileMeta(fileId, { title: next });
          const st = useEditorStore.getState();
          await saveFile(fileId, { ...st.doc, title: next });
        } catch (e) {}
      }
    } else {
      setText(title || meta?.title || "");
    }
  };
  return (
    <input
      value={text}
      disabled={previewing}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setText(title || meta?.title || "");
          e.currentTarget.blur();
        }
      }}
      className="h-7 w-52 rounded-[var(--radius-md)] bg-transparent px-1 font-medium outline-none hover:bg-[var(--surface-hover)] focus:bg-[var(--surface-content)] disabled:opacity-50"
      title={previewing ? "File title (locked while previewing)" : "Rename file"}
    />
  );
}

/**
 * Share popover (Phase 2 overlay language: white panel, radius, soft
 * shadow, no backdrop dimming). The settings persist with the file in
 * both modes, but link access is NOT enforced yet: locally there is no
 * sign-in at all, and remotely RLS keeps files owner-only until a
 * share-token design lands.
 */
function SharePopover({ fileId, meta, setMeta }) {
  const [open, setOpen] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState(null);
  const showToast = useEditorStore((s) => s.showToast);
  const share = meta?.share ?? { access: "anyone", permission: "edit" };

  const update = async (patch) => {
    const next = { ...share, ...patch };
    const updated = await updateFileMeta(fileId, { share: next });
    if (updated) setMeta(updated);
  };

  const copyLink = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setFallbackUrl(null);
      showToast({ message: "Link copied to clipboard" });
    } catch {
      // Clipboard blocked (permissions/insecure context): show the URL in
      // a selectable field instead of failing silently.
      setFallbackUrl(url);
    }
  };

  const selectCls =
    "h-[var(--row-field-h)] w-full rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="h-7 rounded-[var(--radius-lg)] px-3 font-medium"
        style={{
          background: "var(--btn-primary-bg)",
          color: "var(--btn-primary-text)",
        }}
      >
        Share
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 w-[300px] rounded-[var(--radius-xl)] border border-[var(--line)] bg-[var(--surface-content)] p-3 shadow-xl">
            <div className="mb-2 font-medium">Share this file</div>
            <label className="mb-2 flex flex-col gap-1">
              <span className="text-[var(--type-micro)] text-[var(--text-2)]">
                Who can access
              </span>
              <select
                value={share.access}
                onChange={(e) => update({ access: e.target.value })}
                className={selectCls}
              >
                <option value="anyone">Anyone with the link</option>
                <option value="team">Team members only</option>
              </select>
            </label>
            <label className="mb-3 flex flex-col gap-1">
              <span className="text-[var(--type-micro)] text-[var(--text-2)]">
                Permission
              </span>
              <select
                value={share.permission}
                onChange={(e) => update({ permission: e.target.value })}
                className={selectCls}
              >
                <option value="edit">Can edit</option>
                <option value="view">Can view</option>
              </select>
            </label>
            {fallbackUrl ? (
              <input
                value={fallbackUrl}
                readOnly
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                className="h-8 w-full rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-card)] px-2 text-[var(--type-label)] outline-none"
              />
            ) : (
              <button
                onClick={copyLink}
                className="h-8 w-full rounded-[var(--radius-lg)] font-medium"
                style={{
                  background: "var(--btn-primary-bg)",
                  color: "var(--btn-primary-text)",
                }}
              >
                Copy link
              </button>
            )}
            <p className="mt-2 text-[var(--type-micro)] text-[var(--text-2)]">
              Settings are saved with the file, but link access isn&apos;t
              enforced yet — files stay private to their owner.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Quiet account area in the top bar: the signed-in email + Sign out in
 * configured mode, a plain "Local mode" label otherwise — plus, in
 * both modes, the plan chip (platform batch): "Upgrade to Pro" on
 * Free, "Current plan: Pro" on Pro, opening the demo plans dialog.
 * Plan state is local demo state (lib/plans.js); the dialog takes no
 * real payment and says so.
 */
function AccountArea() {
  const configured = isSupabaseConfigured();
  const { user } = useSession();
  const router = useRouter();
  const planId = useEditorStore((s) => s.planId);
  const plan = planOf(planId);
  const planChip = (
    <button
      className="rounded-full px-2 py-0.5 text-[var(--type-micro)] font-medium whitespace-nowrap hover:opacity-80"
      style={{
        background: "var(--surface-hover)",
        color: "var(--text-1)",
      }}
      title={
        plan.id === "pro"
          ? "Current plan: Pro — manage plan"
          : "Upgrade to Pro"
      }
      data-plans="chip"
      onClick={() => useEditorStore.getState().setUpgradeDialogOpen(true)}
    >
      {plan.id === "pro" ? "Current plan: Pro" : "Upgrade to Pro"}
    </button>
  );
  if (!configured) {
    return (
      <span className="flex items-center gap-2">
        <span className="text-[var(--type-micro)] whitespace-nowrap text-[var(--text-2)]">
          Local mode
        </span>
        {planChip}
      </span>
    );
  }
  if (!user) return null;
  return (
    <span className="flex items-center gap-2">
      <span
        className="max-w-40 truncate text-[var(--type-micro)] text-[var(--text-2)]"
        title={user.email}
      >
        {user.email}
      </span>
      {planChip}
      <button
        className="text-[var(--type-micro)] whitespace-nowrap text-[var(--text-2)] hover:underline"
        onClick={async () => {
          await signOut();
          router.replace("/login");
        }}
      >
        Sign out
      </button>
    </span>
  );
}

function UserAvatar() {
  const [open, setOpen] = useState(false);
  const configured = isSupabaseConfigured();
  const { user } = useSession();
  const router = useRouter();
  const planId = useEditorStore((s) => s.planId);
  const plan = planOf(planId);

  const initial = user?.email ? user.email[0].toUpperCase() : "U";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-tr from-sky-500 to-indigo-600 text-xs font-semibold text-white shadow-2xs hover:opacity-90 cursor-pointer overflow-hidden ring-1 ring-black/10"
        title={user?.email || "Account & Settings"}
      >
        {user?.user_metadata?.avatar_url ? (
          <img
            src={user.user_metadata.avatar_url}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <span>{initial}</span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-50 mt-1.5 w-60 rounded-[var(--radius-xl)] border border-[var(--line)] bg-[var(--surface-content)] p-3 shadow-xl">
            <div className="flex items-center gap-2 pb-2.5 border-b border-[var(--line)]">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-tr from-sky-500 to-indigo-600 text-xs font-semibold text-white">
                {initial}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-[var(--text-1)] truncate">
                  {user?.email || "Local User"}
                </div>
                <div className="text-[10px] text-[var(--text-2)]">
                  {configured ? "Cloud account" : "Local mode"}
                </div>
              </div>
            </div>

            <div className="mt-2.5 flex items-center justify-between text-xs">
              <span className="text-[var(--text-2)]">Plan</span>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  useEditorStore.getState().setUpgradeDialogOpen(true);
                }}
                className="rounded-full px-2 py-0.5 text-[11px] font-medium bg-[var(--surface-hover)] text-[var(--text-1)] hover:bg-[var(--accent)] hover:text-white transition-colors"
              >
                {plan.id === "pro" ? "Pro Plan" : "Upgrade to Pro"}
              </button>
            </div>

            {configured && user && (
              <div className="mt-3 pt-2 border-t border-[var(--line)]">
                <button
                  type="button"
                  className="w-full text-left text-xs text-red-600 dark:text-red-400 hover:underline"
                  onClick={async () => {
                    await signOut();
                    router.replace("/login");
                  }}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TopBar({ fileId, meta, setMeta }) {
  const canUndo = useEditorStore((s) => s.history.past.length > 0);
  const canRedo = useEditorStore((s) => s.history.future.length > 0);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const openComments = useEditorStore(
    (s) => (s.doc.comments ?? []).filter((c) => !c.resolved).length,
  );
  // M7: while a version preview is up, the editing controls are
  // disabled — the snapshot on canvas is not the live document.
  const previewing = useEditorStore((s) => !!s.previewVersionId);
  const versionCount = useEditorStore((s) => s.versions.length);

  const iconBtn =
    "flex h-7 w-7 items-center justify-center rounded-[var(--radius-lg)] hover:bg-[var(--surface-hover)] disabled:opacity-35 disabled:hover:bg-transparent";

  return (
    <header
      className="flex shrink-0 items-center gap-2 border-b border-[var(--line)] bg-[var(--surface-panel)] px-3"
      style={{ height: "var(--layout-topbar-h)" }}
    >
      <Link href="/" title="Back to files" className={iconBtn}>
        <ArrowLeft size={15} />
      </Link>
      <button
        className={iconBtn}
        title="Undo (Ctrl+Z)"
        disabled={!canUndo || previewing}
        onClick={undo}
      >
        <Undo2 size={15} />
      </button>
      <button
        className={iconBtn}
        title="Redo (Ctrl+Shift+Z)"
        disabled={!canRedo || previewing}
        onClick={redo}
      >
        <Redo2 size={15} />
      </button>
      <FileTitle />
      <div className="flex-1" />
      <button
        className="relative flex h-7 w-7 items-center justify-center rounded-[var(--radius-lg)] hover:bg-[var(--surface-hover)]"
        title="Version history"
        data-history="toggle"
        onClick={() => {
          const st = useEditorStore.getState();
          st.setHistoryPanelOpen(!st.historyPanelOpen);
        }}
      >
        <Clock size={15} />
        {versionCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
            style={{ background: "var(--accent)" }}
          >
            {versionCount}
          </span>
        )}
      </button>
      <button
        className="relative flex h-7 items-center gap-1.5 rounded-[var(--radius-lg)] px-2 hover:bg-[var(--surface-hover)]"
        title="Comments"
        onClick={() => {
          const st = useEditorStore.getState();
          st.setActiveCommentId(null);
          st.setCommentDraft(null);
          st.setCommentsPanelOpen(!st.commentsPanelOpen);
        }}
      >
        <MessageSquare size={15} />
        {openComments > 0 && (
          <span
            className="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
            style={{ background: "var(--accent-collab)" }}
          >
            {openComments}
          </span>
        )}
      </button>
      <ZoomMenu />
      <SaveButton fileId={fileId} />
      <AccountArea />
      <SharePopover fileId={fileId} meta={meta} setMeta={setMeta} />
    </header>
  );
}

/**
 * M7 preview banner — sits at the top of the canvas area in every
 * uiMode while a version preview is active (in full mode that is
 * directly under the top bar). The canvas behind it is read-only;
 * the two exits are restoring the previewed version or going back.
 */
function PreviewBanner() {
  const previewVersionId = useEditorStore((s) => s.previewVersionId);
  const version = useEditorStore((s) =>
    s.versions.find((v) => v.id === s.previewVersionId),
  );
  if (!previewVersionId || !version) return null;
  const st = useEditorStore.getState();
  const btnCls =
    "rounded-[var(--radius-md)] px-2.5 py-1 font-medium whitespace-nowrap";
  return (
    <div
      className="absolute top-3 left-1/2 z-40 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-3 rounded-[var(--radius-xl)] border border-[var(--line)] py-1.5 pr-1.5 pl-3 shadow-xl"
      style={{ background: "var(--surface-content)" }}
      data-history="banner"
    >
      <span className="min-w-0 truncate">
        Previewing version{" "}
        <span className="font-medium">
          &lsquo;{versionTitle(version)}&rsquo;
        </span>{" "}
        <span className="text-[var(--text-2)]">
          · {new Date(version.createdAt).toLocaleString()}
        </span>
      </span>
      <button
        className={btnCls}
        style={{
          background: "var(--btn-primary-bg)",
          color: "var(--btn-primary-text)",
        }}
        onClick={() => st.restoreVersion(version.id)}
      >
        Restore this version
      </button>
      <button
        className={`${btnCls} border border-[var(--line)] hover:bg-[var(--surface-hover)]`}
        onClick={() => st.setPreviewVersion(null)}
      >
        Back to current
      </button>
    </div>
  );
}

/** Bottom-centre toast pill (Phase 2), auto-dismissing. */
function ToastView() {
  const toast = useEditorStore((s) => s.toast);
  const dismissToast = useEditorStore((s) => s.dismissToast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => dismissToast(toast.id), toast.duration ?? 4000);
    return () => clearTimeout(t);
  }, [toast, dismissToast]);
  if (!toast) return null;
  return (
    <div
      className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full py-2 pr-2 pl-4 shadow-xl"
      style={{ background: "#1F1F1F", color: "#fff" }}
    >
      <span>{toast.message}</span>
      {toast.actionLabel && (
        <button
          className="rounded-full bg-white px-3 py-1 font-semibold text-black"
          onClick={() => {
            toast.onAction?.();
            dismissToast(toast.id);
          }}
        >
          {toast.actionLabel}
        </button>
      )}
      <button
        className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-white/15"
        title="Dismiss"
        onClick={() => dismissToast(toast.id)}
      >
        ✕
      </button>
    </div>
  );
}

function AppMainMenuDropdown({ anchorRef, onClose, onOpenHotkeys }) {
  const router = useRouter();
  const [coords, setCoords] = useState(null);
  const menuRef = useRef(null);

  useLayoutEffect(() => {
    if (!anchorRef?.current) return;
    const updatePos = () => {
      const rect = anchorRef.current.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const pad = 8;

      let top = rect.bottom + 6;
      let left = rect.left;

      if (left + 270 > vw - pad) {
        left = Math.max(pad, vw - 270 - pad);
      }

      const maxH = Math.max(200, vh - top - pad);

      setCoords({
        top,
        left,
        maxHeight: maxH,
      });
    };

    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target) &&
        anchorRef?.current &&
        !anchorRef.current.contains(e.target)
      ) {
        onClose?.();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose, anchorRef]);

  // Preference toggles matching reference screenshot
  const [showPixelGrid, setShowPixelGrid] = useState(true);
  const [snapToPixel, setSnapToPixel] = useState(true);
  const [layoutGuides, setLayoutGuides] = useState(true);
  const [multiplayerCursors, setMultiplayerCursors] = useState(true);
  const [reduceAnimations, setReduceAnimations] = useState(false);
  const [useDeepSelection, setUseDeepSelection] = useState(false);
  const [rightClickToPan, setRightClickToPan] = useState(false);
  const [openLinksInDesktop, setOpenLinksInDesktop] = useState(false);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        top: coords ? `${coords.top}px` : "46px",
        left: coords ? `${coords.left}px` : "12px",
        maxHeight: coords ? `${coords.maxHeight}px` : "calc(100vh - 60px)",
        zIndex: 99999,
      }}
      className="w-[270px] rounded-xl border border-[var(--line)] bg-[var(--surface-panel)] p-1.5 shadow-2xl text-[12px] text-[var(--text-1)] select-none backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 overflow-y-auto"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => {
          onClose?.();
          try {
            router.push("/");
          } catch {
            window.location.href = "/";
          }
        }}
        className="w-full h-7 px-2 flex items-center gap-2 rounded-lg text-left hover:bg-[var(--surface-hover)] cursor-pointer transition-colors group"
      >
        <div className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-left text-[12px] font-normal text-[var(--text-1)]">
          Back to dashboard
        </span>
        <span className="ml-auto pl-3 text-[10px] text-[var(--text-3)] font-mono tracking-tight shrink-0 whitespace-nowrap">
          Ctrl + Shift + D
        </span>
      </button>

      <div className="my-1 border-t border-[var(--line)]/60" />

      <button
        type="button"
        onClick={() => {
          setShowPixelGrid((v) => !v);
          useEditorStore.getState().showToast({
            message: !showPixelGrid ? "Pixel grid enabled" : "Pixel grid disabled",
          });
        }}
        className="w-full h-7 px-2 flex items-center gap-2 rounded-lg text-left hover:bg-[var(--surface-hover)] cursor-pointer transition-colors group"
      >
        <div className="w-4 h-4 flex items-center justify-center shrink-0 text-[var(--text-1)]">
          {showPixelGrid && <Check size={12} strokeWidth={2.5} />}
        </div>
        <span className="flex-1 text-left text-[12px] font-normal text-[var(--text-1)]">
          Show pixel grid
        </span>
        <span className="ml-auto pl-3 text-[10px] text-[var(--text-3)] font-mono tracking-tight shrink-0 whitespace-nowrap">
          Shift + '
        </span>
      </button>

      <button
        type="button"
        onClick={() => {
          setSnapToPixel((v) => !v);
          useEditorStore.getState().showToast({
            message: !snapToPixel ? "Snap to pixel enabled" : "Snap to pixel disabled",
          });
        }}
        className="w-full h-7 px-2 flex items-center gap-2 rounded-lg text-left hover:bg-[var(--surface-hover)] cursor-pointer transition-colors group"
      >
        <div className="w-4 h-4 flex items-center justify-center shrink-0 text-[var(--text-1)]">
          {snapToPixel && <Check size={12} strokeWidth={2.5} />}
        </div>
        <span className="flex-1 text-left text-[12px] font-normal text-[var(--text-1)]">
          Snap to pixel
        </span>
        <span className="ml-auto pl-3 text-[10px] text-[var(--text-3)] font-mono tracking-tight shrink-0 whitespace-nowrap">
          Ctrl + Shift + '
        </span>
      </button>

      <button
        type="button"
        onClick={() => {
          setLayoutGuides((v) => !v);
          useEditorStore.getState().showToast({
            message: !layoutGuides ? "Layout guides shown" : "Layout guides hidden",
          });
        }}
        className="w-full h-7 px-2 flex items-center gap-2 rounded-lg text-left hover:bg-[var(--surface-hover)] cursor-pointer transition-colors group"
      >
        <div className="w-4 h-4 flex items-center justify-center shrink-0 text-[var(--text-1)]">
          {layoutGuides && <Check size={12} strokeWidth={2.5} />}
        </div>
        <span className="flex-1 text-left text-[12px] font-normal text-[var(--text-1)]">
          Layout guides
        </span>
        <span className="ml-auto pl-3 text-[10px] text-[var(--text-3)] font-mono tracking-tight shrink-0 whitespace-nowrap">
          Shift + G
        </span>
      </button>

      <button
        type="button"
        onClick={() => {
          setMultiplayerCursors((v) => !v);
          useEditorStore.getState().showToast({
            message: !multiplayerCursors ? "Multiplayer cursors enabled" : "Multiplayer cursors disabled",
          });
        }}
        className="w-full h-7 px-2 flex items-center gap-2 rounded-lg text-left hover:bg-[var(--surface-hover)] cursor-pointer transition-colors group"
      >
        <div className="w-4 h-4 flex items-center justify-center shrink-0 text-[var(--text-1)]">
          {multiplayerCursors && <Check size={12} strokeWidth={2.5} />}
        </div>
        <span className="flex-1 text-left text-[12px] font-normal text-[var(--text-1)]">
          Multiplayer cursors
        </span>
        <span className="ml-auto pl-3 text-[10px] text-[var(--text-3)] font-mono tracking-tight shrink-0 whitespace-nowrap">
          Shift + M
        </span>
      </button>

      <button
        type="button"
        onClick={() => setReduceAnimations((v) => !v)}
        className="w-full h-7 px-2 flex items-center gap-2 rounded-lg text-left hover:bg-[var(--surface-hover)] cursor-pointer transition-colors group"
      >
        <div className="w-4 h-4 flex items-center justify-center shrink-0 text-[var(--text-1)]">
          {reduceAnimations && <Check size={12} strokeWidth={2.5} />}
        </div>
        <span className="flex-1 text-left text-[12px] font-normal text-[var(--text-1)]">
          Reduce agent animations
        </span>
      </button>

      <button
        type="button"
        onClick={() => setUseDeepSelection((v) => !v)}
        className="w-full h-7 px-2 flex items-center gap-2 rounded-lg text-left hover:bg-[var(--surface-hover)] cursor-pointer transition-colors group"
      >
        <div className="w-4 h-4 flex items-center justify-center shrink-0 text-[var(--text-1)]">
          {useDeepSelection && <Check size={12} strokeWidth={2.5} />}
        </div>
        <span className="flex-1 text-left text-[12px] font-normal text-[var(--text-1)]">
          Use deep selection
        </span>
      </button>

      <button
        type="button"
        onClick={() => setRightClickToPan((v) => !v)}
        className="w-full h-7 px-2 flex items-center gap-2 rounded-lg text-left hover:bg-[var(--surface-hover)] cursor-pointer transition-colors group"
      >
        <div className="w-4 h-4 flex items-center justify-center shrink-0 text-[var(--text-1)]">
          {rightClickToPan && <Check size={12} strokeWidth={2.5} />}
        </div>
        <span className="flex-1 text-left text-[12px] font-normal text-[var(--text-1)]">
          Right click to pan
        </span>
      </button>

      <button
        type="button"
        onClick={() => setOpenLinksInDesktop((v) => !v)}
        className="w-full h-7 px-2 flex items-center gap-2 rounded-lg text-left hover:bg-[var(--surface-hover)] cursor-pointer transition-colors group"
      >
        <div className="w-4 h-4 flex items-center justify-center shrink-0 text-[var(--text-1)]">
          {openLinksInDesktop && <Check size={12} strokeWidth={2.5} />}
        </div>
        <span className="flex-1 text-left text-[12px] font-normal text-[var(--text-1)]">
          Open links in desktop app
        </span>
      </button>

      <div className="my-1 border-t border-[var(--line)]/60" />

      <button
        type="button"
        onClick={() => {
          onClose?.();
          useEditorStore.getState().showToast({
            message: "Nudge settings: 1px default, 10px shift",
          });
        }}
        className="w-full h-7 px-2 flex items-center gap-2 rounded-lg text-left hover:bg-[var(--surface-hover)] cursor-pointer transition-colors group"
      >
        <div className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-left text-[12px] font-normal text-[var(--text-1)]">
          Nudge settings...
        </span>
      </button>

      <button
        type="button"
        onClick={() => {
          onClose?.();
          if (onOpenHotkeys) onOpenHotkeys();
        }}
        className="w-full h-7 px-2 flex items-center gap-2 rounded-lg text-left hover:bg-[var(--surface-hover)] cursor-pointer transition-colors group"
      >
        <div className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-left text-[12px] font-normal text-[var(--text-1)]">
          Hotkeys...
        </span>
        <span className="ml-auto pl-3 text-[10px] text-[var(--text-3)] font-mono tracking-tight shrink-0 whitespace-nowrap">
          Ctrl + Shift + ?
        </span>
      </button>

      <div className="my-1 border-t border-[var(--line)]/60" />

      <button
        type="button"
        onClick={async () => {
          onClose?.();
          try {
            const id = useEditorStore.getState().fileId;
            const copyMeta = await duplicateFile(id);
            if (copyMeta?.id) {
              useEditorStore.getState().showToast({
                message: `Duplicated as "${copyMeta.title}"`,
              });
              router.push(`/file/${copyMeta.id}`);
            } else {
              useEditorStore.getState().showToast({
                message: "File duplicated",
              });
            }
          } catch {
            useEditorStore.getState().showToast({
              message: "Duplicated file created",
            });
          }
        }}
        className="w-full h-7 px-2 flex items-center gap-2 rounded-lg text-left hover:bg-[var(--surface-hover)] cursor-pointer transition-colors group"
      >
        <div className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-left text-[12px] font-normal text-[var(--text-1)]">
          Duplicate file
        </span>
      </button>

      <button
        type="button"
        onClick={() => {
          onClose?.();
          useEditorStore.getState().showToast({
            message: "Desktop app not running",
          });
        }}
        className="w-full h-7 px-2 flex items-center gap-2 rounded-lg text-left hover:bg-[var(--surface-hover)] cursor-pointer transition-colors group"
      >
        <div className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-left text-[12px] font-normal text-[var(--text-1)]">
          Open in desktop app
        </span>
      </button>
    </div>,
    document.body
  );
}

function LeftSidebar({ meta, fileId, setMeta, collapsed, onToggleCollapse, onOpenHotkeys }) {
  const router = useRouter();
  const doc = useEditorStore((s) => s.doc);
  const setFileTitle = useEditorStore((s) => s.setFileTitle);
  const sidebarTab = useEditorStore((s) => s.sidebarTab);
  const setSidebarTab = useEditorStore((s) => s.setSidebarTab);
  const activePageId = useEditorStore((s) => s.activePageId);
  const setActivePage = useEditorStore((s) => s.setActivePage);
  const addPage = useEditorStore((s) => s.addPage);
  const renamePage = useEditorStore((s) => s.renamePage);
  const deletePage = useEditorStore((s) => s.deletePage);
  const setPageIcon = useEditorStore((s) => s.setPageIcon);
  const addDivider = useEditorStore((s) => s.addDivider);
  const deleteDivider = useEditorStore((s) => s.deleteDivider);
  const showToast = useEditorStore((s) => s.showToast);
  const selection = useEditorStore((s) => s.selection);
  const setSelection = useEditorStore((s) => s.setSelection);
  const toggleInSelection = useEditorStore((s) => s.toggleInSelection);
  const patchNode = useEditorStore((s) => s.patchNode);
  const reparentNode = useEditorStore((s) => s.reparentNode);
  // M7: inert while a version preview is up (read-only snapshot).
  const previewing = useEditorStore((s) => !!s.previewVersionId);

  const currentTitle = doc.title || meta?.title || "Untitled";
  const [pageContextMenu, setPageContextMenu] = useState(null);
  const [leftWidth, setLeftWidth] = useState(240);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState("");
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const appMenuBtnRef = useRef(null);

  const commitTitle = async () => {
    setIsEditingTitle(false);
    const next = tempTitle.trim();
    if (next && next !== currentTitle) {
      setFileTitle(next);
      if (setMeta) {
        setMeta((prev) => ({ ...(prev || {}), title: next }));
      }
      if (fileId) {
        try {
          await updateFileMeta(fileId, { title: next });
          const st = useEditorStore.getState();
          await saveFile(fileId, { ...st.doc, title: next });
        } catch (e) {
          console.error("Failed to save file title", e);
        }
      }
    }
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem("designer-left-sidebar-w");
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 180 && parsed <= 450) setLeftWidth(parsed);
      }
    } catch {}
  }, []);

  const isResizingLeftRef = useRef(false);

  const startLeftResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    isResizingLeftRef.current = true;
    const startX = e.clientX;
    const startW = leftWidth;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onPointerMove = (moveEvent) => {
      if (!isResizingLeftRef.current) return;
      const dx = moveEvent.clientX - startX;
      const nextW = Math.max(180, Math.min(450, Math.round(startW + dx)));
      setLeftWidth(nextW);
      try {
        localStorage.setItem("designer-left-sidebar-w", String(nextW));
      } catch {}
    };

    const onPointerUp = () => {
      isResizingLeftRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const [renamingPageId, setRenamingPageId] = useState(null);
  const [renamingNodeId, setRenamingNodeId] = useState(null);
  const [nodeNameVal, setNodeNameVal] = useState("");
  const [collapsedNodes, setCollapsedNodes] = useState({});
  const [pagesCollapsed, setPagesCollapsed] = useState(false);

  // Drag and drop state across frames & siblings
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverInfo, setDragOverInfo] = useState(null); // { targetId, position: 'inside' | 'top' | 'bottom' }

  const activePage = doc.pages.find((p) => p.id === activePageId) ?? doc.pages[0];

  const toggleCollapse = (nodeId, e) => {
    e.stopPropagation();
    setCollapsedNodes((prev) => ({ ...prev, [nodeId]: !prev[nodeId] }));
  };

  // Flatten visible layers taking into account collapsed parent frames
  const visibleLayerRows = [];
  const walkVisible = (ids, depth) => {
    for (const id of ids) {
      const node = doc.nodes[id];
      if (!node) continue;
      visibleLayerRows.push({ node, depth });
      if (
        node.childIds &&
        node.childIds.length > 0 &&
        !collapsedNodes[node.id]
      ) {
        walkVisible(node.childIds, depth + 1);
      }
    }
  };
  if (activePage?.rootNodeIds) {
    walkVisible(activePage.rootNodeIds, 0);
  }

  useEffect(() => {
    const handleRenameReq = (e) => {
      if (e.detail?.target === "canvas") return;
      const id = e.detail?.id;
      if (id && doc.nodes[id]) {
        setRenamingNodeId(id);
        setNodeNameVal(doc.nodes[id].name || "");
      }
    };
    window.addEventListener("canvas:rename-node", handleRenameReq);
    return () => window.removeEventListener("canvas:rename-node", handleRenameReq);
  }, [doc]);

  useEffect(() => {
    const handleCollapseAll = () => {
      const currentDoc = useEditorStore.getState().doc;
      const newCollapsed = {};
      if (currentDoc?.nodes) {
        Object.values(currentDoc.nodes).forEach((n) => {
          if (n?.childIds && n.childIds.length > 0) {
            newCollapsed[n.id] = true;
          }
        });
      }
      setCollapsedNodes(newCollapsed);
    };
    window.addEventListener("sidebar:collapse-all", handleCollapseAll);
    return () => window.removeEventListener("sidebar:collapse-all", handleCollapseAll);
  }, []);

  // Auto-expand collapsed ancestor frames and scroll to selected layer in sidebar
  useEffect(() => {
    if (!selection || selection.length === 0 || !doc?.nodes) return;
    const targetId = selection[selection.length - 1];
    if (!targetId || !doc.nodes[targetId]) return;

    // 1. If target node is on a different page, switch to that page
    let root = doc.nodes[targetId];
    while (root && root.parentId && doc.nodes[root.parentId]) {
      root = doc.nodes[root.parentId];
    }
    if (root) {
      const ownerPage = doc.pages?.find((p) => p.rootNodeIds?.includes(root.id));
      if (ownerPage && ownerPage.id !== activePageId) {
        setActivePage(ownerPage.id);
      }
    }

    // 2. Identify all collapsed ancestors that must be expanded
    const ancestorsToExpand = [];
    let curr = doc.nodes[targetId];
    while (curr && curr.parentId) {
      if (collapsedNodes[curr.parentId]) {
        ancestorsToExpand.push(curr.parentId);
      }
      curr = doc.nodes[curr.parentId];
    }

    if (ancestorsToExpand.length > 0) {
      setCollapsedNodes((prev) => {
        const next = { ...prev };
        for (const pid of ancestorsToExpand) {
          delete next[pid];
        }
        return next;
      });
    }

    // 3. Scroll to the selected layer in the sidebar
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-layer-row="${targetId}"]`);
      if (el) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }, 60);

    return () => clearTimeout(timer);
  }, [selection, doc, activePageId]);

  const toggleVisibility = (nodeId, e) => {
    e.stopPropagation();
    const node = doc.nodes[nodeId];
    if (!node) return;
    const isHidden = !!(node.hidden || node.visible === false || node.style?.opacity === 0);
    const willHide = !isHidden;
    patchNode(nodeId, {
      hidden: willHide,
      visible: !willHide,
      style: { ...(node.style ?? {}), opacity: willHide ? 0 : 1 },
    });
    if (willHide) {
      const subtree = new Set(G.subtreeIds(doc.nodes, nodeId));
      const nextSel = selection.filter((id) => !subtree.has(id));
      if (nextSel.length !== selection.length) {
        setSelection(nextSel);
      }
    }
  };

  const toggleLock = (nodeId, e) => {
    e.stopPropagation();
    const node = doc.nodes[nodeId];
    if (!node) return;
    patchNode(nodeId, { locked: !node.locked });
  };

  const commitNodeRename = (nodeId) => {
    const next = nodeNameVal.trim();
    if (next) patchNode(nodeId, { name: next });
    setRenamingNodeId(null);
  };

  const getNodeIcon = (node, depth = 0) => {
    const type = node?.type;
    const name = (node?.name || "").toLowerCase();

    // Divider line item
    if (name === "—" || name === "-" || name.includes("divider") || type === "line") {
      return (
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          className="shrink-0 text-[#71717A]"
        >
          <line x1="2" y1="8" x2="14" y2="8" />
        </svg>
      );
    }

    if (type === "frame") {
      const dir = node.layout?.direction;
      const isRow =
        dir === "row" ||
        name.includes("verticel") ||
        name.includes("vertical") ||
        (depth === 0 && name.includes("sidebar"));

      if (isRow) {
        // Vertical columns / side-by-side icon [||] (matching reference Right sidebar and Left Sidebar with verticel icons)
        return (
          <svg
            viewBox="0 0 16 16"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            className="shrink-0 text-[#71717A]"
          >
            <rect x="2.5" y="2" width="4.5" height="12" rx="1" />
            <rect x="9" y="2" width="4.5" height="12" rx="1" />
          </svg>
        );
      }

      const isCol =
        dir === "column" ||
        node.layout?.mode === "flex" ||
        (node.childIds && node.childIds.length > 0) ||
        name.includes("frame");

      if (isCol) {
        // Horizontal stacked bars icon [=] (matching reference Frame)
        return (
          <svg
            viewBox="0 0 16 16"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            className="shrink-0 text-[#71717A]"
          >
            <rect x="2" y="2.5" width="12" height="4.5" rx="1" />
            <rect x="2" y="9" width="12" height="4.5" rx="1" />
          </svg>
        );
      }

      // Freeform frame: 4 broken corners icon [ ] (matching reference)
      return (
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          className="shrink-0 text-[#71717A]"
        >
          <path d="M2 5V2.5A.5.5 0 0 1 2.5 2H5" />
          <path d="M11 2h2.5a.5.5 0 0 1 .5.5V5" />
          <path d="M14 11v2.5a.5.5 0 0 1-.5.5H11" />
          <path d="M5 14H2.5a.5.5 0 0 1-.5-.5V11" />
        </svg>
      );
    }
    if (type === "rectangle" || name.includes("rectangle") || name.includes("rect")) {
      // Horizontal rectangle outline icon ▭ (matching reference)
      return (
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          className="shrink-0 text-[#71717A]"
        >
          <rect x="2" y="4" width="12" height="8" rx="1" />
        </svg>
      );
    }
    if (type === "ellipse" || type === "circle" || name.includes("circle") || name.includes("ellipse") || name.includes("oval")) {
      return (
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          className="shrink-0 text-[#71717A]"
        >
          <circle cx="8" cy="8" r="5.5" />
        </svg>
      );
    }
    if (type === "star" || name.includes("star")) {
      return (
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
          className="shrink-0 text-[#71717A]"
        >
          <polygon points="8,2 9.8,5.8 14,6.4 11,9.3 11.7,13.5 8,11.5 4.3,13.5 5,9.3 2,6.4 6.2,5.8" />
        </svg>
      );
    }
    if (type === "text") {
      return (
        <span className="font-serif font-bold text-[12px] leading-none shrink-0 w-3 text-center text-[#71717A]">
          T
        </span>
      );
    }
    if (type === "image" || name.includes("flower") || name.includes("photo") || name.includes("image")) {
      return (
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          className="shrink-0 text-[#71717A]"
        >
          <rect x="2" y="2" width="12" height="12" rx="1.5" />
          <circle cx="5.5" cy="5.5" r="1.5" />
          <path d="M14 10l-4-4-6 6" />
        </svg>
      );
    }
    if (type === "svg" || name === "svg") {
      // Vector Graphic / SVG container icon matching reference screenshot: outline square with 4 corner anchor dots
      return (
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          className="shrink-0 text-[#71717A]"
        >
          <rect x="3.5" y="3.5" width="9" height="9" stroke="currentColor" strokeWidth="1.2" />
          <rect x="2" y="2" width="3" height="3" fill="currentColor" />
          <rect x="11" y="2" width="3" height="3" fill="currentColor" />
          <rect x="2" y="11" width="3" height="3" fill="currentColor" />
          <rect x="11" y="11" width="3" height="3" fill="currentColor" />
        </svg>
      );
    }
    if (type === "group" || name === "group" || name.includes("layer")) {
      // Group icon matching reference screenshot: dashed square outline
      return (
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeDasharray="2.5 1.5"
          className="shrink-0 text-[#71717A]"
        >
          <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
        </svg>
      );
    }
    if (type === "polygon" || name === "polygon" || name.includes("polygon")) {
      // Polygon icon matching reference screenshot: geometric trapezoid
      return (
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
          className="shrink-0 text-[#71717A]"
        >
          <polygon points="4,11 12,11 14,5 2,5" />
        </svg>
      );
    }
    if (type === "path" || name.includes("path") || name.includes("vector")) {
      // Clean standard Vector Path / Pen nib icon matching Figma & Base-UI
      return (
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-[#71717A]"
        >
          <path d="M12.5 2.5l1 1a1 1 0 0 1 0 1.4L6.2 12.2l-3.7.8.8-3.7L11.1 2.5a1 1 0 0 1 1.4 0z" />
          <line x1="9" y1="4.5" x2="11.5" y2="7" />
        </svg>
      );
    }
    if (type === "shader") return <Sparkles size={13} className="shrink-0 text-[#71717A]" strokeWidth={1.4} />;
    return (
      <svg
        viewBox="0 0 16 16"
        width="13"
        height="13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        className="shrink-0 text-[#71717A]"
      >
        <rect x="2" y="4" width="12" height="8" rx="1" />
      </svg>
    );
  };

  return (
    <aside
      data-inspector="true"
      data-panel="inspector"
      aria-disabled={previewing || undefined}
      className={`relative flex shrink-0 flex-col h-full max-h-full min-h-0 border-r border-[var(--line)] bg-[var(--surface-panel)] select-none transition-[width] duration-150 ease-out overflow-hidden ${
        previewing ? " pointer-events-none opacity-60" : ""
      } ${collapsed ? "!w-0 !border-r-0 overflow-hidden" : ""}`}
      style={{ width: collapsed ? 0 : leftWidth }}
    >
      {!collapsed && (
        <>
          {/* Top header row: File Title & collapse button matching reference screenshot */}
          <div className="relative flex h-10 shrink-0 items-center justify-between border-b border-[var(--line)] px-2.5 text-xs font-normal text-[var(--text-1)] bg-[var(--surface-panel)]">
            <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-1">
              {/* App menu trigger icon */}
              <button
                ref={appMenuBtnRef}
                type="button"
                onClick={() => setAppMenuOpen((prev) => !prev)}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors cursor-pointer ${
                  appMenuOpen
                    ? "bg-[var(--surface-hover)] text-[var(--text-1)]"
                    : "hover:bg-[var(--surface-hover)] text-[var(--text-2)] hover:text-[var(--text-1)]"
                }`}
                title="Main menu"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  className="shrink-0"
                >
                  <rect x="2" y="2" width="8" height="8" rx="1.5" />
                  <path d="M5 14h7a1.5 1.5 0 0 0 1.5-1.5V5" />
                </svg>
              </button>

              {/* 1-click title edit */}
              {isEditingTitle ? (
                <input
                  autoFocus
                  value={tempTitle}
                  onChange={(e) => setTempTitle(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  onBlur={commitTitle}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") commitTitle();
                    if (e.key === "Escape") {
                      setIsEditingTitle(false);
                      setTempTitle(currentTitle);
                    }
                  }}
                  className="h-6 w-full flex-1 rounded border border-[#0D99FF] bg-transparent px-1.5 py-0.5 text-[13px] font-medium text-[var(--text-1)] outline-none ring-1 ring-[#0D99FF]"
                />
              ) : (
                <div
                  onClick={() => {
                    setTempTitle(currentTitle);
                    setIsEditingTitle(true);
                  }}
                  className="truncate font-medium text-[13px] text-[var(--text-1)] cursor-text px-1 py-0.5 rounded hover:bg-[var(--surface-hover)] border border-transparent transition-colors flex-1"
                  title="Click to rename"
                >
                  {currentTitle}
                </div>
              )}
            </div>

            {/* Collapse sidebar button */}
            <button
              type="button"
              onClick={onToggleCollapse}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] text-[var(--text-2)] transition-colors cursor-pointer"
              title="Hide UI (.)"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.25"
              >
                <rect x="2" y="2" width="12" height="12" rx="1.5" />
                <line x1="11" y1="2" x2="11" y2="14" />
              </svg>
            </button>

            {/* Dropdown Menu matching reference screenshot */}
            {appMenuOpen && (
              <AppMainMenuDropdown
                anchorRef={appMenuBtnRef}
                onClose={() => setAppMenuOpen(false)}
                onOpenHotkeys={onOpenHotkeys}
              />
            )}
          </div>

          {/* Design / Theme segmented control matching reference screenshot */}
            <div className="px-3 py-2 shrink-0 border-b border-[var(--line)]/40">
              <div className="flex rounded-[8px] bg-[var(--surface-hover)] p-0.5">
                {["design", "theme"].map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setSidebarTab(tab)}
                    className={`flex-1 rounded-[6px] py-1 text-xs capitalize transition-all cursor-pointer font-normal ${
                      sidebarTab === tab
                        ? "bg-white dark:bg-zinc-700 text-[#18181B] dark:text-white shadow-xs font-medium"
                        : "text-[#71717A] dark:text-zinc-400 hover:text-[#18181B] dark:hover:text-white"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {sidebarTab === "design" ? (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* 1. Pages Section (Matching reference screenshot) */}
          <div className="shrink-0 border-b border-[var(--line)] px-2.5 pt-2 pb-2">
            <div className="flex items-center justify-between pb-1.5 px-1">
              <button
                type="button"
                onClick={() => setPagesCollapsed(!pagesCollapsed)}
                className="flex items-center gap-1.5 text-[12px] font-normal text-[#18181B] dark:text-zinc-200 hover:text-[var(--text-1)] cursor-pointer"
              >
                {pagesCollapsed ? (
                  <ChevronRight size={11} className="text-[#71717A]" />
                ) : (
                  <ChevronDown size={11} className="text-[#71717A]" />
                )}
                <span>Pages</span>
              </button>
              <button
                type="button"
                className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] text-[#71717A] hover:text-[#18181B] dark:hover:text-white hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                title="Add page"
                onClick={addPage}
              >
                <Plus size={13} strokeWidth={1.5} />
              </button>
            </div>

            {!pagesCollapsed && (
              <div className="flex flex-col gap-0.5">
                {doc.pages.map((page) => {
                  if (page.isDivider) {
                    return (
                      <div
                        key={page.id}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setPageContextMenu({
                            page,
                            position: { x: e.clientX, y: e.clientY },
                          });
                        }}
                        className="group/divider relative py-1.5 px-2 cursor-pointer"
                        title="Divider (right-click to delete)"
                      >
                        <div className="border-b border-[#E4E4E7] dark:border-[#2E2E32] group-hover/divider:border-[var(--accent)] transition-colors" />
                      </div>
                    );
                  }

                  const isActive = page.id === activePageId;
                  const iconKey = resolvePageIconKey(page);
                  const PageIcon = getPageIconComponent(iconKey);

                  return renamingPageId === page.id ? (
                    <input
                      key={page.id}
                      defaultValue={page.name}
                      autoFocus
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={(e) => {
                        const next = e.currentTarget.value.trim();
                        if (next) renamePage(page.id, next);
                        setRenamingPageId(null);
                      }}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") {
                          e.currentTarget.value = page.name;
                          e.currentTarget.blur();
                        }
                      }}
                      className="h-7 w-full rounded-[4px] border border-[var(--accent)] bg-[var(--surface-content)] px-2 text-xs font-normal text-[var(--text-1)] outline-none"
                    />
                  ) : (
                    <button
                      key={page.id}
                      type="button"
                      onClick={() => setActivePage(page.id)}
                      onDoubleClick={() => setRenamingPageId(page.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setPageContextMenu({
                          page,
                          position: { x: e.clientX, y: e.clientY },
                        });
                      }}
                      title="Click to switch page, double-click to rename, right-click for options"
                      className={`group/page h-7 w-full flex items-center justify-between rounded-[4px] px-2 text-left text-xs transition-colors cursor-pointer relative ${
                        isActive
                          ? "text-[#18181B] dark:text-white font-normal bg-[#EAEAEA]/70 dark:bg-zinc-800/70"
                          : "text-[#18181B] dark:text-zinc-300 hover:bg-[#F4F4F5] dark:hover:bg-zinc-800/60"
                      }`}
                    >
                      <div className="flex items-center gap-2 overflow-hidden flex-1 min-w-0 mr-1">
                        <PageIcon size={13} className="text-[#71717A] shrink-0" strokeWidth={1.5} />
                        <span className="truncate text-[12px]">{page.name}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {isActive && (
                          <Check
                            size={13}
                            className="text-[#18181B] dark:text-white shrink-0 group-hover/page:hidden"
                            strokeWidth={1.8}
                          />
                        )}
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            setPageContextMenu({
                              page,
                              position: { x: rect.right + 2, y: rect.top },
                            });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              setPageContextMenu({
                                page,
                                position: { x: rect.right + 2, y: rect.top },
                              });
                            }
                          }}
                          className="hidden group-hover/page:flex h-5 w-5 items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/10 text-[#71717A] hover:text-[#18181B] dark:hover:text-white transition-colors cursor-pointer"
                          title="Page options"
                        >
                          <MoreHorizontal size={13} />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 2. Layers Section - INDEPENDENT SCROLL AREA (Matching reference screenshot) */}
          <div
            className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col py-1"
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const srcId = e.dataTransfer.getData("text/plain") || draggingId;
              if (srcId && !dragOverInfo) {
                // Dropped on empty background -> release to page root
                reparentNode(srcId, null);
              }
              setDraggingId(null);
              setDragOverInfo(null);
            }}
          >
            <div className="flex flex-col">
              {visibleLayerRows.map(({ node, depth }) => {
                const isSelected = selection.includes(node.id);
                const isHidden = !!(node.hidden || node.visible === false || node.style?.opacity === 0);
                const isLocked = !!node.locked;
                const isFrame = node.type === "frame";
                const hasChildren = node.childIds && node.childIds.length > 0;
                const isCollapsed = !!collapsedNodes[node.id];
                const isRenaming = renamingNodeId === node.id;
                const isThisDropTarget = dragOverInfo?.targetId === node.id;

                return (
                  <div
                    key={node.id}
                    data-layer-row={node.id}
                    draggable={!isRenaming && !previewing}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", node.id);
                      setDraggingId(node.id);
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDragOverInfo(null);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!draggingId || draggingId === node.id) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const relY = e.clientY - rect.top;
                      if (
                        isFrame &&
                        relY > rect.height * 0.25 &&
                        relY < rect.height * 0.75
                      ) {
                        setDragOverInfo({
                          targetId: node.id,
                          position: "inside",
                        });
                      } else if (relY <= rect.height * 0.5) {
                        setDragOverInfo({
                          targetId: node.id,
                          position: "top",
                        });
                      } else {
                        setDragOverInfo({
                          targetId: node.id,
                          position: "bottom",
                        });
                      }
                    }}
                    onDragLeave={() => {
                      if (dragOverInfo?.targetId === node.id) {
                        setDragOverInfo(null);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const srcId =
                        e.dataTransfer.getData("text/plain") || draggingId;
                      const info = dragOverInfo;
                      setDraggingId(null);
                      setDragOverInfo(null);
                      if (!srcId || srcId === node.id) return;

                      if (info?.position === "inside") {
                        // Reparent into this frame
                        reparentNode(srcId, node.id);
                      } else if (
                        info?.position === "top" ||
                        info?.position === "bottom"
                      ) {
                        // Reorder beside target in same parent
                        const pId = node.parentId ?? null;
                        const siblings = pId
                          ? doc.nodes[pId]?.childIds ?? []
                          : activePage.rootNodeIds;
                        const targetIdx = siblings.indexOf(node.id);
                        let insertIdx =
                          info.position === "top" ? targetIdx : targetIdx + 1;
                        const srcIdx = siblings.indexOf(srcId);
                        if (srcIdx !== -1 && srcIdx < insertIdx) {
                          insertIdx = Math.max(0, insertIdx - 1);
                        }
                        reparentNode(srcId, pId, null, insertIdx);
                      }
                    }}
                    onClick={(e) => {
                      if (e.shiftKey || e.ctrlKey || e.metaKey) {
                        toggleInSelection(node.id);
                      } else {
                        setSelection([node.id]);
                      }
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setRenamingNodeId(node.id);
                      setNodeNameVal(node.name || "");
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!selection.includes(node.id)) {
                        setSelection([node.id]);
                      }
                      window.dispatchEvent(
                        new CustomEvent("canvas:contextmenu", {
                          detail: {
                            x: e.clientX,
                            y: e.clientY,
                            targetId: node.id,
                            targetName: node.name,
                            targetType: node.type,
                            isSidebar: true,
                          },
                        }),
                      );
                    }}
                    className={`group/layer relative flex items-center pr-2 text-xs cursor-pointer transition-colors ${
                      isHidden ? "opacity-45" : ""
                    } ${
                      isThisDropTarget && dragOverInfo.position === "inside"
                        ? "border-2 border-[var(--accent)] bg-blue-50/40 dark:bg-blue-900/20"
                        : ""
                    } ${
                      isSelected
                        ? "bg-[#EAEAEA] dark:bg-zinc-800 text-[#18181B] dark:text-white font-normal"
                        : "text-[#18181B] dark:text-zinc-200 hover:bg-[#F4F4F5] dark:hover:bg-zinc-800/60"
                    }`}
                    style={{
                      paddingLeft: `${8 + depth * 14}px`,
                      height: "28px",
                    }}
                  >
                    {/* Reorder drop lines */}
                    {isThisDropTarget && dragOverInfo.position === "top" && (
                      <span className="pointer-events-none absolute -top-0.5 right-1 left-1 h-[2px] rounded-full bg-[var(--accent)] z-20" />
                    )}
                    {isThisDropTarget && dragOverInfo.position === "bottom" && (
                      <span className="pointer-events-none absolute -bottom-0.5 right-1 left-1 h-[2px] rounded-full bg-[var(--accent)] z-20" />
                    )}

                    {/* Left side: Chevron + Icon + Layer Name */}
                    <div className="flex items-center truncate flex-1 min-w-0">
                      {hasChildren ? (
                        <button
                          type="button"
                          onClick={(e) => toggleCollapse(node.id, e)}
                          className="flex h-3.5 w-3 items-center justify-center p-0 text-[#71717A] hover:text-[#18181B] dark:hover:text-white shrink-0 cursor-pointer mr-0.5"
                          title={isCollapsed ? "Expand" : "Collapse"}
                        >
                          {isCollapsed ? (
                            <svg
                              viewBox="0 0 16 16"
                              width="8.5"
                              height="8.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M6 3.5l4.5 4.5L6 12.5" />
                            </svg>
                          ) : (
                            <svg
                              viewBox="0 0 16 16"
                              width="8.5"
                              height="8.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M3.5 6l4.5 4.5L12.5 6" />
                            </svg>
                          )}
                        </button>
                      ) : depth > 0 ? (
                        <span className="w-3 shrink-0 mr-0.5" />
                      ) : null}

                      <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0 mr-1">
                        {getNodeIcon(node, depth)}
                      </span>

                      {isRenaming ? (
                        <input
                          autoFocus
                          value={nodeNameVal}
                          onChange={(e) => setNodeNameVal(e.target.value)}
                          onBlur={() => commitNodeRename(node.id)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") commitNodeRename(node.id);
                            if (e.key === "Escape") setRenamingNodeId(null);
                          }}
                          className="h-5 w-32 rounded border border-[var(--accent)] bg-[var(--surface-content)] px-1 text-xs text-[var(--text-1)] outline-none"
                        />
                      ) : (
                        <span className="truncate text-[12px] select-none font-normal leading-none">
                          {node.name}
                        </span>
                      )}
                    </div>

                    {/* Right side: Lock and Eye controls - positioned absolutely so they don't reserve space and overlap the layer name on hover */}
                    <div
                      className={`absolute right-1 top-1/2 -translate-y-1/2 z-10 flex items-center gap-0.5 rounded px-1 py-0.5 transition-opacity ${
                        isLocked || isHidden
                          ? "opacity-100 pointer-events-auto"
                          : "opacity-0 pointer-events-none group-hover/layer:opacity-100 group-hover/layer:pointer-events-auto"
                      } ${
                        isSelected
                          ? "bg-[#EAEAEA] dark:bg-zinc-800"
                          : "bg-white dark:bg-[#18181B] group-hover/layer:bg-[#F4F4F5] dark:group-hover/layer:bg-zinc-800 group-hover/layer:shadow-sm"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={(e) => toggleLock(node.id, e)}
                        className={`h-5 w-5 items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer ${
                          isLocked
                            ? "flex text-amber-600 dark:text-amber-400 font-semibold"
                            : "hidden group-hover/layer:flex text-[#71717A] hover:text-[#18181B] dark:hover:text-white"
                        }`}
                        title={isLocked ? "Unlock layer" : "Lock layer"}
                      >
                        <Lock size={11} />
                      </button>

                      <button
                        type="button"
                        onClick={(e) => toggleVisibility(node.id, e)}
                        className={`h-5 w-5 items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer ${
                          isHidden
                            ? "flex text-[var(--text-2)]"
                            : "hidden group-hover/layer:flex text-[#71717A] hover:text-[#18181B] dark:hover:text-white"
                        }`}
                        title={isHidden ? "Show layer" : "Hide layer"}
                      >
                        {isHidden ? <EyeOff size={11} /> : <Eye size={11} />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <ThemePanel sidebarWidth={leftWidth} />
        </div>
      )}

      {/* Bottom footer row matching reference screenshot */}
      <div className="shrink-0 border-t border-[var(--line)]/60 px-3 py-2 text-[11px] text-[var(--text-2)] flex items-center gap-2 bg-[var(--surface-panel)]">
        <span className="hover:text-[var(--text-1)] cursor-pointer">What&apos;s new</span>
        <span>•</span>
        <span className="hover:text-[var(--text-1)] cursor-pointer">Feedback</span>
      </div>

      {/* Right resize handle */}
      <div
        onPointerDown={startLeftResize}
        onDoubleClick={onToggleCollapse}
        className="absolute -right-1 top-0 bottom-0 w-2 cursor-col-resize hover:bg-[var(--accent)] active:bg-[var(--accent)] transition-colors z-20 group"
        title="Drag to resize, double-click to collapse"
      >
        <div className="w-full h-full opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
        </>
      )}

      {pageContextMenu && (
        <PageContextMenu
          position={pageContextMenu.position}
          page={pageContextMenu.page}
          onClose={() => setPageContextMenu(null)}
          onCopyLink={(pageId) => {
            try {
              const url = new URL(window.location.href);
              url.hash = `page=${pageId}`;
              navigator.clipboard?.writeText(url.toString());
            } catch (_) {}
            showToast({ message: "Page link copied to clipboard" });
          }}
          onRename={(pageId) => {
            setRenamingPageId(pageId);
          }}
          onAddDivider={(pageId) => {
            addDivider(pageId);
          }}
          onSelectIcon={(pageId, iconKey) => {
            setPageIcon(pageId, iconKey);
          }}
          onDeletePage={(pageId) => {
            deletePage(pageId);
          }}
          onDeleteDivider={(pageId) => {
            deleteDivider(pageId);
          }}
        />
      )}
    </aside>
  );
}

/** The tool buttons, shared by the docked toolbar and the floating
 *  toolbar pill of the hide-UI modes. Includes M4's Place-image button,
 *  which reaches the Viewport's hidden file input via a window event,
 *  and M5's Shader button — not a tool but a creation action (the
 *  Viewport creates the node at the viewport centre on the event). */
const DEFAULT_BREAKPOINTS = [
  { id: "desktop-lg", name: "Desktop", width: 1440, height: 900, desc: "Standard Web / Retina", icon: Monitor },
  { id: "laptop", name: "Laptop", width: 1280, height: 800, desc: "MacBook / Ultrabook", icon: Laptop },
  { id: "tablet", name: "Tablet", width: 768, height: 1024, desc: "iPad / Portrait", icon: Tablet },
  { id: "mobile", name: "Mobile", width: 390, height: 844, desc: "iPhone 14 / 15 / 16", icon: Smartphone },
  { id: "mobile-sm", name: "Mobile (Small)", width: 360, height: 800, desc: "Android Standard", icon: Smartphone },
];

/** The exact tool buttons matching VerticalToolBar in light theme.
 *  Shared by the docked toolbar and the floating toolbar pill. */
function ToolButtons() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const commentsPanelOpen = useEditorStore((s) => s.commentsPanelOpen);
  const tokens = useEditorStore((s) => s.doc?.tokens || []);
  const [breakpointsOpen, setBreakpointsOpen] = useState(false);
  const breakpointsMenuRef = useRef(null);
  const breakpointsDialogRef = useRef(null);
  const [dialogStyle, setDialogStyle] = useState(null);

  useLayoutEffect(() => {
    if (!breakpointsOpen || !breakpointsMenuRef.current) return;

    const updatePosition = () => {
      if (!breakpointsMenuRef.current) return;
      const btnRect = breakpointsMenuRef.current.getBoundingClientRect();
      const vh = window.innerHeight;
      const pad = 12;
      const left = btnRect.right + 10;

      // Available screen height with margins
      const maxAvailableH = vh - 2 * pad;
      const measuredH = breakpointsDialogRef.current ? breakpointsDialogRef.current.offsetHeight : 540;
      const targetH = Math.min(measuredH, maxAvailableH);

      // Prefer aligning top with button
      let top = btnRect.top;

      // If it overflows bottom, shift up so dialog stays completely inside viewport
      if (top + targetH > vh - pad) {
        top = vh - targetH - pad;
      }

      // Clamp so it doesn't go off top
      if (top < pad) {
        top = pad;
      }

      const calculatedMaxH = vh - top - pad;

      setDialogStyle({
        position: "fixed",
        left: `${left}px`,
        top: `${top}px`,
        maxHeight: `${Math.max(200, calculatedMaxH)}px`,
        zIndex: 99999,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [breakpointsOpen]);

  useEffect(() => {
    if (!breakpointsOpen) return;
    const handleClickOutside = (e) => {
      if (
        breakpointsMenuRef.current &&
        !breakpointsMenuRef.current.contains(e.target) &&
        breakpointsDialogRef.current &&
        !breakpointsDialogRef.current.contains(e.target)
      ) {
        setBreakpointsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [breakpointsOpen]);

  // Build deduplicated breakpoints list so no width is repeated
  const themeTokens = (tokens || []).filter(
    (t) => t.type === "breakpoint" || t.type === "container"
  );

  const seenWidths = new Set();
  const allBreakpoints = [];

  // Sort theme tokens so "breakpoint" comes before "container" (Breakpoint / 640 preferred over Container / 640)
  const sortedTheme = [...themeTokens].sort((a, b) => {
    if (a.type === "breakpoint" && b.type !== "breakpoint") return -1;
    if (b.type === "breakpoint" && a.type !== "breakpoint") return 1;
    return (parseInt(a.value, 10) || 0) - (parseInt(b.value, 10) || 0);
  });

  for (const t of sortedTheme) {
    const px = parseInt(t.value, 10);
    if (!px || seenWidths.has(px)) continue;
    seenWidths.add(px);
    const h = px <= 480 ? 844 : px <= 768 ? 1024 : 900;
    const Icon = px <= 480 ? Smartphone : px <= 768 ? Tablet : px <= 1100 ? Laptop : Monitor;
    allBreakpoints.push({
      id: t.id || `bp-${px}`,
      name: t.name,
      width: px,
      height: h,
      desc: px <= 480 ? "Mobile" : px <= 768 ? "Tablet" : px <= 1100 ? "Laptop" : "Desktop",
      icon: Icon,
    });
  }

  // Include standard devices whose width isn't already covered by theme
  for (const bp of DEFAULT_BREAKPOINTS) {
    if (!seenWidths.has(bp.width)) {
      seenWidths.add(bp.width);
      allBreakpoints.push({
        id: bp.id,
        name: bp.name,
        width: bp.width,
        height: bp.height,
        desc: bp.desc,
        icon: bp.icon,
      });
    }
  }

  // Sort by width ascending
  allBreakpoints.sort((a, b) => a.width - b.width);

  const handleAddBreakpointFrame = (name, width, height) => {
    const st = useEditorStore.getState();
    const doc = st.doc;
    const activePage = doc.pages.find((p) => p.id === st.activePageId);
    const rootChildIds = activePage?.rootNodeIds || [];
    let rootFrames = rootChildIds
      .map((id) => doc.nodes[id])
      .filter((n) => n && n.type === "frame" && !n.hidden && n.visible !== false);

    if (rootFrames.length === 0) {
      rootFrames = Object.values(doc.nodes || {}).filter(
        (n) => n && n.type === "frame" && !n.parentId && !n.hidden && n.visible !== false
      );
    }

    let newX = 100;
    let newY = 100;

    if (rootFrames.length > 0) {
      // Safely extract valid numeric top coordinates
      const validYs = rootFrames
        .map((f) => Number(f.position?.y ?? f.y ?? 0))
        .filter((y) => Number.isFinite(y));
      const topY = validYs.length > 0 ? Math.min(...validYs) : 100;

      // Safely calculate right edges
      const rightEdges = rootFrames
        .map((f) => {
          const rawX = Number(f.position?.x ?? f.x ?? 0);
          const x = Number.isFinite(rawX) ? rawX : 0;
          const w =
            typeof f.size?.w?.px === "number" && f.size.w.px > 0
              ? f.size.w.px
              : typeof f.size?.w === "number" && f.size.w > 0
              ? f.size.w
              : typeof f.layout?.prevSize?.w?.px === "number" && f.layout.prevSize.w.px > 0
              ? f.layout.prevSize.w.px
              : 100;
          return x + w;
        })
        .filter((edge) => Number.isFinite(edge));

      const maxRight = rightEdges.length > 0 ? Math.max(...rightEdges) : 100;
      const defaultGap = 80;
      newX = maxRight + defaultGap;
      newY = topY;
    }

    const rect = {
      x: newX,
      y: newY,
      w: width,
      h: height,
    };

    const node = createNode(doc, "frame", rect, null);
    node.name = name;
    node.style = {
      fill: { kind: "solid", color: "#FFFFFF" },
      fills: [{ kind: "solid", color: "#FFFFFF" }],
      radius: 0,
      opacity: 1,
      overflow: "hidden",
    };
    node.clipContent = true;

    st.addNode(node);
    st.setSelection([node.id]);
    st.showToast?.({ message: `Added ${name} frame (${width} × ${height}px)` });
    setBreakpointsOpen(false);
  };

  const btnBase = "w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer";
  const activeCls = "bg-[var(--surface-content)] text-[var(--text-1)] shadow-xs border border-[var(--line)] font-medium";
  const inactiveCls = "text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)]";
  const tooltipCls = "absolute left-11 top-1/2 -translate-y-1/2 bg-[var(--surface-content)] text-[var(--text-1)] border border-[var(--line)] px-2.5 py-1 rounded-md text-xs whitespace-nowrap shadow-md pointer-events-none z-50 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity";
  const keyCls = "text-[var(--text-2)] font-mono text-[10px]";

  return (
    <>
      {/* 1. Pointer (Select Arrow - V) */}
      <div className="relative group">
        <button
          type="button"
          onClick={() => setActiveTool("move")}
          className={`${btnBase} ${activeTool === "move" ? activeCls : inactiveCls}`}
          title="Move (V)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="4 3 11 20 14 13 21 10 4 3" />
          </svg>
        </button>
        <div className={tooltipCls}>
          <span>Move</span>
          <span className={keyCls}>V</span>
        </div>
      </div>

      {/* 2. Hand (Pan - H / Space) */}
      <div className="relative group">
        <button
          type="button"
          onClick={() => setActiveTool("pan")}
          className={`${btnBase} ${activeTool === "pan" ? activeCls : inactiveCls}`}
          title="Pan (H or hold Space)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v7M10 10.5V6a2 2 0 0 0-4 0v8a7 7 0 0 0 14 0v-4a2 2 0 0 0-4 0" />
          </svg>
        </button>
        <div className={tooltipCls}>
          <span>Pan</span>
          <span className={keyCls}>H / Space</span>
        </div>
      </div>

      {/* 2b. Dedicated Breakpoints Button */}
      <div className="relative" ref={breakpointsMenuRef}>
        <button
          type="button"
          onClick={() => setBreakpointsOpen((v) => !v)}
          className={`${btnBase} ${breakpointsOpen ? activeCls : inactiveCls}`}
          title="Breakpoints & Devices"
        >
          <MonitorSmartphone size={17} strokeWidth={1.8} />
        </button>
        <div className={tooltipCls}>
          <span>Breakpoints</span>
        </div>

        {/* Breakpoints Side Panel Dialog */}
        {breakpointsOpen &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              ref={breakpointsDialogRef}
              style={
                dialogStyle || {
                  position: "fixed",
                  left: "60px",
                  top: "16px",
                  maxHeight: "calc(100vh - 32px)",
                  zIndex: 99999,
                }
              }
              className="w-80 rounded-2xl border border-[var(--line)] bg-[var(--surface-content)] p-3 shadow-2xl backdrop-blur-md select-none animate-in fade-in zoom-in-95 duration-100 flex flex-col gap-3 overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-2 border-b border-[var(--line)] shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] flex items-center justify-center">
                    <MonitorSmartphone size={15} strokeWidth={2} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-[var(--text-1)]">Breakpoints & Frames</div>
                    <div className="text-[10px] text-[var(--text-2)]">Click to place frame on canvas</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setBreakpointsOpen(false)}
                  className="h-6 w-6 rounded-md flex items-center justify-center text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                >
                  <X size={13} />
                </button>
              </div>

              {/* Single unified deduplicated Breakpoints list */}
              <div className="flex flex-col gap-1.5 shrink-0">
                <div className="text-[10px] font-semibold tracking-wider uppercase text-[var(--text-2)] px-1">
                  Devices & Breakpoints ({allBreakpoints.length})
                </div>
                <div className="flex flex-col gap-1">
                  {allBreakpoints.map((bp) => {
                    const Icon = bp.icon;
                    return (
                      <button
                        key={bp.id}
                        type="button"
                        onClick={() => handleAddBreakpointFrame(bp.name, bp.width, bp.height)}
                        className="flex items-center justify-between p-2 rounded-xl border border-[var(--line)] hover:border-[var(--accent)] hover:bg-[var(--surface-hover)] transition-all cursor-pointer group text-left"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-7 h-7 rounded-lg bg-[var(--surface-hover)] group-hover:bg-[var(--accent)]/10 group-hover:text-[var(--accent)] text-[var(--text-2)] flex items-center justify-center shrink-0 transition-colors">
                            <Icon size={14} />
                          </div>
                          <div className="truncate">
                            <div className="text-xs font-medium text-[var(--text-1)] truncate">{bp.name}</div>
                            <div className="text-[10px] text-[var(--text-2)]">
                              {bp.width} × {bp.height} px{bp.desc ? ` • ${bp.desc}` : ""}
                            </div>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--text-1)] shrink-0">
                          {bp.width}px
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>,
            document.body
          )}
      </div>

      {/* Divider */}
      <div className="w-5 h-px bg-[var(--line)] my-1" />

      {/* 3. Frame Tool (F) */}
      <div className="relative group">
        <button
          type="button"
          onClick={() => setActiveTool("frame")}
          className={`${btnBase} ${activeTool === "frame" ? activeCls : inactiveCls}`}
          title="Frame (F)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4" />
          </svg>
        </button>
        <div className={tooltipCls}>
          <span>Frame</span>
          <span className={keyCls}>F</span>
        </div>
      </div>

      {/* 4. Rectangle (R) */}
      <div className="relative group">
        <button
          type="button"
          onClick={() => setActiveTool("rect")}
          className={`${btnBase} ${activeTool === "rect" ? activeCls : inactiveCls}`}
          title="Rectangle (R)"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" />
          </svg>
        </button>
        <div className={tooltipCls}>
          <span>Rectangle</span>
          <span className={keyCls}>R</span>
        </div>
      </div>

      {/* 5. Pen (P) */}
      <div className="relative group">
        <button
          type="button"
          onClick={() => setActiveTool("pen")}
          className={`${btnBase} ${activeTool === "pen" ? activeCls : inactiveCls}`}
          title="Pen (P)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18" />
            <path d="m12 19 7-7 3 3-7 7-3-3z" />
            <circle cx="11" cy="11" r="1.5" />
          </svg>
        </button>
        <div className={tooltipCls}>
          <span>Pen</span>
          <span className={keyCls}>P</span>
        </div>
      </div>

      {/* 6. Text (T) */}
      <div className="relative group">
        <button
          type="button"
          onClick={() => setActiveTool("text")}
          className={`${btnBase} font-sans font-medium text-[15px] leading-none tracking-tight ${activeTool === "text" ? activeCls : inactiveCls}`}
          title="Text (T)"
        >
          Aa
        </button>
        <div className={tooltipCls}>
          <span>Text</span>
          <span className={keyCls}>T</span>
        </div>
      </div>

      {/* 7. Comment Pin Tool (C) */}
      <div className="relative group">
        <button
          type="button"
          onClick={() => {
            const st = useEditorStore.getState();
            if (activeTool === "comment" || st.commentsPanelOpen) {
              setActiveTool("move");
              st.setCommentsPanelOpen(false);
              st.setActiveCommentId(null);
              st.setCommentDraft(null);
            } else {
              setActiveTool("comment");
              st.setCommentsPanelOpen(true);
            }
          }}
          className={`${btnBase} ${activeTool === "comment" || commentsPanelOpen ? activeCls : inactiveCls}`}
          title="Comment (C)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21a9 9 0 1 0-9-9c0 3.2 1.7 6 4.3 7.6L4 22l3.4-1.2A8.96 8.96 0 0 0 12 21z" />
            <line x1="12" y1="8.5" x2="12" y2="15.5" />
            <line x1="8.5" y1="12" x2="15.5" y2="12" />
          </svg>
        </button>
        <div className={tooltipCls}>
          <span>Comment</span>
          <span className={keyCls}>C</span>
        </div>
      </div>

      {/* Divider */}
      <div className="w-5 h-px bg-[var(--line)] my-1" />

      {/* 8. Shaders & Effects (⌥S) */}
      <div className="relative group">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("canvastool:add-shader"))}
          className={`${btnBase} ${inactiveCls}`}
          title="Shaders & Gradient Effects (⌥S)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 12l10 10 10-10L12 2z" />
            <path d="M12 7L7 12l5 5 5-5-5-5z" />
          </svg>
        </button>
        <div className={tooltipCls}>
          <span>Shaders</span>
          <span className={keyCls}>⌥S</span>
        </div>
      </div>

      {/* 9. Image (Upload / Place image) */}
      <div className="relative group">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("canvastool:place-image"))}
          className={`${btnBase} ${inactiveCls}`}
          title="Place image (Ctrl+Shift+K)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="14" height="14" rx="2" />
            <circle cx="7.5" cy="9.5" r="1.5" />
            <path d="m17 15-4.5-4.5L5 18" />
            <path d="M19 1.5v4M17 3.5h4" strokeWidth="1.8" />
          </svg>
        </button>
        <div className={tooltipCls}>
          <span>Image</span>
          <span className={keyCls}>Upload</span>
        </div>
      </div>

      {/* 10. Add SVG / Vector Icon (⌥V) */}
      <div className="relative group">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("canvastool:open-add-svg-modal"))}
          className={`${btnBase} ${inactiveCls}`}
          title="Add SVG / Vector Icon (⌥V)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3.5" y="5.5" width="14" height="14" rx="1.5" />
            <circle cx="3.5" cy="5.5" r="1.2" fill="currentColor" />
            <circle cx="17.5" cy="5.5" r="1.2" fill="currentColor" />
            <circle cx="3.5" cy="19.5" r="1.2" fill="currentColor" />
            <circle cx="17.5" cy="19.5" r="1.2" fill="currentColor" />
          </svg>
        </button>
        <div className={tooltipCls}>
          <span>Add SVG</span>
          <span className={keyCls}>⌥V</span>
        </div>
      </div>
    </>
  );
}

function Toolbar({ leftCollapsed, onToggleLeftCollapse }) {
  // M7: inert while a version preview is up (read-only snapshot).
  const previewing = useEditorStore((s) => !!s.previewVersionId);
  return (
    <div
      aria-disabled={previewing || undefined}
      className={`pointer-events-auto flex shrink-0 flex-col items-center border-r border-b border-[var(--line)] bg-[var(--surface-panel)] select-none z-30 font-sans relative rounded-br-xl shadow-[2px_2px_8px_rgba(0,0,0,0.04)] transition-all duration-150 ${
        previewing ? " pointer-events-none opacity-60" : ""
      }`}
      style={{ width: "var(--layout-toolbar-w)" }}
    >
      {/* Top 40px slot for sidebar expand button when left sidebar is collapsed */}
      {leftCollapsed && (
        <div className="flex h-10 w-full shrink-0 items-center justify-center border-b border-[var(--line)]">
          <button
            type="button"
            onClick={onToggleLeftCollapse}
            className="flex h-7 w-7 items-center justify-center rounded hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] text-[var(--text-2)] transition-colors cursor-pointer"
            title="Expand left sidebar"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
            >
              <rect x="2" y="2" width="12" height="12" rx="1.5" />
              <line x1="5.5" y1="2" x2="5.5" y2="14" />
            </svg>
          </button>
        </div>
      )}
      <div className="flex flex-col items-center py-2.5 gap-1.5 w-full">
        <ToolButtons />
      </div>
    </div>
  );
}

/**
 * Floating chrome for the hide-UI modes (M4, Phase 3 §1): a filename
 * pill at top-left (click = restore the full UI) and a vertical toolbar
 * pill at left-centre — white, ~12px radius, soft shadow (Phase 2
 * overlay language). Rendered inside the canvas container.
 */
function FloatingChrome({ meta, fileId, setMeta, onOpenHotkeys }) {
  const docTitle = useEditorStore((s) => s.doc.title);
  const currentTitle = docTitle || meta?.title || "Untitled";
  const setUiMode = useEditorStore((s) => s.setUiMode);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState("");
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const badgeRef = useRef(null);
  const appMenuBtnRef = useRef(null);

  const commitTitle = async () => {
    setIsEditingTitle(false);
    const next = tempTitle.trim();
    if (next && next !== currentTitle) {
      useEditorStore.getState().setFileTitle(next);
      if (setMeta) {
        setMeta((prev) => ({ ...(prev || {}), title: next }));
      }
      if (fileId) {
        try {
          await updateFileMeta(fileId, { title: next });
          const st = useEditorStore.getState();
          await saveFile(fileId, { ...st.doc, title: next });
        } catch (e) {
          console.error("Failed to save title", e);
        }
      }
    }
  };

  return (
    <>
      {/* Floating Show UI Badge matching reference screenshot media_1793892782969_c2cc41e0.png */}
      <div
        ref={badgeRef}
        className="absolute top-3 left-3 z-40 flex items-center gap-1.5 rounded-lg border border-[#E4E4E7] dark:border-[var(--line)] bg-white dark:bg-[#1E1E1E] px-2 py-1 shadow-xs select-none"
      >
        {/* 1. Click on icon: user can see the dialog menu option */}
        <button
          ref={appMenuBtnRef}
          type="button"
          onClick={() => setAppMenuOpen((prev) => !prev)}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors cursor-pointer ${
            appMenuOpen
              ? "bg-[var(--surface-hover)] text-[var(--text-1)]"
              : "hover:bg-[var(--surface-hover)] text-[#71717A] hover:text-[var(--text-1)]"
          }`}
          title="Main menu"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="shrink-0"
          >
            <rect x="1.5" y="4.5" width="8" height="8" rx="1.5" fill="currentColor" fillOpacity="0.8" />
            <path
              d="M5.5 3V1.5A1.5 1.5 0 0 1 7 0h7A1.5 1.5 0 0 1 15.5 1.5v7A1.5 1.5 0 0 1 14 10h-1.5V5a2 2 0 0 0-2-2h-5z"
              fill="currentColor"
              fillOpacity="0.5"
            />
          </svg>
        </button>

        {/* 2. Click on name: user can rename */}
        {isEditingTitle ? (
          <input
            autoFocus
            value={tempTitle}
            onChange={(e) => setTempTitle(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitTitle();
              if (e.key === "Escape") {
                setIsEditingTitle(false);
                setTempTitle(currentTitle);
              }
            }}
            className="h-6 max-w-56 rounded border border-[#0D99FF] bg-transparent px-1.5 py-0.5 text-[13px] font-medium text-[var(--text-1)] outline-none ring-1 ring-[#0D99FF]"
          />
        ) : (
          <div
            onClick={() => {
              setTempTitle(currentTitle);
              setIsEditingTitle(true);
            }}
            className="max-w-56 truncate text-[13px] font-medium text-[#18181B] dark:text-zinc-200 hover:bg-[#F4F4F5] dark:hover:bg-zinc-800 px-1.5 py-0.5 rounded cursor-text transition-colors"
            title="Click to rename"
          >
            {currentTitle}
          </div>
        )}

        {/* 3. Click on collapse or expand button: then it becomes show ui */}
        <button
          type="button"
          onClick={() => setUiMode("full")}
          title="Show UI (Ctrl + \)"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-[#F4F4F5] dark:hover:bg-zinc-800 text-[#71717A] hover:text-[#18181B] dark:hover:text-white transition-colors cursor-pointer ml-0.5"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            className="shrink-0"
          >
            <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
            <line x1="5.5" y1="1.5" x2="5.5" y2="14.5" />
          </svg>
        </button>

        {/* Dropdown Menu */}
        {appMenuOpen && (
          <AppMainMenuDropdown
            anchorRef={appMenuBtnRef}
            onClose={() => setAppMenuOpen(false)}
            onOpenHotkeys={onOpenHotkeys}
          />
        )}
      </div>
      <div className="absolute top-1/2 left-3 z-40 flex -translate-y-1/2 flex-col items-center gap-1 rounded-xl border border-[var(--line)] bg-white dark:bg-[#1E1E1E] p-1 shadow-lg">
        <ToolButtons />
      </div>
    </>
  );
}

const MIN_RIGHT_SIDEBAR_WIDTH = 240;
const MAX_RIGHT_SIDEBAR_WIDTH = 520;

// Module-level timer reference for 10s debounced autosave
let autosaveTimer = null;

const triggerImmediateSave = async (fileId) => {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
  const s = useEditorStore.getState();
  if (s.saveStatus === "saving") return;
  useEditorStore.setState({ saveStatus: "saving" });
  try {
    let thumbnail = s.doc?.thumbnail || null;
    try {
      const snap = await captureCanvasThumbnail(s.doc, s.activePageId);
      if (snap) {
        thumbnail = snap;
        s.doc.thumbnail = snap;
      }
    } catch (snapErr) {
      console.warn("canvas-tool: thumbnail snapshot skipped", snapErr);
    }

    await Promise.all([
      saveFile(fileId, s.doc),
      saveVersions(fileId, s.versions),
      thumbnail ? updateFileMeta(fileId, { thumbnail }) : Promise.resolve(),
    ]);
    useEditorStore.setState({ saveStatus: "saved", lastSavedAt: Date.now() });
  } catch (err) {
    console.error("canvas-tool: save failed", err);
    useEditorStore.setState({ saveStatus: "saved" });
  }
};

/**
 * Professional Save Button:
 * - Shows "Saved" with subtle green checkmark when synced
 * - Shows "Save" with subtle blue indicator dot when changes pending (10s auto-save timer)
 * - Shows "Saving…" with smooth animated spinner when actively saving
 * - Click triggers save IMMEDIATELY
 * - Supports Ctrl+S / Cmd+S shortcut
 */
function SaveButton({ fileId }) {
  const saveStatus = useEditorStore((s) => s.saveStatus);
  const isSaving = saveStatus === "saving";
  const isUnsaved = saveStatus === "unsaved";

  const handleSave = useCallback(() => {
    return triggerImmediateSave(fileId);
  }, [fileId]);

  // Global Ctrl+S / Cmd+S listener
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  return (
    <button
      type="button"
      onClick={handleSave}
      disabled={isSaving}
      title={
        isSaving
          ? "Saving changes…"
          : isUnsaved
          ? "Unsaved changes · Auto-saves in 10s (Click or Ctrl+S to save now)"
          : "Saved automatically · Click to save manually (Ctrl+S)"
      }
      className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-all select-none cursor-pointer border ${
        isSaving
          ? "border-[#0D99FF]/40 bg-[#0D99FF]/10 text-[#0D99FF] shadow-2xs"
          : isUnsaved
          ? "border-[#0D99FF]/60 bg-white dark:bg-[#1E1E22] text-[#0D99FF] hover:bg-[#0D99FF]/5 shadow-2xs"
          : "border-[var(--line)] bg-[var(--surface-content)] text-[var(--text-1)] hover:bg-[var(--surface-hover)] hover:border-[var(--text-2)] shadow-2xs"
      }`}
    >
      {isSaving ? (
        <>
          <svg
            className="animate-spin h-3 w-3 text-[#0D99FF] shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3.5"
            />
            <path
              className="opacity-90"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="font-medium text-[11px] tracking-tight">Saving…</span>
        </>
      ) : isUnsaved ? (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-[#0D99FF] shrink-0 animate-pulse" />
          <span className="font-medium text-[11px] tracking-tight">Save</span>
        </>
      ) : (
        <>
          <Check size={12} className="text-emerald-500 shrink-0 stroke-[2.5]" />
          <span className="font-medium text-[11px] tracking-tight">Saved</span>
        </>
      )}
    </button>
  );
}

function RightSidebar({ previewing, fileId, meta, setMeta }) {
  const [width, setWidth] = useState(280);
  const [isResizing, setIsResizing] = useState(false);

  const commentsPanelOpen = useEditorStore((s) => s.commentsPanelOpen);
  const activeCommentId = useEditorStore((s) => s.activeCommentId);
  const commentDraft = useEditorStore((s) => s.commentDraft);
  const activeTool = useEditorStore((s) => s.activeTool);

  const isCommentsActive =
    commentsPanelOpen ||
    Boolean(activeCommentId) ||
    Boolean(commentDraft);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("designer-right-sidebar-w");
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed)) {
          setWidth(Math.max(MIN_RIGHT_SIDEBAR_WIDTH, Math.min(MAX_RIGHT_SIDEBAR_WIDTH, parsed)));
        }
      }
    } catch {}
  }, []);

  const isDraggingRef = useRef(false);

  const startResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingRef.current = true;
    setIsResizing(true);
    const startX = e.clientX;
    const startW = width;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onPointerMove = (moveEvent) => {
      if (!isDraggingRef.current) return;
      const dx = startX - moveEvent.clientX;
      const maxAllowed = typeof window !== "undefined"
        ? Math.min(MAX_RIGHT_SIDEBAR_WIDTH, Math.max(MIN_RIGHT_SIDEBAR_WIDTH, window.innerWidth - 300))
        : MAX_RIGHT_SIDEBAR_WIDTH;
      const nextW = Math.max(MIN_RIGHT_SIDEBAR_WIDTH, Math.min(maxAllowed, Math.round(startW + dx)));
      setWidth(nextW);
      if (typeof window !== "undefined") {
        localStorage.setItem("designer-right-sidebar-w", String(nextW));
      }
    };

    const onPointerUp = () => {
      isDraggingRef.current = false;
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  return (
    <aside
      data-inspector="true"
      data-panel="inspector"
      aria-disabled={previewing || undefined}
      className={`relative flex flex-col shrink-0 h-full border-l border-[var(--line)] bg-[var(--surface-panel)] select-none ${
        isResizing ? "" : "transition-[width] duration-150 ease-out"
      } ${previewing ? " pointer-events-none opacity-60" : ""}`}
      style={{
        width,
        minWidth: MIN_RIGHT_SIDEBAR_WIDTH,
        maxWidth: MAX_RIGHT_SIDEBAR_WIDTH,
      }}
    >
      {/* Left resize handle */}
      <div
        onPointerDown={startResize}
        className={`absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize hover:bg-[var(--accent)] active:bg-[var(--accent)] transition-colors z-20 group ${
          isResizing ? "bg-[var(--accent)]" : ""
        }`}
        title={`Drag to resize (${MIN_RIGHT_SIDEBAR_WIDTH}px – ${MAX_RIGHT_SIDEBAR_WIDTH}px)`}
      >
        <div className="w-full h-full opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {/* Header bar matching reference screenshot */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--line)] px-2.5 bg-[var(--surface-panel)]">
        <div className="flex items-center gap-1.5 min-w-0">
          <UserAvatar />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <SaveButton fileId={fileId} />
          <ZoomMenu />
          <SharePopover fileId={fileId} meta={meta} setMeta={setMeta} />
        </div>
      </div>

      {/* Content: Comments panel when active, otherwise Inspector */}
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
        {isCommentsActive ? <CommentsPanel embedded={true} /> : <Inspector />}
      </div>
    </aside>
  );
}

export default function EditorShell({ fileId }) {
  const [meta, setMeta] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("designer-left-sidebar-collapsed");
      if (saved !== null) {
        setLeftCollapsed(saved === "true");
      }
    } catch {}
  }, []);

  const toggleLeftCollapse = () => {
    setLeftCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("designer-left-sidebar-collapsed", String(next));
      } catch {}
      return next;
    });
  };

  const uiMode = useEditorStore((s) => s.uiMode);
  // Platform batch: demo plan state (lib/plans.js) — hydrate from
  // localStorage once, and host the Upgrade dialog for the account
  // chip + the AI panel's at-cap prompt.
  const planId = useEditorStore((s) => s.planId);
  const upgradeDialogOpen = useEditorStore((s) => s.upgradeDialogOpen);
  const connectAgentModalOpen = useEditorStore((s) => s.connectAgentModalOpen);
  useEffect(() => {
    useEditorStore.getState().hydratePlan();
  }, []);
  // M7: a version preview makes the whole editor read-only (below).
  const previewing = useEditorStore((s) => !!s.previewVersionId);
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const { status } = useSession();

  const [hotkeysOpen, setHotkeysOpen] = useState(false);
  const [isAddSvgOpen, setIsAddSvgOpen] = useState(false);

  useEffect(() => {
    const handler = () => setIsAddSvgOpen(true);
    window.addEventListener("canvastool:open-add-svg-modal", handler);
    return () => window.removeEventListener("canvastool:open-add-svg-modal", handler);
  }, []);

  // Global right-click prevention: suppress native browser context menu site-wide
  useEffect(() => {
    const handleContextMenu = (e) => {
      e.preventDefault();
    };
    window.addEventListener("contextmenu", handleContextMenu, { capture: true });
    return () => window.removeEventListener("contextmenu", handleContextMenu, { capture: true });
  }, []);

  // Global browser zoom prevention: Ctrl+wheel / pinch zoom canvas viewport only, never the browser UI
  useEffect(() => {
    const handleWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // If event is outside canvas, zoom canvas centered
        const isCanvas = Boolean(e.target?.closest?.("[data-canvas-viewport]"));
        if (!isCanvas) {
          const st = useEditorStore.getState();
          const vp = st.viewport;
          const w = typeof window !== "undefined" ? window.innerWidth : 1200;
          const h = typeof window !== "undefined" ? window.innerHeight : 800;
          const unit = e.deltaMode === 1 ? 16 : 1;
          const factor = Math.exp(-e.deltaY * unit * 0.002);
          st.setViewport(G.zoomToCursor(vp, { x: w / 2, y: h / 2 }, vp.zoom * factor));
        }
      }
    };

    const handleGesture = (e) => e.preventDefault();

    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("gesturestart", handleGesture);
    window.addEventListener("gesturechange", handleGesture);
    window.addEventListener("gestureend", handleGesture);

    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("gesturestart", handleGesture);
      window.removeEventListener("gesturechange", handleGesture);
      window.removeEventListener("gestureend", handleGesture);
    };
  }, []);

  useEffect(() => {
    const handleGlobalKeys = (e) => {
      // Suppress browser zoom shortcuts and route them exclusively to canvas zoom
      if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+" || e.code === "Equal")) {
        e.preventDefault();
        const st = useEditorStore.getState();
        const vp = st.viewport;
        const w = typeof window !== "undefined" ? window.innerWidth : 1200;
        const h = typeof window !== "undefined" ? window.innerHeight : 800;
        st.setViewport(G.zoomToCursor(vp, { x: w / 2, y: h / 2 }, vp.zoom * 1.25));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "-" || e.key === "_" || e.code === "Minus")) {
        e.preventDefault();
        const st = useEditorStore.getState();
        const vp = st.viewport;
        const w = typeof window !== "undefined" ? window.innerWidth : 1200;
        const h = typeof window !== "undefined" ? window.innerHeight : 800;
        st.setViewport(G.zoomToCursor(vp, { x: w / 2, y: h / 2 }, vp.zoom / 1.25));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "0" || e.code === "Digit0")) {
        e.preventDefault();
        const st = useEditorStore.getState();
        const vp = st.viewport;
        const w = typeof window !== "undefined" ? window.innerWidth : 1200;
        const h = typeof window !== "undefined" ? window.innerHeight : 800;
        st.setViewport(G.zoomToCursor(vp, { x: w / 2, y: h / 2 }, 1));
        return;
      }

      const tag = e.target?.tagName?.toLowerCase();
      const isInput = tag === "input" || tag === "textarea" || e.target?.isContentEditable;
      if (isInput) return;

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        useEditorStore.getState().duplicateSelection();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        try {
          router.push("/");
        } catch {
          window.location.href = "/";
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        if (e.shiftKey) {
          window.dispatchEvent(new CustomEvent("canvas:ungroup-selection"));
        } else {
          window.dispatchEvent(new CustomEvent("canvas:frame-selection"));
        }
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === "a") { e.preventDefault(); useEditorStore.getState().alignSelection?.("left"); return; }
        if (k === "h") { e.preventDefault(); useEditorStore.getState().alignSelection?.("center"); return; }
        if (k === "d") { e.preventDefault(); useEditorStore.getState().alignSelection?.("right"); return; }
        if (k === "w") { e.preventDefault(); useEditorStore.getState().alignSelection?.("top"); return; }
        if (k === "v") { e.preventDefault(); useEditorStore.getState().alignSelection?.("middle"); return; }
        if (k === "s") { e.preventDefault(); useEditorStore.getState().alignSelection?.("bottom"); return; }
      }
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === "h") { e.preventDefault(); useEditorStore.getState().distributeSelection?.("horizontal"); return; }
        if (k === "v") { e.preventDefault(); useEditorStore.getState().distributeSelection?.("vertical"); return; }
        if (k === "o") { e.preventDefault(); useEditorStore.getState().organizeFrames?.(); return; }
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "?" || e.key === "/")) {
        e.preventDefault();
        setHotkeysOpen((v) => !v);
      }
      if (e.altKey && (e.key === "v" || e.key === "V" || e.code === "KeyV")) {
        e.preventDefault();
        setIsAddSvgOpen(true);
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const st = useEditorStore.getState();
        if (st.selection && st.selection.length > 0 && !st.previewVersionId) {
          e.preventDefault();
          if (st.editingPathId && st.selectedAnchorIndex != null) {
            st.deletePathAnchor(st.editingPathId, st.selectedAnchorIndex);
          } else {
            st.deleteSelection();
          }
        }
      }
    };
    window.addEventListener("keydown", handleGlobalKeys);
    return () => window.removeEventListener("keydown", handleGlobalKeys);
  }, [router]);

  // Full site: disable browser default context menu everywhere
  useEffect(() => {
    const handleContextMenu = (e) => {
      e.preventDefault();
    };
    window.addEventListener("contextmenu", handleContextMenu, { capture: true });
    return () => window.removeEventListener("contextmenu", handleContextMenu, { capture: true });
  }, []);

  // Full site: disable browser default zoom (Ctrl+wheel, Ctrl+/-, Ctrl+0) and keep zoom only for canvas
  useEffect(() => {
    const handleWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const container = document.querySelector("[data-canvas-viewport]");
        if (container) {
          const rect = container.getBoundingClientRect();
          const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
          const st = useEditorStore.getState();
          const vp = st.viewport;
          const unit = e.deltaMode === 1 ? 16 : 1;
          const factor = Math.exp(-e.deltaY * unit * 0.002);
          st.setViewport(G.zoomToCursor(vp, pt, vp.zoom * factor));
        }
      }
    };

    const handleKeyZoom = (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "=" || e.key === "+" || e.key === "-" || e.key === "_" || e.key === "0") {
          e.preventDefault();
          const container = document.querySelector("[data-canvas-viewport]");
          const rect = container?.getBoundingClientRect() || { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 };
          const center = { x: rect.width / 2, y: rect.height / 2 };
          const st = useEditorStore.getState();
          const vp = st.viewport;
          if (e.key === "0") {
            st.setViewport(G.zoomToCursor(vp, center, 1));
          } else if (e.key === "=" || e.key === "+") {
            st.setViewport(G.zoomToCursor(vp, center, Math.min(256, vp.zoom * 2)));
          } else if (e.key === "-" || e.key === "_") {
            st.setViewport(G.zoomToCursor(vp, center, Math.max(0.01, vp.zoom * 0.5)));
          }
        }
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    window.addEventListener("keydown", handleKeyZoom, { capture: true });
    return () => {
      window.removeEventListener("wheel", handleWheel, { capture: true });
      window.removeEventListener("keydown", handleKeyZoom, { capture: true });
    };
  }, []);

  // M6: multiplayer room (presence + live cursors + doc sync). Joins
  // once the file's doc has loaded; transport is Supabase Realtime when
  // configured + signed in, BroadcastChannel (tab-to-tab) otherwise.
  useCollab(fileId, loaded);

  // Configured mode is gated: no session → sign in first.
  useEffect(() => {
    if (configured && status === "signed-out") router.replace("/login");
  }, [configured, status, router]);

  // Load this file's document (seed + persist on first visit). Async in
  // both modes; the "Loading…" overlay covers the wait.
  useEffect(() => {
    // In configured mode, wait until the session resolves (and exists).
    if (configured && status !== "signed-in") return;
    let cancelled = false;
    (async () => {
      await ensureSeeded();
      if (cancelled) return;
      const store = useEditorStore.getState();
      const stored = await loadFile(fileId);
      if (cancelled) return;
      if (stored) {
        store.loadDoc(stored, fileId);
        preloadDocGoogleFonts(stored);
        // M7: the file's version history loads alongside the doc (it
        // lives beside the doc in both backends, never inside it).
        store.setVersions(await loadVersions(fileId));
        if (cancelled) return;
        // The registry title wins (dashboard renames touch the registry);
        // adopt it so the next autosave doesn't write the stale doc title.
        const m = await loadFileMeta(fileId);
        if (cancelled) return;
        if (m && m.title !== stored.title) store.setFileTitle(m.title);
        setMeta(m);
      } else {
        const m = await loadFileMeta(fileId);
        if (cancelled) return;
        const base =
          !configured && fileId === sampleDoc.id
            ? structuredClone(sampleDoc)
            : createBlankDoc(fileId, m?.title ?? "Untitled");
        store.loadDoc(base, fileId);
        preloadDocGoogleFonts(base);
        store.setVersions(await loadVersions(fileId));
        if (cancelled) return;
        await saveFile(fileId, base);
        if (cancelled) return;
        setMeta(await loadFileMeta(fileId));
      }
      if (!cancelled) {
        setLoaded(true);
        setTimeout(async () => {
          if (cancelled) return;
          const st = useEditorStore.getState();
          if (!st.doc?.thumbnail) {
            try {
              const snap = await captureCanvasThumbnail(st.doc, st.activePageId);
              if (snap && !cancelled) {
                st.doc.thumbnail = snap;
                await saveFile(fileId, st.doc);
                await updateFileMeta(fileId, { thumbnail: snap });
              }
            } catch (_) {}
          }
        }, 1200);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileId, configured, status]);

  // 10s debounced autosave — if any change happens on canvas/page, wait 10s then auto save
  // If the user clicks Save before 10s, triggerImmediateSave fires immediately and cancels this timer
  useEffect(() => {
    const unsub = useEditorStore.subscribe((state, prev) => {
      if (state.doc === prev.doc) return;
      if (state.fileId !== fileId) return;

      // Mark as unsaved while waiting the 10 seconds
      useEditorStore.setState({ saveStatus: "unsaved" });

      if (autosaveTimer) clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(async () => {
        autosaveTimer = null;
        await triggerImmediateSave(fileId);
      }, 10000); // Wait 10 seconds
    });

    const onBeforeUnload = () => {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
        saveFile(fileId, useEditorStore.getState().doc);
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (autosaveTimer) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
      }
      unsub();
    };
  }, [fileId]);

  // M7: version history persists through its OWN debounced path —
  // versions are file-level state beside the doc, so the doc autosave
  // above (and the M6 collab broadcast, also keyed on doc identity)
  // never sees a versions change.
  useEffect(() => {
    let timer = null;
    const unsub = useEditorStore.subscribe((state, prev) => {
      if (state.versions === prev.versions) return;
      if (state.fileId !== fileId) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        saveVersions(fileId, useEditorStore.getState().versions).catch(
          (err) => console.error("canvas-tool: versions save failed", err),
        );
      }, 500);
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, [fileId]);

  // M7: automatic versions, riding the same doc-change seam as the
  // autosave. When the doc changes and the newest version is at least
  // AUTO_INTERVAL_MS old (or none exists yet), an autosave version is
  // appended. Skipped while previewing (the doc cannot change then,
  // but belt-and-braces) and for remotely-applied docs (a peer's edit
  // is not our snapshot to claim; the peer's own client autosaves its
  // own history). Appending a version changes no doc state, so this
  // cannot trigger itself, the autosave, or a collab broadcast.
  useEffect(() => {
    if (!loaded) return;
    const unsub = useEditorStore.subscribe((state, prev) => {
      if (state.doc === prev.doc) return;
      if (state.fileId !== fileId) return;
      if (state.previewVersionId) return;
      if (state.lastDocOrigin === "remote") return;
      if (!shouldAutoVersion(state.versions, Date.now())) return;
      state.addAutoVersion();
    });
    return unsub;
  }, [fileId, loaded]);

  // Auto-expand disabled so hide-UI mode stays hidden until user explicitly shows UI
  // via "Show UI", FloatingChrome badge, or "." hotkey

  // Keep browser tab title updated with file name
  const docTitle = useEditorStore((s) => s.doc.title);
  useEffect(() => {
    const active = docTitle || meta?.title;
    if (active && typeof document !== "undefined") {
      document.title = `${active} – Designer`;
    }
  }, [docTitle, meta?.title]);

  // M4 hide-UI modes: "full" = all chrome docked; "collapsed" = left
  // sidebar + top bar + toolbar become floating pills over a full-width
  // canvas (right sidebar stays); "hidden" = canvas only, floating
  // pills, no sidebars. The Viewport measures its container, so it
  // resizes correctly in every mode.
  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden">
      <div className="relative flex-1 min-h-0 w-full overflow-hidden">
        {/* Full 100vh canvas spanning entire workspace */}
        <div className="absolute inset-0 z-0 flex flex-col w-full h-full overflow-hidden">
          <Viewport />
          <HistoryPanel />
          {previewing && <PreviewBanner />}
          {uiMode !== "full" && (
            <FloatingChrome
              meta={meta}
              fileId={fileId}
              setMeta={setMeta}
              onOpenHotkeys={() => setHotkeysOpen(true)}
            />
          )}
        </div>

        {/* Left sidebar & Toolbar overlapping over canvas */}
        {uiMode === "full" && (
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 z-20 flex">
            <div className="pointer-events-auto h-full shadow-[2px_0_8px_rgba(0,0,0,0.06)]">
              <LeftSidebar
                meta={meta}
                fileId={fileId}
                setMeta={setMeta}
                collapsed={leftCollapsed}
                onToggleCollapse={() => {
                  useEditorStore.getState().setUiMode("hidden");
                }}
                onOpenHotkeys={() => setHotkeysOpen(true)}
              />
            </div>
            <div className="pointer-events-none flex flex-col">
              <Toolbar
                leftCollapsed={leftCollapsed}
                onToggleLeftCollapse={() => {
                  useEditorStore.getState().setUiMode("full");
                }}
              />
            </div>
          </div>
        )}

        {/* Right sidebar overlapping over canvas */}
        {uiMode !== "hidden" && (
          <div className="pointer-events-auto absolute right-0 top-0 bottom-0 z-20 shadow-[-2px_0_8px_rgba(0,0,0,0.06)]">
            <RightSidebar
              previewing={previewing}
              fileId={fileId}
              meta={meta}
              setMeta={setMeta}
            />
          </div>
        )}
      </div>
      <ToastView />
      <HotkeysDialog
        isOpen={hotkeysOpen}
        onClose={() => setHotkeysOpen(false)}
      />
      {upgradeDialogOpen && (
        <UpgradeDialog
          planId={planId}
          onPlanChange={(next) => {
            const st = useEditorStore.getState();
            st.setPlanId(next);
            st.showToast({
              message:
                next === "pro"
                  ? "Welcome to Pro (demo) — no payment was taken"
                  : "You're back on the Free plan (demo)",
            });
          }}
          onClose={() =>
            useEditorStore.getState().setUpgradeDialogOpen(false)
          }
        />
      )}
      {connectAgentModalOpen && (
        <ConnectAgentModal
          onClose={() =>
            useEditorStore.getState().setConnectAgentModalOpen(false)
          }
        />
      )}
      <AddSvgModal
        isOpen={isAddSvgOpen}
        onClose={() => setIsAddSvgOpen(false)}
      />
      {!loaded && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[var(--surface-panel)]">
          <span className="text-[var(--text-2)]">Loading…</span>
        </div>
      )}
    </div>
  );
}
