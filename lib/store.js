/**
 * Editor state (Zustand).
 *
 * M3 â€” history scheme (snapshot-based, see lib/history.js):
 * Every mutating action calls `commitDocHistory(get, set, coalesceKey)`
 * BEFORE it changes the doc. That pushes a structuredClone of the CURRENT
 * (pre-mutation) doc onto `history.past` and clears `history.future`, so
 * `undo()` is just "swap the doc for the newest past snapshot, pushing the
 * current doc onto future". Coalescing: a commit whose coalesceKey matches
 * the newest entry's key within the window merges into it (no new entry) â€”
 * this is how rapid nudges become ONE undo step (Phase 3 Ã‚Â§14) and how
 * slider drags in the Inspector stay a single step.
 *
 * Two mutation paths deliberately do NOT commit on their own, because they
 * are transient drag streams:
 * - setNodePositions (drag-move) and setNodeCanvasRect (resize): the
 *   Viewport captures a pre-gesture snapshot at pointer-down and calls
 *   `commitSnapshot(snapshot)` once at pointer-up.
 * Everything else â€” inspector commits, token CRUD, flex changes, create /
 * delete / duplicate, text-edit commits, comments, page add/rename â€” is a
 * discrete action and commits inside the action itself.
 *
 * History covers the DOC ONLY (nodes + tokens + comments): the viewport is
 * never in history, selection is pruned to surviving ids after undo/redo,
 * and loadDoc() resets history. File-title edits are history-exempt.
 */
import { create } from "zustand";
import { sampleDoc } from "./sample-doc.js";
import { absoluteOrigin, absoluteRect, selectionRoots, subtreeIds } from "./geometry.js";
import { detachToken } from "./model.js";
import { normalizeAnchors, toggleAnchorSmooth } from "./path.js";
import { defaultShader } from "./shader.js";
import { defaultGrid } from "./grid.js";
import { starterTokens } from "./theme.js";
import { HISTORY_CAP, applyCommit, makeEntry, pushHistory } from "./history.js";
import { makeVersion, pruneVersions, versionTitle } from "./versions.js";
import { cleanAndNormalizeHtml } from "./richtext.js";
import { reorderList } from "./flex.js";
import { CURSOR_CHAT_TTL_MS, sanitizeChatText } from "./collab.js";
import { effectiveVersionCap, loadPlanId, savePlanId } from "./plans.js";

export { MIN_ZOOM, MAX_ZOOM } from "./geometry.js";

/** Nudge steps in canvas px (Phase 3 Ã‚Â§10). A settings dialog comes later. */
export const NUDGE_SMALL = 1;
export const NUDGE_LARGE = 8;

let idSeq = 1;
/** Next node id, skipping ids already present in `doc` (M3: docs persist
 *  across sessions, so a restarted counter must not re-mint a live id). */
export function nextNodeId(doc) {
  let id = `node-${idSeq++}`;
  while (doc && doc.nodes[id]) id = `node-${idSeq++}`;
  return id;
}

const BASE_NAMES = {
  frame: "Frame",
  rect: "Rectangle",
  ellipse: "Ellipse",
  text: "Text",
  path: "Path",
  image: "Image",
  shader: "Shader",
};

/** "Rectangle", then "Rectangle 2", "Rectangle 3", Ã¢â‚¬Â¦ â€” first free name. */
function nextName(nodes, type) {
  const base = BASE_NAMES[type] ?? "Node";
  const taken = new Set(Object.values(nodes).map((n) => n.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** Default styles for freshly created nodes (our own defaults). */
function defaultStyle(type) {
  switch (type) {
    case "frame":
      return { fill: { kind: "solid", color: "#FFFFFF" }, radius: 0 };
    case "rect":
      return { fill: { kind: "solid", color: "#D9DEE8" }, radius: 0 };
    case "ellipse":
      return { fill: { kind: "solid", color: "#D9DEE8" }, radius: 50 };
    case "text":
      return { fill: { kind: "solid", color: "#1F1F1F" } };
    case "path":
      // M4: paths are born as open curves with a near-black 1.5px stroke
      // and no fill (a fill only shows once the path is closed).
      return {
        stroke: {
          width: 1.5,
          paint: { kind: "solid", color: "#1F1F1F", alpha: 1 },
        },
      };
    default:
      return {};
  }
}

/**
 * Build a new node of `type` with canvas-space rect `rect` (position is
 * converted to parent-relative here) under `parentId` (null = page root).
 */
export function createNode(doc, type, rect, parentId) {
  const parentOrigin = parentId
    ? absoluteOrigin(doc.nodes, parentId)
    : { x: 0, y: 0 };
  const node = {
    id: nextNodeId(doc),
    type,
    name: nextName(doc.nodes, type),
    parentId: parentId ?? null,
    childIds: [],
    layout: { mode: "freeform" },
    position: { x: rect.x - parentOrigin.x, y: rect.y - parentOrigin.y },
    size: {
      w: type === "text" ? { kind: "fit" } : { kind: "fixed", px: Math.max(1, Math.round(rect.w)) },
      h: type === "text" ? { kind: "fit" } : { kind: "fixed", px: Math.max(1, Math.round(rect.h)) },
    },
    style: defaultStyle(type),
  };
  if (type === "frame") {
    // Parent frame initially has clip content checked; child frames do not
    const isParentFrame = parentId == null;
    node.clipContent = isParentFrame;
    if (isParentFrame) {
      node.style = { ...node.style, overflow: "hidden" };
    }
  }
  if (type === "ellipse") {
    // Ellipses are born with a 50% radius so they render as ovals/circles.
    node.style = { ...node.style, radius: 50 };
  }
  if (type === "text") {
    node.text = {
      content: "",
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 1.25,
      letterSpacing: 0,
      align: "left",
    };
  }
  if (type === "path") {
    // Anchors arrive via setPathFromCanvas (the pen tool); the factory
    // rect is a placeholder that the first anchor immediately replaces.
    node.path = { anchors: [], closed: false };
  }
  if (type === "shader") {
    // M5: shader layers are born with the default preset (lib/shader.js).
    node.shader = defaultShader();
  }
  return node;
}

let tokenSeq = 1;
/** Next token id, skipping ids already present in `doc` (see nextNodeId). */
function nextTokenId(doc) {
  let id = `tok-${tokenSeq++}`;
  while (doc && doc.tokens.some((t) => t.id === id)) id = `tok-${tokenSeq++}`;
  return id;
}

let toastSeq = 1;

/**
 * Applies layout constraints (start, center, end, stretch, scale) to the children
 * of a resized frame. Keeps constrained layers pinned to their configured sides
 * with the exact same distance (Figma / Paper Design model).
 */
export function applyConstraintsToChildren(
  nodes,
  parentId,
  oldW,
  oldH,
  newW,
  newH,
  startSnapshotNodes = null
) {
  const parent = nodes[parentId];
  if (!parent || !parent.childIds || parent.childIds.length === 0) return nodes;

  const deltaW = newW - oldW;
  const deltaH = newH - oldH;
  if (Math.abs(deltaW) < 0.001 && Math.abs(deltaH) < 0.001) return nodes;

  let nextNodes = { ...nodes };

  for (const cid of parent.childIds) {
    const baseChild = startSnapshotNodes?.[cid] || nodes[cid];
    const currentChild = nodes[cid];
    if (!baseChild || !currentChild) continue;

    // In flex containers, in-flow items follow flexbox; only absolute items follow constraints.
    // In freeform containers, all children follow constraints.
    const isFlexParent = parent.layout?.mode === "flex";
    const isAbsolute = Boolean(baseChild.position?.absolute);
    if (isFlexParent && !isAbsolute) continue;

    const hC = baseChild.constraints?.horizontal || "start";
    const vC = baseChild.constraints?.vertical || "start";

    // Original position and size
    const startX = Number.isFinite(Number(baseChild.position?.x))
      ? Number(baseChild.position.x)
      : (Number.isFinite(Number(baseChild.x)) ? Number(baseChild.x) : 0);
    const startY = Number.isFinite(Number(baseChild.position?.y))
      ? Number(baseChild.position.y)
      : (Number.isFinite(Number(baseChild.y)) ? Number(baseChild.y) : 0);
    const startW = Number.isFinite(Number(baseChild.size?.w?.px))
      ? Number(baseChild.size.w.px)
      : (Number.isFinite(Number(baseChild.w)) ? Number(baseChild.w) : 100);
    const startH = Number.isFinite(Number(baseChild.size?.h?.px))
      ? Number(baseChild.size.h.px)
      : (Number.isFinite(Number(baseChild.h)) ? Number(baseChild.h) : 100);

    let nextX = startX;
    let nextW = startW;

    if (hC === "end") {
      // Pinned to Right edge: maintain distance to Right edge
      nextX = startX + deltaW;
    } else if (hC === "center") {
      // Pinned to horizontal center
      nextX = startX + deltaW / 2;
    } else if (hC === "stretch") {
      // Pinned to Left & Right: stretch width
      nextX = startX;
      nextW = Math.max(1, startW + deltaW);
    } else if (hC === "scale") {
      // Proportional scale
      const scaleX = oldW > 0 ? newW / oldW : 1;
      nextX = startX * scaleX;
      nextW = Math.max(1, startW * scaleX);
    } else {
      // "start" (Left): pinned to Left edge
      nextX = startX;
    }

    let nextY = startY;
    let nextH = startH;

    if (vC === "end") {
      // Pinned to Bottom edge: maintain distance to Bottom edge
      nextY = startY + deltaH;
    } else if (vC === "center") {
      // Pinned to vertical center
      nextY = startY + deltaH / 2;
    } else if (vC === "stretch") {
      // Pinned to Top & Bottom: stretch height
      nextY = startY;
      nextH = Math.max(1, startH + deltaH);
    } else if (vC === "scale") {
      // Proportional scale
      const scaleY = oldH > 0 ? newH / oldH : 1;
      nextY = startY * scaleY;
      nextH = Math.max(1, startH * scaleY);
    } else {
      // "start" (Top): pinned to Top edge
      nextY = startY;
    }

    const round2 = (v) => Math.round(v * 100) / 100;
    nextX = round2(nextX);
    nextY = round2(nextY);
    nextW = Math.round(nextW);
    nextH = Math.round(nextH);

    const childPatch = {
      position: {
        ...(currentChild.position || {}),
        x: nextX,
        y: nextY,
        ...(isAbsolute ? { absolute: true } : {}),
      },
      x: nextX,
      y: nextY,
    };

    if (hC === "stretch" || hC === "scale") {
      childPatch.size = {
        ...(currentChild.size || {}),
        w: { ...(currentChild.size?.w || {}), kind: "fixed", px: nextW },
      };
      childPatch.w = nextW;
    }

    if (vC === "stretch" || vC === "scale") {
      childPatch.size = {
        ...(childPatch.size || currentChild.size || {}),
        h: { ...(currentChild.size?.h || {}), kind: "fixed", px: nextH },
      };
      childPatch.h = nextH;
    }

    nextNodes[cid] = {
      ...currentChild,
      ...childPatch,
    };

    // Recursively apply if child itself has children and was resized
    if ((nextW !== startW || nextH !== startH) && currentChild.childIds?.length) {
      nextNodes = applyConstraintsToChildren(
        nextNodes,
        cid,
        startW,
        startH,
        nextW,
        nextH,
        startSnapshotNodes
      );
    }
  }

  return nextNodes;
}

/** Unique-ish ids for comments/pages (they persist, so no bare counters). */
function uniqueId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

/**
 * Push a pre-mutation snapshot of the current doc onto the undo stack.
 * Called at the TOP of every discrete mutating action (see header).
 */
function commitDocHistory(get, set, coalesceKey = null) {
  const s = get();
  const entry = makeEntry(structuredClone(s.doc), coalesceKey);
  set({ history: applyCommit(s.history, entry) });
}

/** State adjustments after the doc is replaced (undo / redo / load). */
function afterDocReplace(doc, s) {
  const editingPathId =
    s.editingPathId && doc.nodes[s.editingPathId] ? s.editingPathId : null;
  return {
    selection: s.selection.filter((id) => doc.nodes[id]),
    activePageId: doc.pages.some((p) => p.id === s.activePageId)
      ? s.activePageId
      : doc.pages[0].id,
    editingTextId: null,
    activeCommentId: (doc.comments ?? []).some((c) => c.id === s.activeCommentId)
      ? s.activeCommentId
      : null,
    // M4: anchor-edit mode survives undo/redo only while its node does.
    editingPathId,
    selectedAnchorIndex: editingPathId ? s.selectedAnchorIndex : null,
  };
}

/** Detach `id` from its parent's childIds or its page's rootNodeIds. */
function detach(doc, id) {
  const node = doc.nodes?.[id];
  if (node && node.parentId && doc.nodes?.[node.parentId]) {
    const parent = doc.nodes[node.parentId];
    parent.childIds = (parent.childIds ?? []).filter((c) => c !== id);
  } else if (doc.nodes) {
    for (const n of Object.values(doc.nodes)) {
      if (n?.childIds?.includes(id)) {
        n.childIds = n.childIds.filter((c) => c !== id);
      }
    }
  }
  for (const page of doc.pages ?? []) {
    page.rootNodeIds = (page.rootNodeIds ?? []).filter((r) => r !== id);
  }
}

/**
 * Apply a sibling reorder to a (cloned) doc: move `childId` within
 * its parent's childIds â€” or the page's rootNodeIds when parentId is
 * null. `insertIndex` is in the without-the-child space (see
 * lib/flex.js reorderList). Returns false for a no-op move so callers
 * can skip the history commit.
 */
function applyReorder(doc, parentId, pageId, childId, insertIndex) {
  if (parentId) {
    const parent = doc.nodes[parentId];
    if (!parent) return false;
    const next = reorderList(parent.childIds ?? [], childId, insertIndex);
    if (!next) return false;
    parent.childIds = next;
    return true;
  }
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return false;
  const next = reorderList(page.rootNodeIds, childId, insertIndex);
  if (!next) return false;
  page.rootNodeIds = next;
  return true;
}

/** Attach `node` under its parentId (start of the sibling list = on top / front). */
function attach(doc, pageId, node, afterId = null) {
  const siblings = node.parentId
    ? doc.nodes[node.parentId].childIds
    : doc.pages.find((p) => p.id === pageId).rootNodeIds;
  if (afterId && siblings.includes(afterId)) {
    siblings.splice(siblings.indexOf(afterId) + 1, 0, node.id);
  } else {
    siblings.unshift(node.id);
  }
  doc.nodes[node.id] = node;
}

/**
 * Core engine for reparenting a node between containers or to canvas root.
 * Enforces:
 * 1. Cycle prevention (cannot reparent to descendant)
 * 2. Visual position preservation (canvas coordinates -> local coordinates conversion)
 * 3. Fill constraint adaptation (converting Fill -> Auto/Fit/Fixed when moving to canvas root
 *    or freeform frame, retaining Fill when moving into flex/grid parent)
 * 4. Proper sibling insertion (preserving order at insertIndex or top/bottom)
 */
function applyReparentToDoc(nextDoc, { id, newParentId, newPosition = null, insertIndex = null, nRect = null }, activePageId) {
  const node = nextDoc.nodes[id];
  if (!node) return;
  if (newParentId) {
    const descendants = subtreeIds(nextDoc.nodes, id);
    if (descendants.includes(newParentId)) return;
  }

  const oldParentId = node.parentId ?? null;
  const oldParent = oldParentId ? nextDoc.nodes[oldParentId] : null;
  const targetParent = newParentId ? nextDoc.nodes[newParentId] : null;

  // Capture canvas rect before detaching to preserve visual position and dimensions
  const liveRect = nRect || absoluteRect(nextDoc.nodes, id) || {
    x: node.position?.x ?? node.x ?? 0,
    y: node.position?.y ?? node.y ?? 0,
    w: node.size?.w?.px ?? node.w ?? 100,
    h: node.size?.h?.px ?? node.h ?? 100,
  };

  detach(nextDoc, id);
  node.parentId = newParentId ?? null;

  const isTargetAutoLayout = targetParent?.layout?.mode === "flex" || targetParent?.layout?.mode === "grid";
  const isAbs = !!(newPosition?.absolute ?? node.position?.absolute);
  const targetSupportsFill = isTargetAutoLayout && !isAbs;

  // 1. Position calculation: preserve visual canvas position
  if (newPosition) {
    node.position = {
      ...node.position,
      ...newPosition,
      x: newPosition.x,
      y: newPosition.y,
    };
    node.x = newPosition.x;
    node.y = newPosition.y;
  } else {
    // If no newPosition was provided (e.g. Layers panel drop or reparent shortcut)
    if (isTargetAutoLayout && !isAbs) {
      node.position = { x: 0, y: 0, absolute: false };
      node.x = 0;
      node.y = 0;
    } else if (targetParent) {
      // Local coordinate relative to targetParent's canvas position
      const tpRect = absoluteRect(nextDoc.nodes, targetParent.id) || {
        x: targetParent.position?.x ?? targetParent.x ?? 0,
        y: targetParent.position?.y ?? targetParent.y ?? 0,
      };
      const localX = Math.round(liveRect.x - tpRect.x);
      const localY = Math.round(liveRect.y - tpRect.y);
      node.position = {
        ...node.position,
        x: localX,
        y: localY,
        ...(isAbs ? { absolute: true } : {}),
      };
      node.x = localX;
      node.y = localY;
    } else {
      // Reparent to canvas root: keep canvas coordinates
      const localX = Math.round(liveRect.x);
      const localY = Math.round(liveRect.y);
      node.position = {
        ...node.position,
        x: localX,
        y: localY,
        absolute: false,
      };
      node.x = localX;
      node.y = localY;
    }
  }

  if (isTargetAutoLayout && !isAbs) {
    if (node.position) delete node.position.absolute;
    node.absolutePosition = false;
  }

  // 2. Handle Fill Width and Height (Requirement 4)
  if (!targetSupportsFill) {
    // Width constraint invalid in non-auto-layout target (or canvas root or absolute)
    const isWFill = node.size?.w?.kind === "fill" || node.wMode === "Fill";
    if (isWFill) {
      if (node.type === "text") {
        // Text adapts naturally to content
        node.size = { ...(node.size || {}), w: { kind: "fit" } };
        node.wMode = "Fit";
      } else {
        // Frames/rects/shapes: freeze to current rendered visual px so visual appearance is preserved
        const curW = Math.max(1, Math.round(liveRect.w || node.size?.w?.px || node.w || 100));
        node.size = { ...(node.size || {}), w: { kind: "fixed", px: curW } };
        node.w = curW;
        node.wMode = "Fixed";
      }
    }

    // Height constraint invalid in non-auto-layout target
    const isHFill = node.size?.h?.kind === "fill" || node.hMode === "Fill";
    if (isHFill) {
      if (node.type === "text") {
        node.size = { ...(node.size || {}), h: { kind: "fit" } };
        node.hMode = "Fit";
      } else {
        const curH = Math.max(1, Math.round(liveRect.h || node.size?.h?.px || node.h || 100));
        node.size = { ...(node.size || {}), h: { kind: "fixed", px: curH } };
        node.h = curH;
        node.hMode = "Fixed";
      }
    }
  }

  // 3. Attach to new parent's siblings
  const page = nextDoc.pages.find((p) => p.id === activePageId) || nextDoc.pages[0];
  const siblings = targetParent
    ? (targetParent.childIds = targetParent.childIds ?? [])
    : (page.rootNodeIds = page.rootNodeIds ?? []);

  if (insertIndex != null && insertIndex >= 0 && insertIndex <= siblings.length) {
    siblings.splice(insertIndex, 0, id);
  } else {
    siblings.unshift(id);
  }
}

export const useEditorStore = create((set, get) => ({
  /** @type {import("./model").DesignFile} */
  doc: structuredClone(sampleDoc),
  activePageId: sampleDoc.pages[0].id,
  /** @type {string[]} selected node ids (any depth) */
  selection: ["rect-accent"],
  viewport: { x: 0, y: 0, zoom: 1 },
  /** Canvas container size in screen px (set by Viewport via ResizeObserver). */
  canvasSize: { w: 0, h: 0 },
  sidebarTab: "design", // "design" | "theme"
  activeTool: "move", // move | pan | frame | rect | pen | text | comment
  // ("shader" is not a tool â€” the toolbar button creates a node directly)
  /** Node id whose text is being edited on canvas (M2), or null. */
  editingTextId: null,

  // -- M3 state --------------------------------------------------------------
  /** Id of the file currently loaded (persistence is keyed by it). */
  fileId: sampleDoc.id,
  /** Undo/redo stacks of { doc, coalesceKey, ts } entries (lib/history.js). */
  history: { past: [], future: [] },
  /** Transient toast: { id, message, actionLabel?, onAction?, duration? }. */
  toast: null,
  /** Comment thread currently open in the overlay panel, or null. */
  activeCommentId: null,
  /** Unsent comment being composed: { pageId, x, y } in page coords. */
  commentDraft: null,
  /** Comments list panel visibility. */
  commentsPanelOpen: false,
  /** Resolved pins/threads stay visible when true (spec toggle). */
  showResolvedComments: false,

  // -- M4 state --------------------------------------------------------------
  /** Path node in anchor-edit mode (double-click a path), or null. */
  editingPathId: null,
  /** Selected anchor index within the editing path, or null. */
  selectedAnchorIndex: null,
  /** Move-drag snapping master switch (Zoom menu, Phase 3 Ã‚Â§7 family). */
  snapEnabled: true,
  /** Chrome visibility: "full" | "collapsed" | "hidden" (Phase 3 Ã‚Â§1). */
  uiMode: "full",
  /** Save status for professional auto-save & manual save indicator: "saved" | "saving" | "unsaved" */
  saveStatus: "saved",
  lastSavedAt: null,
  setSaveStatus: (saveStatus) => set({ saveStatus, ...(saveStatus === "saved" ? { lastSavedAt: Date.now() } : {}) }),

  // -- M6 state (multiplayer â€” lib/collab.js, components/Collab.jsx) --------
  /** Active transport: "supabase" | "local" | "off". */
  collabMode: "off",
  /** The transport reported SUBSCRIBED / live at least once. */
  collabConnected: false,
  /** This tab's identity { id, name, color } (id is PER-TAB, see Collab). */
  identity: null,
  /** Flat presence map of REMOTE peers: { peerId: presenceState }. */
  peers: {},
  /** Our cursor in canvas coords on the active page, or null. Written
   *  (throttled) by the Viewport; published as presence by Collab. */
  localCursor: null,
  /** Bumped on every doc replacement (see the subscription at the
   *  bottom of this file) â€” a cheap change signal for collab tooling. */
  docVersion: 0,
  /** Origin of the most recent doc change: "local" | "remote". Set to
   *  "remote" ONLY by applyRemoteDoc; the collab doc-broadcast
   *  subscription reads it to avoid echo loops (and consumes it). */
  lastDocOrigin: "local",

  // -- M7 state (version history â€” lib/versions.js) ----------------------
  /** The loaded file's versions, NEWEST FIRST. File-level state, NOT
   *  part of the doc: snapshots must never nest, version edits are not
   *  undo steps, and the collab doc subscription (keyed on doc
   *  identity) never sees them. Persisted by the shell via
   *  persistence.saveVersions. */
  versions: [],
  /** Id of the version being previewed read-only, or null. */
  previewVersionId: null,
  /** History panel visibility. */
  historyPanelOpen: false,

  // -- depth-gap batch state ------------------------------------------------
  /** Transient guide drag: { frameId, guideId, pos } while a frame's
   *  line guide is being dragged on the canvas. Editor state, NOT
   *  doc â€” the doc (and its one history entry) update only on drop,
   *  through the same patchNode path the Guides panel uses. */
  guideDrag: null,
  /** Our own cursor-chat bubble: { text, expiresAt } or null. Written
   *  by sendCursorChat, published as presence by components/Collab.jsx
   *  (which also clears it at expiry), rendered by the Viewport. */
  localChat: null,
  /** The active collab transport's send fn, registered by
   *  components/Collab.jsx while a room is joined (null when solo).
   *  Lets store actions (cursor chat) broadcast without the store
   *  owning the transport lifecycle. */
  collabSend: null,

  // -- platform batch state (plans & billing â€” lib/plans.js) ------------
  /** Current plan id ("free" | "pro"). Demo state: persisted to
   *  localStorage (canvastool:plan) by setPlanId, restored by
   *  hydratePlan on shell mount. Drives the version-history cap
   *  (free 10 / pro 30) via the prune call-sites below; file-count and
   *  AI-generation limits are enforced in the dashboard / AI panel,
   *  which read the same helpers. */
  planId: "free",
  /** Upgrade dialog visibility (opened from the account area and from
   *  the AI panel's at-cap upgrade prompt). */
  upgradeDialogOpen: false,
  /** Connect AI agent (MCP) modal visibility. */
  connectAgentModalOpen: false,

  // -- shell state ---------------------------------------------------------
  setConnectAgentModalOpen: (open) => set({ connectAgentModalOpen: !!open }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setActiveTool: (tool) => {
    set((state) => {
      const updates = { activeTool: tool };
      if (tool === "comment") {
        updates.commentsPanelOpen = true;
      } else if (state.activeTool === "comment" || state.commentsPanelOpen || state.commentDraft || state.activeCommentId) {
        updates.commentsPanelOpen = false;
        updates.activeCommentId = null;
        updates.commentDraft = null;
      }
      return updates;
    });
  },
  setEditingPathId: (id) =>
    set({ editingPathId: id, selectedAnchorIndex: id ? 0 : null }),
  setSelectedAnchorIndex: (index) => set({ selectedAnchorIndex: index }),
  setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
  setGuideDrag: (drag) => set({ guideDrag: drag }),
  setUiMode: (mode) => set({ uiMode: mode }),
  setActivePage: (id) => set({ activePageId: id, selection: [] }),
  setViewport: (viewport) => set({ viewport }),
  setCanvasSize: (canvasSize) => set({ canvasSize }),

  // -- M3: file loading / title ------------------------------------------------

  /**
   * Replace the whole document (persistence load). Resets history,
   * selection and comment UI â€” a freshly loaded file has no past.
   */
  loadDoc: (doc, fileId) => {
    const next = structuredClone(doc);
    if (!Array.isArray(next.comments)) next.comments = [];
    // M4: docs saved before assets existed load with an empty table.
    if (!next.assets || typeof next.assets !== "object") next.assets = {};
    if (!next.nodes || typeof next.nodes !== "object") next.nodes = {};
    for (const page of next.pages ?? []) {
      if (Array.isArray(page.rootNodeIds)) {
        page.rootNodeIds = page.rootNodeIds.filter((id) => Boolean(next.nodes[id]));
      }
    }
    for (const node of Object.values(next.nodes)) {
      if (Array.isArray(node?.childIds)) {
        node.childIds = node.childIds.filter((id) => Boolean(next.nodes[id]));
      }
    }
    const isNewBlankDoc = !next.nodes || Object.keys(next.nodes).length === 0;
    set({
      doc: next,
      fileId: fileId ?? next.id,
      activePageId: next.pages[0]?.id,
      selection: [],
      history: { past: [], future: [] },
      editingTextId: null,
      activeCommentId: null,
      commentDraft: null,
      commentsPanelOpen: false,
      editingPathId: null,
      selectedAnchorIndex: null,
      lastDocOrigin: "local",
      ...(isNewBlankDoc ? { viewport: { x: 0, y: 0, zoom: 1 } } : {}),
      // M7: a freshly loaded file shows its own history (the shell sets
      // it right after load) and is never mid-preview.
      versions: [],
      previewVersionId: null,
      historyPanelOpen: false,
    });
  },

  // -- M6: multiplayer ---------------------------------------------------------

  setCollabMode: (mode) => set({ collabMode: mode }),
  setCollabConnected: (connected) => set({ collabConnected: connected }),
  setIdentity: (identity) => set({ identity }),
  setPeers: (peers) => set({ peers: peers ?? {} }),
  setLocalCursor: (cursor) => set({ localCursor: cursor }),
  setLocalChat: (chat) => set({ localChat: chat }),
  setCollabSend: (fn) => set({ collabSend: fn ?? null }),

  /**
   * Cursor chat (depth-gap batch): sanitise the text, raise our own
   * bubble for CURSOR_CHAT_TTL_MS (the Collab hook publishes it as
   * presence and clears it at expiry) and broadcast it on the active
   * transport for immediacy. Returns false when nothing was sent
   * (blank after sanitising). With no transport registered the bubble
   * still shows locally â€” the Viewport gates the input on a live
   * session, so this is only a fallback.
   */
  sendCursorChat: (text) => {
    const s = get();
    const clean = sanitizeChatText(text);
    if (!clean) return false;
    set({
      localChat: { text: clean, expiresAt: Date.now() + CURSOR_CHAT_TTL_MS },
    });
    if (s.collabSend && s.identity) {
      s.collabSend({
        kind: "cursor-chat",
        senderId: s.identity.id,
        text: clean,
      });
    }
    return true;
  },

  /** Consume the "remote" origin flag after the collab subscription
   *  has seen (and skipped broadcasting) a remotely-applied doc. */
  consumeRemoteOrigin: () => {
    if (get().lastDocOrigin === "remote") set({ lastDocOrigin: "local" });
  },

  /**
   * Apply a document received from a peer (whole-doc last-writer-wins,
   * M6). Deliberately NOT a history commit: taking a peer's doc must
   * not become an undo step of our own. The redo stack IS cleared â€”
   * redoing into a pre-sync local future would silently fork the doc.
   * Selection/UI are pruned to what survives (afterDocReplace), and
   * lastDocOrigin is set to "remote" so the collab subscription skips
   * re-broadcasting it (loop prevention); the autosave subscription
   * still persists it, which is desired.
   */
  applyRemoteDoc: (remoteDoc) => {
    const s = get();
    if (!remoteDoc || typeof remoteDoc !== "object") return;
    if (!Array.isArray(remoteDoc.pages) || !remoteDoc.nodes) return;
    const next = structuredClone(remoteDoc);
    if (!Array.isArray(next.comments)) next.comments = [];
    if (!next.assets || typeof next.assets !== "object") next.assets = {};
    set({
      doc: next,
      history: { past: s.history.past, future: [] },
      lastDocOrigin: "remote",
      ...afterDocReplace(next, s),
    });
  },

  // -- platform batch: plans ------------------------------------------------

  /** Restore the persisted demo plan (shell mount). Client-only â€”
   *  loadPlanId reads localStorage and falls back to "free". */
  hydratePlan: () => set({ planId: loadPlanId() }),

  /** Set + persist the demo plan (Upgrade dialog / Manage plan). */
  setPlanId: (planId) => set({ planId: savePlanId(planId) }),

  setUpgradeDialogOpen: (open) => set({ upgradeDialogOpen: !!open }),

  // -- M7: version history -------------------------------------------------

  /** Replace the version list (shell load path). Exits any preview â€”
   *  the previewed version may belong to the previous file. */
  setVersions: (versions) =>
    set({
      versions: Array.isArray(versions) ? versions : [],
      previewVersionId: null,
    }),

  setHistoryPanelOpen: (open) => set({ historyPanelOpen: !!open }),

  /** Manual "Save current version" (History panel). Returns the id. */
  addVersion: (name) => {
    const s = get();
    const version = makeVersion(s.doc, {
      name: name ?? null,
      auto: false,
      authorName: s.identity?.name ?? "You",
      now: Date.now(),
    });
    set({
      versions: pruneVersions(
        [version, ...s.versions],
        effectiveVersionCap(s.planId),
      ),
    });
    return version.id;
  },

  /**
   * Automatic snapshot, driven by the shell's autosave seam (it checks
   * versions.shouldAutoVersion before calling). File-level only: no
   * doc change, no history entry, no collab broadcast.
   */
  addAutoVersion: () => {
    const s = get();
    const version = makeVersion(s.doc, {
      name: null,
      auto: true,
      authorName: s.identity?.name ?? "You",
      now: Date.now(),
    });
    set({
      versions: pruneVersions(
        [version, ...s.versions],
        effectiveVersionCap(s.planId),
      ),
    });
    return version.id;
  },

  /** Rename a version (panel inline edit; manual versions only there). */
  renameVersion: (id, name) => {
    const s = get();
    const trimmed = typeof name === "string" ? name.trim() : "";
    set({
      versions: s.versions.map((v) =>
        v.id === id ? { ...v, name: trimmed || null } : v,
      ),
    });
  },

  /** Delete a version; deleting the previewed one exits the preview. */
  deleteVersion: (id) => {
    const s = get();
    set({
      versions: s.versions.filter((v) => v.id !== id),
      previewVersionId: s.previewVersionId === id ? null : s.previewVersionId,
    });
  },

  /**
   * Enter/exit the read-only preview. Entering clears the selection
   * and every transient editing state (text edit, anchor edit, comment
   * draft/thread) so nothing on screen pretends the snapshot is live.
   */
  setPreviewVersion: (id) => {
    const s = get();
    if (id != null && !s.versions.some((v) => v.id === id)) return;
    set({
      previewVersionId: id ?? null,
      selection: [],
      editingTextId: null,
      editingPathId: null,
      selectedAnchorIndex: null,
      activeCommentId: null,
      commentDraft: null,
    });
  },

  /**
   * Restore a version. Three deliberate properties:
   * 1. A safety auto version of the CURRENT doc ("Before restore") is
   *    appended first â€” restoring is never the only way back.
   * 2. The snapshot is applied as a NORMAL history commit (the
   *    pre-restore doc goes onto the undo stack), so the restore is
   *    itself undoable with Ctrl+Z and the collab subscription
   *    broadcasts it as an ordinary local change â€” this deliberately
   *    does NOT route through applyRemoteDoc.
   * 3. Any preview exits; the editor is live again on the restored doc.
   */
  restoreVersion: (id) => {
    const s = get();
    const version = s.versions.find((v) => v.id === id);
    if (!version || !version.snapshot) return;
    const restored = structuredClone(version.snapshot);
    if (!Array.isArray(restored.comments)) restored.comments = [];
    if (!restored.assets || typeof restored.assets !== "object") {
      restored.assets = {};
    }
    const safety = makeVersion(s.doc, {
      name: "Before restore",
      auto: true,
      authorName: s.identity?.name ?? "You",
      now: Date.now(),
    });
    commitDocHistory(get, set);
    set({
      doc: restored,
      versions: pruneVersions(
        [safety, ...s.versions],
        effectiveVersionCap(s.planId),
      ),
      previewVersionId: null,
      ...afterDocReplace(restored, s),
    });
    get().showToast({
      message: `Restored version '${versionTitle(version)}' â€” Undo to revert`,
      duration: 6000,
    });
  },

  /** Rename the file. History-EXEMPT (a meta change, not a doc edit). */
  setFileTitle: (title) => {
    const { doc } = get();
    // M7: while previewing a version the title input is disabled; this
    // guard keeps the invariant at the store level too.
    if (get().previewVersionId) return;
    if (doc.title === title) return;
    set({ doc: { ...doc, title } });
  },

  // -- M3: undo / redo -----------------------------------------------------------

  /**
   * Push a snapshot captured BEFORE a drag gesture began (Viewport move /
   * resize streams mutate transiently and commit once, here, at the end).
   */
  commitSnapshot: (snapshot) => {
    const s = get();
    set({ history: applyCommit(s.history, makeEntry(snapshot, null)) });
  },

  undo: () => {
    const s = get();
    if (s.history.past.length === 0) return;
    const past = [...s.history.past];
    const entry = past.pop();
    const future = pushHistory(
      s.history.future,
      makeEntry(structuredClone(s.doc), null),
      HISTORY_CAP,
    );
    const doc = structuredClone(entry.doc);
    set({ doc, history: { past, future }, ...afterDocReplace(doc, s) });
  },

  redo: () => {
    const s = get();
    if (s.history.future.length === 0) return;
    const future = [...s.history.future];
    const entry = future.pop();
    const past = pushHistory(
      s.history.past,
      makeEntry(structuredClone(s.doc), null),
      HISTORY_CAP,
    );
    const doc = structuredClone(entry.doc);
    set({ doc, history: { past, future }, ...afterDocReplace(doc, s) });
  },

  // -- M3: toasts ------------------------------------------------------------------

  showToast: (toast) =>
    set({ toast: { id: toastSeq++, duration: 4000, ...toast } }),

  dismissToast: (id) => {
    const s = get();
    if (!id || s.toast?.id === id) set({ toast: null });
  },

  // -- M3: pages ---------------------------------------------------------------------

  /** Add a page and switch to it (one history entry). */
  addPage: () => {
    const { doc } = get();
    commitDocHistory(get, set);
    const page = {
      id: uniqueId("page"),
      name: `Page ${doc.pages.length + 1}`,
      background: "#EEEEEE",
      rootNodeIds: [],
    };
    set({
      doc: { ...doc, pages: [...doc.pages, page] },
      activePageId: page.id,
      selection: [],
    });
  },

  /** Rename a page (one history entry). */
  renamePage: (id, name) => {
    const { doc } = get();
    const page = doc.pages.find((p) => p.id === id);
    if (!page || page.name === name) return;
    commitDocHistory(get, set);
    set({
      doc: {
        ...doc,
        pages: doc.pages.map((p) => (p.id === id ? { ...p, name } : p)),
      },
    });
  },

  /** Set a page's background colour (one history entry). */
  setPageBackground: (id, background) => {
    const { doc } = get();
    const page = doc.pages.find((p) => p.id === id);
    if (!page || page.background === background) return;
    commitDocHistory(get, set);
    set({
      doc: {
        ...doc,
        pages: doc.pages.map((p) => (p.id === id ? { ...p, background } : p)),
      },
    });
  },

  /** Delete a page (one history entry). */
  deletePage: (id) => {
    const { doc, activePageId } = get();
    const actualPages = (doc.pages || []).filter((p) => !p.isDivider);
    if (actualPages.length <= 1) {
      get().showToast({ message: "Cannot delete the only page" });
      return false;
    }
    const pageToDelete = doc.pages.find((p) => p.id === id);
    if (!pageToDelete || pageToDelete.isDivider) return false;

    commitDocHistory(get, set);
    const nextPages = doc.pages.filter((p) => p.id !== id);
    let nextActiveId = activePageId;
    if (activePageId === id) {
      const remainingValid = nextPages.find((p) => !p.isDivider);
      nextActiveId = remainingValid ? remainingValid.id : nextPages[0]?.id;
    }

    set({
      doc: { ...doc, pages: nextPages },
      activePageId: nextActiveId,
      selection: activePageId === id ? [] : get().selection,
    });
    get().showToast({ message: `Deleted page "${pageToDelete.name}"` });
    return true;
  },

  /** Set a page's custom icon (one history entry). */
  setPageIcon: (id, icon) => {
    const { doc } = get();
    const page = doc.pages.find((p) => p.id === id);
    if (!page || page.icon === icon) return;
    commitDocHistory(get, set);
    set({
      doc: {
        ...doc,
        pages: doc.pages.map((p) => (p.id === id ? { ...p, icon } : p)),
      },
    });
  },

  /** Add a divider below a page in the pages list. */
  addDivider: (afterPageId) => {
    const { doc } = get();
    commitDocHistory(get, set);
    const divider = {
      id: uniqueId("divider"),
      isDivider: true,
      name: "Divider",
      rootNodeIds: [],
    };
    const idx = doc.pages.findIndex((p) => p.id === afterPageId);
    const nextPages = [...doc.pages];
    if (idx !== -1) {
      nextPages.splice(idx + 1, 0, divider);
    } else {
      nextPages.push(divider);
    }
    set({
      doc: { ...doc, pages: nextPages },
    });
    get().showToast({ message: "Divider added" });
  },

  /** Delete a divider from the pages list. */
  deleteDivider: (id) => {
    const { doc } = get();
    commitDocHistory(get, set);
    set({
      doc: {
        ...doc,
        pages: doc.pages.filter((p) => p.id !== id),
      },
    });
  },

  // -- M3: comments --------------------------------------------------------------------

  setActiveCommentId: (id) => set({ activeCommentId: id }),
  setCommentDraft: (draft) => set({ commentDraft: draft }),
  setCommentsPanelOpen: (open) => set({ commentsPanelOpen: open }),
  setShowResolvedComments: (show) => set({ showResolvedComments: show }),

  /** Create a comment thread at a page point with its first message. */
  addComment: ({ pageId, x, y, text, nodeId = null, relX = null, relY = null }) => {
    const { doc } = get();
    commitDocHistory(get, set);
    const comment = {
      id: uniqueId("comment"),
      pageId,
      x,
      y,
      nodeId,
      relX,
      relY,
      resolved: false,
      createdAt: new Date().toISOString(),
      messages: [
        {
          id: uniqueId("msg"),
          author: "You",
          text,
          ts: new Date().toISOString(),
        },
      ],
    };
    set({
      doc: { ...doc, comments: [...(doc.comments ?? []), comment] },
      activeCommentId: comment.id,
      commentDraft: null,
    });
    return comment.id;
  },

  /** Append a message to a thread (one history entry). */
  addCommentMessage: (commentId, text) => {
    const { doc } = get();
    if (!(doc.comments ?? []).some((c) => c.id === commentId)) return;
    commitDocHistory(get, set);
    set({
      doc: {
        ...doc,
        comments: doc.comments.map((c) =>
          c.id === commentId
            ? {
              ...c,
              messages: [
                ...c.messages,
                {
                  id: uniqueId("msg"),
                  author: "You",
                  text,
                  ts: new Date().toISOString(),
                },
              ],
            }
            : c,
        ),
      },
    });
  },

  /** Resolve a thread (one history entry; the toast's Undo reverses it). */
  resolveComment: (commentId) => {
    commitDocHistory(get, set);
    get().setCommentResolved(commentId, true);
  },

  /** Raw resolved-flag setter WITHOUT a history entry (toast Undo path). */
  setCommentResolved: (commentId, resolved) => {
    const { doc } = get();
    set({
      doc: {
        ...doc,
        comments: (doc.comments ?? []).map((c) =>
          c.id === commentId ? { ...c, resolved } : c,
        ),
      },
    });
  },

  deleteComment: (commentId) => {
    const { doc, activeCommentId } = get();
    commitDocHistory(get, set);
    set({
      doc: {
        ...doc,
        comments: (doc.comments ?? []).filter((c) => c.id !== commentId),
      },
      activeCommentId: activeCommentId === commentId ? null : activeCommentId,
    });
  },

  updateCommentMessage: (commentId, messageId, newText) => {
    const { doc } = get();
    commitDocHistory(get, set);
    set({
      doc: {
        ...doc,
        comments: (doc.comments ?? []).map((c) => {
          if (c.id !== commentId) return c;
          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === messageId ? { ...m, text: newText, updatedAt: new Date().toISOString() } : m
            ),
          };
        }),
      },
    });
  },

  deleteCommentMessage: (commentId, messageId) => {
    const { doc, activeCommentId } = get();
    commitDocHistory(get, set);
    const comment = (doc.comments ?? []).find((c) => c.id === commentId);
    if (!comment) return;
    const remainingMessages = comment.messages.filter((m) => m.id !== messageId);
    if (!remainingMessages.length) {
      set({
        doc: {
          ...doc,
          comments: (doc.comments ?? []).filter((c) => c.id !== commentId),
        },
        activeCommentId: activeCommentId === commentId ? null : activeCommentId,
      });
      return;
    }
    set({
      doc: {
        ...doc,
        comments: doc.comments.map((c) =>
          c.id === commentId ? { ...c, messages: remainingMessages } : c
        ),
      },
    });
  },

  resolveAllComments: () => {
    const { doc } = get();
    commitDocHistory(get, set);
    set({
      doc: {
        ...doc,
        comments: (doc.comments ?? []).map((c) => ({ ...c, resolved: true })),
      },
    });
  },

  reopenAllComments: () => {
    const { doc } = get();
    commitDocHistory(get, set);
    set({
      doc: {
        ...doc,
        comments: (doc.comments ?? []).map((c) => ({ ...c, resolved: false })),
      },
    });
  },

  // -- selection -----------------------------------------------------------
  setSelection: (ids) =>
    set((s) => ({
      selection: ids,
      ...(s.uiMode === "hidden" && Array.isArray(ids) && ids.length > 0
        ? { uiMode: "collapsed" }
        : {}),
    })),
  toggleInSelection: (id) =>
    set((s) => {
      const next = s.selection.includes(id)
        ? s.selection.filter((x) => x !== id)
        : [...s.selection, id];
      return {
        selection: next,
        ...(s.uiMode === "hidden" && next.length > 0
          ? { uiMode: "collapsed" }
          : {}),
      };
    }),
  /** Escape: step a single selection out to its parent, else clear. */
  escapeSelection: () => {
    const { selection, doc } = get();
    if (selection.length === 1) {
      const node = doc.nodes[selection[0]];
      if (node?.parentId) {
        set({ selection: [node.parentId] });
        return;
      }
    }
    set({ selection: [] });
  },

  // -- node mutation ---------------------------------------------------------
  /** Move the effective selection roots by (dx, dy) canvas units.
   *  In-flow flex children are skipped (their position is automatic).
   *  This is the NUDGE path (arrow keys): commits coalesce per selection,
   *  so a burst of nudges is one undo step (Phase 3 Ã‚Â§14). Drag-move uses
   *  setNodePositions + commitSnapshot instead. */
  moveSelectionBy: (dx, dy) => {
    const { doc, selection } = get();
    if (selection.length === 0 || (dx === 0 && dy === 0)) return;
    const roots = selectionRoots(doc.nodes, selection);
    const movable = roots.filter((id) => {
      const n = doc.nodes[id];
      const parent = n.parentId ? doc.nodes[n.parentId] : null;
      return !(parent?.layout?.mode === "flex" && !n?.position?.absolute);
    });
    if (movable.length === 0) return;
    commitDocHistory(get, set, `nudge:${movable.join(",")}`);
    const nodes = { ...doc.nodes };
    for (const id of movable) {
      const n = nodes[id];
      nodes[id] = {
        ...n,
        position: {
          ...(n.position || {}),
          x: (n.position?.x ?? n.x ?? 0) + dx,
          y: (n.position?.y ?? n.y ?? 0) + dy,
        },
        x: (n.x ?? n.position?.x ?? 0) + dx,
        y: (n.y ?? n.position?.y ?? 0) + dy,
      };
    }
    const isMovedOrDescendant = (nodeId) => {
      let cur = nodeId;
      while (cur) {
        if (movable.includes(cur)) return true;
        cur = nodes[cur]?.parentId;
      }
      return false;
    };
    const updatedComments = (doc.comments ?? []).map((c) => {
      if (c.nodeId && isMovedOrDescendant(c.nodeId)) {
        return { ...c, x: c.x + dx, y: c.y + dy };
      }
      return c;
    });
    set({ doc: { ...doc, nodes, comments: updatedComments } });
  },

  /**
   * Reorder a node among its siblings (depth-gap batch). parentId null
   * = the active page's root list. `insertIndex` is in the
   * without-the-child space (lib/flex.js). ONE history entry; a
   * position-preserving drop commits nothing. Used directly by the
   * Layers panel; the canvas flex-reorder drag uses the transient
   * variant below + commitSnapshot, like the other drag streams.
   */
  reorderChild: (parentId, childId, insertIndex) => {
    const { doc, activePageId } = get();
    const next = structuredClone(doc);
    if (!applyReorder(next, parentId, activePageId, childId, insertIndex)) {
      return;
    }
    commitDocHistory(get, set);
    set({ doc: next });
  },

  /** reorderChild WITHOUT a history commit (canvas drag streams
   *  commit their pre-gesture snapshot once, at pointer-up). */
  reorderChildTransient: (parentId, childId, insertIndex) => {
    const { doc, activePageId } = get();
    const next = structuredClone(doc);
    if (!applyReorder(next, parentId, activePageId, childId, insertIndex)) {
      return;
    }
    set({ doc: next });
  },

  /**
   * Core engine for reparenting a node between containers or to canvas root.
   * Enforces:
   * 1. Cycle prevention (cannot reparent to descendant)
   * 2. Visual position preservation (canvas coordinates -> local coordinates conversion)
   * 3. Fill constraint adaptation (converting Fill -> Auto/Fit/Fixed when moving to canvas root
   *    or freeform frame, retaining Fill when moving into flex/grid parent)
   * 4. Proper sibling insertion (preserving order at insertIndex or top/bottom)
   */

  /** Reparent a single node with history commit */
  reparentNode: (id, newParentId, newPosition = null, insertIndex = null, nRect = null) => {
    const { doc, activePageId } = get();
    const node = doc.nodes[id];
    if (!node) return;
    if (newParentId) {
      const descendants = subtreeIds(doc.nodes, id);
      if (descendants.includes(newParentId)) return;
    }
    commitDocHistory(get, set);
    const next = structuredClone(doc);
    applyReparentToDoc(next, { id, newParentId, newPosition, insertIndex, nRect }, activePageId);
    set({ doc: next, selection: [id] });
  },

  /** Reparent a single node transiently (without history commit) */
  reparentNodeTransient: (id, newParentId, newPosition = null, insertIndex = null, nRect = null) => {
    const { doc, activePageId } = get();
    const node = doc.nodes[id];
    if (!node) return;
    if (newParentId) {
      const descendants = subtreeIds(doc.nodes, id);
      if (descendants.includes(newParentId)) return;
    }
    const next = structuredClone(doc);
    applyReparentToDoc(next, { id, newParentId, newPosition, insertIndex, nRect }, activePageId);
    set({ doc: next, selection: [id] });
  },

  /** Reparent multiple nodes transiently (without history commit) */
  reparentNodesTransient: (reparents) => {
    const { doc, activePageId } = get();
    const next = structuredClone(doc);
    for (const item of reparents) {
      applyReparentToDoc(next, item, activePageId);
    }
    set({ doc: next });
  },

  /** Set positions for many nodes at once: Map(id -> {x, y}) parent-relative. */
  setNodePositions: (positions) => {
    const { doc } = get();
    const nodes = { ...doc.nodes };
    for (const [id, pos] of positions) {
      if (nodes[id]) {
        const rawX = Number(pos.x);
        const rawY = Number(pos.y);
        const safeX = Number.isFinite(rawX) ? rawX : (Number.isFinite(Number(nodes[id].position?.x)) ? Number(nodes[id].position.x) : 0);
        const safeY = Number.isFinite(rawY) ? rawY : (Number.isFinite(Number(nodes[id].position?.y)) ? Number(nodes[id].position.y) : 0);
        nodes[id] = {
          ...nodes[id],
          x: safeX,
          y: safeY,
          position: { ...nodes[id].position, ...pos, x: safeX, y: safeY },
        };
      }
    }
    const movedIds = new Set(positions.keys());
    const isMovedOrDescendant = (nodeId) => {
      let cur = nodeId;
      while (cur) {
        if (movedIds.has(cur)) return true;
        cur = nodes[cur]?.parentId;
      }
      return false;
    };
    let commentsChanged = false;
    const updatedComments = (doc.comments ?? []).map((c) => {
      if (c.nodeId && nodes[c.nodeId] && c.relX != null && c.relY != null && isMovedOrDescendant(c.nodeId)) {
        let cur = nodes[c.nodeId];
        let absX = Number(cur.position?.x ?? cur.x ?? 0);
        let absY = Number(cur.position?.y ?? cur.y ?? 0);
        while (cur.parentId && nodes[cur.parentId]) {
          cur = nodes[cur.parentId];
          absX += Number(cur.position?.x ?? cur.x ?? 0);
          absY += Number(cur.position?.y ?? cur.y ?? 0);
        }
        const nextX = Math.round(absX + c.relX);
        const nextY = Math.round(absY + c.relY);
        if (nextX !== c.x || nextY !== c.y) {
          commentsChanged = true;
          return { ...c, x: nextX, y: nextY };
        }
      }
      return c;
    });

    set({
      doc: {
        ...doc,
        nodes,
        ...(commentsChanged ? { comments: updatedComments } : {}),
      },
    });
  },

  /** Organize frames cleanly along top alignment with uniform 80px gap (Figma/Paper style). */
  organizeFrames: (targetFrameIds = null) => {
    const { doc, activePageId, selection } = get();
    const page = doc.pages.find((p) => p.id === activePageId);
    const rootIds = page?.rootNodeIds || [];
    let rootFrames = rootIds
      .map((id) => doc.nodes[id])
      .filter((n) => n && n.type === "frame" && !n.hidden && n.visible !== false);

    if (rootFrames.length === 0) {
      rootFrames = Object.values(doc.nodes || {}).filter(
        (n) => n && n.type === "frame" && !n.parentId && !n.hidden && n.visible !== false
      );
    }

    let targets = [];
    if (Array.isArray(targetFrameIds) && targetFrameIds.length >= 2) {
      targets = targetFrameIds.map((id) => doc.nodes[id]).filter(Boolean);
    } else if (Array.isArray(selection) && selection.length >= 2) {
      const selFrames = selection.map((id) => doc.nodes[id]).filter((n) => n && n.type === "frame");
      if (selFrames.length >= 2) targets = selFrames;
    }

    if (targets.length < 2) {
      targets = rootFrames;
    }

    if (targets.length < 2) {
      get().showToast?.({ message: "Need at least 2 frames to organize" });
      return;
    }

    commitDocHistory(get, set);

    const getFrameX = (f) => {
      const x = Number(f.position?.x ?? f.x ?? 0);
      return Number.isFinite(x) ? x : 0;
    };
    const getFrameY = (f) => {
      const y = Number(f.position?.y ?? f.y ?? 0);
      return Number.isFinite(y) ? y : 0;
    };
    const getFrameW = (f) => {
      if (typeof f.size?.w?.px === "number" && f.size.w.px > 0) return f.size.w.px;
      if (typeof f.size?.w === "number" && f.size.w > 0) return f.size.w;
      if (typeof f.layout?.prevSize?.w?.px === "number" && f.layout.prevSize.w.px > 0) return f.layout.prevSize.w.px;
      return 100;
    };

    // Sort horizontally from left to right by current X
    const sorted = [...targets].sort((a, b) => getFrameX(a) - getFrameX(b));

    // Align with the top Y of the highest frame in the group
    const topY = Math.min(...sorted.map(getFrameY));
    const startX = getFrameX(sorted[0]);
    const gap = 80;

    let curX = startX;
    const positions = new Map();
    for (const frame of sorted) {
      const w = getFrameW(frame);
      positions.set(frame.id, { x: curX, y: topY });
      curX += w + gap;
    }

    get().setNodePositions(positions);
    get().showToast?.({ message: `Organized ${sorted.length} frames (80px gap)` });
  },

  /** Parent-relative position (Inspector X/Y â€” a discrete commit). */
  setNodePosition: (id, x, y) => {
    const node = get().doc.nodes[id];
    if (!node) return;
    commitDocHistory(get, set);
    get().setNodePositions(new Map([[id, { ...node.position, x, y }]]));
  },

  /** Fixed pixel size (Inspector W/H and resize commits). */
  setNodeSize: (id, w, h) => {
    const { doc } = get();
    const n = doc.nodes[id];
    if (!n) return;
    commitDocHistory(get, set);
    set({
      doc: {
        ...doc,
        nodes: {
          ...doc.nodes,
          [id]: {
            ...n,
            size: {
              w: { kind: "fixed", px: Math.max(1, w) },
              h: { kind: "fixed", px: Math.max(1, h) },
            },
          },
        },
      },
    });
  },

  /** Set ONE axis of a node's size to a fixed px value (Inspector W or H). */
  setNodeSizeAxis: (id, axis, px) => {
    const { doc } = get();
    const n = doc.nodes[id];
    if (!n) return;
    commitDocHistory(get, set);
    set({
      doc: {
        ...doc,
        nodes: {
          ...doc.nodes,
          [id]: {
            ...n,
            size: {
              ...n.size,
              [axis]: { kind: "fixed", px: Math.max(1, px) },
            },
          },
        },
      },
    });
  },

  /** Set a node's rect from CANVAS-space coords (resize handles). */
  setNodeCanvasRect: (id, rect, handle = null, startSnapshot = null, startRect = null) => {
    const { doc } = get();
    const n = doc.nodes[id];
    if (!n) return;
    const parent = n.parentId ? doc.nodes[n.parentId] : null;
    const isFlexChild = parent?.layout?.mode === "flex" && !n.position?.absolute;
    const parentOrigin = n.parentId
      ? absoluteOrigin(doc.nodes, n.parentId)
      : { x: 0, y: 0 };

    const isText = n.type === "text";
    const affectsW = !handle || handle.includes("e") || handle.includes("w");
    const affectsH = !handle || handle.includes("n") || handle.includes("s");

    const newSizeW = affectsW || isText
      ? { kind: "fixed", px: Math.round(Math.max(1, rect.w)) }
      : (n.size?.w?.kind === "fixed" && n.size.w.px ? n.size.w : { kind: "fixed", px: Math.round(Math.max(1, rect.w)) });
    const newSizeH = affectsH || isText
      ? { kind: "fixed", px: Math.round(Math.max(1, rect.h)) }
      : (n.size?.h?.kind === "fixed" && n.size.h.px ? n.size.h : { kind: "fixed", px: Math.round(Math.max(1, rect.h)) });

    const newPos = isFlexChild
      ? n.position
      : {
        ...(n.position ?? {}),
        x: Math.round(rect.x - parentOrigin.x),
        y: Math.round(rect.y - parentOrigin.y),
      };

    const baseParent = startSnapshot?.nodes?.[id] || n;
    const oldW = (startRect?.w != null && Number.isFinite(Number(startRect.w)))
      ? Math.round(Number(startRect.w))
      : Number.isFinite(Number(baseParent.size?.w?.px))
      ? Number(baseParent.size.w.px)
      : Number.isFinite(Number(baseParent.w))
      ? Number(baseParent.w)
      : Math.round(rect.w);

    const oldH = (startRect?.h != null && Number.isFinite(Number(startRect.h)))
      ? Math.round(Number(startRect.h))
      : Number.isFinite(Number(baseParent.size?.h?.px))
      ? Number(baseParent.size.h.px)
      : Number.isFinite(Number(baseParent.h))
      ? Number(baseParent.h)
      : Math.round(rect.h);

    const finalW = newSizeW.px ?? Math.round(rect.w);
    const finalH = newSizeH.px ?? Math.round(rect.h);

    let nodes = {
      ...doc.nodes,
      [id]: {
        ...n,
        position: newPos,
        x: newPos?.x ?? n.x,
        y: newPos?.y ?? n.y,
        size: {
          w: newSizeW,
          h: newSizeH,
        },
        w: finalW,
        h: finalH,
        ...(isText ? { text: { ...n.text, wrap: "wrap" } } : {}),
      },
    };

    // Apply constraints to direct children
    if (n.childIds && n.childIds.length > 0) {
      nodes = applyConstraintsToChildren(
        nodes,
        id,
        oldW,
        oldH,
        newSizeW.px,
        newSizeH.px,
        startSnapshot?.nodes
      );
    }

    set({ doc: { ...doc, nodes } });
  },

  /** Add a node (built by createNode) and select it. Optionally adopts existing children. */
  addNode: (node, adoptedChildren = []) => {
    const { doc, activePageId } = get();
    commitDocHistory(get, set);
    const next = structuredClone(doc);
    attach(next, activePageId, structuredClone(node));
    if (Array.isArray(adoptedChildren) && adoptedChildren.length > 0) {
      const frameNode = next.nodes[node.id];
      if (frameNode) {
        frameNode.childIds = frameNode.childIds || [];
        for (const item of adoptedChildren) {
          const childId = typeof item === "string" ? item : item?.id;
          if (!childId || !next.nodes[childId] || childId === node.id) continue;
          detach(next, childId);
          const childNode = next.nodes[childId];
          childNode.parentId = node.id;
          if (
            typeof item === "object" &&
            item !== null &&
            typeof item.x === "number" &&
            typeof item.y === "number"
          ) {
            childNode.position = {
              ...(childNode.position || {}),
              x: item.x,
              y: item.y,
              absolute: true,
            };
          }
          if (!frameNode.childIds.includes(childId)) {
            frameNode.childIds.push(childId);
          }
        }
      }
    }
    set({ doc: next, selection: [node.id] });
  },

  /** Add an SVG container node along with its child Path nodes in a single history transaction. */
  addSvgTree: (svgNode, pathNodes = []) => {
    const { doc, activePageId } = get();
    commitDocHistory(get, set);
    const next = structuredClone(doc);
    attach(next, activePageId, structuredClone(svgNode));
    for (const p of pathNodes) {
      next.nodes[p.id] = structuredClone(p);
    }
    set({ doc: next, selection: [svgNode.id] });
  },

  // -- M4: path drawing / anchor editing --------------------------------------
  // Like the M3 drag streams, pen drawing and anchor drags are transient:
  // the Viewport captures a pre-gesture snapshot and commits it ONCE via
  // commitSnapshot when the gesture (or the whole pen drawing) finishes.

  /** addNode WITHOUT a history commit (pen tool's first click). */
  addNodeTransient: (node) => {
    const { doc, activePageId } = get();
    const next = structuredClone(doc);
    attach(next, activePageId, structuredClone(node));
    set({ doc: next, selection: [node.id] });
  },

  /** Remove a node + subtree WITHOUT a history commit (discards a
   *  degenerate pen path â€” fewer than 2 anchors â€” before it ever
   *  entered history). */
  removeNodeTransient: (id) => {
    const { doc, selection } = get();
    if (!doc.nodes[id]) return;
    const next = structuredClone(doc);
    detach(next, id);
    for (const sub of subtreeIds(next.nodes, id)) delete next.nodes[sub];
    set({ doc: next, selection: selection.filter((s) => s !== id) });
  },

  /**
   * Replace a path node's geometry from CANVAS-space anchors (the pen
   * tool and the anchor editor both work in canvas space). Converts to
   * node-local anchors and renormalises: node position/size become the
   * anchors' bounding box. Transient â€” no history commit.
   */
  setPathFromCanvas: (id, anchorsCanvas, closed) => {
    const { doc } = get();
    const n = doc.nodes[id];
    if (!n || n.type !== "path") return;
    const origin = n.parentId
      ? absoluteOrigin(doc.nodes, n.parentId)
      : { x: 0, y: 0 };
    const shift = (p) =>
      p ? { x: p.x - origin.x, y: p.y - origin.y } : null;
    const inParentSpace = anchorsCanvas.map((a) => ({
      x: a.x - origin.x,
      y: a.y - origin.y,
      in: shift(a.in),
      out: shift(a.out),
      smooth: !!a.smooth,
    }));
    const { anchors, offset, size } = normalizeAnchors(inParentSpace);
    set({
      doc: {
        ...doc,
        nodes: {
          ...doc.nodes,
          [id]: {
            ...n,
            path: { anchors, closed },
            position: { ...n.position, x: offset.x, y: offset.y },
            size: {
              w: { kind: "fixed", px: Math.max(1, size.w) },
              h: { kind: "fixed", px: Math.max(1, size.h) },
            },
          },
        },
      },
    });
  },

  /** Alt+click an anchor: toggle smooth/corner (one history entry).
   *  Anchor points don't move, so no renormalisation is needed. */
  togglePathAnchorSmooth: (id, index) => {
    const { doc } = get();
    const n = doc.nodes[id];
    if (!n || n.type !== "path" || !n.path) return;
    const anchors = n.path.anchors;
    const anchor = anchors[index];
    if (!anchor) return;
    commitDocHistory(get, set);
    const closed = n.path.closed;
    let prev = anchors[index - 1] ?? null;
    let next = anchors[index + 1] ?? null;
    if (closed && anchors.length > 1) {
      if (!prev) prev = anchors[anchors.length - 1];
      if (!next) next = anchors[0];
    }
    if (prev === anchor) prev = null;
    if (next === anchor) next = null;
    const updated = toggleAnchorSmooth(anchor, prev, next);
    set({
      doc: {
        ...doc,
        nodes: {
          ...doc.nodes,
          [id]: {
            ...n,
            path: {
              ...n.path,
              anchors: anchors.map((a, i) => (i === index ? updated : a)),
            },
          },
        },
      },
      selectedAnchorIndex: index,
    });
  },

  /** Delete ONE anchor of a path (one history entry). Deleting the last
   *  anchor deletes the node itself and exits anchor-edit mode. */
  deletePathAnchor: (id, index) => {
    const { doc, selection } = get();
    const n = doc.nodes[id];
    if (!n || n.type !== "path" || !n.path) return;
    const remaining = n.path.anchors.filter((_, i) => i !== index);
    if (remaining.length === n.path.anchors.length) return;
    commitDocHistory(get, set);
    if (remaining.length === 0) {
      const next = structuredClone(doc);
      detach(next, id);
      for (const sub of subtreeIds(next.nodes, id)) delete next.nodes[sub];
      set({
        doc: next,
        selection: selection.filter((s) => s !== id),
        editingPathId: null,
        selectedAnchorIndex: null,
      });
      return;
    }
    const { anchors, offset, size } = normalizeAnchors(remaining);
    set({
      doc: {
        ...doc,
        nodes: {
          ...doc.nodes,
          [id]: {
            ...n,
            path: { ...n.path, anchors },
            position: {
              ...n.position,
              x: n.position.x + offset.x,
              y: n.position.y + offset.y,
            },
            size: {
              w: { kind: "fixed", px: Math.max(1, size.w) },
              h: { kind: "fixed", px: Math.max(1, size.h) },
            },
          },
        },
      },
      selectedAnchorIndex: Math.min(index, remaining.length - 1),
    });
  },

  // -- M4: image assets ---------------------------------------------------------

  /**
   * Store an image asset (dataURL) in the doc. NO history commit of its
   * own: the mutation it accompanies (Place image Ã¢â€ â€™ addNode, image fill Ã¢â€ â€™
   * patchNodeStyle) commits a snapshot that already includes the asset,
   * so undo removes the use and merely leaves a harmless orphan asset.
   */
  addAsset: (asset) => {
    const { doc } = get();
    set({
      doc: {
        ...doc,
        assets: { ...(doc.assets ?? {}), [asset.id]: asset.dataUrl },
      },
    });
  },

  /** Delete specific nodes by IDs, subtrees included. */
  deleteNodes: (ids) => {
    if (!ids || ids.length === 0) return;
    const { doc, selection } = get();
    commitDocHistory(get, set);
    const next = structuredClone(doc);
    for (const id of ids) {
      detach(next, id);
      for (const sub of subtreeIds(next.nodes, id)) delete next.nodes[sub];
    }
    const nextSel = selection.filter((sId) => !ids.includes(sId));
    set({ doc: next, selection: nextSel });
  },

  /** Delete the selection, subtrees included. */
  deleteSelection: () => {
    const { doc, selection } = get();
    if (selection.length === 0) return;
    const roots = selectionRoots(doc.nodes, selection);
    if (roots.length === 0) return;
    commitDocHistory(get, set);
    const next = structuredClone(doc);
    for (const id of roots) {
      detach(next, id);
      for (const sub of subtreeIds(next.nodes, id)) delete next.nodes[sub];
    }
    set({ doc: next, selection: [] });
  },

  /** Duplicate the selection placed cleanly outside the original layer. */
  duplicateSelection: () => {
    const { doc, selection, activePageId } = get();
    if (selection.length === 0) return;
    const roots = selectionRoots(doc.nodes, selection);
    if (roots.length === 0) return;
    commitDocHistory(get, set);
    const next = structuredClone(doc);
    const cloneIds = [];
    const page = next.pages.find((p) => p.id === activePageId) || next.pages[0];
    const isMultiRoots = roots.length > 1;

    for (const id of roots) {
      const idMap = new Map();
      const cloneSubtree = (oldId, parentId) => {
        const old = next.nodes[oldId];
        const copy = structuredClone(old);
        copy.id = nextNodeId(next);
        copy.parentId = parentId;
        idMap.set(oldId, copy.id);
        next.nodes[copy.id] = copy;
        copy.childIds = (old.childIds ?? []).map((c) =>
          cloneSubtree(c, copy.id),
        );
        return copy.id;
      };
      const original = next.nodes[id];
      if (!original) continue;
      const rootCloneId = cloneSubtree(id, original.parentId);
      const cloneNode = next.nodes[rootCloneId];

      const origX = Number.isFinite(Number(original.position?.x))
        ? Number(original.position.x)
        : (Number.isFinite(Number(original.x)) ? Number(original.x) : 0);
      const origY = Number.isFinite(Number(original.position?.y))
        ? Number(original.position.y)
        : (Number.isFinite(Number(original.y)) ? Number(original.y) : 0);
      const origW =
        (typeof original.size?.w?.px === "number" ? original.size.w.px : Number(original.size?.w)) ||
        (typeof original.w === "number" ? original.w : 400);

      if (original.parentId) {
        const parentNode = next.nodes[original.parentId];
        const isFlex = parentNode && parentNode.layout?.mode === "flex";
        if (!isFlex) {
          // Absolute / free-form inside parent: offset outside the original
          const targetX = origX + 20;
          const targetY = origY + 20;
          cloneNode.x = targetX;
          cloneNode.y = targetY;
          cloneNode.position = { ...(cloneNode.position || {}), x: targetX, y: targetY };
        }
        // In flex, insertion in siblings automatically arranges it in flow
      } else {
        // Top-level canvas frame/layer
        let targetX = origX + 30;
        let targetY = origY + 30;

        if (!isMultiRoots) {
          // Single top-level frame: place neatly to the right outside original
          const gap = 32;
          targetX = origX + origW + gap;
          targetY = origY;

          const existingRoots = (page?.rootNodeIds || [])
            .filter((rid) => rid !== rootCloneId)
            .map((rid) => next.nodes[rid])
            .filter(Boolean);

          while (
            existingRoots.some(
              (r) =>
                Math.abs((r.position?.x ?? r.x ?? 0) - targetX) < 20 &&
                Math.abs((r.position?.y ?? r.y ?? 0) - targetY) < 20
            )
          ) {
            targetX += origW + gap;
          }
        }

        cloneNode.x = Math.round(targetX);
        cloneNode.y = Math.round(targetY);
        cloneNode.position = {
          ...(cloneNode.position || {}),
          x: Math.round(targetX),
          y: Math.round(targetY),
        };
      }

      // Place the clone directly above the original in stacking order.
      const siblings = original.parentId
        ? next.nodes[original.parentId].childIds
        : page.rootNodeIds;
      siblings.splice(siblings.indexOf(id), 0, rootCloneId);
      cloneIds.push(rootCloneId);
    }
    set({ doc: next, selection: cloneIds });
    get().showToast?.({
      message: `Duplicated ${cloneIds.length} ${cloneIds.length === 1 ? "layer" : "layers"}`,
    });
  },

  /** Align selected nodes against their bounding box */
  alignSelection: (alignment) => {
    const { doc, selection } = get();
    if (selection.length < 2) return;
    const roots = selectionRoots(doc.nodes, selection);
    if (roots.length < 2) return;

    const getNodeRect = (id) => {
      const n = doc.nodes[id];
      if (!n) return null;
      const x = Number.isFinite(Number(n.position?.x))
        ? Number(n.position.x)
        : (Number.isFinite(Number(n.x)) ? Number(n.x) : 0);
      const y = Number.isFinite(Number(n.position?.y))
        ? Number(n.position.y)
        : (Number.isFinite(Number(n.y)) ? Number(n.y) : 0);
      const w =
        (typeof n.size?.w?.px === "number" ? n.size.w.px : Number(n.size?.w)) ||
        (typeof n.w === "number" ? n.w : 100);
      const h =
        (typeof n.size?.h?.px === "number" ? n.size.h.px : Number(n.size?.h)) ||
        (typeof n.h === "number" ? n.h : 100);
      return { id, x, y, w, h };
    };

    const rects = roots.map(getNodeRect).filter(Boolean);
    if (rects.length < 2) return;

    commitDocHistory(get, set);

    const minX = Math.min(...rects.map((r) => r.x));
    const maxX = Math.max(...rects.map((r) => r.x + r.w));
    const minY = Math.min(...rects.map((r) => r.y));
    const maxY = Math.max(...rects.map((r) => r.y + r.h));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const positions = new Map();
    for (const r of rects) {
      let targetX = r.x;
      let targetY = r.y;
      if (alignment === "left") targetX = minX;
      else if (alignment === "center") targetX = Math.round(centerX - r.w / 2);
      else if (alignment === "right") targetX = maxX - r.w;
      else if (alignment === "top") targetY = minY;
      else if (alignment === "middle") targetY = Math.round(centerY - r.h / 2);
      else if (alignment === "bottom") targetY = maxY - r.h;

      positions.set(r.id, { x: targetX, y: targetY });
    }

    get().setNodePositions(positions);
    get().showToast?.({ message: `Aligned ${rects.length} layers to ${alignment}` });
  },

  /** Distribute spacing evenly between selected nodes */
  distributeSelection: (axis) => {
    const { doc, selection } = get();
    const roots = selectionRoots(doc.nodes, selection);
    if (roots.length < 3) {
      get().showToast?.({ message: "Select 3 or more layers to distribute" });
      return;
    }

    const getNodeRect = (id) => {
      const n = doc.nodes[id];
      if (!n) return null;
      const x = Number.isFinite(Number(n.position?.x))
        ? Number(n.position.x)
        : (Number.isFinite(Number(n.x)) ? Number(n.x) : 0);
      const y = Number.isFinite(Number(n.position?.y))
        ? Number(n.position.y)
        : (Number.isFinite(Number(n.y)) ? Number(n.y) : 0);
      const w =
        (typeof n.size?.w?.px === "number" ? n.size.w.px : Number(n.size?.w)) ||
        (typeof n.w === "number" ? n.w : 100);
      const h =
        (typeof n.size?.h?.px === "number" ? n.size.h.px : Number(n.size?.h)) ||
        (typeof n.h === "number" ? n.h : 100);
      return { id, x, y, w, h };
    };

    const rects = roots.map(getNodeRect).filter(Boolean);
    if (rects.length < 3) return;

    commitDocHistory(get, set);
    const positions = new Map();

    if (axis === "horizontal") {
      const sorted = [...rects].sort((a, b) => a.x - b.x);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const totalSpan = last.x + last.w - first.x;
      const totalWidths = sorted.reduce((sum, r) => sum + r.w, 0);
      const totalGapSpace = totalSpan - totalWidths;
      const gap = totalGapSpace / (sorted.length - 1);

      let curX = first.x;
      for (let i = 0; i < sorted.length; i++) {
        const item = sorted[i];
        positions.set(item.id, { x: Math.round(curX), y: item.y });
        curX += item.w + gap;
      }
    } else {
      const sorted = [...rects].sort((a, b) => a.y - b.y);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const totalSpan = last.y + last.h - first.y;
      const totalHeights = sorted.reduce((sum, r) => sum + r.h, 0);
      const totalGapSpace = totalSpan - totalHeights;
      const gap = totalGapSpace / (sorted.length - 1);

      let curY = first.y;
      for (let i = 0; i < sorted.length; i++) {
        const item = sorted[i];
        positions.set(item.id, { x: item.x, y: Math.round(curY) });
        curY += item.h + gap;
      }
    }

    get().setNodePositions(positions);
    get().showToast?.({
      message: `Distributed ${rects.length} layers ${axis === "horizontal" ? "horizontally" : "vertically"}`,
    });
  },

  // -- M2: generic node patching ------------------------------------------------

  /**
   * Shallow-merge top-level keys into a node (position/size/style/Ã¢â‚¬Â¦).
   * This is the choke point for ALL Inspector commits, flex changes,
   * sizing/rotation changes and text-edit commits (they all funnel through
   * patchNodeStyle/Layout/Text Ã¢â€ â€™ patchNode), so history commits here, once.
   * The coalesce key includes the patched top-level keys: a continuous
   * slider drag (style, style, styleÃ¢â‚¬Â¦) merges into one entry, while
   * switching to a different kind of edit starts a new one.
   */
  patchNode: (id, patch) => {
    const { doc } = get();
    const n = doc.nodes[id];
    if (!n) return;
    commitDocHistory(
      get,
      set,
      `patch:${id}:${Object.keys(patch).sort().join(",")}`,
    );
    let nextNodes = { ...doc.nodes, [id]: { ...n, ...patch } };
    if ((patch.size || patch.w != null || patch.h != null) && n.childIds && n.childIds.length > 0) {
      const oldW = Number.isFinite(Number(n.size?.w?.px)) ? Number(n.size.w.px) : (Number(n.w) || 100);
      const oldH = Number.isFinite(Number(n.size?.h?.px)) ? Number(n.size.h.px) : (Number(n.h) || 100);
      const newW = Number.isFinite(Number(patch.size?.w?.px))
        ? Number(patch.size.w.px)
        : Number.isFinite(Number(patch.w))
        ? Number(patch.w)
        : oldW;
      const newH = Number.isFinite(Number(patch.size?.h?.px))
        ? Number(patch.size.h.px)
        : Number.isFinite(Number(patch.h))
        ? Number(patch.h)
        : oldH;
      if (newW !== oldW || newH !== oldH) {
        nextNodes[id] = {
          ...nextNodes[id],
          w: newW,
          h: newH,
        };
        nextNodes = applyConstraintsToChildren(nextNodes, id, oldW, oldH, newW, newH);
      }
    }
    set({
      doc: { ...doc, nodes: nextNodes },
    });
  },

  /** Patch multiple nodes in a single history commit. */
  patchNodes: (updates) => {
    const { doc } = get();
    if (!updates || Object.keys(updates).length === 0) return;
    commitDocHistory(get, set, "patchNodes");
    const nextNodes = { ...doc.nodes };
    for (const [id, patch] of Object.entries(updates)) {
      if (nextNodes[id]) {
        nextNodes[id] = { ...nextNodes[id], ...patch };
      }
    }
    set({ doc: { ...doc, nodes: nextNodes } });
  },

  /** Merge keys into node.style (each style key is replaced wholesale). */
  patchNodeStyle: (id, stylePatch) => {
    const { doc } = get();
    const n = doc.nodes[id];
    if (!n) return;
    get().patchNode(id, { style: { ...(n.style ?? {}), ...stylePatch } });
  },

  /** Merge keys into node.layout. */
  patchNodeLayout: (id, layoutPatch) => {
    const { doc } = get();
    const n = doc.nodes[id];
    if (!n) return;
    get().patchNode(id, { layout: { ...n.layout, ...layoutPatch } });
  },

  /** Merge keys into node.text. */
  patchNodeText: (id, textPatch) => {
    const { doc } = get();
    const n = doc.nodes[id];
    if (!n || !n.text) return;
    const patch = { ...textPatch };
    if (patch.html) {
      patch.html = cleanAndNormalizeHtml(patch.html);
      if (!patch.html || !/<span[^>]*style=/i.test(patch.html)) {
        patch.html = undefined;
      }
    }
    get().patchNode(id, { text: { ...n.text, ...patch } });
  },

  /** Set one axis of a node's size to any Sizing value (M2 dropdowns). */
  setNodeSizing: (id, axis, sizing) => {
    const { doc, viewport } = get();
    const n = doc.nodes[id];
    if (!n) return;
    const existing = n.size?.[axis];

    const hasVisibleChildren = Boolean(
      n.childIds &&
      n.childIds.length > 0 &&
      n.childIds.some((cid) => {
        const c = doc.nodes[cid];
        return c && !c.hidden && c.visible !== false && c.style?.opacity !== 0;
      })
    );

    let liveFitPx = null;
    if (typeof document !== "undefined") {
      const el = document.querySelector(`[data-node-id="${id}"]`);
      if (el) {
        const zoom = viewport?.zoom || 1;
        const rect = el.getBoundingClientRect();
        const measured = Math.round(axis === "w" ? rect.width / zoom : rect.height / zoom);
        if (measured > 0) liveFitPx = measured;
      }
    }

    let resolved = sizing;
    if (sizing.kind === "fit" || sizing.kind === "auto") {
      if (n.type === "text" || (n.type === "frame" && hasVisibleChildren)) {
        // Text or container with content: hug content naturally without hardcoded pixel locks
        resolved = { kind: sizing.kind };
      } else {
        // Empty frame: stay at what w and h currently have
        const px = existing?.px ?? liveFitPx ?? (axis === "w" ? 300 : 200);
        resolved = { ...sizing, px };
      }
    } else if (
      sizing.kind === "fixed" &&
      (sizing.px == null || ((existing?.kind === "fit" || existing?.kind === "auto") && (sizing.px === 100 || !sizing.px)))
    ) {
      // If switching from fit/auto to fixed, preserve the live current fit size
      const px = liveFitPx ?? existing?.px ?? (axis === "w" ? 300 : 200);
      resolved = { ...sizing, px: Math.max(1, px) };
    }
    const modeKey = axis === "w" ? "wMode" : "hMode";
    const modeVal = sizing.kind === "fit" ? "Fit" : sizing.kind === "fill" ? "Fill" : sizing.kind === "auto" ? "Auto" : sizing.kind === "relative" ? "Relative" : "Fixed";
    get().patchNode(id, { size: { ...n.size, [axis]: resolved }, [modeKey]: modeVal });
  },

  setNodeRotation: (id, deg) => get().patchNode(id, { rotation: deg }),

  setNodeTextContent: (id, content) =>
    get().patchNodeText(id, { content }),

  setEditingTextId: (id) => set({ editingTextId: id }),

  // -- M2: flex -----------------------------------------------------------------

  /**
   * "Add flex" (spec, Phase 1 v2.2): direction defaults to COLUMN, the
   * frame's W/H sizing becomes Fit (preserving current px so it doesn't shrink),
   * and padding seeds from existing padding (if any side is set) or defaults to 16px.
   * The pre-flex size is stashed on the layout so "Remove flex" can restore it.
   */
  addFlex: (id) => {
    const { doc, selection } = get();
    const targetIds =
      selection && selection.length > 1 && (!id || selection.includes(id))
        ? selection
        : id
        ? [id]
        : selection;
    if (!targetIds || !targetIds.length) return;

    // Helper: Extract and preserve any existing padding from node.layout, node.padding, node.flex, or styles
    const extractExistingPadding = (node) => {
      if (!node) return null;
      const lp = node.layout?.padding;
      const np = node.padding;
      const fp = node.flex?.padding;
      const sp = node.style?.padding;
      const rawStyle = node.rawStyle;

      const toPx = (v) => {
        if (v === null || v === undefined) return null;
        if (typeof v === "object" && v !== null && "value" in v) return toPx(v.value);
        if (typeof v === "number" && Number.isFinite(v)) return v;
        if (typeof v === "string") {
          const parsed = parseFloat(v);
          if (Number.isFinite(parsed)) return parsed;
        }
        return null;
      };

      let l = toPx(lp?.l ?? lp?.left ?? np?.l ?? np?.left ?? fp?.left ?? fp?.l);
      let t = toPx(lp?.t ?? lp?.top ?? np?.t ?? np?.top ?? fp?.top ?? fp?.t);
      let r = toPx(lp?.r ?? lp?.right ?? np?.r ?? np?.right ?? fp?.right ?? fp?.r);
      let b = toPx(lp?.b ?? lp?.bottom ?? np?.b ?? np?.bottom ?? fp?.bottom ?? fp?.b);
      let h = toPx(lp?.h ?? np?.h);
      let v = toPx(lp?.v ?? np?.v);

      if (rawStyle && typeof rawStyle === "object") {
        if (l === null) l = toPx(rawStyle["padding-left"] ?? rawStyle["padding-inline-start"]);
        if (t === null) t = toPx(rawStyle["padding-top"] ?? rawStyle["padding-block-start"]);
        if (r === null) r = toPx(rawStyle["padding-right"] ?? rawStyle["padding-inline-end"]);
        if (b === null) b = toPx(rawStyle["padding-bottom"] ?? rawStyle["padding-block-end"]);
        if (h === null) h = toPx(rawStyle["padding-inline"]);
        if (v === null) v = toPx(rawStyle["padding-block"]);
        if (typeof rawStyle.padding === "string") {
          const parts = rawStyle.padding.trim().split(/\s+/).map(toPx).filter((num) => num !== null);
          if (parts.length === 1) {
            if (t === null) t = parts[0];
            if (r === null) r = parts[0];
            if (b === null) b = parts[0];
            if (l === null) l = parts[0];
          } else if (parts.length === 2) {
            if (t === null) t = parts[0];
            if (b === null) b = parts[0];
            if (r === null) r = parts[1];
            if (l === null) l = parts[1];
          } else if (parts.length === 4) {
            if (t === null) t = parts[0];
            if (r === null) r = parts[1];
            if (b === null) b = parts[2];
            if (l === null) l = parts[3];
          }
        }
      }

      if (typeof sp === "string") {
        const parts = sp.trim().split(/\s+/).map(toPx).filter((num) => num !== null);
        if (parts.length === 1) {
          if (t === null) t = parts[0];
          if (r === null) r = parts[0];
          if (b === null) b = parts[0];
          if (l === null) l = parts[0];
        } else if (parts.length === 2) {
          if (t === null) t = parts[0];
          if (b === null) b = parts[0];
          if (r === null) r = parts[1];
          if (l === null) l = parts[1];
        } else if (parts.length === 4) {
          if (t === null) t = parts[0];
          if (r === null) r = parts[1];
          if (b === null) b = parts[2];
          if (l === null) l = parts[3];
        }
      }

      const hasAnyPadding = [l, t, r, b, h, v].some((val) => val !== null && val !== undefined);
      if (!hasAnyPadding) return null;

      const effL = l ?? h ?? 0;
      const effT = t ?? v ?? 0;
      const effR = r ?? h ?? 0;
      const effB = b ?? v ?? 0;
      const effH = h ?? (effL === effR ? effL : effL);
      const effV = v ?? (effT === effB ? effT : effT);

      return {
        l: effL,
        t: effT,
        r: effR,
        b: effB,
        h: effH,
        v: effV,
      };
    };

    // If multiple nodes are selected, OR if the selected single node is NOT already a frame:
    // wrap the layer(s) into a new parent Frame with flex layout active!
    // If a single frame is selected: simply activate flex on that frame directly without creating a new parent.
    const isMultiple = targetIds.length > 1;
    const singleNode = !isMultiple ? doc.nodes[targetIds[0]] : null;
    const shouldWrapInParentFrame = isMultiple || (singleNode && singleNode.type !== "frame");

    if (shouldWrapInParentFrame) {
      commitDocHistory(get, set);
      const frameId = `frame_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const targetNodes = targetIds.map((tid) => doc.nodes[tid]).filter(Boolean);
      if (!targetNodes.length) return;

      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

      targetNodes.forEach((n) => {
        let liveW = null,
          liveH = null;
        if (typeof document !== "undefined") {
          const el = document.querySelector(`[data-node-id="${n.id}"]`);
          if (el) {
            const zoom = get().viewport?.zoom || 1;
            const rect = el.getBoundingClientRect();
            const mw = Math.round(rect.width / zoom);
            const mh = Math.round(rect.height / zoom);
            if (mw > 0) liveW = mw;
            if (mh > 0) liveH = mh;
          }
        }
        const nx = n.position?.x ?? n.x ?? 0;
        const ny = n.position?.y ?? n.y ?? 0;
        const nw = liveW ?? n.size?.w?.px ?? n.w ?? 100;
        const nh = liveH ?? n.size?.h?.px ?? n.h ?? 100;
        minX = Math.min(minX, nx);
        minY = Math.min(minY, ny);
        maxX = Math.max(maxX, nx + nw);
        maxY = Math.max(maxY, ny + nh);
      });

      const currentW = Math.max(20, Math.round(maxX - minX));
      const currentH = Math.max(20, Math.round(maxY - minY));
      const firstParentId = targetNodes[0].parentId ?? null;
      const page =
        doc.pages.find((p) => p.id === get().activePageId) || doc.pages[0];

      const existingSinglePadding = targetNodes.length === 1 ? extractExistingPadding(targetNodes[0]) : null;
      const initialPadding = existingSinglePadding || { h: 16, v: 16, l: 16, t: 16, r: 16, b: 16 };

      const newFrame = {
        id: frameId,
        name: "Frame",
        type: "frame",
        parentId: firstParentId,
        childIds: targetIds,
        x: minX,
        y: minY,
        position: { x: minX, y: minY },
        w: currentW,
        h: currentH,
        size: {
          w: { kind: "auto" },
          h: { kind: "auto" },
        },
        layout: {
          mode: "flex",
          direction: "column",
          reverse: false,
          wrap: false,
          gap: 20,
          padding: initialPadding,
          alignMain: "start",
          alignCross: "start",
          prevSize: {
            w: { kind: "fixed", px: currentW },
            h: { kind: "fixed", px: currentH },
          },
        },
        style: {},
        clipContent: firstParentId == null,
      };

      const updatedNodes = {
        ...doc.nodes,
        [frameId]: newFrame,
      };

      targetIds.forEach((tid) => {
        const tn = updatedNodes[tid];
        if (tn) {
          updatedNodes[tid] = {
            ...tn,
            parentId: frameId,
            x: 0,
            y: 0,
            position: { x: 0, y: 0 },
          };
        }
      });

      let updatedPages = doc.pages;
      if (firstParentId) {
        const parentNode = doc.nodes[firstParentId];
        if (parentNode) {
          const idx = parentNode.childIds.indexOf(targetIds[0]);
          const newChildIds = parentNode.childIds.filter((cid) => !targetIds.includes(cid));
          newChildIds.splice(idx >= 0 ? idx : newChildIds.length, 0, frameId);
          updatedNodes[firstParentId] = {
            ...parentNode,
            childIds: newChildIds,
          };
        }
      } else {
        updatedPages = doc.pages.map((p) => {
          if (p.id === page?.id) {
            const idx = p.rootNodeIds.indexOf(targetIds[0]);
            const newRoots = p.rootNodeIds.filter((rid) => !targetIds.includes(rid));
            newRoots.splice(idx >= 0 ? idx : newRoots.length, 0, frameId);
            return {
              ...p,
              rootNodeIds: newRoots,
            };
          }
          return p;
        });
      }

      set({
        doc: {
          ...doc,
          nodes: updatedNodes,
          pages: updatedPages,
        },
        selection: [frameId],
      });
      return;
    }

    // Single frame node: convert the frame itself to flex layout
    const n = doc.nodes[targetIds[0]];
    if (!n) return;

    // Measure live rendered dimensions from DOM so size never jumps
    let liveW = null;
    let liveH = null;
    if (typeof document !== "undefined") {
      const el = document.querySelector(`[data-node-id="${n.id}"]`);
      if (el) {
        const zoom = get().viewport?.zoom || 1;
        const rect = el.getBoundingClientRect();
        const mw = Math.round(rect.width / zoom);
        const mh = Math.round(rect.height / zoom);
        if (mw > 0) liveW = mw;
        if (mh > 0) liveH = mh;
      }
    }

    const currentW = Math.max(1, Math.round(liveW ?? n.size?.w?.px ?? n.w ?? 300));
    const currentH = Math.max(1, Math.round(liveH ?? n.size?.h?.px ?? n.h ?? 200));

    // When clicking flex:
    // - Default padding is 16px (uniform)
    // - Default gap is 20px
    // - Preserve existing fixed or container width and height so frame dimensions never jump or become "fit" unexpectedly
    const existingW = n.size?.w
      ? { ...n.size.w }
      : { kind: "fixed", px: currentW };
    const existingH = n.size?.h
      ? { ...n.size.h }
      : { kind: "fixed", px: currentH };

    commitDocHistory(get, set);

    // Convert eligible children to in-flow flex items
    const childUpdates = {};
    for (const cid of n.childIds || []) {
      const cn = doc.nodes[cid];
      if (cn && !cn.position?.absolute) {
        childUpdates[cid] = {
          position: { absolute: false, x: 0, y: 0 },
          x: 0,
          y: 0,
        };
      }
    }

    const existingPadding = extractExistingPadding(n);
    const padding = existingPadding || {
      h: 16,
      v: 16,
      l: 16,
      t: 16,
      r: 16,
      b: 16,
    };

    get().patchNodes({
      [n.id]: {
        layout: {
          mode: "flex",
          direction: n.layout?.direction || "column",
          reverse: Boolean(n.layout?.reverse),
          wrap: Boolean(n.layout?.wrap),
          gap: typeof n.layout?.gap === "number" ? n.layout.gap : (n.layout?.gap?.value ?? 20),
          padding,
          alignMain: n.layout?.alignMain || "start",
          alignCross: n.layout?.alignCross || "start",
          prevSize: { ...n.size },
        },
        size: {
          w: existingW,
          h: existingH,
        },
      },
      ...childUpdates,
    });
  },

  /**
   * "Remove flex": back to freeform.
   * Frame size and all child positions and sizes are frozen to their exact
   * rendered layout geometry so nothing jumps and user can move layers normally.
   */
  removeFlex: (id) => {
    const { doc } = get();
    const n = doc.nodes[id];
    if (!n || n.layout?.mode !== "flex") return;

    let liveFrameW = null;
    let liveFrameH = null;
    const childUpdates = {};
    const zoom = get().viewport?.zoom || 1;

    if (typeof document !== "undefined") {
      const frameEl = document.querySelector(`[data-node-id="${id}"]`);
      if (frameEl) {
        const frameRect = frameEl.getBoundingClientRect();
        liveFrameW = Math.round(frameRect.width / zoom);
        liveFrameH = Math.round(frameRect.height / zoom);

        for (const childId of n.childIds || []) {
          const childNode = doc.nodes[childId];
          if (!childNode) continue;
          const childEl = document.querySelector(`[data-node-id="${childId}"]`);
          if (childEl) {
            const childRect = childEl.getBoundingClientRect();
            const x = Math.round((childRect.left - frameRect.left) / zoom);
            const y = Math.round((childRect.top - frameRect.top) / zoom);
            const w = Math.round(childRect.width / zoom);
            const h = Math.round(childRect.height / zoom);

            childUpdates[childId] = {
              position: {
                ...(childNode.position ?? {}),
                x,
                y,
                absolute: false,
              },
              size: {
                w: { kind: "fixed", px: Math.max(1, w) },
                h: { kind: "fixed", px: Math.max(1, h) },
              },
            };
          }
        }
      }
    }

    const finalFrameW = liveFrameW ?? (typeof n.size?.w?.px === "number" ? n.size.w.px : 300);
    const finalFrameH = liveFrameH ?? (typeof n.size?.h?.px === "number" ? n.size.h.px : 200);

    const frameUpdate = {
      layout: { mode: "freeform" },
      size: {
        w: { kind: "fixed", px: Math.max(1, finalFrameW) },
        h: { kind: "fixed", px: Math.max(1, finalFrameH) },
      },
    };

    get().patchNodes({
      [id]: frameUpdate,
      ...childUpdates,
    });
  },

  /**
   * "Add grid": enables CSS Grid layout on a frame or wraps selection in a new Grid Frame.
   */
  addGrid: (id) => {
    const { doc, selection } = get();
    const targetIds =
      selection && selection.length > 1 && (!id || selection.includes(id))
        ? selection
        : id
        ? [id]
        : selection;
    if (!targetIds || !targetIds.length) return;

    const isMultiple = targetIds.length > 1;
    const singleNode = !isMultiple ? doc.nodes[targetIds[0]] : null;
    const shouldWrapInParentFrame = isMultiple || (singleNode && singleNode.type !== "frame");

    if (shouldWrapInParentFrame) {
      const targetNodes = targetIds.map((tid) => doc.nodes[tid]).filter(Boolean);
      if (!targetNodes.length) return;
      const firstParentId = targetNodes[0].parentId;
      const parentNode = firstParentId ? doc.nodes[firstParentId] : null;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const tn of targetNodes) {
        const x = tn.position?.x ?? 0;
        const y = tn.position?.y ?? 0;
        const w = tn.size?.w?.px ?? tn.w ?? 100;
        const h = tn.size?.h?.px ?? tn.h ?? 100;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
      }

      const frameW = Math.max(200, maxX - minX);
      const frameH = Math.max(100, maxY - minY);
      const newFrameId = "node-" + Math.random().toString(36).slice(2, 10);
      const newFrame = {
        id: newFrameId,
        type: "frame",
        name: "Grid Frame",
        parentId: firstParentId,
        position: { x: minX, y: minY },
        size: {
          w: { kind: "fixed", px: frameW },
          h: { kind: "fit" },
        },
        childIds: targetIds,
        layout: defaultGrid(),
        style: { fills: [] },
      };

      const childUpdates = {};
      for (const tid of targetIds) {
        childUpdates[tid] = {
          parentId: newFrameId,
          position: { absolute: false, x: 0, y: 0 },
        };
      }

      get().patchNodes({
        [newFrameId]: newFrame,
        ...childUpdates,
      });

      if (parentNode) {
        const nextChildIds = parentNode.childIds.filter((cid) => !targetIds.includes(cid));
        nextChildIds.push(newFrameId);
        get().patchNode(firstParentId, { childIds: nextChildIds });
      }

      get().setSelection([newFrameId]);
    } else {
      const frameNode = doc.nodes[targetIds[0]];
      if (!frameNode) return;
      commitDocHistory(get, set);

      let liveW = null;
      let liveH = null;
      if (typeof document !== "undefined") {
        const el = document.querySelector(`[data-node-id="${frameNode.id}"]`);
        if (el) {
          const zoom = get().viewport?.zoom || 1;
          const rect = el.getBoundingClientRect();
          const mw = Math.round(rect.width / zoom);
          const mh = Math.round(rect.height / zoom);
          if (mw > 0) liveW = mw;
          if (mh > 0) liveH = mh;
        }
      }

      const currentW = Math.max(1, Math.round(liveW ?? frameNode.size?.w?.px ?? frameNode.w ?? 300));
      const currentH = Math.max(1, Math.round(liveH ?? frameNode.size?.h?.px ?? frameNode.h ?? 200));

      const existingW = frameNode.size?.w
        ? { ...frameNode.size.w }
        : { kind: "fixed", px: currentW };
      const existingH = frameNode.size?.h
        ? { ...frameNode.size.h }
        : { kind: "fixed", px: currentH };

      const childUpdates = {};
      for (const cid of frameNode.childIds || []) {
        const cn = doc.nodes[cid];
        if (cn) {
          childUpdates[cid] = {
            position: { absolute: false, x: 0, y: 0 },
            x: 0,
            y: 0,
          };
        }
      }

      const existingGridPadding = extractExistingPadding(frameNode);
      const gridLayout = {
        ...defaultGrid(),
        ...(existingGridPadding ? { padding: existingGridPadding } : {}),
      };

      get().patchNodes({
        [frameNode.id]: {
          layout: gridLayout,
          size: {
            w: existingW,
            h: existingH,
          },
        },
        ...childUpdates,
      });
    }
  },

  /**
   * "Remove grid": back to freeform.
   */
  removeGrid: (id) => {
    const { doc } = get();
    const n = doc.nodes[id];
    if (!n || n.layout?.mode !== "grid") return;

    let liveFrameW = null;
    let liveFrameH = null;
    const childUpdates = {};
    const zoom = get().viewport?.zoom || 1;

    if (typeof document !== "undefined") {
      const frameEl = document.querySelector(`[data-node-id="${id}"]`);
      if (frameEl) {
        const frameRect = frameEl.getBoundingClientRect();
        liveFrameW = Math.round(frameRect.width / zoom);
        liveFrameH = Math.round(frameRect.height / zoom);

        for (const childId of n.childIds || []) {
          const childNode = doc.nodes[childId];
          if (!childNode) continue;
          const childEl = document.querySelector(`[data-node-id="${childId}"]`);
          if (childEl) {
            const childRect = childEl.getBoundingClientRect();
            const x = Math.round((childRect.left - frameRect.left) / zoom);
            const y = Math.round((childRect.top - frameRect.top) / zoom);
            const w = Math.round(childRect.width / zoom);
            const h = Math.round(childRect.height / zoom);

            childUpdates[childId] = {
              position: {
                ...(childNode.position ?? {}),
                x,
                y,
                absolute: false,
              },
              size: {
                w: { kind: "fixed", px: Math.max(1, w) },
                h: { kind: "fixed", px: Math.max(1, h) },
              },
            };
          }
        }
      }
    }

    const finalFrameW = liveFrameW ?? (typeof n.size?.w?.px === "number" ? n.size.w.px : 300);
    const finalFrameH = liveFrameH ?? (typeof n.size?.h?.px === "number" ? n.size.h.px : 200);

    get().patchNodes({
      [id]: {
        layout: { mode: "freeform" },
        size: {
          w: { kind: "fixed", px: Math.max(1, finalFrameW) },
          h: { kind: "fixed", px: Math.max(1, finalFrameH) },
        },
      },
      ...childUpdates,
    });
  },

  // -- M2: tokens ("Theme") -------------------------------------------------------

  /** Append a token ({ type, name, value } or { type, name, aliasOf }). */
  addToken: (data) => {
    const { doc } = get();
    commitDocHistory(get, set);
    const token = { id: nextTokenId(doc), ...data };
    set({ doc: { ...doc, tokens: [...doc.tokens, token] } });
    return token.id;
  },

  /** Merge keys into a token (rename, new value, alias change). */
  updateToken: (id, patch) => {
    const { doc } = get();
    commitDocHistory(get, set, `token:${id}`);
    set({
      doc: {
        ...doc,
        tokens: doc.tokens.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      },
    });
  },

  /**
   * Delete a token. Per spec this is silent and every use AUTO-DETACHES to
   * its resolved literal first (see model.detachToken).
   */
  deleteToken: (id) => {
    const { doc } = get();
    commitDocHistory(get, set);
    const next = structuredClone(doc);
    detachToken(next, id);
    set({ doc: next });
  },

  /** Append our starter theme, skipping token names that already exist. */
  applyStarterTheme: () => {
    const { doc } = get();
    const existing = new Set(doc.tokens.map((t) => t.name));
    const fresh = starterTokens()
      .filter((t) => !existing.has(t.name))
      .map((t) => ({ id: nextTokenId(doc), ...t }));
    if (fresh.length > 0) {
      commitDocHistory(get, set);
      set({ doc: { ...doc, tokens: [...doc.tokens, ...fresh] } });
    }
    return fresh.length;
  },

  // -----------------------------------------------------------------------
  // Align & Distribute (selection-level)
  // -----------------------------------------------------------------------
  /** Align selected root nodes to a common edge/center.
   *  alignment: "left" | "center" | "right" | "top" | "middle" | "bottom" */
  alignNodes: (alignment) => {
    const { doc, selection } = get();
    const roots = selectionRoots(doc.nodes, selection);
    if (roots.length < 2) return;

    const rects = new Map();
    for (const id of roots) {
      const n = doc.nodes[id];
      if (!n) continue;
      const x = Number.isFinite(Number(n.position?.x))
        ? Number(n.position.x)
        : (Number.isFinite(Number(n.x)) ? Number(n.x) : 0);
      const y = Number.isFinite(Number(n.position?.y))
        ? Number(n.position.y)
        : (Number.isFinite(Number(n.y)) ? Number(n.y) : 0);
      const w =
        (typeof n.size?.w?.px === "number" ? n.size.w.px : Number(n.size?.w)) ||
        (typeof n.w === "number" ? n.w : 100);
      const h =
        (typeof n.size?.h?.px === "number" ? n.size.h.px : Number(n.size?.h)) ||
        (typeof n.h === "number" ? n.h : 100);
      let absX = x, absY = y;
      let parent = n.parentId ? doc.nodes[n.parentId] : null;
      while (parent) {
        const px = Number.isFinite(Number(parent.position?.x))
          ? Number(parent.position.x)
          : (Number.isFinite(Number(parent.x)) ? Number(parent.x) : 0);
        const py = Number.isFinite(Number(parent.position?.y))
          ? Number(parent.position.y)
          : (Number.isFinite(Number(parent.y)) ? Number(parent.y) : 0);
        absX += px;
        absY += py;
        parent = parent.parentId ? doc.nodes[parent.parentId] : null;
      }
      rects.set(id, { x: absX, y: absY, w, h });
    }
    if (rects.size < 2) return;

    let ref;
    const values = Array.from(rects.values());
    if (alignment === "left") ref = Math.min(...values.map((r) => r.x));
    else if (alignment === "center") {
      const cx = values.map((r) => r.x + r.w / 2);
      ref = cx.reduce((a, b) => a + b, 0) / cx.length;
    } else if (alignment === "right") ref = Math.max(...values.map((r) => r.x + r.w));
    else if (alignment === "top") ref = Math.min(...values.map((r) => r.y));
    else if (alignment === "middle") {
      const cy = values.map((r) => r.y + r.h / 2);
      ref = cy.reduce((a, b) => a + b, 0) / cy.length;
    } else if (alignment === "bottom") ref = Math.max(...values.map((r) => r.y + r.h));
    else return;

    commitDocHistory(get, set, `align:${alignment}`);
    const positions = new Map();
    for (const id of roots) {
      const r = rects.get(id);
      if (!r) continue;
      const n = doc.nodes[id];
      let parent = n.parentId ? doc.nodes[n.parentId] : null;
      let parentOriginX = 0, parentOriginY = 0;
      while (parent) {
        const px = Number.isFinite(Number(parent.position?.x))
          ? Number(parent.position.x)
          : (Number.isFinite(Number(parent.x)) ? Number(parent.x) : 0);
        const py = Number.isFinite(Number(parent.position?.y))
          ? Number(parent.position.y)
          : (Number.isFinite(Number(parent.y)) ? Number(parent.y) : 0);
        parentOriginX += px;
        parentOriginY += py;
        parent = parent.parentId ? doc.nodes[parent.parentId] : null;
      }
      let nx = r.x, ny = r.y;
      if (alignment === "left") nx = ref;
      else if (alignment === "center") nx = ref - r.w / 2;
      else if (alignment === "right") nx = ref - r.w;
      if (alignment === "top") ny = ref;
      else if (alignment === "middle") ny = ref - r.h / 2;
      else if (alignment === "bottom") ny = ref - r.h;
      positions.set(id, {
        x: Math.round(nx - parentOriginX),
        y: Math.round(ny - parentOriginY),
      });
    }
    get().setNodePositions(positions);
  },

  /** Distribute selected root nodes evenly along an axis.
   *  distribution: "horizontal" | "vertical" */
  distributeNodes: (distribution) => {
    const { doc, selection } = get();
    const roots = selectionRoots(doc.nodes, selection);
    if (roots.length < 3) return;

    const rects = new Map();
    for (const id of roots) {
      const n = doc.nodes[id];
      if (!n) continue;
      const x = Number.isFinite(Number(n.position?.x))
        ? Number(n.position.x)
        : (Number.isFinite(Number(n.x)) ? Number(n.x) : 0);
      const y = Number.isFinite(Number(n.position?.y))
        ? Number(n.position.y)
        : (Number.isFinite(Number(n.y)) ? Number(n.y) : 0);
      const w =
        (typeof n.size?.w?.px === "number" ? n.size.w.px : Number(n.size?.w)) ||
        (typeof n.w === "number" ? n.w : 100);
      const h =
        (typeof n.size?.h?.px === "number" ? n.size.h.px : Number(n.size?.h)) ||
        (typeof n.h === "number" ? n.h : 100);
      let absX = x, absY = y;
      let parent = n.parentId ? doc.nodes[n.parentId] : null;
      while (parent) {
        const px = Number.isFinite(Number(parent.position?.x))
          ? Number(parent.position.x)
          : (Number.isFinite(Number(parent.x)) ? Number(parent.x) : 0);
        const py = Number.isFinite(Number(parent.position?.y))
          ? Number(parent.position.y)
          : (Number.isFinite(Number(parent.y)) ? Number(parent.y) : 0);
        absX += px;
        absY += py;
        parent = parent.parentId ? doc.nodes[parent.parentId] : null;
      }
      rects.set(id, { x: absX, y: absY, w, h });
    }
    if (rects.size < 3) return;

    commitDocHistory(get, set, `distribute:${distribution}`);
    const positions = new Map();

    if (distribution === "horizontal") {
      const sorted = Array.from(rects.entries()).sort((a, b) => a[1].x - b[1].x);
      const first = sorted[0][1];
      const last = sorted[sorted.length - 1][1];
      const totalSpan = last.x + last.w - first.x;
      const totalW = sorted.reduce((sum, [, r]) => sum + r.w, 0);
      const freeSpace = totalSpan - totalW;
      const gap = freeSpace / (sorted.length - 1);
      let cursor = first.x;
      for (const [id, r] of sorted) {
        const n = doc.nodes[id];
        let parent = n.parentId ? doc.nodes[n.parentId] : null;
        let parentOriginX = 0, parentOriginY = 0;
        while (parent) {
          const px = Number.isFinite(Number(parent.position?.x))
            ? Number(parent.position.x)
            : (Number.isFinite(Number(parent.x)) ? Number(parent.x) : 0);
          const py = Number.isFinite(Number(parent.position?.y))
            ? Number(parent.position.y)
            : (Number.isFinite(Number(parent.y)) ? Number(parent.y) : 0);
          parentOriginX += px;
          parentOriginY += py;
          parent = parent.parentId ? doc.nodes[parent.parentId] : null;
        }
        positions.set(id, {
          x: Math.round(cursor - parentOriginX),
          y: Math.round(r.y - parentOriginY),
        });
        cursor += r.w + gap;
      }
    } else if (distribution === "vertical") {
      const sorted = Array.from(rects.entries()).sort((a, b) => a[1].y - b[1].y);
      const first = sorted[0][1];
      const last = sorted[sorted.length - 1][1];
      const totalSpan = last.y + last.h - first.y;
      const totalH = sorted.reduce((sum, [, r]) => sum + r.h, 0);
      const freeSpace = totalSpan - totalH;
      const gap = freeSpace / (sorted.length - 1);
      let cursor = first.y;
      for (const [id, r] of sorted) {
        const n = doc.nodes[id];
        let parent = n.parentId ? doc.nodes[n.parentId] : null;
        let parentOriginX = 0, parentOriginY = 0;
        while (parent) {
          const px = Number.isFinite(Number(parent.position?.x))
            ? Number(parent.position.x)
            : (Number.isFinite(Number(parent.x)) ? Number(parent.x) : 0);
          const py = Number.isFinite(Number(parent.position?.y))
            ? Number(parent.position.y)
            : (Number.isFinite(Number(parent.y)) ? Number(parent.y) : 0);
          parentOriginX += px;
          parentOriginY += py;
          parent = parent.parentId ? doc.nodes[parent.parentId] : null;
        }
        positions.set(id, {
          x: Math.round(r.x - parentOriginX),
          y: Math.round(cursor - parentOriginY),
        });
        cursor += r.h + gap;
      }
    }
    get().setNodePositions(positions);
  },
}));
