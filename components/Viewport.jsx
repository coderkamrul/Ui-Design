"use client";

/**
 * Canvas viewport (M1) — all canvas interaction lives here.
 *
 * Structure: a focusable container (screen space) holding
 *   1. the "world" div — document nodes rendered by CanvasNode under a
 *      translate+scale transform from the store's viewport,
 *   3. a screen-space overlay: selection outlines, the multi-select union
 *      box, 8 resize handles (constant screen size at any zoom), the
 *      marquee box, the creation ghost and the live size pill.
 *
 * Gestures (Phase 3 spec + our decisions where the spec was unobservable):
 * - Pan tool drag, Space+drag, middle-drag; wheel = vertical pan,
 *   Shift+wheel = horizontal pan, Ctrl/Cmd+wheel = zoom to cursor.
 * - Move tool: click select, Shift+click toggle, drag move, marquee from
 *   empty canvas (intersect rule), click empty = deselect.
 * - Frame/Rectangle: drag creates (click without drag = a default size).
 *   A drag starting inside a frame parents the node to that frame.
 * - Text: click creates a 120×24 text node (content editing is M2).
 * - Keys (canvas focused, never while typing in a field): arrows nudge
 *   1px / Shift 8px, Delete, Ctrl+A, Ctrl+D, Escape steps out to parent,
 *   tool letters, Ctrl+= / Ctrl+- zoom steps, Shift+0/1/2 zoom presets.
 * - M7: while a version preview is active, the world renders the
 *   version's snapshot instead of the live doc and the canvas is
 *   read-only — pan/zoom and the hide-UI keys still work, Escape exits
 *   the preview, every editing gesture/key is ignored.
 * - Depth-gap batch: dragging an in-flow flex child is a REORDER drag
 *   (ghost + insertion line, one commit on drop; absolute children
 *   keep the normal move drag); frame line guides can be dragged on
 *   the canvas (6 screen-px hit strip, transient store state, one
 *   commit on drop, double-click deletes); "/" opens cursor chat,
 *   broadcast over the collab transport and shown as a 4 s bubble at
 *   each peer's cursor.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment } from "react";
import CanvasNode from "./CanvasNode";
import {
  NUDGE_LARGE,
  NUDGE_SMALL,
  createNode,
  nextNodeId,
  useEditorStore,
} from "@/lib/store";
import * as G from "@/lib/geometry";
import { anchorsToD, mirrorHandle } from "@/lib/path";
import { collectSnapLines, computeSnap, computeResizeSnap } from "@/lib/snap";
import { CURSOR_CHAT_MAX_LEN, shouldSendCursor } from "@/lib/collab";
import { inFlowChildren, insertionIndex } from "@/lib/flex";
import { resolveNumeric } from "@/lib/model";
import { MAX_PLACED_EDGE, capSize, fileToAsset } from "@/lib/images";
import { nodeToReact, nodeToCss, nodeToTailwind } from "@/lib/codegen";
import { ContextMenu } from "./ContextMenu";
import { parseSvgToNodes } from "@/lib/svg";
import { parseHtmlToCanvasNodes } from "@/lib/htmlToCanvasNodes";
import { convertSnapshotToCanvasNodes, normalizeLineHeight, looksLikeHtml } from "@/lib/snapshot-import";
import { toPng } from "html-to-image";

/** Screen px within which a pen click counts as "on the first anchor". */
const PEN_CLOSE_PX = 6;

/** Distinct SVG cursors for padding manipulation (boundary bar + opposing arrows) */
const PADDING_CURSOR_V =
  'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\' fill=\'none\'%3E%3Cfilter id=\'s\' x=\'0\' y=\'0\' width=\'24\' height=\'24\' filterUnits=\'userSpaceOnUse\'%3E%3CfeDropShadow dx=\'0\' dy=\'0.5\' stdDeviation=\'1\' flood-opacity=\'0.4\'/%3E%3C/filter%3E%3Cg filter=\'url(%23s)\'%3E%3Cline x1=\'4\' y1=\'12\' x2=\'20\' y2=\'12\' stroke=\'%23ffffff\' stroke-width=\'3.5\' stroke-linecap=\'round\'/%3E%3Cline x1=\'4.5\' y1=\'12\' x2=\'19.5\' y2=\'12\' stroke=\'%230D99FF\' stroke-width=\'2\' stroke-linecap=\'round\'/%3E%3Cpath d=\'M12 2.5L7.5 7H10.5V9.5H13.5V7H16.5L12 2.5Z\' fill=\'%230D99FF\' stroke=\'%23ffffff\' stroke-width=\'1.2\' stroke-linejoin=\'round\'/%3E%3Cpath d=\'M12 21.5L7.5 17H10.5V14.5H13.5V17H16.5L12 21.5Z\' fill=\'%230D99FF\' stroke=\'%23ffffff\' stroke-width=\'1.2\' stroke-linejoin=\'round\'/%3E%3C/g%3E%3C/svg%3E") 12 12, row-resize';

const PADDING_CURSOR_H =
  'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\' fill=\'none\'%3E%3Cfilter id=\'s\' x=\'0\' y=\'0\' width=\'24\' height=\'24\' filterUnits=\'userSpaceOnUse\'%3E%3CfeDropShadow dx=\'0\' dy=\'0.5\' stdDeviation=\'1\' flood-opacity=\'0.4\'/%3E%3C/filter%3E%3Cg filter=\'url(%23s)\'%3E%3Cline x1=\'12\' y1=\'4\' x2=\'12\' y2=\'20\' stroke=\'%23ffffff\' stroke-width=\'3.5\' stroke-linecap=\'round\'/%3E%3Cline x1=\'12\' y1=\'4.5\' x2=\'12\' y2=\'19.5\' stroke=\'%230D99FF\' stroke-width=\'2\' stroke-linecap=\'round\'/%3E%3Cpath d=\'M2.5 12L7 7.5V10.5H9.5V13.5H7V16.5L2.5 12Z\' fill=\'%230D99FF\' stroke=\'%23ffffff\' stroke-width=\'1.2\' stroke-linejoin=\'round\'/%3E%3Cpath d=\'M21.5 12L17 7.5V10.5H14.5V13.5H17V16.5L21.5 12Z\' fill=\'%230D99FF\' stroke=\'%23ffffff\' stroke-width=\'1.2\' stroke-linejoin=\'round\'/%3E%3C/g%3E%3C/svg%3E") 12 12, col-resize';

/** Distinct SVG cursors for margin manipulation (Warm Amber/Orange #F97316) */
const MARGIN_CURSOR_V =
  'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\' fill=\'none\'%3E%3Cfilter id=\'sm\' x=\'0\' y=\'0\' width=\'24\' height=\'24\' filterUnits=\'userSpaceOnUse\'%3E%3CfeDropShadow dx=\'0\' dy=\'0.5\' stdDeviation=\'1\' flood-opacity=\'0.4\'/%3E%3C/filter%3E%3Cg filter=\'url(%23sm)\'%3E%3Cline x1=\'4\' y1=\'12\' x2=\'20\' y2=\'12\' stroke=\'%23ffffff\' stroke-width=\'3.5\' stroke-linecap=\'round\'/%3E%3Cline x1=\'4.5\' y1=\'12\' x2=\'19.5\' y2=\'12\' stroke=\'%23F97316\' stroke-width=\'2\' stroke-linecap=\'round\'/%3E%3Cpath d=\'M12 2.5L7.5 7H10.5V9.5H13.5V7H16.5L12 2.5Z\' fill=\'%23F97316\' stroke=\'%23ffffff\' stroke-width=\'1.2\' stroke-linejoin=\'round\'/%3E%3Cpath d=\'M12 21.5L7.5 17H10.5V14.5H13.5V17H16.5L12 21.5Z\' fill=\'%23F97316\' stroke=\'%23ffffff\' stroke-width=\'1.2\' stroke-linejoin=\'round\'/%3E%3C/g%3E%3C/svg%3E") 12 12, row-resize';

const MARGIN_CURSOR_H =
  'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\' fill=\'none\'%3E%3Cfilter id=\'sm\' x=\'0\' y=\'0\' width=\'24\' height=\'24\' filterUnits=\'userSpaceOnUse\'%3E%3CfeDropShadow dx=\'0\' dy=\'0.5\' stdDeviation=\'1\' flood-opacity=\'0.4\'/%3E%3C/filter%3E%3Cg filter=\'url(%23sm)\'%3E%3Cline x1=\'12\' y1=\'4\' x2=\'12\' y2=\'20\' stroke=\'%23ffffff\' stroke-width=\'3.5\' stroke-linecap=\'round\'/%3E%3Cline x1=\'12\' y1=\'4.5\' x2=\'12\' y2=\'19.5\' stroke=\'%23F97316\' stroke-width=\'2\' stroke-linecap=\'round\'/%3E%3Cpath d=\'M2.5 12L7 7.5V10.5H9.5V13.5H7V16.5L2.5 12Z\' fill=\'%23F97316\' stroke=\'%23ffffff\' stroke-width=\'1.2\' stroke-linejoin=\'round\'/%3E%3Cpath d=\'M21.5 12L17 7.5V10.5H14.5V13.5H17V16.5L21.5 12Z\' fill=\'%23F97316\' stroke=\'%23ffffff\' stroke-width=\'1.2\' stroke-linejoin=\'round\'/%3E%3C/g%3E%3C/svg%3E") 12 12, col-resize';

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

/** Cumulative canvas rotation for a node taking into account rotated ancestors. */
function nodeCanvasRotation(nodes, id) {
  if (!nodes || !id) return 0;
  let rot = 0;
  let cur = nodes[id];
  while (cur) {
    if (cur.rotation != null && cur.rotation !== 0) {
      rot += Number(cur.rotation) || 0;
    } else if (typeof cur.style?.transform === "string") {
      const m = /rotate\((-?\d+(?:\.\d+)?)deg\)/i.exec(cur.style.transform);
      if (m) rot += parseFloat(m[1]) || 0;
    } else if (typeof cur.style?.customCss?.transform === "string") {
      const m = /rotate\((-?\d+(?:\.\d+)?)deg\)/i.exec(cur.style.customCss.transform);
      if (m) rot += parseFloat(m[1]) || 0;
    }
    cur = cur.parentId ? nodes[cur.parentId] : null;
  }
  return ((rot % 360) + 360) % 360;
}

/** A path node's anchors converted from node-local to CANVAS space. */
function anchorsInCanvas(nodes, node) {
  const o = G.absoluteOrigin(nodes, node.id);
  const shift = (p) => (p ? { x: p.x + o.x, y: p.y + o.y } : null);
  return (node.path?.anchors ?? []).map((a) => ({
    x: a.x + o.x,
    y: a.y + o.y,
    in: shift(a.in),
    out: shift(a.out),
    smooth: !!a.smooth,
  }));
}

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CORNER_HANDLES = ["nw", "ne", "se", "sw"];
const HANDLE_CURSORS = {
  nw: "var(--cursor-resize-nwse, nwse-resize)",
  se: "var(--cursor-resize-nwse, nwse-resize)",
  ne: "var(--cursor-resize-nesw, nesw-resize)",
  sw: "var(--cursor-resize-nesw, nesw-resize)",
  n: "var(--cursor-resize-ns, ns-resize)",
  s: "var(--cursor-resize-ns, ns-resize)",
  e: "var(--cursor-resize-ew, ew-resize)",
  w: "var(--cursor-resize-ew, ew-resize)",
};
const HANDLE_SIZE = 8;
const EDGE_HIT_SIZE = 8;
const DRAG_THRESHOLD = 2; // screen px before a press becomes a drag
const DEFAULT_RECT_SIZE = { w: 100, h: 100 };
const DEFAULT_FRAME_SIZE = { w: 320, h: 240 };
const DEFAULT_ELLIPSE_SIZE = { w: 120, h: 80 };

/**
 * Cursor-chat bubble (depth-gap batch): white pill, dark text, small
 * tail pointing down-left toward the cursor it belongs to. Rendered
 * for peers (from their presence chat field) and for ourselves.
 */
function ChatBubble({ text }) {
  return (
    <div
      style={{
        position: "relative",
        background: "#ffffff",
        color: "#18181B",
        borderRadius: 10,
        padding: "6px 12px",
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1.4,
        width: "max-content",
        minWidth: 48,
        maxWidth: 280,
        wordBreak: "break-word",
        whiteSpace: "pre-wrap",
        boxShadow: "0 4px 16px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.08)",
        border: "1px solid rgba(0,0,0,0.08)",
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      {text}
      <div
        style={{
          position: "absolute",
          left: 10,
          bottom: -5,
          width: 8,
          height: 8,
          background: "#ffffff",
          transform: "rotate(45deg)",
          borderRight: "1px solid rgba(0,0,0,0.08)",
          borderBottom: "1px solid rgba(0,0,0,0.08)",
        }}
      />
    </div>
  );
}

function handleOffset(handle, rect) {
  // Screen-space top-left of a handle centred on its anchor point.
  const cx = handle.includes("w")
    ? rect.x
    : handle.includes("e")
      ? rect.x + rect.w
      : rect.x + rect.w / 2;
  const cy = handle.includes("n")
    ? rect.y
    : handle.includes("s")
      ? rect.y + rect.h
      : rect.y + rect.h / 2;
  return { x: cx - HANDLE_SIZE / 2, y: cy - HANDLE_SIZE / 2 };
}

function formatPaddingVal(val) {
  if (val == null || isNaN(val)) return 0;
  return Math.round(Number(val));
}

/** Formats sizing mode & dimensions for hover/selection badge (e.g. "Fit 206 × Fill 38") */
function formatSizingBadge(node, rect) {
  if (!node || !rect) return "";
  const w = Math.round(rect.w);
  const h = Math.round(rect.h);

  const formatDim = (axis, px) => {
    const s = node.size?.[axis];
    if (s?.kind === "fit" || s?.kind === "auto") return `${s.kind === "auto" ? "Auto" : "Fit"} ${px}`;
    if (s?.kind === "fill") return `Fill ${px}`;
    if (s?.kind === "relative") return `${s.pct ?? 100}% ${px}`;
    return `${px}`;
  };

  return `${formatDim("w", w)} × ${formatDim("h", h)}`;
}

/** Finds a clean, non-overlapping empty spot on the canvas based on existing frames. */
function findEmptyCanvasPosition(doc, activePageId, sourceBounds = { w: 300, h: 200 }) {
  const pg = doc.pages.find((p) => p.id === activePageId) || doc.pages[0];
  const rootIds = (pg?.rootNodeIds || []).filter((id) => Boolean(doc.nodes[id]));
  if (!rootIds.length) {
    return { x: 100, y: 100 };
  }

  let maxX = -Infinity;
  let alignY = 100;
  for (const rid of rootIds) {
    const node = doc.nodes[rid];
    if (!node) continue;
    const nw = node.w || 100;
    const right = (node.x ?? 0) + nw;
    if (right > maxX) {
      maxX = right;
      alignY = node.y ?? 100;
    }
  }

  const GAP = 40;
  return {
    x: Math.round(maxX + GAP),
    y: Math.round(alignY),
  };
}

export default function Viewport() {
  const doc = useEditorStore((s) => s.doc);
  const tokens = doc.tokens ?? [];
  const activePageId = useEditorStore((s) => s.activePageId);
  const selection = useEditorStore((s) => s.selection);
  const viewport = useEditorStore((s) => s.viewport);
  const activeTool = useEditorStore((s) => s.activeTool);
  const activeCommentId = useEditorStore((s) => s.activeCommentId);
  const commentDraft = useEditorStore((s) => s.commentDraft);
  const showResolvedComments = useEditorStore((s) => s.showResolvedComments);
  const editingPathId = useEditorStore((s) => s.editingPathId);
  const selectedAnchorIndex = useEditorStore((s) => s.selectedAnchorIndex);
  // M6: remote peers (flat presence map from lib/collab transports).
  const peers = useEditorStore((s) => s.peers);
  // M7: version preview — while set, the canvas renders the version's
  // snapshot (renderDoc) instead of the live doc, read-only.
  const previewVersionId = useEditorStore((s) => s.previewVersionId);
  const versions = useEditorStore((s) => s.versions);
  // Depth-gap batch: our cursor-chat bubble + last known cursor (the
  // bubble and the chat composer anchor to it), and the transient
  // guide-drag state (the dragged guide renders from it, not the doc).
  const localChat = useEditorStore((s) => s.localChat);
  const localCursor = useEditorStore((s) => s.localCursor);
  const guideDrag = useEditorStore((s) => s.guideDrag);
  const canvasSize = useEditorStore((s) => s.canvasSize);
  const fileId = useEditorStore((s) => s.fileId);
  const uiMode = useEditorStore((s) => s.uiMode);

  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const fileInputRef = useRef(null); // Place-image picker (M4)
  const pasteSeqRef = useRef(0); // paste cascade counter (M4)
  const sessionRef = useRef(null); // active gesture, see onPointerDown
  // M6: cursor-publish throttle state { at, x, y, page } — presence is
  // sent at most every 50 ms and only when the pointer actually moved
  // (or the page changed).
  const cursorSentRef = useRef({ at: 0, x: null, y: null, page: null });
  const [marquee, setMarquee] = useState(null); // canvas-space rect
  const [draft, setDraft] = useState(null); // creation ghost, canvas rect
  const [pill, setPill] = useState(null); // { x, y, text } screen space
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [altHeld, setAltHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const [hoveredCommentId, setHoveredCommentId] = useState(null);
  const commentHoverTimerRef = useRef(null);
  const handleCommentEnter = (id) => {
    if (commentHoverTimerRef.current) clearTimeout(commentHoverTimerRef.current);
    setHoveredCommentId(id);
  };
  const handleCommentLeave = () => {
    if (commentHoverTimerRef.current) clearTimeout(commentHoverTimerRef.current);
    commentHoverTimerRef.current = setTimeout(() => {
      setHoveredCommentId(null);
    }, 200);
  };
  // M4: in-progress pen drawing { nodeId, anchors (CANVAS space), cursor,
  // hoverClose, historySnapshot } — the node already lives in the doc and
  // is updated transiently; the snapshot commits once on finish.
  const [pen, setPen] = useState(null);
  // M4: active snap lines while drag-moving { v: line|null, h: line|null }
  const [snapViz, setSnapViz] = useState(null);
  // Depth-gap batch: flex-reorder visuals while a reorder drag runs —
  // { ghost, line } rects in CANVAS coords (ghost = the dragged node's
  // start rect translated by the pointer delta).
  const [reorderViz, setReorderViz] = useState(null);
  // Depth-gap batch: the line guide under the pointer (move tool, no
  // active gesture): { frameId, guideId, kind, lineAt, rect } — purely
  // for the hover highlight + resize cursor.
  const [guideHover, setGuideHover] = useState(null);
  // Depth-gap batch: cursor-chat composer { text, anchor } — anchor in
  // SCREEN coords, captured when "/" is pressed.
  const [chatDraft, setChatDraft] = useState(null);
  // Measured canvas-space rects per node id (from the rendered DOM). The
  // geometry module only estimates fit/fill sizes, so the selection overlay
  // prefers these real measurements (M2: flex children measure correctly).
  const [measured, setMeasured] = useState({});
  const [dropTargetFrameId, setDropTargetFrameId] = useState(null);
  const [contextMenuPos, setContextMenuPos] = useState(null);
  const [hoveredPaddingSide, setHoveredPaddingSide] = useState(null);
  const [activePaddingVal, setActivePaddingVal] = useState(null);
  const [hoveredMarginSide, setHoveredMarginSide] = useState(null);
  const [activeMarginVal, setActiveMarginVal] = useState(null);
  const [hoveredGapIndex, setHoveredGapIndex] = useState(null);
  const [activeGapVal, setActiveGapVal] = useState(null);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [pasting, setPasting] = useState(false);
  const pointerCanvasPosRef = useRef(null);
  const isPointerOverCanvasRef = useRef(false);
  const clipboardPayloadRef = useRef(null);
  const copiedStylesRef = useRef(null);
  const copiedNodeRef = useRef(null);
  const editingTextId = useEditorStore((s) => s.editingTextId);
  const setEditingTextId = useEditorStore((s) => s.setEditingTextId);

  const getPasteTargetPosition = (sourceBounds = { w: 200, h: 200 }) => {
    const st = store.getState();
    const cursor = isPointerOverCanvasRef.current ? pointerCanvasPosRef.current : null;
    if (cursor && !isNaN(cursor.x) && !isNaN(cursor.y)) {
      return {
        x: Math.round(cursor.x),
        y: Math.round(cursor.y),
        isCursor: true,
      };
    }
    const emptyPos = findEmptyCanvasPosition(st.doc, st.activePageId, sourceBounds);
    return {
      x: emptyPos.x,
      y: emptyPos.y,
      isCursor: false,
    };
  };

  const copySelectedNodes = async (explicitId = null) => {
    const st = store.getState();
    const targetIds = explicitId ? [explicitId] : st.selection;
    if (!targetIds || !targetIds.length) return false;

    const roots = G.selectionRoots(st.doc.nodes, targetIds);
    if (!roots.length) return false;

    const payload = {
      type: "canvas-nodes-clip",
      version: 1,
      rootIds: roots,
      nodes: {},
    };

    for (const rId of roots) {
      for (const subId of G.subtreeIds(st.doc.nodes, rId)) {
        if (st.doc.nodes[subId]) {
          payload.nodes[subId] = structuredClone(st.doc.nodes[subId]);
        }
      }
    }

    clipboardPayloadRef.current = payload;
    copiedNodeRef.current = payload.nodes[roots[0]];

    // Build Paper Design standard clipboard format
    const plainText = `Node IDs: ${roots.join(", ")}`;
    const jsonStr = JSON.stringify(payload);
    const escapedJson = jsonStr.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const paperHtml = `<html>\n<body>\n<!--StartFragment--><meta charset="utf-8"><!--<paper-paste-start data-embed="${escapedJson}"></paper-paste-start>--><span style="white-space:pre-wrap;">${plainText}</span><!--EndFragment-->\n</body>\n</html>`;

    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        const textBlob = new Blob([plainText], { type: "text/plain" });
        const htmlBlob = new Blob([paperHtml], { type: "text/html" });
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": textBlob,
            "text/html": htmlBlob,
          }),
        ]);
      } else {
        await navigator.clipboard?.writeText(plainText);
      }
    } catch (_) {
      try {
        await navigator.clipboard?.writeText(plainText);
      } catch (_) {}
    }

    st.showToast({
      message: roots.length === 1 ? "Layer copied" : `${roots.length} layers copied`,
    });
    return true;
  };

  const executePaste = async (clipboardText = null, clipItems = null, clipboardHtml = null) => {
    const st = store.getState();
    if (st.previewVersionId) return;

    setPasting(true);
    await new Promise((resolve) => setTimeout(resolve, 80));

    try {
      // 1. If images are in clipboard items (from paste event)
      if (clipItems) {
        for (const item of clipItems) {
          if (item.type?.startsWith("image/")) {
            const file = typeof item.getAsFile === "function" ? item.getAsFile() : item;
            if (file) {
              const target = getPasteTargetPosition({ w: 300, h: 200 });
              await placeImageFile(file, 0, target);
              return;
            }
          }
        }
      }

      // 1b. If no clipItems provided, query navigator.clipboard.read() for images or html
      let html = clipboardHtml;
      if (typeof navigator !== "undefined" && navigator.clipboard?.read) {
        try {
          const cbItems = await navigator.clipboard.read();
          for (const item of cbItems) {
            const imgType = item.types?.find((t) => t.startsWith("image/"));
            if (imgType && !clipboardText && !clipboardHtml) {
              const blob = await item.getType(imgType);
              if (blob) {
                const ext = imgType.split("/")[1] || "png";
                const file = new File([blob], `pasted-image.${ext}`, { type: imgType });
                const target = getPasteTargetPosition({ w: 300, h: 200 });
                await placeImageFile(file, 0, target);
                return;
              }
            }
            if (!html && item.types?.includes("text/html")) {
              const blob = await item.getType("text/html");
              if (blob) html = await blob.text();
            }
          }
        } catch (_) {}
      }

      // 2. Read clipboard text
      let text = clipboardText;
      if (!text && typeof navigator !== "undefined" && navigator.clipboard?.readText) {
        try {
          text = await navigator.clipboard.readText();
        } catch (_) {}
      }
      text = text?.trim();

      // 3. Check for SVG
      if (
        text &&
        (text.startsWith("<svg") ||
          text.includes("<path") ||
          text.startsWith("<?xml") ||
          (text.startsWith("M") && text.includes(" ")))
      ) {
        const selectedNode = st.selection[0] ? st.doc.nodes[st.selection[0]] : null;
        const targetParent =
          selectedNode?.type === "frame"
            ? selectedNode
            : selectedNode?.parentId && st.doc.nodes[selectedNode.parentId]?.type === "frame"
              ? st.doc.nodes[selectedNode.parentId]
              : null;
        const targetParentId = targetParent ? targetParent.id : null;
        const target = targetParent ? { x: 0, y: 0 } : getPasteTargetPosition({ w: 200, h: 200 });
        const parsed = parseSvgToNodes(st.doc, text, targetParentId, target);
        if (parsed) {
          st.addSvgTree(parsed.svgNode, parsed.pathNodes);
          st.setActiveTool("move");
          st.showToast({
            message: targetParent
              ? `Added SVG to ${targetParent.name || "Frame"}`
              : "Custom SVG added to canvas",
          });
        }
        return;
      }

      // 4. Check for Paper Design Snapshot (<x-paper-html>) or HTML payload
      let payload = null;
      if (!html && text && (text.includes("<x-paper-html") || text.includes("paper-snapshot") || text.includes("paper-paste-start") || text.includes("data-embed=") || looksLikeHtml(text))) {
        html = text;
      }

      const isFormattedHtml =
        html &&
        (looksLikeHtml(html) ||
          html.includes("<x-paper-html") ||
          html.includes("paper-snapshot") ||
          html.includes("paper-paste-start") ||
          html.includes("data-embed=") ||
          html.includes("<header") ||
          html.includes("<section") ||
          html.includes("<nav") ||
          html.includes("<div") ||
          html.includes("<footer") ||
          html.includes("<main"));

      if (isFormattedHtml) {
        let htmlPayload = null;

        // Primary: Comprehensive snapshot-to-canvas converter with browser measurement,
        // rich text runs, full flex layout, border sides, shadows, and SVGs.
        try {
          const parsedFromHtml = await convertSnapshotToCanvasNodes(html, { measure: true, exactLayout: true });
          if (parsedFromHtml && parsedFromHtml.rootIds?.length) {
            htmlPayload = parsedFromHtml;
          }
        } catch (err) {
          console.warn("convertSnapshotToCanvasNodes failed:", err);
        }

        // Fallback: DOM-based parser (htmlToCanvasNodes.js) if primary converter produced nothing.
        if (!htmlPayload) {
          try {
            const parsed = parseHtmlToCanvasNodes(html);
            if (parsed && parsed.rootIds?.length) {
              htmlPayload = parsed;
            }
          } catch (err) {
            console.warn("htmlToCanvasNodes failed:", err);
          }
        }

        if (htmlPayload && htmlPayload.rootIds?.length) {
          payload = htmlPayload;

          // If the import produced no visual styling (all fills none, no borders,
          // no shadows, no images), offer "Paste as Image" so the design still
          // appears on canvas with its colors intact.
          if (!importedNodesHaveStyling(payload)) {
            st.showToast({
              message: "Paste lost styles (Snap/Figma CSS classes).",
              actionLabel: "Paste as Image",
              onAction: () => {
                if (html) pasteHtmlAsImage(html);
              },
              duration: 6000,
            });
            return; // don't import unstyled nodes
          }
        }
      }

      // 5. Check for serialized nodes (from clipboard text or internal ref)
      if (!payload && text && text.startsWith("{") && text.includes('"type":"canvas-nodes-clip"')) {
        try {
          payload = JSON.parse(text);
        } catch (_) {}
      }

      // Check if internal layer copy matches clipboard
      const isInternalLayerRef = text && text.startsWith("Node IDs:");
      if (!payload && (isInternalLayerRef || !text)) {
        if (clipboardPayloadRef.current) {
          payload = clipboardPayloadRef.current;
        } else if (copiedNodeRef.current) {
          payload = {
            type: "canvas-nodes-clip",
            version: 1,
            rootIds: [copiedNodeRef.current.id],
            nodes: { [copiedNodeRef.current.id]: copiedNodeRef.current },
          };
        }
      }

      if (payload && payload.nodes && payload.rootIds?.length) {
        const nextDoc = structuredClone(st.doc);
        const activePg =
          nextDoc.pages.find((p) => p.id === st.activePageId) || nextDoc.pages[0];

        // Overall bounding box of source roots
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const rid of payload.rootIds) {
          const n = payload.nodes[rid];
          if (n) {
            const nx = n.x ?? n.position?.x ?? 0;
            const ny = n.y ?? n.position?.y ?? 0;
            const nw = n.w ?? n.size?.w?.px ?? (typeof n.size?.w === "number" ? n.size.w : 100);
            const nh = n.h ?? n.size?.h?.px ?? (typeof n.size?.h === "number" ? n.size.h : 100);
            minX = Math.min(minX, nx);
            minY = Math.min(minY, ny);
            maxX = Math.max(maxX, nx + nw);
            maxY = Math.max(maxY, ny + nh);
          }
        }

        if (minX === Infinity) {
          minX = 0;
          minY = 0;
          maxX = 200;
          maxY = 200;
        }

        const sourceW = maxX - minX;
        const sourceH = maxY - minY;
        const targetPos = getPasteTargetPosition({ w: sourceW, h: sourceH });

        const dx = targetPos.x - minX;
        const dy = targetPos.y - minY;

        const newRootIds = [];
        const idMap = new Map();

        const cloneSubtree = (nodeId, newParentId) => {
          const orig = payload.nodes[nodeId];
          if (!orig) return null;
          const clone = structuredClone(orig);
          clone.id = `${clone.type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          clone.parentId = newParentId;

          // For text nodes on import: preserve exact line height, ensure height is fit-content
          if (clone.type === "text" && clone.text) {
            const fs = clone.text.fontSize || 16;
            const lh = normalizeLineHeight(clone.text.lineHeight, fs);
            clone.text.lineHeight = lh;
            if (!clone.size?.h || clone.size.h.kind !== "fixed") {
              clone.size = { ...(clone.size || {}), h: { kind: "fit" } };
            }
          }

          idMap.set(nodeId, clone.id);
          nextDoc.nodes[clone.id] = clone;
          clone.childIds = (orig.childIds ?? [])
            .map((cId) => cloneSubtree(cId, clone.id))
            .filter(Boolean);
          return clone.id;
        };

        for (const rid of payload.rootIds) {
          const newRid = cloneSubtree(rid, null);
          if (newRid) {
            const newRoot = nextDoc.nodes[newRid];
            newRoot.x = Math.round((newRoot.x ?? newRoot.position?.x ?? 0) + dx);
            newRoot.y = Math.round((newRoot.y ?? newRoot.position?.y ?? 0) + dy);
            if (!newRoot.position) newRoot.position = { x: newRoot.x, y: newRoot.y };
            else {
              newRoot.position.x = newRoot.x;
              newRoot.position.y = newRoot.y;
            }
            delete newRoot.position.absolute;
            newRootIds.push(newRid);
          }
        }

        if (newRootIds.length) {
          activePg.rootNodeIds.unshift(...newRootIds);
          st.commitSnapshot(structuredClone(st.doc));
          useEditorStore.setState({ doc: nextDoc });
          st.setSelection(newRootIds);
          st.showToast({
            message: newRootIds.length === 1 ? "Layer pasted" : `${newRootIds.length} layers pasted`,
          });
          return;
        }
      }

      // 6. Plain text clipboard -> paste as an editable Text layer
      if (text && typeof text === "string" && text.length > 0) {
        const trimmed = text.trim();
        if (trimmed.length > 0 && !trimmed.startsWith("Node IDs:")) {
          const selectedNode = st.selection[0] ? st.doc.nodes[st.selection[0]] : null;
          const targetParent =
            selectedNode?.type === "frame"
              ? selectedNode
              : selectedNode?.parentId && st.doc.nodes[selectedNode.parentId]?.type === "frame"
                ? st.doc.nodes[selectedNode.parentId]
                : null;
          const targetParentId = targetParent ? targetParent.id : null;
          const isFlexParent = targetParent?.layout?.mode === "flex" || targetParent?.layout?.mode === "grid";

          const targetPos = getPasteTargetPosition({ w: 200, h: 40 });
          const parentOrigin = targetParentId
            ? (() => {
                const r = rectOf(st.doc.nodes, targetParentId);
                return { x: r.x, y: r.y };
              })()
            : { x: 0, y: 0 };

          const posX = isFlexParent ? 0 : Math.round(targetPos.x - parentOrigin.x);
          const posY = isFlexParent ? 0 : Math.round(targetPos.y - parentOrigin.y);

          let textColor = "#1F1F1F";
          const parentFill = targetParent?.style?.fill?.color || targetParent?.style?.fill;
          if (
            typeof parentFill === "string" &&
            (parentFill === "#000000" ||
              parentFill === "#18181B" ||
              parentFill.startsWith("#0") ||
              parentFill.startsWith("#1") ||
              parentFill.startsWith("#2"))
          ) {
            textColor = "#FFFFFF";
          }

          const node = {
            ...createNode(
              st.doc,
              "text",
              { x: posX, y: posY, w: 200, h: 40 },
              targetParentId
            ),
            name: trimmed.length > 30 ? trimmed.slice(0, 30).trim() + "..." : trimmed,
            position: { x: posX, y: posY },
            size: {
              w: { kind: "fit" },
              h: { kind: "fit" },
            },
            style: {
              fill: { kind: "solid", color: textColor },
            },
            text: {
              content: text,
              fontSize: 16,
              fontWeight: 400,
              lineHeight: 1.4,
              letterSpacing: 0,
              align: "left",
              wrap: text.includes("\n") ? "wrap" : "none",
            },
          };

          st.addNode(node);
          st.setActiveTool("move");
          st.setSelection([node.id]);
          st.showToast({ message: "Text layer pasted" });
          return;
        }
      }

      // 5. Fallback: duplicate selection cleanly outside the original
      if (st.selection.length) {
        st.duplicateSelection();
      }
    } finally {
      setTimeout(() => setPasting(false), 250);
    }
  };

  /**
   * Paste-HTML-as-Image fallback: when Snap/Figma/etc. clipboard HTML has no
   * inline styles (only CSS classes), the node importer can't recover colors,
   * borders, shadows, or flex layout. Render the HTML to a PNG and paste it
   * as a single image node so the design still appears on canvas.
   */
  const pasteHtmlAsImage = async (html) => {
    const st = store.getState();
    if (st.previewVersionId) return;

    setPasting(true);
    try {
      // Create an offscreen container to render the HTML
      const container = document.createElement("div");
      container.style.position = "fixed";
      container.style.top = "-9999px";
      container.style.left = "-9999px";
      container.style.width = "auto";
      container.style.height = "auto";
      container.style.visibility = "hidden";
      container.style.pointerEvents = "none";
      container.innerHTML = html;
      document.body.appendChild(container);

      // Let the browser layout/paint
      await new Promise((r) => setTimeout(r, 50));

      let dataUrl = null;
      try {
        dataUrl = await toPng(container, {
          width: container.scrollWidth,
          height: container.scrollHeight,
          style: {
            transform: "scale(1)",
            transformOrigin: "0 0",
          },
          cacheBust: true,
        });
      } catch (_) {
        // toPng may fail in some environments — fall back silently
      }

      document.body.removeChild(container);

      if (!dataUrl) {
        st.showToast({ message: "Could not render paste as image" });
        return;
      }

      // Store the image as an asset and create an image node
      const assetId = `img-${Date.now().toString(36)}`;
      const target = getPasteTargetPosition({ w: container.scrollWidth, h: container.scrollHeight });

      const doc = st.doc;
      const page = doc.pages.find((p) => p.id === st.activePageId) || doc.pages[0];
      const nodeId = `image_${Date.now().toString(36)}`;

      const imageNode = {
        id: nodeId,
        type: "image",
        name: "Pasted Image",
        parentId: null,
        childIds: [],
        layout: { mode: "freeform" },
        x: target.x,
        y: target.y,
        position: { x: target.x, y: target.y },
        size: {
          w: { kind: "fixed", px: Math.max(1, container.scrollWidth) },
          h: { kind: "fixed", px: Math.max(1, container.scrollHeight) },
        },
        style: {
          fill: { kind: "none" },
          opacity: 1,
        },
        image: { assetId, fit: "cover" },
      };

      const nextDoc = {
        ...doc,
        nodes: {
          ...doc.nodes,
          [assetId]: dataUrl, // store dataURL in assets
          [nodeId]: imageNode,
        },
        pages: doc.pages.map((p) =>
          p.id === page.id ? { ...p, rootNodeIds: [nodeId, ...(p.rootNodeIds ?? [])] } : p
        ),
      };

      st.commitSnapshot(structuredClone(st.doc));
      useEditorStore.setState({ doc: nextDoc });
      st.setSelection([nodeId]);
      st.showToast({ message: "Pasted as image (styles flattened)" });
    } finally {
      setTimeout(() => setPasting(false), 250);
    }
  };

  /**
   * Check whether an imported node tree has any visual styling (fills,
   * borders, shadows, or images). Returns true when it looks like styles
   * survived the import.
   */
  function importedNodesHaveStyling(payload) {
    if (!payload || !payload.rootIds?.length) return false;
    for (const rid of payload.rootIds) {
      const walk = (id) => {
        const n = payload.nodes[id];
        if (!n) return false;
        const style = n.style || {};
        // Has fill, border, shadow, image, or svg markup?
        if (
          style.fill?.kind !== "none" ||
          style.fills?.some((f) => f && f.kind !== "none") ||
          style.borders?.length ||
          style.border?.width ||
          style.shadows?.length ||
          style.shadow?.length ||
          n.type === "image" ||
          n.type === "svg" ||
          n.type === "shader" ||
          n.svgOuterHtml ||
          n.svgMarkup
        ) {
          return true;
        }
        // Recurse into children
        if (n.childIds?.length) {
          for (const c of n.childIds) {
            if (walk(c)) return true;
          }
        }
        return false;
      };
      if (walk(rid)) return true;
    }
    return false;
  }

  const handleMoveZ = (id, direction) => {
    const st = useEditorStore.getState();
    const targetIds = id ? [id] : st.selection;
    if (!targetIds || targetIds.length === 0) return;
    if (id && !st.selection.includes(id)) {
      st.setSelection([id]);
    }

    let movedAny = false;
    for (const targetId of targetIds) {
      const n = st.doc.nodes[targetId];
      if (!n) continue;
      const parentId = n.parentId ?? null;
      const activePg =
        st.doc.pages.find((p) => p.id === st.activePageId) || st.doc.pages[0];
      const siblings = parentId
        ? (st.doc.nodes[parentId]?.childIds ?? [])
        : (activePg?.rootNodeIds ?? []);
      const idx = siblings.indexOf(targetId);
      if (idx === -1) continue;
      const count = siblings.length;
      if (count <= 1) continue;

      let targetIndex = idx;
      // In design tools:
      // index 0 is FRONT (top of the Layers panel).
      // index count - 1 is BACK (bottom of the Layers panel).
      if (direction === "front") {
        targetIndex = 0;
      } else if (direction === "back") {
        targetIndex = count - 1;
      } else if (direction === "forward") {
        targetIndex = Math.max(0, idx - 1);
      } else if (direction === "backward") {
        targetIndex = Math.min(count - 1, idx + 1);
      }

      if (targetIndex !== idx) {
        st.reorderChild(parentId, targetId, targetIndex);
        movedAny = true;
      }
    }

    if (movedAny) {
      const msg =
        direction === "front"
          ? "Brought to front"
          : direction === "back"
          ? "Sent to back"
          : direction === "forward"
          ? "Moved forward"
          : "Moved backward";
      st.showToast({ message: msg });
    }
  };

  const handlePasteNode = (targetId, options = {}) => {
    if (!options.replace && !options.onTop) {
      executePaste();
      return;
    }

    const st = store.getState();
    const sourceNode =
      copiedNodeRef.current ||
      (st.selection[0] ? st.doc.nodes[st.selection[0]] : null);
    if (!sourceNode) {
      st.duplicateSelection();
      return;
    }

    setPasting(true);
    const nextDoc = structuredClone(st.doc);
    const idMap = new Map();

    const cloneSubtree = (nodeId, newParentId) => {
      const orig = st.doc.nodes[nodeId];
      if (!orig) return null;
      const clone = structuredClone(orig);
      clone.id = `${clone.type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      clone.parentId = newParentId;
      idMap.set(nodeId, clone.id);
      nextDoc.nodes[clone.id] = clone;
      clone.childIds = (orig.childIds ?? [])
        .map((cId) => cloneSubtree(cId, clone.id))
        .filter(Boolean);
      return clone.id;
    };

    let targetParentId = null;
    let targetIndex = -1;

    const activePg =
      st.doc.pages.find((p) => p.id === st.activePageId) || st.doc.pages[0];

    if (targetId && st.doc.nodes[targetId]) {
      const target = st.doc.nodes[targetId];
      targetParentId = target.parentId ?? null;
      const siblings = targetParentId
        ? st.doc.nodes[targetParentId]?.childIds ?? []
        : (activePg?.rootNodeIds ?? []);
      targetIndex = siblings.indexOf(targetId);
    }

    const newRootId = cloneSubtree(sourceNode.id, targetParentId);
    if (!newRootId) {
      setPasting(false);
      return;
    }

    const newRoot = nextDoc.nodes[newRootId];

    if (options.replace && targetId) {
      const old = st.doc.nodes[targetId];
      if (old) {
        newRoot.x = old.x;
        newRoot.y = old.y;
        newRoot.w = old.w;
        newRoot.h = old.h;
        if (targetParentId) {
          const p = nextDoc.nodes[targetParentId];
          p.childIds = p.childIds.map((c) => (c === targetId ? newRootId : c));
        } else {
          const pg =
            nextDoc.pages.find((p) => p.id === activePageId) ||
            nextDoc.pages[0];
          pg.rootNodeIds = pg.rootNodeIds.map((c) =>
            c === targetId ? newRootId : c
          );
        }
        delete nextDoc.nodes[targetId];
      }
    } else if (options.onTop && targetId) {
      const old = st.doc.nodes[targetId];
      if (old) {
        newRoot.x = old.x;
        newRoot.y = old.y;
      }
      if (targetParentId) {
        const p = nextDoc.nodes[targetParentId];
        p.childIds.splice(targetIndex + 1, 0, newRootId);
      } else {
        const pg =
          nextDoc.pages.find((p) => p.id === activePageId) || nextDoc.pages[0];
        pg.rootNodeIds.splice(targetIndex + 1, 0, newRootId);
      }
    }

    st.commitSnapshot(structuredClone(st.doc));
    useEditorStore.setState({ doc: nextDoc });
    st.setSelection([newRootId]);
    setTimeout(() => setPasting(false), 250);
  };

  const handleFrameSelection = (nodeId) => {
    const st = store.getState();
    const ids = st.selection.length
      ? st.selection
      : nodeId
      ? [nodeId]
      : [];
    if (!ids.length) return;
    const nodes = ids.map((id) => st.doc.nodes[id]).filter(Boolean);
    if (!nodes.length) return;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    nodes.forEach((n) => {
      const nx = n.position?.x ?? n.x ?? 0;
      const ny = n.position?.y ?? n.y ?? 0;
      const nw = n.size?.w?.px ?? n.w ?? 100;
      const nh = n.size?.h?.px ?? n.h ?? 100;
      minX = Math.min(minX, nx);
      minY = Math.min(minY, ny);
      maxX = Math.max(maxX, nx + nw);
      maxY = Math.max(maxY, ny + nh);
    });

    const frameId = `frame_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const firstParentId = nodes[0].parentId ?? null;
    const nextDoc = structuredClone(st.doc);

    const frameW = Math.max(20, maxX - minX);
    const frameH = Math.max(20, maxY - minY);

    const frameNode = {
      id: frameId,
      type: "frame",
      name: "Frame",
      x: minX,
      y: minY,
      position: { x: minX, y: minY },
      w: frameW,
      h: frameH,
      size: {
        w: { kind: "fixed", px: frameW },
        h: { kind: "fixed", px: frameH },
      },
      parentId: firstParentId,
      childIds: ids,
      layout: { mode: "freeform" },
      style: {},
      clipContent: firstParentId == null,
    };
    nextDoc.nodes[frameId] = frameNode;

    ids.forEach((id) => {
      const child = nextDoc.nodes[id];
      if (child) {
        const cx = (child.position?.x ?? child.x ?? 0) - minX;
        const cy = (child.position?.y ?? child.y ?? 0) - minY;
        child.x = cx;
        child.y = cy;
        child.position = {
          ...(child.position || {}),
          x: cx,
          y: cy,
        };
        child.parentId = frameId;
      }
    });

    if (firstParentId && nextDoc.nodes[firstParentId]) {
      const parent = nextDoc.nodes[firstParentId];
      const idx = parent.childIds.indexOf(ids[0]);
      parent.childIds = parent.childIds.filter((id) => !ids.includes(id));
      parent.childIds.splice(idx >= 0 ? idx : parent.childIds.length, 0, frameId);
    } else {
      const pg =
        nextDoc.pages.find((p) => p.id === st.activePageId) || nextDoc.pages[0];
      const idx = pg.rootNodeIds.indexOf(ids[0]);
      pg.rootNodeIds = pg.rootNodeIds.filter((id) => !ids.includes(id));
      pg.rootNodeIds.splice(idx >= 0 ? idx : pg.rootNodeIds.length, 0, frameId);
    }

    useEditorStore.setState({ doc: nextDoc });
    st.setSelection([frameId]);
  };

  const handleUngroup = (nodeId) => {
    const st = store.getState();
    const targetNode = st.doc.nodes[nodeId];
    if (!targetNode || !targetNode.childIds?.length) return;

    const nextDoc = structuredClone(st.doc);
    const parentId = targetNode.parentId ?? null;
    const childIds = targetNode.childIds;

    childIds.forEach((cId) => {
      const child = nextDoc.nodes[cId];
      if (child) {
        child.x = (child.x || 0) + (targetNode.x || 0);
        child.y = (child.y || 0) + (targetNode.y || 0);
        child.parentId = parentId;
      }
    });

    if (parentId && nextDoc.nodes[parentId]) {
      const parent = nextDoc.nodes[parentId];
      const idx = parent.childIds.indexOf(nodeId);
      parent.childIds = parent.childIds.filter((id) => id !== nodeId);
      parent.childIds.splice(
        idx >= 0 ? idx : parent.childIds.length,
        0,
        ...childIds
      );
    } else {
      const pg =
        nextDoc.pages.find((p) => p.id === activePageId) || nextDoc.pages[0];
      const idx = pg.rootNodeIds.indexOf(nodeId);
      pg.rootNodeIds = pg.rootNodeIds.filter((id) => id !== nodeId);
      pg.rootNodeIds.splice(
        idx >= 0 ? idx : pg.rootNodeIds.length,
        0,
        ...childIds
      );
    }

    delete nextDoc.nodes[nodeId];

    useEditorStore.setState({ doc: nextDoc });
    st.setSelection(childIds);
  };

  const onContextMenu = (e) => {
    e.preventDefault();
    const el = e.target.closest("[data-node-id], [data-frame-title-id]");
    const targetId = el?.dataset?.frameTitleId || el?.dataset?.nodeId || null;
    let targetNode = targetId ? doc.nodes[targetId] : null;
    if (targetId && !selection.includes(targetId)) {
      useEditorStore.getState().setSelection([targetId]);
    }
    const hierarchy = [];
    if (targetId) {
      let curr = targetNode;
      while (curr) {
        hierarchy.push({
          id: curr.id,
          name: curr.name || curr.type,
          type: curr.type,
        });
        curr = curr.parentId ? doc.nodes[curr.parentId] : null;
      }
    }
    setContextMenuPos({
      x: e.clientX,
      y: e.clientY,
      targetId,
      targetName: targetNode?.name,
      targetType: targetNode?.type,
      targetLayout: targetNode?.layout?.mode,
      hierarchy: hierarchy.reverse(),
    });
  };

  useEffect(() => {
    const handleCustomContext = (e) => {
      const { x, y, targetId, isSidebar } = e.detail || {};
      const targetNode = targetId ? doc.nodes[targetId] : null;
      const hierarchy = [];
      if (targetId) {
        let curr = targetNode;
        while (curr) {
          hierarchy.push({
            id: curr.id,
            name: curr.name || curr.type,
            type: curr.type,
          });
          curr = curr.parentId ? doc.nodes[curr.parentId] : null;
        }
      }
      setContextMenuPos({
        x,
        y,
        targetId,
        targetName: targetNode?.name,
        targetType: targetNode?.type,
        targetLayout: targetNode?.layout?.mode,
        hierarchy: hierarchy.reverse(),
        isSidebar: Boolean(isSidebar),
      });
    };
    const handleCustomFrameSelection = () => {
      handleFrameSelection();
    };
    const handleCustomUngroupSelection = () => {
      const st = store.getState();
      const sel = st.selection || [];
      sel.forEach((id) => handleUngroup(id));
    };
    window.addEventListener("canvas:contextmenu", handleCustomContext);
    window.addEventListener("canvas:frame-selection", handleCustomFrameSelection);
    window.addEventListener("canvas:ungroup-selection", handleCustomUngroupSelection);
    return () => {
      window.removeEventListener("canvas:contextmenu", handleCustomContext);
      window.removeEventListener("canvas:frame-selection", handleCustomFrameSelection);
      window.removeEventListener("canvas:ungroup-selection", handleCustomUngroupSelection);
    };
  }, [doc]);

  // M7: the document the canvas actually renders — the previewed
  // version's snapshot while previewing, the live doc otherwise. All
  // render paths (world, overlays, measuring) use renderDoc; gesture
  // handlers keep reading the live doc from the store and are blocked
  // while previewing (see onPointerDown / onKeyDown).
  const previewVersion = previewVersionId
    ? (versions ?? []).find((v) => v.id === previewVersionId) ?? null
    : null;
  const previewing = !!previewVersion;
  const renderDoc = previewVersion ? previewVersion.snapshot : doc;
  const page =
    renderDoc.pages.find((p) => p.id === activePageId) ?? renderDoc.pages[0];
  const store = useEditorStore;

  // -- container plumbing ----------------------------------------------------

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const report = () =>
      store
        .getState()
        .setCanvasSize({ w: el.clientWidth, h: el.clientHeight });
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [store]);

  // Auto fit to screen when opening/loading an existing file, or 100% zoom centered when creating a new file
  const lastFittedFileRef = useRef(null);
  useEffect(() => {
    if (!doc || !canvasSize?.w || !canvasSize?.h) return;
    const fileKey = `${fileId || doc.id || "file"}:${activePageId}`;
    if (lastFittedFileRef.current === fileKey) return;
    lastFittedFileRef.current = fileKey;

    const pg = doc.pages.find((p) => p.id === activePageId) || doc.pages[0];
    const bounds = G.pageBounds(doc.nodes, pg);
    const leftOff = uiMode === "full" ? 300 : 0;
    const rightOff = uiMode !== "hidden" ? 280 : 0;

    if (bounds && bounds.w > 0 && bounds.h > 0) {
      // Existing file with content -> Zoom to fit
      store.getState().setViewport(G.fitViewport(bounds, canvasSize, 64, { left: leftOff, right: rightOff }));
    } else {
      // New / empty file -> Zoom must be 100% (zoom = 1), centered on canvas!
      const availW = canvasSize.w - leftOff - rightOff;
      const availH = canvasSize.h;
      store.getState().setViewport({
        zoom: 1,
        x: Math.round(leftOff + availW / 2),
        y: Math.round(availH / 2),
      });
    }
  }, [fileId, doc, activePageId, canvasSize, store, uiMode]);

  // Wheel needs a non-passive listener so Ctrl+wheel can suppress the
  // browser's own page zoom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const st = store.getState();
      const vp = st.viewport;
      const unit = e.deltaMode === 1 ? 16 : 1; // line vs pixel scrolling
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * unit * 0.002);
        st.setViewport(G.zoomToCursor(vp, pt, vp.zoom * factor));
      } else if (e.shiftKey) {
        const d =
          Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        st.setViewport({ ...vp, x: vp.x - d * unit });
      } else {
        st.setViewport({
          ...vp,
          x: vp.x - e.deltaX * unit,
          y: vp.y - e.deltaY * unit,
        });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [store]);

  // -- M4: image placement (Place image + paste) ------------------------------

  const openPlaceImage = () => fileInputRef.current?.click();

  /** Shared tail of Place image, paste-an-image, and drag-and-drop: store the asset and
   *  create an image node at explicitTargetPos or viewport centre (cascaded for pastes). */
  const placeImageFile = async (file, cascade = 0, explicitTargetPos = null) => {
    const st = store.getState();
    // M7: read-only while previewing a version.
    if (st.previewVersionId) return;
    try {
      // Check if file is SVG: import directly as vector SVG node with Path children
      if (file.type === "image/svg+xml" || file.name?.toLowerCase().endsWith(".svg")) {
        const text = await file.text();
        const selectedNode = st.selection[0] ? st.doc.nodes[st.selection[0]] : null;
        const targetParent =
          selectedNode?.type === "frame"
            ? selectedNode
            : selectedNode?.parentId && st.doc.nodes[selectedNode.parentId]?.type === "frame"
              ? st.doc.nodes[selectedNode.parentId]
              : null;
        const targetParentId = targetParent ? targetParent.id : null;
        let targetPos = { x: 0, y: 0 };
        if (explicitTargetPos) {
          targetPos = {
            x: Math.round(explicitTargetPos.x + cascade),
            y: Math.round(explicitTargetPos.y + cascade),
          };
        } else if (!targetParent) {
          const centre = G.screenToCanvas(st.viewport, {
            x: st.canvasSize.w / 2,
            y: st.canvasSize.h / 2,
          });
          targetPos = {
            x: Math.round(centre.x - 8 + cascade),
            y: Math.round(centre.y - 8 + cascade),
          };
        }
        const parsed = parseSvgToNodes(st.doc, text, targetParentId, targetPos);
        if (parsed) {
          st.addSvgTree(parsed.svgNode, parsed.pathNodes);
          st.setActiveTool("move");
          st.showToast({ message: "SVG imported as vector paths" });
          return;
        }
      }

      const asset = await fileToAsset(file);
      st.addAsset(asset);
      const { w, h } = capSize(asset.width, asset.height, MAX_PLACED_EDGE);

      let rect;
      if (explicitTargetPos) {
        const isCursor = explicitTargetPos.isCursor !== false;
        rect = {
          x: Math.round(explicitTargetPos.x - (isCursor ? w / 2 : 0) + cascade),
          y: Math.round(explicitTargetPos.y - (isCursor ? h / 2 : 0) + cascade),
          w,
          h,
        };
      } else {
        const centre = G.screenToCanvas(st.viewport, {
          x: st.canvasSize.w / 2,
          y: st.canvasSize.h / 2,
        });
        rect = {
          x: Math.round(centre.x - w / 2 + cascade),
          y: Math.round(centre.y - h / 2 + cascade),
          w,
          h,
        };
      }
      const centre = { x: rect.x + w / 2, y: rect.y + h / 2 };
      const pg = st.doc.pages.find((p) => p.id === st.activePageId);
      let parentId = G.findFrameAtPoint(st.doc.nodes, pg, centre);
      // A flex parent would swallow the position into its flow; images
      // land at the page root instead (same guard as the pen tool).
      if (parentId && (st.doc.nodes[parentId]?.layout?.mode === "flex" || st.doc.nodes[parentId]?.layout?.mode === "grid")) {
        parentId = null;
      }
      const node = createNode(st.doc, "image", rect, parentId);
      node.image = { assetId: asset.id, fit: "cover" };
      st.addNode(node);
      st.setActiveTool("move");
      st.showToast({ message: "Image added to canvas" });
    } catch (err) {
      st.showToast({ message: `Image failed: ${err.message}` });
    }
  };

  // The toolbar's Image button (EditorShell) asks over a window event.
  useEffect(() => {
    const handler = () => openPlaceImage();
    window.addEventListener("canvastool:place-image", handler);
    return () => window.removeEventListener("canvastool:place-image", handler);
  }, []);

  const [isDragOverCanvas, setIsDragOverCanvas] = useState(false);
  const dragCounterRef = useRef(0);

  // Prevent default window navigation when files are dropped outside canvas
  useEffect(() => {
    const handleWindowDragOver = (e) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
    };
    const handleWindowDrop = (e) => {
      if (!containerRef.current?.contains(e.target)) {
        if (e.dataTransfer?.types?.includes("Files")) {
          e.preventDefault();
        }
      }
    };
    window.addEventListener("dragover", handleWindowDragOver);
    window.addEventListener("drop", handleWindowDrop);
    return () => {
      window.removeEventListener("dragover", handleWindowDragOver);
      window.removeEventListener("drop", handleWindowDrop);
    };
  }, []);

  const handleDragEnter = (e) => {
    e.preventDefault();
    dragCounterRef.current += 1;
    if (
      e.dataTransfer?.types?.includes("Files") ||
      e.dataTransfer?.types?.includes("text/uri-list") ||
      e.dataTransfer?.types?.includes("text/html")
    ) {
      setIsDragOverCanvas(true);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const scr = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const cPt = G.screenToCanvas(store.getState().viewport, scr);
      pointerCanvasPosRef.current = cPt;
      isPointerOverCanvasRef.current = true;
    }
    if (!isDragOverCanvas) {
      setIsDragOverCanvas(true);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setIsDragOverCanvas(false);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOverCanvas(false);

    const st = store.getState();
    if (st.previewVersionId) return;

    let dropCanvasPos = null;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const scr = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      dropCanvasPos = G.screenToCanvas(st.viewport, scr);
      pointerCanvasPosRef.current = dropCanvasPos;
      isPointerOverCanvasRef.current = true;
    }
    if (!dropCanvasPos) {
      dropCanvasPos = G.screenToCanvas(st.viewport, {
        x: st.canvasSize.w / 2,
        y: st.canvasSize.h / 2,
      });
    }

    const targetPos = { x: dropCanvasPos.x, y: dropCanvasPos.y, isCursor: true };

    // 1. Check for files (dragged from OS explorer, desktop, or other windows)
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) {
      let placedCount = 0;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isImage =
          file.type?.startsWith("image/") ||
          /\.(png|jpe?g|webp|gif|svg|avif|bmp|ico)$/i.test(file.name || "");
        if (isImage) {
          await placeImageFile(file, placedCount * 24, targetPos);
          placedCount++;
        }
      }
      if (placedCount > 0) return;
    }

    // 2. Check for dragged images from web pages (HTML <img> or URI list)
    const html = e.dataTransfer?.getData("text/html");
    const uriList = e.dataTransfer?.getData("text/uri-list");
    let imageUrl = null;

    if (html) {
      const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (match && match[1]) {
        imageUrl = match[1];
      }
    }
    if (!imageUrl && uriList) {
      const firstUri = uriList
        .split("\n")
        .map((u) => u.trim())
        .find((u) => !u.startsWith("#") && u.length > 0);
      if (
        firstUri &&
        (firstUri.startsWith("http://") ||
          firstUri.startsWith("https://") ||
          firstUri.startsWith("data:image/"))
      ) {
        imageUrl = firstUri;
      }
    }

    if (imageUrl) {
      try {
        const res = await fetch(imageUrl);
        const blob = await res.blob();
        if (blob && (blob.type?.startsWith("image/") || blob.size > 0)) {
          const ext = blob.type?.split("/")[1] || "png";
          const file = new File([blob], `dropped-image.${ext}`, {
            type: blob.type || "image/png",
          });
          await placeImageFile(file, 0, targetPos);
          return;
        }
      } catch (_) {
        try {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = async () => {
            try {
              const canvas = document.createElement("canvas");
              canvas.width = img.naturalWidth || 400;
              canvas.height = img.naturalHeight || 300;
              const ctx = canvas.getContext("2d");
              ctx.drawImage(img, 0, 0);
              canvas.toBlob(async (blob) => {
                if (blob) {
                  const file = new File([blob], "dropped-image.png", { type: "image/png" });
                  await placeImageFile(file, 0, targetPos);
                }
              }, "image/png");
            } catch (_) {}
          };
          img.src = imageUrl;
          return;
        } catch (_) {}
      }
    }

    // 3. Check for SVG plain text dropped
    const plainText = e.dataTransfer?.getData("text/plain")?.trim();
    if (
      plainText &&
      (plainText.startsWith("<svg") ||
        plainText.includes("<path") ||
        plainText.startsWith("<?xml"))
    ) {
      const selectedNode = st.selection[0] ? st.doc.nodes[st.selection[0]] : null;
      const targetParent =
        selectedNode?.type === "frame"
          ? selectedNode
          : selectedNode?.parentId && st.doc.nodes[selectedNode.parentId]?.type === "frame"
            ? st.doc.nodes[selectedNode.parentId]
            : null;
      const targetParentId = targetParent ? targetParent.id : null;
      const parsed = parseSvgToNodes(st.doc, plainText, targetParentId, targetPos);
      if (parsed) {
        st.addSvgTree(parsed.svgNode, parsed.pathNodes);
        st.setActiveTool("move");
        st.showToast({ message: "SVG dropped as vector paths" });
      }
    }
  };

  // -- M5: shader layer creation -------------------------------------------
  // The toolbar's Shader button asks over a window event (same pattern
  // as Place image): drop a 480×360 shader node, default preset, at the
  // viewport centre. addNode commits ONE history entry and selects it.
  useEffect(() => {
    const handler = () => {
      const st = store.getState();
      // M7: read-only while previewing a version.
      if (st.previewVersionId) return;
      const centre = G.screenToCanvas(st.viewport, {
        x: st.canvasSize.w / 2,
        y: st.canvasSize.h / 2,
      });
      const rect = {
        x: Math.round(centre.x - 240),
        y: Math.round(centre.y - 180),
        w: 480,
        h: 360,
      };
      const pg = st.doc.pages.find((p) => p.id === st.activePageId);
      let parentId = G.findFrameAtPoint(st.doc.nodes, pg, centre);
      // Same guard as Place image / the pen tool: a flex parent would
      // swallow the position into its flow.
      if (parentId && (st.doc.nodes[parentId]?.layout?.mode === "flex" || st.doc.nodes[parentId]?.layout?.mode === "grid")) {
        parentId = null;
      }
      const node = createNode(st.doc, "shader", rect, parentId);
      st.addNode(node);
      st.setActiveTool("move");
    };
    window.addEventListener("canvastool:add-shader", handler);
    return () => window.removeEventListener("canvastool:add-shader", handler);
  }, [store]);

  // Paste an image from the clipboard (spec entry route #3). Skipped
  // while typing in any field, where paste means text.
  useEffect(() => {
    const onPaste = (e) => {
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      ) {
        return;
      }
      for (const item of e.clipboardData?.items ?? []) {
        if (item.type?.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            pasteSeqRef.current += 1;
            const target = getPasteTargetPosition({ w: 300, h: 200 });
            placeImageFile(file, (pasteSeqRef.current % 5) * 24, target);
          }
          return;
        }
      }

      // 2. Check for HTML from Paper Design (<x-paper-html>) or Paper embed payload
      const html = e.clipboardData?.getData("text/html");
      const text = e.clipboardData?.getData("text/plain")?.trim();

      if (
        html &&
        (html.includes("<x-paper-html") ||
          html.includes("paper-snapshot") ||
          html.includes("paper-paste-start") ||
          html.includes("data-embed="))
      ) {
        e.preventDefault();
        executePaste(text, null, html);
        return;
      }

      // 3. Check for serialized nodes JSON (from extension or internal copy)
      if (text && text.startsWith("{") && text.includes('"type":"canvas-nodes-clip"')) {
        e.preventDefault();
        executePaste(text, null, html);
        return;
      }

      // 4. Check for pasted SVG code, path strings, or vector XML
      if (
        text &&
        (text.startsWith("<svg") ||
          text.includes("<path") ||
          text.startsWith("<?xml") ||
          (text.startsWith("M") && text.includes(" ")))
      ) {
        e.preventDefault();
        const st = store.getState();
        const selectedNode = st.selection[0] ? st.doc.nodes[st.selection[0]] : null;
        const targetParent =
          selectedNode?.type === "frame"
            ? selectedNode
            : selectedNode?.parentId && st.doc.nodes[selectedNode.parentId]?.type === "frame"
              ? st.doc.nodes[selectedNode.parentId]
              : null;
        const targetParentId = targetParent ? targetParent.id : null;
        let targetPos = { x: 0, y: 0 };
        if (!targetParent) {
          const target = getPasteTargetPosition({ w: 200, h: 200 });
          targetPos = { x: Math.round(target.x - 8), y: Math.round(target.y - 8) };
        }
        const parsed = parseSvgToNodes(st.doc, text, targetParentId, targetPos);
        if (parsed) {
          st.addSvgTree(parsed.svgNode, parsed.pathNodes);
          st.setActiveTool("move");
          st.showToast({
            message: targetParent
              ? `Added SVG to ${targetParent.name || "Frame"}`
              : "Custom SVG added to canvas",
          });
        }
        return;
      }

      // 5. Plain text on clipboard -> paste as an editable Text layer
      if (text && text.length > 0) {
        e.preventDefault();
        executePaste(text, null, html);
        return;
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- M4: pen finishing -------------------------------------------------------

  /** Finish the in-progress pen path. Fewer than 2 anchors = discard. */
  const finishPen = (closed) => {
    if (!pen) return;
    const st = store.getState();
    if (pen.anchors.length < 2) {
      st.removeNodeTransient(pen.nodeId);
    } else {
      st.setPathFromCanvas(pen.nodeId, pen.anchors, closed);
      st.commitSnapshot(pen.historySnapshot); // ONE history entry total
      st.setSelection([pen.nodeId]);
    }
    setPen(null);
    st.setActiveTool("move");
  };

  // Switching tools mid-draw finishes the path as open.
  useEffect(() => {
    if (activeTool !== "pen" && pen) finishPen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, pen]);

  // Measure rendered nodes after every doc/viewport change so the overlay
  // can draw exact rects (flex items, wrapped text, rotated elements) instead of estimates.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const crect = el.getBoundingClientRect();
    const vp = store.getState().viewport;
    const map = {};
    el.querySelectorAll("[data-node-id]").forEach((nodeEl) => {
      const r = nodeEl.getBoundingClientRect();
      const unrotatedW = nodeEl.offsetWidth || (r.width / vp.zoom);
      const unrotatedH = nodeEl.offsetHeight || (r.height / vp.zoom);
      const centerCanvasX = (r.left + r.width / 2 - crect.left - vp.x) / vp.zoom;
      const centerCanvasY = (r.top + r.height / 2 - crect.top - vp.y) / vp.zoom;
      map[nodeEl.dataset.nodeId] = {
        x: centerCanvasX - unrotatedW / 2,
        y: centerCanvasY - unrotatedH / 2,
        w: unrotatedW,
        h: unrotatedH,
      };
    });
    setMeasured(map);
  }, [renderDoc, viewport, activePageId, store]);

  /** Best-known canvas rect for a node: measured DOM rect, else geometry. */
  const rectOf = (nodes, id) => measured[id] ?? G.absoluteRect(nodes, id);

  /**
   * Find the deepest / top-most frame containing point cPt (excluding excluded node subtrees).
   * Uses measured real-DOM canvas rects for accurate hit-testing on flex/fill frames.
   */
  const findFrameAtCanvasPoint = (cPt, excludeIds = null) => {
    const st = store.getState();
    const pg =
      st.doc.pages.find((p) => p.id === st.activePageId) ?? st.doc.pages[0];
    if (!pg) return null;
    let best = null;
    let order = 0;
    const excludeSet = excludeIds ? new Set(excludeIds) : null;
    const walk = (ids, depth) => {
      for (const id of ids) {
        if (excludeSet?.has(id)) continue;
        const node = st.doc.nodes[id];
        if (!node || G.isNodeHidden(st.doc.nodes, id)) continue;
        const myOrder = order++;
        if (node.type === "frame") {
          const r = rectOf(st.doc.nodes, id);
          const inside =
            cPt.x >= r.x &&
            cPt.x <= r.x + r.w &&
            cPt.y >= r.y &&
            cPt.y <= r.y + r.h;
          if (
            inside &&
            (!best ||
              depth > best.depth ||
              (depth === best.depth && myOrder > best.order))
          ) {
            best = { id, depth, order: myOrder };
          }
        }
        if (node.childIds?.length) walk(node.childIds, depth + 1);
      }
    };
    walk(pg.rootNodeIds, 0);
    return best ? best.id : null;
  };

  /**
   * Find target frame for pointer event (checks clicked DOM element or canvas geometry).
   */
  const findTargetFrameForEvent = (e, cPt, excludeIds = null) => {
    const st = store.getState();
    const excludeSet = excludeIds ? new Set(excludeIds) : null;
    let el = e?.target?.closest?.("[data-node-id], [data-frame-title-id]");
    while (el) {
      const nid = el.dataset.frameTitleId || el.dataset.nodeId;
      if (!excludeSet?.has(nid) && !G.isNodeHidden(st.doc.nodes, nid)) {
        const n = st.doc.nodes[nid];
        if (n?.type === "frame") return nid;
      }
      el = el.parentElement?.closest?.("[data-node-id], [data-frame-title-id]");
    }
    return findFrameAtCanvasPoint(cPt, excludeIds);
  };

  /**
   * Depth-gap batch: hit-test frame LINE guides at a canvas point.
   * The hit strip is 6 SCREEN px wide (±3 px around the 1px line);
   * the nearest matching guide on the active page wins. Grid guides
   * are never hit (panel-only). Returns
   * { frame, guide, rect, lineAt } or null.
   */
  const guideHitAt = (st, cPt) => {
    const tol = 3 / st.viewport.zoom;
    const pg =
      st.doc.pages.find((p) => p.id === st.activePageId) ?? st.doc.pages[0];
    if (!pg) return null;
    const onPage = new Set();
    const walk = (ids) => {
      for (const id of ids) {
        if (onPage.has(id)) continue;
        onPage.add(id);
        const n = st.doc.nodes[id];
        if (n?.childIds?.length) walk(n.childIds);
      }
    };
    walk(pg.rootNodeIds);
    let best = null;
    for (const frame of Object.values(st.doc.nodes)) {
      if (frame.type !== "frame" || !onPage.has(frame.id)) continue;
      if (!frame.guides?.length) continue;
      const rect = rectOf(st.doc.nodes, frame.id);
      for (const g of frame.guides) {
        if (g.hidden) continue;
        if (g.kind !== "v" && g.kind !== "h") continue;
        const lineAt = g.kind === "v" ? rect.x + g.pos : rect.y + g.pos;
        const along = g.kind === "v" ? cPt.x : cPt.y;
        const cross = g.kind === "v" ? cPt.y : cPt.x;
        const crossFrom = g.kind === "v" ? rect.y : rect.x;
        const crossTo = g.kind === "v" ? rect.y + rect.h : rect.x + rect.w;
        const dist = Math.abs(along - lineAt);
        if (dist > tol) continue;
        if (cross < crossFrom - tol || cross > crossTo + tol) continue;
        if (!best || dist < best.dist) {
          best = { frame, guide: g, rect, lineAt, dist };
        }
      }
    }
    return best;
  };

  // -- coordinate helpers ------------------------------------------------------

  const containerPoint = (e) => {
    const rect = containerRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const canvasPoint = (e) =>
    G.screenToCanvas(store.getState().viewport, containerPoint(e));

  const zoomByStep = (dir) => {
    const st = store.getState();
    const { w, h } = st.canvasSize;
    const center = { x: w / 2, y: h / 2 };
    st.setViewport(
      G.zoomToCursor(st.viewport, center, st.viewport.zoom * (dir > 0 ? 2 : 0.5)),
    );
  };
  const zoomToFit = () => {
    const st = store.getState();
    const pg = st.doc.pages.find((p) => p.id === st.activePageId);
    let bounds = null;
    const roots = (pg?.rootNodeIds || []).filter(
      (id) => st.doc.nodes[id] && !G.isNodeHidden(st.doc.nodes, id),
    );
    if (roots.length > 0) {
      const rects = roots
        .map((id) => rectOf(st.doc.nodes, id))
        .filter((r) => r && r.w > 0 && r.h > 0);
      if (rects.length > 0) bounds = G.rectUnion(rects);
    }
    if (!bounds) bounds = G.pageBounds(st.doc.nodes, pg);
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
  };
  const zoomToSelection = () => {
    const st = store.getState();
    const roots = st.selection.filter((id) => st.doc.nodes[id]);
    let bounds = null;
    if (roots.length > 0) {
      const rects = roots
        .map((id) => rectOf(st.doc.nodes, id))
        .filter((r) => r && r.w > 0 && r.h > 0);
      if (rects.length > 0) bounds = G.rectUnion(rects);
    }
    if (!bounds) bounds = G.selectionBounds(st.doc.nodes, st.selection);
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
  };
  const zoomTo100 = () => {
    const st = store.getState();
    const { w, h } = st.canvasSize;
    st.setViewport(G.zoomToCursor(st.viewport, { x: w / 2, y: h / 2 }, 1));
  };

  // -- pen tool (M4) -----------------------------------------------------------

  /**
   * Pen press. The first click creates the path node in the doc (via the
   * transient add — the pre-draw snapshot commits once, at finish) and
   * drops anchor #1. Later clicks append anchors; a click within
   * PEN_CLOSE_PX of the first anchor closes the path instead. Every press
   * also starts a "pen" session so a drag can pull out a smooth handle.
   */
  const handlePenDown = (e, st, pt, cPt) => {
    if (!pen) {
      const pg = st.doc.pages.find((p) => p.id === st.activePageId);
      let parentId = G.findFrameAtPoint(st.doc.nodes, pg, cPt);
      if (parentId && (st.doc.nodes[parentId]?.layout?.mode === "flex" || st.doc.nodes[parentId]?.layout?.mode === "grid")) {
        parentId = null; // a flex parent would swallow the path into flow
      }
      const historySnapshot = structuredClone(st.doc);
      const node = createNode(
        st.doc,
        "path",
        { x: cPt.x, y: cPt.y, w: 1, h: 1 },
        parentId,
      );
      st.addNodeTransient(node);
      const anchors = [{ x: cPt.x, y: cPt.y, in: null, out: null, smooth: false }];
      st.setPathFromCanvas(node.id, anchors, false);
      setPen({
        nodeId: node.id,
        anchors,
        cursor: cPt,
        hoverClose: false,
        historySnapshot,
      });
      beginSession(e, { kind: "pen", index: 0 });
      return;
    }

    const firstScr = G.canvasToScreen(st.viewport, pen.anchors[0]);
    if (
      pen.anchors.length >= 2 &&
      Math.hypot(firstScr.x - pt.x, firstScr.y - pt.y) <= PEN_CLOSE_PX
    ) {
      finishPen(true);
      return;
    }
    const anchors = [
      ...pen.anchors,
      { x: cPt.x, y: cPt.y, in: null, out: null, smooth: false },
    ];
    st.setPathFromCanvas(pen.nodeId, anchors, false);
    setPen({ ...pen, anchors, cursor: cPt, hoverClose: false });
    beginSession(e, { kind: "pen", index: anchors.length - 1 });
  };

  // -- pointer gestures --------------------------------------------------------

  const beginSession = (e, session) => {
    sessionRef.current = session;
    setHoveredNodeId(null);
    containerRef.current.setPointerCapture(e.pointerId);
  };

  const onPointerDown = (e) => {
    containerRef.current.focus();
    const st = store.getState();
    const tool = st.activeTool;
    const pt = containerPoint(e);
    const cPt = G.screenToCanvas(st.viewport, pt);

    const wantsPan =
      tool === "pan" || spaceHeld || e.button === 1;
    if (wantsPan) {
      if (e.button === 1) e.preventDefault();
      setPanning(true);
      beginSession(e, {
        kind: "pan",
        startPt: pt,
        startVp: { ...st.viewport },
      });
      return;
    }
    // M7: version preview is read-only — panning (handled above) is
    // the only gesture; every editing press is ignored. The shell also
    // makes the sidebars/inspector inert, and store.setFileTitle is
    // guarded, so the live doc cannot change under the snapshot.
    if (st.previewVersionId) return;
    if (e.button !== 0) return;

    // M4: anchor-edit handles win over every tool — an anchor dot or a
    // handle dot of the path being edited starts an anchor drag (or, with
    // Alt, toggles the anchor smooth/corner).
    const anchorEl = e.target.closest?.("[data-anchor-idx]");
    if (anchorEl && st.editingPathId) {
      const node = st.doc.nodes[st.editingPathId];
      if (node?.type === "path") {
        const index = Number(anchorEl.dataset.anchorIdx);
        const which = anchorEl.dataset.handle ?? null;
        st.setSelectedAnchorIndex(index);
        if (e.altKey && !which) {
          st.togglePathAnchorSmooth(node.id, index);
          return;
        }
        beginSession(e, {
          kind: which ? "handle" : "anchor",
          nodeId: node.id,
          index,
          which,
          startPt: pt,
          anchorsCanvas: anchorsInCanvas(st.doc.nodes, node),
          historySnapshot: structuredClone(st.doc),
          mutated: false,
        });
        return;
      }
    }

    if (tool === "pen") {
      handlePenDown(e, st, pt, cPt);
      return;
    }

    if (tool === "frame" || tool === "rect" || tool === "ellipse" || tool === "text") {
      const parentId = findTargetFrameForEvent(e, cPt);
      beginSession(e, {
        kind: "create",
        tool,
        parentId,
        start: cPt,
        moved: false,
      });
      setDraft({ x: cPt.x, y: cPt.y, w: 0, h: 0 });
      return;
    }

    if (tool === "comment") {
      // a click drops a comment pin and opens the comment UI in the right sidebar
      st.setCommentsPanelOpen(true);
      st.setActiveCommentId(null);
      const hitEl = e.target.closest("[data-node-id]");
      let hitId = hitEl ? hitEl.dataset.nodeId : null;
      if (!hitId) {
        const frame = findFrameAtCanvasPoint(cPt);
        if (frame) hitId = frame.id;
      }
      let nodeId = null;
      let relX = null;
      let relY = null;
      if (hitId && st.doc.nodes[hitId]) {
        nodeId = hitId;
        const nr = G.absoluteRect(st.doc.nodes, hitId) || rectOf(st.doc.nodes, hitId);
        if (nr) {
          relX = Math.round(cPt.x - nr.x);
          relY = Math.round(cPt.y - nr.y);
        }
      }
      st.setCommentDraft({
        pageId: st.activePageId,
        x: Math.round(cPt.x),
        y: Math.round(cPt.y),
        nodeId,
        relX,
        relY,
      });
      return;
    }

    // Clicking anywhere on the canvas or layers outside of comment tool closes comment UI and restores regular right sidebar
    if (st.commentsPanelOpen || st.activeCommentId || st.commentDraft || st.activeTool === "comment") {
      st.setCommentsPanelOpen(false);
      st.setActiveCommentId(null);
      st.setCommentDraft(null);
      if (st.activeTool === "comment") {
        st.setActiveTool("move");
      }
    }

    if (tool !== "move") return;

    // Depth-gap batch: a press within the 6-screen-px strip of a
    // frame's line guide grabs the GUIDE — guides render above nodes,
    // so this wins over the node drag and the marquee at that strip.
    // The drag is transient (store.guideDrag); the doc commits once,
    // on release, through patchNode (the Guides panel's path).
    const gHit = guideHitAt(st, cPt);
    if (gHit) {
      beginSession(e, {
        kind: "guide",
        frameId: gHit.frame.id,
        guideId: gHit.guide.id,
        orientation: gHit.guide.kind,
        startPos: gHit.guide.pos,
        currentPos: gHit.guide.pos,
      });
      st.setGuideDrag({
        frameId: gHit.frame.id,
        guideId: gHit.guide.id,
        pos: gHit.guide.pos,
      });
      return;
    }

    const hitEl = e.target.closest?.("[data-node-id], [data-frame-title-id]");
    let hitId = hitEl?.dataset.frameTitleId || hitEl?.dataset.nodeId;
    if (hitId && G.isNodeHidden(st.doc.nodes, hitId)) {
      hitId = null;
    }
    if (e.detail >= 2 && hitEl?.dataset?.frameTitleId) {
      window.dispatchEvent(
        new CustomEvent("canvas:rename-frame-title", {
          detail: { id: hitEl.dataset.frameTitleId, target: "canvas" },
        })
      );
      return;
    }
    // M4: while anchor-editing a path, clicking its body does nothing
    // (anchors are the handles); clicking anything else exits the mode.
    if (st.editingPathId) {
      if (hitId === st.editingPathId) return;
      st.setEditingPathId(null);
      st.setSelectedAnchorIndex(null);
    }
    // Clicking inside the rich text formatting toolbar should never exit text edit mode
    if (e.target?.closest?.("[data-rich-text-toolbar]")) return;

    // Clicking outside currently edited text exits text edit mode
    if (st.editingTextId && hitId !== st.editingTextId) {
      const curTextNode = st.doc.nodes[st.editingTextId];
      if (curTextNode && (!curTextNode.text?.content || !curTextNode.text.content.trim())) {
        if (typeof st.deleteNodes === "function") {
          st.deleteNodes([st.editingTextId]);
        } else if (typeof st.removeNodeTransient === "function") {
          st.removeNodeTransient(st.editingTextId);
        }
      }
      st.setEditingTextId(null);
    }
    let selectId = hitId;
    if (hitId && st.doc.nodes[hitId] && (!e.ctrlKey || e.altKey)) {
      // 1. If hitId is or is inside an already-selected layer/frame:
      // Keep the selected layer as the drag target! Moving it moves the selected layer and all its children.
      let selectedAncestor = null;
      let check = st.doc.nodes[hitId];
      while (check) {
        if (st.selection.includes(check.id)) {
          selectedAncestor = check.id;
          break;
        }
        check = check.parentId ? st.doc.nodes[check.parentId] : null;
      }

      if (selectedAncestor) {
        selectId = selectedAncestor;
      } else {
        // If clicking inside an SVG vector graphic, select the root SVG node
        let cur = st.doc.nodes[hitId];
        while (cur && cur.parentId && st.doc.nodes[cur.parentId]) {
          if (cur.type === "svg") {
            selectId = cur.id;
            break;
          }
          const p = st.doc.nodes[cur.parentId];
          if (p.type === "svg") {
            selectId = p.id;
            break;
          }
          cur = p;
        }
      }
    }

    if (selectId && st.doc.nodes[selectId]) {
      const isDuplicateKey = Boolean(e.altKey || (e.ctrlKey && e.altKey) || (e.metaKey && e.altKey));
      if (!isDuplicateKey && (e.shiftKey || e.ctrlKey || e.metaKey)) {
        st.toggleInSelection(selectId);
        return;
      }
      if (!st.selection.includes(selectId)) st.setSelection([selectId]);
      // Depth-gap batch: a sole-selected IN-FLOW flex child cannot be
      // drag-moved (its position is automatic — M2/P3), so its drag is
      // a REORDER drag instead: the node ghosts along with the pointer
      // and drops into a new flow slot (see onPointerMove/Up).
      // Absolutely-positioned children skip this and move normally.
      {
        const effSel = st.selection.includes(selectId)
          ? st.selection
          : [selectId];
        const hitNode = st.doc.nodes[selectId];
        const hitParent = hitNode.parentId
          ? st.doc.nodes[hitNode.parentId]
          : null;
        const isAutoParent = hitParent?.layout?.mode === "flex" || hitParent?.layout?.mode === "grid";
        if (
          !isDuplicateKey &&
          effSel.length === 1 &&
          isAutoParent &&
          !hitNode.position?.absolute
        ) {
          beginSession(e, {
            kind: "reorder",
            id: selectId,
            rawHitId: hitId,
            parentId: hitParent.id,
            start: cPt,
            startPt: pt,
            engaged: false,
            startRect: rectOf(st.doc.nodes, selectId),
            historySnapshot: structuredClone(st.doc),
            insertIndex: null,
            isOutsideParent: false,
          });
          return;
        }
      }
      // In-flow flex / grid children cannot be drag-moved (their position is
      // automatic); selecting them is all a press does (unless duplicating with Alt/Ctrl+Alt).
      const movable = (id) => {
        if (isDuplicateKey) return true;
        const n = st.doc.nodes[id];
        const parent = n?.parentId ? st.doc.nodes[n.parentId] : null;
        const isAutoChild = (parent?.layout?.mode === "flex" || parent?.layout?.mode === "grid") && !n?.position?.absolute;
        return !isAutoChild;
      };
      const roots = (
        st.selection.includes(selectId)
          ? G.selectionRoots(st.doc.nodes, st.selection)
          : [selectId]
      ).filter(movable);
      if (roots.length === 0) return;
      const starts = new Map(
        roots.map((id) => {
          const n = st.doc.nodes[id];
          const parent = n?.parentId ? st.doc.nodes[n.parentId] : null;
          const isAutoChild = (parent?.layout?.mode === "flex" || parent?.layout?.mode === "grid") && !n?.position?.absolute;
          if (isAutoChild && isDuplicateKey) {
            const r = rectOf(st.doc.nodes, id);
            return [id, { x: r.x, y: r.y }];
          }
          return [
            id,
            {
              x: Number.isFinite(Number(n?.position?.x))
                ? Number(n.position.x)
                : (Number.isFinite(Number(n?.x)) ? Number(n.x) : 0),
              y: Number.isFinite(Number(n?.position?.y))
                ? Number(n.position.y)
                : (Number.isFinite(Number(n?.y)) ? Number(n.y) : 0),
            },
          ];
        }),
      );
      // M4: precompute the moving union rect + snap lines for the drag.
      let unionStart = null;
      let snapLines = null;
      if (st.snapEnabled) {
        const rects = roots.map((r) => rectOf(st.doc.nodes, r));
        if (rects.length > 0) {
          const x = Math.min(...rects.map((r) => r.x));
          const y = Math.min(...rects.map((r) => r.y));
          unionStart = {
            x,
            y,
            w: Math.max(...rects.map((r) => r.x + r.w)) - x,
            h: Math.max(...rects.map((r) => r.y + r.h)) - y,
          };
          const moving = new Set();
          for (const r of roots) {
            for (const sub of G.subtreeIds(st.doc.nodes, r)) {
              moving.add(sub);
            }
          }
          const frameGuides = [];
          for (const f of Object.values(st.doc.nodes)) {
            if (f.type !== "frame" || !f.guides?.length) continue;
            frameGuides.push({
              rect: rectOf(st.doc.nodes, f.id),
              guides: f.guides,
            });
          }
          const firstParentId = roots.length > 0 ? st.doc.nodes[roots[0]]?.parentId ?? null : null;
          const activePageNodeIds = new Set();
          const collectPageNodeIds = (ids) => {
            for (const id of ids ?? []) {
              activePageNodeIds.add(id);
              const n = st.doc.nodes[id];
              if (n?.childIds?.length) collectPageNodeIds(n.childIds);
            }
          };
          collectPageNodeIds(page?.rootNodeIds);

          snapLines = collectSnapLines(
            st.doc.nodes,
            moving,
            frameGuides,
            firstParentId,
            (id) => rectOf(st.doc.nodes, id),
            activePageNodeIds
          );
        }
      }
      beginSession(e, {
        kind: "move",
        clickId: selectId,
        rawHitId: hitId,
        hadModifier: Boolean(e.shiftKey || e.ctrlKey || e.metaKey),
        start: cPt,
        startPt: pt,
        starts,
        engaged: false,
        // M3: pre-gesture snapshot — committed ONCE at pointer-up, so a
        // whole drag stream is a single undo entry.
        historySnapshot: structuredClone(st.doc),
        unionStart,
        snapLines,
        originalRoots: roots,
        originalStarts: starts,
        isDuplicating: false,
        cloneRoots: null,
      });
      return;
    }

    // Empty canvas: marquee (a press without drag just deselects).
    beginSession(e, { kind: "marquee", start: cPt, startPt: pt });
    setMarquee({ x: cPt.x, y: cPt.y, w: 0, h: 0 });
  };

  const onPointerMove = (e) => {
    const session = sessionRef.current;
    const st = store.getState();
    const vp = st.viewport;
    const pt = containerPoint(e);
    const cPt = G.screenToCanvas(vp, pt);

    pointerCanvasPosRef.current = cPt;
    isPointerOverCanvasRef.current = true;

    // M6: publish our cursor as presence (canvas coords). Throttled to
    // 50 ms and only on actual movement / page change; the Collab hook
    // turns store.localCursor changes into transport track() calls.
    {
      const last = cursorSentRef.current;
      const now = performance.now();
      if (shouldSendCursor(last.at, now)) {
        const moved =
          last.x === null ||
          Math.hypot(cPt.x - last.x, cPt.y - last.y) >= 0.5 ||
          last.page !== st.activePageId;
        if (moved) {
          cursorSentRef.current = { at: now, x: cPt.x, y: cPt.y, page: st.activePageId };
          st.setLocalCursor({
            x: Math.round(cPt.x * 100) / 100,
            y: Math.round(cPt.y * 100) / 100,
          });
        } else {
          cursorSentRef.current = { ...last, at: now };
        }
      }
    }

    // M4: pen hover (no button down) — track the cursor for the rubber
    // line and light up the first anchor when a close is in reach.
    if (!session) {
      if (pen) {
        const firstScr = G.canvasToScreen(vp, pen.anchors[0]);
        const hoverClose =
          pen.anchors.length >= 2 &&
          Math.hypot(firstScr.x - pt.x, firstScr.y - pt.y) <= PEN_CLOSE_PX;
        setPen({ ...pen, cursor: cPt, hoverClose });
      } else if (st.activeTool === "move") {
        // Depth-gap batch: guide hover highlight + resize cursor.
        const hit = guideHitAt(st, cPt);
        setGuideHover((prev) => {
          const next = hit
            ? {
                frameId: hit.frame.id,
                guideId: hit.guide.id,
                kind: hit.guide.kind,
                lineAt: hit.lineAt,
                rect: hit.rect,
              }
            : null;
          return prev?.guideId === next?.guideId &&
            prev?.frameId === next?.frameId
            ? prev
            : next;
        });

        // Layer hover detection for canvas inspection
        const isControl = e.target.closest?.(
          "[data-anchor-idx], [data-handle], [data-comment-pin], [data-context-menu]"
        );
        const hitEl = isControl
          ? null
          : e.target.closest?.("[data-node-id], [data-frame-title-id]");
        let hitId =
          hitEl?.dataset.frameTitleId || hitEl?.dataset.nodeId || null;
        if (hitId && G.isNodeHidden(st.doc.nodes, hitId)) {
          hitId = null;
        }
        setHoveredNodeId((prev) => (prev === hitId ? prev : hitId));
      }
      return;
    }

    switch (session.kind) {
      case "guide": {
        // Depth-gap batch: the guide position is TRANSIENT store state
        // (the doc doesn't move); the frame-local coordinate is
        // clamped to the frame's box along the guide's axis.
        const rect = rectOf(st.doc.nodes, session.frameId);
        const raw =
          session.orientation === "v" ? cPt.x - rect.x : cPt.y - rect.y;
        const max = session.orientation === "v" ? rect.w : rect.h;
        const pos = Math.round(Math.max(0, Math.min(max, raw)) * 100) / 100;
        if (pos !== session.currentPos) {
          session.currentPos = pos;
          st.setGuideDrag({
            frameId: session.frameId,
            guideId: session.guideId,
            pos,
          });
        }
        break;
      }
      case "reorder": {
        // Depth-gap batch: flex drag-reorder. The doc is untouched —
        // we compute the target slot from the OTHER siblings' measured
        // rects (visual order along the main axis) and draw a ghost +
        // insertion line; the children array changes once, on release.
        const dist = Math.hypot(
          pt.x - session.startPt.x,
          pt.y - session.startPt.y,
        );
        if (!session.engaged && dist < DRAG_THRESHOLD) return;
        session.engaged = true;
        const parent = st.doc.nodes[session.parentId];
        if (!parent) break;

        const ghostRect = {
          x: session.startRect.x + (cPt.x - session.start.x),
          y: session.startRect.y + (cPt.y - session.start.y),
          w: session.startRect.w,
          h: session.startRect.h,
        };
        const ghostCenter = {
          x: ghostRect.x + ghostRect.w / 2,
          y: ghostRect.y + ghostRect.h / 2,
        };

        const movingSubtree = G.subtreeIds(st.doc.nodes, session.id);
        let targetFrameId = findFrameAtCanvasPoint(cPt, movingSubtree);
        if (!targetFrameId || targetFrameId === session.parentId) {
          const centerTarget = findFrameAtCanvasPoint(ghostCenter, movingSubtree);
          if (centerTarget && centerTarget !== session.parentId) {
            targetFrameId = centerTarget;
          }
        }

        const isHoveringOtherFrame = Boolean(
          targetFrameId && targetFrameId !== session.parentId
        );

        const pRect = rectOf(st.doc.nodes, parent.id);
        const margin = 12 / vp.zoom;
        const isInsideParent =
          cPt.x >= pRect.x - margin &&
          cPt.x <= pRect.x + pRect.w + margin &&
          cPt.y >= pRect.y - margin &&
          cPt.y <= pRect.y + pRect.h + margin;

        const kids = parent.childIds
          .map((id) => st.doc.nodes[id])
          .filter(Boolean);
        const others = inFlowChildren(kids).filter(
          (n) => n.id !== session.id,
        );

        if (isInsideParent && !isHoveringOtherFrame && others.length > 0) {
          session.isOutsideParent = false;
          session.targetFrameId = null;
          setDropTargetFrameId(null);
          const isParentGrid = parent.layout?.mode === "grid";
          if (isParentGrid) {
            const withRects = others.map((n) => {
              const r = rectOf(st.doc.nodes, n.id);
              const cx = r.x + r.w / 2;
              const cy = r.y + r.h / 2;
              const dist = Math.hypot(cPt.x - cx, cPt.y - cy);
              return { id: n.id, rect: r, cx, cy, dist };
            });
            withRects.sort((a, b) => a.dist - b.dist);
            const nearest = withRects[0];
            const without = parent.childIds.filter((id) => id !== session.id);
            const nearestIdx = without.indexOf(nearest.id);
            const isAfter = cPt.x > nearest.cx || (Math.abs(cPt.x - nearest.cx) < 20 && cPt.y > nearest.cy);
            session.insertIndex = Math.max(0, Math.min(without.length, nearestIdx + (isAfter ? 1 : 0)));

            setReorderViz({
              ghost: ghostRect,
              line: {
                x: nearest.rect.x,
                y: nearest.rect.y,
                w: nearest.rect.w,
                h: nearest.rect.h,
                isCell: true,
              },
              name: st.doc.nodes[session.id]?.name ?? "",
            });
          } else {
            const row = parent.layout.direction === "row";
            const axis = row ? "x" : "y";
            const withRects = others.map((n) => ({
              id: n.id,
              rect: rectOf(st.doc.nodes, n.id),
            }));
            withRects.sort((a, b) =>
              row ? a.rect.x - b.rect.x : a.rect.y - b.rect.y,
            );
            const sortedRects = withRects.map((w) => w.rect);
            const vIdx = insertionIndex(sortedRects, axis, row ? cPt.x : cPt.y);

            const without = parent.childIds.filter((id) => id !== session.id);
            session.insertIndex =
              vIdx >= withRects.length
                ? without.indexOf(withRects[withRects.length - 1].id) + 1
                : without.indexOf(withRects[vIdx].id);

            const gap = resolveNumeric(parent.layout.gap, st.doc.tokens);
            const startOf = (r) => (row ? r.x : r.y);
            const endOf = (r) => (row ? r.x + r.w : r.y + r.h);
            let at;
            if (vIdx === 0) at = startOf(sortedRects[0]) - gap / 2;
            else if (vIdx >= sortedRects.length) {
              at = endOf(sortedRects[sortedRects.length - 1]) + gap / 2;
            } else {
              at = (endOf(sortedRects[vIdx - 1]) + startOf(sortedRects[vIdx])) / 2;
            }

            setReorderViz({
              ghost: ghostRect,
              line: row
                ? { x: at, y: pRect.y, w: 0, h: pRect.h }
                : { x: pRect.x, y: at, w: pRect.w, h: 0 },
              name: st.doc.nodes[session.id]?.name ?? "",
            });
          }
        } else {
          session.isOutsideParent = true;
          session.insertIndex = null;
          session.targetFrameId = isHoveringOtherFrame ? targetFrameId : null;
          setDropTargetFrameId(
            isHoveringOtherFrame ? targetFrameId : null,
          );
          setReorderViz({
            ghost: ghostRect,
            line: null,
            name: st.doc.nodes[session.id]?.name ?? "",
          });
        }
        break;
      }
      case "pen": {
        // Click+drag on the newest anchor pulls out a symmetric handle
        // pair and marks the anchor smooth (spec gesture).
        const anchors = pen ? [...pen.anchors] : [];
        const a = anchors[session.index];
        if (!a) break;
        anchors[session.index] = {
          ...a,
          out: { x: cPt.x, y: cPt.y },
          in: { x: 2 * a.x - cPt.x, y: 2 * a.y - cPt.y },
          smooth: true,
        };
        st.setPathFromCanvas(pen.nodeId, anchors, false);
        setPen({ ...pen, anchors, cursor: cPt });
        break;
      }
      case "anchor": {
        // Drag an anchor: the anchor AND its handles move by the delta.
        const dx = (pt.x - session.startPt.x) / vp.zoom;
        const dy = (pt.y - session.startPt.y) / vp.zoom;
        if (dx !== 0 || dy !== 0) session.mutated = true;
        const shift = (p) => (p ? { x: p.x + dx, y: p.y + dy } : null);
        const anchors = session.anchorsCanvas.map((a, i) =>
          i === session.index
            ? { x: a.x + dx, y: a.y + dy, in: shift(a.in), out: shift(a.out), smooth: a.smooth }
            : a,
        );
        const node = st.doc.nodes[session.nodeId];
        st.setPathFromCanvas(session.nodeId, anchors, node?.path?.closed ?? false);
        break;
      }
      case "handle": {
        // Drag one handle; smooth anchors mirror the opposite handle.
        session.mutated = true;
        const anchors = [...session.anchorsCanvas];
        const a = anchors[session.index];
        if (!a) break;
        anchors[session.index] = mirrorHandle(a, session.which, cPt);
        const node = st.doc.nodes[session.nodeId];
        st.setPathFromCanvas(session.nodeId, anchors, node?.path?.closed ?? false);
        break;
      }
      case "pan": {
        st.setViewport({
          ...session.startVp,
          x: session.startVp.x + (pt.x - session.startPt.x),
          y: session.startVp.y + (pt.y - session.startPt.y),
        });
        break;
      }
      case "move": {
        const dist = Math.hypot(
          pt.x - session.startPt.x,
          pt.y - session.startPt.y,
        );
        if (!session.engaged && dist < DRAG_THRESHOLD) return;
        session.engaged = true;

        const isAlt = Boolean(e.altKey || (e.ctrlKey && e.altKey) || (e.metaKey && e.altKey));

        // Alt / Ctrl+Alt duplicate drag toggle
        if (isAlt && !session.isDuplicating && session.originalRoots) {
          const currentDoc = structuredClone(store.getState().doc);
          const baseDoc = session.historySnapshot;
          const cloneIds = [];
          const activePage =
            currentDoc.pages.find((p) => p.id === st.activePageId) ||
            currentDoc.pages[0];

          for (const origId of session.originalRoots) {
            const origNode = baseDoc.nodes[origId];
            if (!origNode) continue;
            const origParent = origNode.parentId ? baseDoc.nodes[origNode.parentId] : null;
            const isOrigFlexChild = origParent?.layout?.mode === "flex" && !origNode.position?.absolute;

            const cloneSubtree = (oldId, parentId) => {
              const oldNode = baseDoc.nodes[oldId];
              if (!oldNode) return null;
              const copy = structuredClone(oldNode);
              copy.id = nextNodeId(currentDoc);
              copy.parentId = parentId;
              currentDoc.nodes[copy.id] = copy;
              copy.childIds = (oldNode.childIds ?? [])
                .map((cid) => cloneSubtree(cid, copy.id))
                .filter(Boolean);
              return copy.id;
            };

            // Restore original node to pre-drag position in currentDoc
            currentDoc.nodes[origId] = structuredClone(origNode);

            const cloneParentId = isOrigFlexChild ? null : origNode.parentId;
            const cloneId = cloneSubtree(origId, cloneParentId);
            if (!cloneId) continue;
            cloneIds.push(cloneId);

            if (isOrigFlexChild) {
              const startPos = session.originalStarts.get(origId) || { x: 0, y: 0 };
              currentDoc.nodes[cloneId].position = { x: startPos.x, y: startPos.y };
              currentDoc.nodes[cloneId].x = startPos.x;
              currentDoc.nodes[cloneId].y = startPos.y;
              activePage.rootNodeIds = [...(activePage.rootNodeIds ?? [])];
              activePage.rootNodeIds.push(cloneId);
            } else if (origNode.parentId && currentDoc.nodes[origNode.parentId]) {
              const parentNode = currentDoc.nodes[origNode.parentId];
              parentNode.childIds = [...(parentNode.childIds ?? [])];
              const idx = parentNode.childIds.indexOf(origId);
              if (idx >= 0) parentNode.childIds.splice(idx + 1, 0, cloneId);
              else parentNode.childIds.push(cloneId);
            } else if (activePage) {
              activePage.rootNodeIds = [...(activePage.rootNodeIds ?? [])];
              const idx = activePage.rootNodeIds.indexOf(origId);
              if (idx >= 0) activePage.rootNodeIds.splice(idx + 1, 0, cloneId);
              else activePage.rootNodeIds.push(cloneId);
            }
          }

          if (cloneIds.length > 0) {
            session.isDuplicating = true;
            session.cloneRoots = cloneIds;
            session.starts = new Map(
              cloneIds.map((cid, i) => {
                const origId = session.originalRoots[i];
                return [
                  cid,
                  { ...(session.originalStarts.get(origId) || { x: 0, y: 0 }) },
                ];
              })
            );
            store.setState({ doc: currentDoc, selection: cloneIds });
          }
        } else if (!isAlt && session.isDuplicating) {
          // Alt released during drag: remove clones, restore original doc and selection
          const revertedDoc = structuredClone(session.historySnapshot);
          session.isDuplicating = false;
          session.cloneRoots = null;
          session.starts = session.originalStarts;
          store.setState({ doc: revertedDoc, selection: session.originalRoots });
        }

        let dx = cPt.x - session.start.x;
        let dy = cPt.y - session.start.y;
        // M4: snapping — correct the delta so the moving union rect
        // aligns to the nearest snap line within 5 screen px.
        if (session.snapLines && session.unionStart) {
          const curMoving = {
            ...session.unionStart,
            x: session.unionStart.x + dx,
            y: session.unionStart.y + dy,
          };
          const snap = computeSnap(
            curMoving,
            session.snapLines,
            Math.min(8, 6 / Math.max(0.2, vp.zoom)),
          );
          dx += snap.dx;
          dy += snap.dy;

          const snappedMoving = {
            ...curMoving,
            x: curMoving.x + snap.dx,
            y: curMoving.y + snap.dy,
          };

          const vList =
            snap.activeVLines && snap.activeVLines.length > 0
              ? snap.activeVLines.map((l) => ({ ...l, movingRect: snappedMoving }))
              : snap.activeV
                ? [{ ...snap.activeV, movingRect: snappedMoving, targetRect: snap.activeV.nodeRect ?? snap.activeV.parentRect }]
                : [];

          const hList =
            snap.activeHLines && snap.activeHLines.length > 0
              ? snap.activeHLines.map((l) => ({ ...l, movingRect: snappedMoving }))
              : snap.activeH
                ? [{ ...snap.activeH, movingRect: snappedMoving, targetRect: snap.activeH.nodeRect ?? snap.activeH.parentRect }]
                : [];

          setSnapViz(
            vList.length > 0 || hList.length > 0
              ? { vList, hList, v: snap.activeV, h: snap.activeH }
              : null,
          );
        }
        const positions = new Map(
          [...session.starts].map(([id, p]) => [
            id,
            { ...p, x: p.x + dx, y: p.y + dy },
          ]),
        );
        store.getState().setNodePositions(positions);

        const currentNodes = store.getState().doc.nodes;
        const movingSubtree = new Set();
        for (const [id] of session.starts) {
          for (const sub of G.subtreeIds(currentNodes, id)) {
            movingSubtree.add(sub);
          }
        }
        const targetFrameId = findFrameAtCanvasPoint(cPt, movingSubtree);
        const firstId = [...session.starts.keys()][0];
        const currentParentId = currentNodes[firstId]?.parentId ?? null;
        setDropTargetFrameId(
          targetFrameId && targetFrameId !== currentParentId
            ? targetFrameId
            : null,
        );
        break;
      }
      case "marquee": {
        const rect = G.normalizeRect(
          session.start.x,
          session.start.y,
          cPt.x,
          cPt.y,
        );
        session.rect = rect;
        setMarquee(rect);
        break;
      }
      case "create": {
        const rect = G.normalizeRect(
          session.start.x,
          session.start.y,
          cPt.x,
          cPt.y,
        );
        session.moved =
          session.moved ||
          rect.w * vp.zoom > DRAG_THRESHOLD ||
          rect.h * vp.zoom > DRAG_THRESHOLD;
        session.rect = rect;
        setDraft(rect);
        const scr = G.canvasRectToScreen(vp, rect);
        setPill({
          x: scr.x + scr.w / 2,
          y: scr.y + scr.h + 10,
          text: `${Math.round(rect.w)} × ${Math.round(rect.h)}`,
        });
        break;
      }
      case "resize": {
        let dx = (pt.x - session.startPt.x) / vp.zoom;
        let dy = (pt.y - session.startPt.y) / vp.zoom;

        if (session.snapLines) {
          const snap = computeResizeSnap(
            session.startRect,
            session.handle,
            dx,
            dy,
            session.snapLines,
            Math.min(8, 6 / Math.max(0.2, vp.zoom)), // capped threshold for sticky snap
          );
          dx = snap.dx;
          dy = snap.dy;
          const currentResized = G.resizeRect(
            session.startRect,
            session.handle,
            dx,
            dy,
            e.shiftKey,
          );
          const vList = snap.activeV
            ? [{ ...snap.activeV, movingRect: currentResized, targetRect: snap.activeV.nodeRect ?? snap.activeV.parentRect }]
            : [];
          const hList = snap.activeH
            ? [{ ...snap.activeH, movingRect: currentResized, targetRect: snap.activeH.nodeRect ?? snap.activeH.parentRect }]
            : [];
          setSnapViz(
            vList.length > 0 || hList.length > 0
              ? { vList, hList, v: snap.activeV, h: snap.activeH }
              : null,
          );
        }

        const rect = G.resizeRect(
          session.startRect,
          session.handle,
          dx,
          dy,
          e.shiftKey,
        );
        if (
          rect.x !== session.startRect.x ||
          rect.y !== session.startRect.y ||
          rect.w !== session.startRect.w ||
          rect.h !== session.startRect.h
        ) {
          session.mutated = true;
        }
        st.setNodeCanvasRect(session.id, rect, session.handle, session.historySnapshot, session.startRect);
        const scr = G.canvasRectToScreen(vp, rect);
        setPill({
          x: scr.x + scr.w / 2,
          y: scr.y + scr.h + 10,
          text: `${Math.round(rect.w)} × ${Math.round(rect.h)}`,
        });
        break;
      }
      case "rotate": {
        const currentAngle =
          Math.atan2(e.clientY - session.centerScreen.y, e.clientX - session.centerScreen.x) *
          (180 / Math.PI);
        let delta = currentAngle - session.startAngle;
        let deg = Math.round(session.startRotation + delta);
        if (e.shiftKey) {
          deg = Math.round(deg / 15) * 15;
        }
        deg = ((deg % 360) + 360) % 360;
        if (deg > 180) deg -= 360;
        session.mutated = true;
        st.setNodeRotation(session.id, deg);
        setPill({
          x: e.clientX,
          y: e.clientY - 24,
          text: `${deg}°`,
        });
        break;
      }
      case "padding": {
        const { id, side, startPad, startPt } = session;
        const dx = (pt.x - startPt.x) / vp.zoom;
        const dy = (pt.y - startPt.y) / vp.zoom;

        let delta = 0;
        if (side === "t") delta = dy;
        else if (side === "b") delta = -dy;
        else if (side === "l") delta = dx;
        else if (side === "r") delta = -dx;

        const isAlt = e.altKey;
        const isShiftAlt = e.shiftKey && e.altKey;

        const nextPad = { ...startPad };
        const rawTarget = Math.max(0, (startPad[side] ?? 0) + delta);
        const targetVal = Math.round(rawTarget);
        nextPad[side] = targetVal;

        if (isShiftAlt) {
          nextPad.t = targetVal;
          nextPad.b = targetVal;
          nextPad.l = targetVal;
          nextPad.r = targetVal;
          nextPad.h = targetVal;
          nextPad.v = targetVal;
        } else if (isAlt) {
          if (side === "t" || side === "b") {
            nextPad.t = targetVal;
            nextPad.b = targetVal;
            nextPad.v = targetVal;
          } else {
            nextPad.l = targetVal;
            nextPad.r = targetVal;
            nextPad.h = targetVal;
          }
        } else {
          // Custom on one side: if opposite sides equal, keep h/v in sync, otherwise decouple
          if (side === "t" || side === "b") {
            if (nextPad.t === nextPad.b) nextPad.v = nextPad.t;
            else delete nextPad.v;
          } else {
            if (nextPad.l === nextPad.r) nextPad.h = nextPad.l;
            else delete nextPad.h;
          }
        }

        session.mutated = true;
        setActivePaddingVal({ side, val: targetVal });

        const node = st.doc.nodes[id];
        if (node) {
          useEditorStore.setState({
            doc: {
              ...st.doc,
              nodes: {
                ...st.doc.nodes,
                [id]: {
                  ...node,
                  layout: {
                    ...node.layout,
                    padding: nextPad,
                  },
                },
              },
            },
          });
        }
        break;
      }
      case "margin": {
        const { id, side, startMar, startPt } = session;
        const dx = (pt.x - startPt.x) / vp.zoom;
        const dy = (pt.y - startPt.y) / vp.zoom;

        let delta = 0;
        if (side === "t") delta = -dy; // moving outward (up) increases margin
        else if (side === "b") delta = dy; // moving outward (down) increases margin
        else if (side === "l") delta = -dx; // moving outward (left) increases margin
        else if (side === "r") delta = dx; // moving outward (right) increases margin

        const isAlt = e.altKey;
        const isShiftAlt = e.shiftKey && e.altKey;

        const nextMar = { ...startMar };
        const rawTarget = Math.max(0, (startMar[side] ?? 0) + delta);
        const targetVal = Math.round(rawTarget);
        nextMar[side] = targetVal;

        if (isShiftAlt) {
          nextMar.t = targetVal;
          nextMar.b = targetVal;
          nextMar.l = targetVal;
          nextMar.r = targetVal;
          nextMar.h = targetVal;
          nextMar.v = targetVal;
        } else if (isAlt) {
          if (side === "t" || side === "b") {
            nextMar.t = targetVal;
            nextMar.b = targetVal;
            nextMar.v = targetVal;
          } else {
            nextMar.l = targetVal;
            nextMar.r = targetVal;
            nextMar.h = targetVal;
          }
        } else {
          if (side === "t" || side === "b") {
            if (nextMar.t === nextMar.b) nextMar.v = nextMar.t;
            else delete nextMar.v;
          } else {
            if (nextMar.l === nextMar.r) nextMar.h = nextMar.l;
            else delete nextMar.h;
          }
        }

        session.mutated = true;
        setActiveMarginVal({ side, val: targetVal });

        const node = st.doc.nodes[id];
        if (node) {
          useEditorStore.setState({
            doc: {
              ...st.doc,
              nodes: {
                ...st.doc.nodes,
                [id]: {
                  ...node,
                  layout: {
                    ...node.layout,
                    margin: nextMar,
                  },
                },
              },
            },
          });
        }
        break;
      }
      case "gap": {
        const { id, startGap, startPt, dir } = session;
        const dx = (pt.x - startPt.x) / vp.zoom;
        const dy = (pt.y - startPt.y) / vp.zoom;
        const delta = dir === "row" ? dx : dy;
        const nextGap = Math.max(0, Math.round(startGap + delta));
        session.mutated = true;
        setActiveGapVal(nextGap);

        const node = st.doc.nodes[id];
        if (node) {
          useEditorStore.setState({
            doc: {
              ...st.doc,
              nodes: {
                ...st.doc.nodes,
                [id]: {
                  ...node,
                  layout: {
                    ...node.layout,
                    gap: nextGap,
                  },
                },
              },
            },
          });
        }
        break;
      }
    }
  };

  const onPointerUp = (e) => {
    const session = sessionRef.current;
    sessionRef.current = null;
    setPanning(false);
    setPill(null);
    setSnapViz(null);
    setDropTargetFrameId(null);
    if (!session) return;
    const st = store.getState();
    const vp = st.viewport;
    const pt = containerPoint(e);
    const cPt = G.screenToCanvas(vp, pt);

    pointerCanvasPosRef.current = cPt;
    isPointerOverCanvasRef.current = true;

    // M3: drag streams commit their pre-gesture snapshot exactly once.
    if (session.kind === "move" && session.engaged && session.historySnapshot) {
      const finalDoc = store.getState().doc;
      const reparents = [];
      const movingSubtree = new Set();
      for (const [id] of session.starts) {
        for (const sub of G.subtreeIds(finalDoc.nodes, id)) {
          movingSubtree.add(sub);
        }
      }

      for (const [id] of session.starts) {
        const node = finalDoc.nodes[id];
        if (!node) continue;

        // Never reparent vector children out of their SVG container
        let isSvgChild = false;
        let c = node;
        while (c && c.parentId && finalDoc.nodes[c.parentId]) {
          if (finalDoc.nodes[c.parentId].type === "svg") {
            isSvgChild = true;
            break;
          }
          c = finalDoc.nodes[c.parentId];
        }
        if (isSvgChild) continue;

        const nRect = rectOf(finalDoc.nodes, id);
        const center = {
          x: nRect.x + nRect.w / 2,
          y: nRect.y + nRect.h / 2,
        };
        let targetFrameId = null;
        if (session.starts.size === 1) {
          targetFrameId = findFrameAtCanvasPoint(cPt, movingSubtree) || findFrameAtCanvasPoint(center, movingSubtree);
        } else {
          targetFrameId = findFrameAtCanvasPoint(center, movingSubtree);
        }

        if (node.parentId !== targetFrameId) {
          if (targetFrameId) {
            const tfRect = rectOf(finalDoc.nodes, targetFrameId);
            const tf = finalDoc.nodes[targetFrameId];
            const isTargetAutoLayout = tf?.layout?.mode === "flex" || tf?.layout?.mode === "grid";
            const isAbs = !isTargetAutoLayout && !!node.position?.absolute;
            const newPos = isTargetAutoLayout
              ? { x: 0, y: 0, absolute: false }
              : {
                  x: Math.round(nRect.x - tfRect.x),
                  y: Math.round(nRect.y - tfRect.y),
                  ...(isAbs ? { absolute: true } : {}),
                };
            reparents.push({ id, newParentId: targetFrameId, newPosition: newPos });
          } else {
            reparents.push({
              id,
              newParentId: null,
              newPosition: {
                x: Math.round(nRect.x),
                y: Math.round(nRect.y),
              },
            });
          }
        }
      }

      st.commitSnapshot(session.historySnapshot);
      if (reparents.length > 0) {
        st.reparentNodesTransient(reparents);
      }
    }
    if (
      session.kind === "move" &&
      !session.engaged &&
      !session.hadModifier
    ) {
      if (session.rawHitId && session.rawHitId !== session.clickId && st.doc.nodes[session.rawHitId]) {
        st.setSelection([session.rawHitId]);
      } else if (session.clickId && st.selection.length > 1) {
        st.setSelection([session.clickId]);
      }
    }
    if (session.kind === "resize" && session.mutated && session.historySnapshot) {
      st.commitSnapshot(session.historySnapshot);
    }
    if (session.kind === "rotate" && session.mutated && session.historySnapshot) {
      st.commitSnapshot(session.historySnapshot);
    }
    if (session.kind === "padding") {
      setActivePaddingVal(null);
      setHoveredPaddingSide(null);
      if (session.mutated && session.historySnapshot) {
        st.commitSnapshot(session.historySnapshot);
      }
    }
    if (session.kind === "margin") {
      setActiveMarginVal(null);
      setHoveredMarginSide(null);
      if (session.mutated && session.historySnapshot) {
        st.commitSnapshot(session.historySnapshot);
      }
    }
    if (session.kind === "gap") {
      setActiveGapVal(null);
      setHoveredGapIndex(null);
      if (session.mutated && session.historySnapshot) {
        st.commitSnapshot(session.historySnapshot);
      }
    }
    // M4: anchor/handle drags follow the same once-per-gesture pattern.
    if (
      (session.kind === "anchor" || session.kind === "handle") &&
      session.mutated &&
      session.historySnapshot
    ) {
      st.commitSnapshot(session.historySnapshot);
    }
    // Depth-gap batch: a finished guide drag commits ONCE through the
    // Guides panel's own patch path (patchNode → one history entry).
    if (session.kind === "guide") {
      st.setGuideDrag(null);
      if (session.currentPos !== session.startPos) {
        const frame = st.doc.nodes[session.frameId];
        if (frame) {
          st.patchNode(session.frameId, {
            guides: (frame.guides ?? []).map((g) =>
              g.id === session.guideId
                ? { ...g, pos: session.currentPos }
                : g,
            ),
          });
        }
      }
    }
    // Depth-gap batch: a reorder drop applies the new order
    // transiently and commits the pre-gesture snapshot once — only
    // when the children array actually changed (dropping back onto
    // the original slot is a no-op, no history entry).
    if (session.kind === "reorder") {
      setReorderViz(null);
      if (!session.engaged) {
        if (session.rawHitId && session.rawHitId !== session.id && st.doc.nodes[session.rawHitId]) {
          st.setSelection([session.rawHitId]);
        }
      } else {
        const isAlt = Boolean(e.altKey || (e.ctrlKey && e.altKey) || (e.metaKey && e.altKey));
        const ghostRect = {
          x: session.startRect.x + (cPt.x - session.start.x),
          y: session.startRect.y + (cPt.y - session.start.y),
          w: session.startRect.w,
          h: session.startRect.h,
        };
        const center = {
          x: ghostRect.x + ghostRect.w / 2,
          y: ghostRect.y + ghostRect.h / 2,
        };
        const movingSubtree = G.subtreeIds(st.doc.nodes, session.id);
        let targetFrameId = session.targetFrameId || findFrameAtCanvasPoint(cPt, movingSubtree);
        if (!targetFrameId || targetFrameId === session.parentId) {
          const centerTarget = findFrameAtCanvasPoint(center, movingSubtree);
          if (centerTarget && centerTarget !== session.parentId) {
            targetFrameId = centerTarget;
          }
        }

        if (isAlt) {
          st.commitSnapshot(session.historySnapshot);
          const currentDoc = structuredClone(st.doc);
          const baseDoc = session.historySnapshot;
          const cloneSubtree = (oldId, parentId) => {
            const oldNode = baseDoc.nodes[oldId];
            if (!oldNode) return null;
            const copy = structuredClone(oldNode);
            copy.id = nextNodeId(currentDoc);
            copy.parentId = parentId;
            currentDoc.nodes[copy.id] = copy;
            copy.childIds = (oldNode.childIds ?? [])
              .map((cid) => cloneSubtree(cid, copy.id))
              .filter(Boolean);
            return copy.id;
          };

          const cloneId = cloneSubtree(session.id, session.parentId);
          if (cloneId) {
            if (targetFrameId && targetFrameId !== session.parentId) {
              const tf = currentDoc.nodes[targetFrameId];
              const tfRect = rectOf(currentDoc.nodes, targetFrameId);
              const isTargetAutoLayout = tf?.layout?.mode === "flex" || tf?.layout?.mode === "grid";
              const newPos = isTargetAutoLayout
                ? { x: 0, y: 0, absolute: false }
                : {
                    x: Math.round(ghostRect.x - tfRect.x),
                    y: Math.round(ghostRect.y - tfRect.y),
                  };
              currentDoc.nodes[cloneId].parentId = targetFrameId;
              currentDoc.nodes[cloneId].position = newPos;
              tf.childIds.unshift(cloneId);
            } else if (!targetFrameId && session.isOutsideParent) {
              const page = currentDoc.pages.find((p) => p.id === st.activePageId) || currentDoc.pages[0];
              currentDoc.nodes[cloneId].parentId = null;
              currentDoc.nodes[cloneId].position = {
                x: Math.round(ghostRect.x),
                y: Math.round(ghostRect.y),
              };
              page?.rootNodeIds.unshift(cloneId);
            } else if (session.insertIndex != null) {
              const pNode = currentDoc.nodes[session.parentId];
              if (pNode) {
                pNode.childIds.splice(session.insertIndex, 0, cloneId);
              }
            } else {
              const pNode = currentDoc.nodes[session.parentId];
              if (pNode) {
                const origIdx = pNode.childIds.indexOf(session.id);
                pNode.childIds.splice(origIdx + 1, 0, cloneId);
              }
            }
            store.setState({ doc: currentDoc, selection: [cloneId] });
            return;
          }
        }

        if (targetFrameId && targetFrameId !== session.parentId) {
          // Adopted into another frame (e.g. empty nested Frame 4 or another frame)
          st.commitSnapshot(session.historySnapshot);
          const tf = st.doc.nodes[targetFrameId];
          const tfRect = rectOf(st.doc.nodes, targetFrameId);
          const isTargetAutoLayout = tf?.layout?.mode === "flex" || tf?.layout?.mode === "grid";
          const newPos = isTargetAutoLayout
            ? { x: 0, y: 0, absolute: false }
            : {
                x: Math.round(ghostRect.x - tfRect.x),
                y: Math.round(ghostRect.y - tfRect.y),
              };
          st.reparentNodeTransient(session.id, targetFrameId, newPos);
        } else if (!targetFrameId && session.isOutsideParent) {
          // Released on empty canvas
          st.commitSnapshot(session.historySnapshot);
          st.reparentNodeTransient(session.id, null, {
            x: Math.round(ghostRect.x),
            y: Math.round(ghostRect.y),
          });
        } else if (session.insertIndex != null) {
          const before = st.doc.nodes[session.parentId]?.childIds ?? [];
          st.reorderChildTransient(
            session.parentId,
            session.id,
            session.insertIndex,
          );
          const after =
            store.getState().doc.nodes[session.parentId]?.childIds ?? [];
          if (before.join("\u0000") !== after.join("\u0000")) {
            st.commitSnapshot(session.historySnapshot);
          }
        }
      }
    }

    if (session.kind === "marquee") {
      const rect = session.rect;
      setMarquee(null);
      const dragged =
        rect && (rect.w * st.viewport.zoom > DRAG_THRESHOLD || rect.h * st.viewport.zoom > DRAG_THRESHOLD);
      if (!dragged) {
        st.setSelection([]);
      } else {
        const hits = page.rootNodeIds.filter(
          (id) =>
            Boolean(st.doc.nodes[id]) &&
            !G.isNodeHidden(st.doc.nodes, id) &&
            G.rectsIntersect(rect, G.absoluteRect(st.doc.nodes, id)),
        );
        st.setSelection(hits);
      }
    }

    if (session.kind === "create") {
      setDraft(null);
      let rect = session.rect ?? {
        x: session.start.x,
        y: session.start.y,
        w: 0,
        h: 0,
      };
      if (!session.moved) {
        const def =
          session.tool === "frame"
            ? DEFAULT_FRAME_SIZE
            : session.tool === "ellipse"
            ? DEFAULT_ELLIPSE_SIZE
            : session.tool === "text"
            ? { w: 100, h: 24 }
            : DEFAULT_RECT_SIZE;
        rect = { x: session.start.x, y: session.start.y, ...def };
      }

      let adoptedChildren = [];
      let actualParentId = session.parentId;

      const drawCanvasRect = {
        x: rect.x,
        y: rect.y,
        w: Math.max(1, rect.w),
        h: Math.max(1, rect.h),
      };

      // Helper: check if the drawn frame completely covers / encloses an existing node
      const isCoveringNode = (cRect, fRect) => {
        if (!cRect || cRect.w <= 0 || cRect.h <= 0) return false;
        // The newly drawn frame must be at least as large as cRect in both dimensions
        if (fRect.w < cRect.w - 4 || fRect.h < cRect.h - 4) return false;

        // Fully enclosed within fRect (with 2px tolerance)
        const fullyEnclosed =
          cRect.x >= fRect.x - 2 &&
          cRect.y >= fRect.y - 2 &&
          cRect.x + cRect.w <= fRect.x + fRect.w + 2 &&
          cRect.y + cRect.h <= fRect.y + fRect.h + 2;
        if (fullyEnclosed) return true;

        // Or mostly covered (at least 85% of cRect is inside fRect)
        const interX1 = Math.max(cRect.x, fRect.x);
        const interY1 = Math.max(cRect.y, fRect.y);
        const interX2 = Math.min(cRect.x + cRect.w, fRect.x + fRect.w);
        const interY2 = Math.min(cRect.y + cRect.h, fRect.y + fRect.h);
        const interW = Math.max(0, interX2 - interX1);
        const interH = Math.max(0, interY2 - interY1);
        const interArea = interW * interH;
        const cArea = cRect.w * cRect.h;

        return cArea > 0 && interArea / cArea >= 0.85;
      };

      // If no parent was set at pointer down, check if the drawn shape is inside an existing frame
      if (!actualParentId) {
        const centerPt = {
          x: drawCanvasRect.x + drawCanvasRect.w / 2,
          y: drawCanvasRect.y + drawCanvasRect.h / 2,
        };
        const targetFrameId = findFrameAtCanvasPoint(centerPt);
        if (targetFrameId) {
          const tr = rectOf(st.doc.nodes, targetFrameId);
          if (tr && !isCoveringNode(tr, drawCanvasRect)) {
            actualParentId = targetFrameId;
          }
        }
      }

      const coversParent = actualParentId
        ? isCoveringNode(rectOf(st.doc.nodes, actualParentId), drawCanvasRect)
        : false;

      // When drawing a frame around or over existing layer elements, adopt them into the new frame
      // ONLY if the new frame truly covers / encloses them.
      if (session.tool === "frame" && session.moved) {
        const frameCanvasRect = drawCanvasRect;

        const pg =
          st.doc.pages.find((p) => p.id === st.activePageId) ?? st.doc.pages[0];
        if (pg) {
          const allPageNodeIds = [];
          const collect = (ids) => {
            for (const cid of ids) {
              allPageNodeIds.push(cid);
              const cn = st.doc.nodes[cid];
              if (cn?.childIds?.length) collect(cn.childIds);
            }
          };
          collect(pg.rootNodeIds);

          const candidateIds = [];
          for (const cid of allPageNodeIds) {
            const cn = st.doc.nodes[cid];
            if (!cn) continue;
            const cRect = rectOf(st.doc.nodes, cid);
            if (!cRect || cRect.w <= 0 || cRect.h <= 0) continue;

            // Only adopt nodes that this newly drawn frame covers
            if (!isCoveringNode(cRect, frameCanvasRect)) continue;

            // If drawn inside an existing frame (actualParentId) and does NOT cover it,
            // never adopt actualParentId or any of its ancestors
            if (actualParentId && !coversParent) {
              if (cid === actualParentId) continue;
              let isAncestor = false;
              let curr = actualParentId;
              while (curr) {
                if (curr === cid) {
                  isAncestor = true;
                  break;
                }
                curr = st.doc.nodes[curr]?.parentId;
              }
              if (isAncestor) continue;
            }

            candidateIds.push(cid);
          }

          // Filter so we only adopt the top-level roots among covered candidates
          const rootCandidateIds = G.selectionRoots(st.doc.nodes, candidateIds);

          // If the new frame covers actualParentId, adopt actualParentId and inherit its parent
          if (actualParentId && coversParent && rootCandidateIds.includes(actualParentId)) {
            actualParentId = st.doc.nodes[actualParentId]?.parentId ?? null;
          }

          adoptedChildren = rootCandidateIds.map((cid) => {
            const cr = rectOf(st.doc.nodes, cid);
            return {
              id: cid,
              x: Math.round(cr.x - frameCanvasRect.x),
              y: Math.round(cr.y - frameCanvasRect.y),
            };
          });
        }
      }

      const parentOrigin = actualParentId
        ? (() => {
            const r = rectOf(st.doc.nodes, actualParentId);
            return { x: r.x, y: r.y };
          })()
        : { x: 0, y: 0 };
      let textOverrides = {};
      if (session.tool === "text") {
        if (session.moved && (rect.w >= 10 || rect.h >= 10)) {
          textOverrides = {
            size: {
              w: { kind: "fixed", px: Math.max(20, Math.round(rect.w)) },
              h: { kind: "fixed", px: Math.max(20, Math.round(rect.h)) },
            },
            text: {
              content: "",
              wrap: "wrap",
              fontSize: 16,
              fontWeight: 400,
              lineHeight: 1.25,
              letterSpacing: 0,
              align: "left",
            },
          };
        } else {
          textOverrides = {
            size: {
              w: { kind: "fit" },
              h: { kind: "fit" },
            },
            text: {
              content: "",
              wrap: "nowrap",
              fontSize: 16,
              fontWeight: 400,
              lineHeight: 1.25,
              letterSpacing: 0,
              align: "left",
            },
          };
        }
      }

      const node = {
        ...createNode(
          st.doc,
          session.tool,
          {
            x: rect.x,
            y: rect.y,
            w: Math.max(1, rect.w),
            h: Math.max(1, rect.h),
          },
          actualParentId,
        ),
        position: {
          x: Math.round(rect.x - parentOrigin.x),
          y: Math.round(rect.y - parentOrigin.y),
        },
        ...textOverrides,
      };
      st.addNode(node, adoptedChildren);
      st.setActiveTool("move");
      if (session.tool === "text") {
        st.setSelection([node.id]);
        st.setEditingTextId(node.id);
      }
    }
    void e;
  };

  const onHandlePointerDown = (e, handle) => {
    e.stopPropagation();
    e.preventDefault();
    containerRef.current.focus();
    const st = store.getState();
    const id = st.selection[0];
    if (!id) return;

    let snapLines = null;
    let parentRect = null;
    if (st.snapEnabled) {
      const moving = new Set([id]);
      for (const sub of G.subtreeIds(st.doc.nodes, id)) {
        moving.add(sub);
      }
      const frameGuides = [];
      for (const f of Object.values(st.doc.nodes)) {
        if (f.type !== "frame" || !f.guides?.length) continue;
        frameGuides.push({
          rect: rectOf(st.doc.nodes, f.id),
          guides: f.guides,
        });
      }
      const parentId = st.doc.nodes[id]?.parentId ?? null;
      snapLines = collectSnapLines(
        st.doc.nodes,
        moving,
        frameGuides,
        parentId,
        (nid) => rectOf(st.doc.nodes, nid)
      );
      if (parentId && st.doc.nodes[parentId]) {
        parentRect = rectOf(st.doc.nodes, parentId);
      }
    }

    beginSession(e, {
      kind: "resize",
      id,
      handle,
      startPt: containerPoint(e),
      startRect: rectOf(st.doc.nodes, id),
      historySnapshot: structuredClone(st.doc),
      snapLines,
      parentRect,
      mutated: false,
    });
  };

  const onRotateHandlePointerDown = (e, handle) => {
    e.stopPropagation();
    e.preventDefault();
    containerRef.current?.focus?.();
    const st = store.getState();
    const id = st.selection[0];
    if (!id) return;
    const node = st.doc.nodes[id];
    if (!node) return;
    const rect = rectOf(st.doc.nodes, id);
    if (!rect) return;

    const centerCanvas = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    const centerScreen = G.canvasToScreen(st.viewport, centerCanvas);
    const startAngle =
      Math.atan2(e.clientY - centerScreen.y, e.clientX - centerScreen.x) *
      (180 / Math.PI);
    const startRotation = Number(node.rotation) || 0;

    beginSession(e, {
      kind: "rotate",
      id,
      handle,
      centerScreen,
      startAngle,
      startRotation,
      historySnapshot: structuredClone(st.doc),
      mutated: false,
    });
  };

  const onPaddingHandlePointerDown = (e, side, padObj) => {
    e.stopPropagation();
    e.preventDefault();
    containerRef.current.focus();
    const st = store.getState();
    const id = st.selection[0];
    if (!id) return;

    setActivePaddingVal({ side, val: formatPaddingVal(padObj[side]) });

    beginSession(e, {
      kind: "padding",
      id,
      side,
      startPt: containerPoint(e),
      startPad: padObj,
      historySnapshot: structuredClone(st.doc),
      mutated: false,
    });
  };

  const onMarginHandlePointerDown = (e, side, marObj) => {
    e.stopPropagation();
    e.preventDefault();
    containerRef.current?.focus();
    const st = store.getState();
    const id = st.selection[0];
    if (!id) return;

    setActiveMarginVal({ side, val: formatPaddingVal(marObj[side]) });

    beginSession(e, {
      kind: "margin",
      id,
      side,
      startPt: containerPoint(e),
      startMar: marObj,
      historySnapshot: structuredClone(st.doc),
      mutated: false,
    });
  };

  const onGapHandlePointerDown = (e, id, currentGap, dir, index) => {
    e.stopPropagation();
    e.preventDefault();
    containerRef.current?.focus();
    const st = store.getState();
    setActiveGapVal(currentGap);
    setHoveredGapIndex(index);
    beginSession(e, {
      kind: "gap",
      id,
      dir,
      index,
      startPt: containerPoint(e),
      startGap: currentGap,
      historySnapshot: structuredClone(st.doc),
      mutated: false,
    });
  };

  const onDoubleClick = (e) => {
    // M7: no text editing / anchor mode while previewing a version.
    if (store.getState().previewVersionId) return;
    // Depth-gap batch: double-clicking a line guide DELETES it (one
    // commit, through the Guides panel's patch path). Guides sit
    // above nodes, so this check comes before the node handling; the
    // press that started this double-click ran a no-move guide drag,
    // which commits nothing.
    {
      const st0 = store.getState();
      const gHit = guideHitAt(st0, canvasPoint(e));
      if (gHit) {
        st0.patchNode(gHit.frame.id, {
          guides: (gHit.frame.guides ?? []).filter(
            (g) => g.id !== gHit.guide.id,
          ),
        });
        return;
      }
    }
    const hitEl =
      e.target.closest?.("[data-node-id], [data-frame-title-id]") ||
      (typeof document !== "undefined"
        ? document
            .elementFromPoint?.(e.clientX, e.clientY)
            ?.closest?.("[data-node-id], [data-frame-title-id]")
        : null);
    const frameTitleId =
      hitEl?.dataset?.frameTitleId ||
      hitEl?.closest?.("[data-frame-title-id]")?.dataset?.frameTitleId;
    if (frameTitleId) {
      window.dispatchEvent(
        new CustomEvent("canvas:rename-frame-title", {
          detail: { id: frameTitleId, target: "canvas" },
        })
      );
      return;
    }
    const hitId = hitEl?.dataset.frameTitleId || hitEl?.dataset.nodeId;
    const st = store.getState();
    const node = hitId ? st.doc.nodes[hitId] : null;
    if (!node) return;
    // M4: double-click a path → anchor-edit mode.
    if (node.type === "path") {
      st.setSelection([hitId]);
      st.setEditingPathId(hitId);
      st.setSelectedAnchorIndex(0);
      return;
    }
    // Double-clicking top border of a parent frame on canvas
    if (node.type === "frame") {
      const rect = rectOf(st.doc.nodes, hitId);
      const cPt = canvasPoint(e);
      if (rect && cPt && cPt.y <= rect.y + 10) {
        window.dispatchEvent(
          new CustomEvent("canvas:rename-frame-title", {
            detail: { id: hitId, target: "canvas" },
          })
        );
        return;
      }
    }
    if (node.type !== "text") return;
    st.setSelection([hitId]);
    st.setEditingTextId(hitId);
  };

  // -- M4: artboard navigation (N / Shift+N) -----------------------------------
  // Cycle the selection through the page's top-level FRAMES in layer
  // order, centring the view on each (fit with padding, zoom ≤ 200%).
  const cycleArtboard = (dir) => {
    const st = store.getState();
    const frames = page.rootNodeIds.filter(
      (id) => st.doc.nodes[id]?.type === "frame",
    );
    if (frames.length === 0) return;
    const current = frames.findIndex((id) => st.selection.includes(id));
    const nextIdx =
      current === -1
        ? dir > 0
          ? 0
          : frames.length - 1
        : (current + dir + frames.length) % frames.length;
    const id = frames[nextIdx];
    st.setSelection([id]);
    const rect = G.absoluteRect(st.doc.nodes, id);
    const fit = G.fitViewport(rect, st.canvasSize, 64);
    if (fit.zoom <= 2) {
      st.setViewport(fit);
    } else {
      st.setViewport({
        zoom: 2,
        x: st.canvasSize.w / 2 - (rect.x + rect.w / 2) * 2,
        y: st.canvasSize.h / 2 - (rect.y + rect.h / 2) * 2,
      });
    }
  };

  // -- keyboard ------------------------------------------------------------------

  const isTypingTarget = (t) =>
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    (t instanceof HTMLElement && (t.isContentEditable || t.getAttribute("contenteditable") === "true"));

  const onKeyDown = (e) => {
    if (isTypingTarget(e.target)) return;
    const st = store.getState();

    // Layer Ordering shortcuts (Figma standard)
    // Bring to front: Ctrl+Shift+] or bare ]
    // Send to back: Ctrl+Shift+[ or bare [
    // Move forward: Ctrl+]
    // Move backward: Ctrl+[
    const modKey = e.ctrlKey || e.metaKey;
    if (modKey && e.shiftKey && (e.key === "]" || e.key === "}")) {
      e.preventDefault();
      handleMoveZ(null, "front");
      return;
    }
    if (modKey && e.shiftKey && (e.key === "[" || e.key === "{")) {
      e.preventDefault();
      handleMoveZ(null, "back");
      return;
    }
    if (modKey && !e.shiftKey && (e.key === "]" || e.key === "}")) {
      e.preventDefault();
      handleMoveZ(null, "forward");
      return;
    }
    if (modKey && !e.shiftKey && (e.key === "[" || e.key === "{")) {
      e.preventDefault();
      handleMoveZ(null, "backward");
      return;
    }
    if (!modKey && !e.altKey && !e.shiftKey && e.key === "]") {
      e.preventDefault();
      handleMoveZ(null, "front");
      return;
    }
    if (!modKey && !e.altKey && !e.shiftKey && e.key === "[") {
      e.preventDefault();
      handleMoveZ(null, "back");
      return;
    }

    if (e.key === "Alt") {
      setAltHeld(true);
    }

    if (e.key === " ") {
      if (!e.repeat) setSpaceHeld(true);
      e.preventDefault();
      return;
    }

    // Depth-gap batch: Escape cancels an in-flight guide/reorder drag.
    // Neither gesture has touched the doc yet (guide = transient store
    // state, reorder applies on release), so cancelling is just
    // dropping the session and its visuals.
    if (
      e.key === "Escape" &&
      sessionRef.current &&
      (sessionRef.current.kind === "reorder" ||
        sessionRef.current.kind === "guide")
    ) {
      sessionRef.current = null;
      setReorderViz(null);
      st.setGuideDrag(null);
      e.preventDefault();
      return;
    }

    // M7: while previewing a version, only view-only keys work —
    // Escape exits the preview; zoom steps / zoom-to-100% and the
    // hide-UI toggles stay available. Everything else (undo, nudge,
    // delete, duplicate, tools…) is blocked so the live doc cannot
    // change under the snapshot.
    if (st.previewVersionId) {
      const modP = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        st.setPreviewVersion(null);
      } else if (modP && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        zoomByStep(1);
      } else if (modP && e.key === "-") {
        e.preventDefault();
        zoomByStep(-1);
      } else if (e.shiftKey && !modP && e.code === "Digit0") {
        e.preventDefault();
        zoomTo100();
      } else if (e.key === ".") {
        e.preventDefault();
        st.setUiMode(st.uiMode === "hidden" ? "full" : "hidden");
      } else if (e.key === ">") {
        e.preventDefault();
        st.setUiMode(st.uiMode === "collapsed" ? "full" : "collapsed");
      }
      return;
    }

    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) st.redo();
      else st.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      st.redo();
      return;
    }
    // M4: Ctrl+Shift+K = Place image (spec entry route).
    if (mod && e.shiftKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openPlaceImage();
      return;
    }
    // Alt + C = Toggle Clip Content
    if (e.altKey && !mod && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      if (st.selection.length === 1) {
        const n = st.doc.nodes[st.selection[0]];
        if (n && n.type === "frame") {
          const nextClip = !(n.clipContent || n.style?.overflow === "hidden");
          st.patchNode(n.id, { clipContent: nextClip });
          st.patchNodeStyle(n.id, { overflow: nextClip ? "hidden" : undefined });
        }
      }
      return;
    }
    // Ctrl + Shift + Alt + R = Resize to fit
    if (mod && e.shiftKey && e.altKey && (e.key === "r" || e.key === "R")) {
      e.preventDefault();
      if (st.selection.length === 1) {
        st.setNodeSizing(st.selection[0], "w", { kind: "fit" });
        st.setNodeSizing(st.selection[0], "h", { kind: "fit" });
      }
      return;
    }
    // Ctrl + Shift + Alt + F = Resize to fill
    if (mod && e.shiftKey && e.altKey && (e.key === "f" || e.key === "F")) {
      e.preventDefault();
      if (st.selection.length === 1) {
        st.setNodeSizing(st.selection[0], "w", { kind: "fill" });
        st.setNodeSizing(st.selection[0], "h", { kind: "fill" });
      }
      return;
    }
    // Ctrl + Shift + H = Show / hide selection
    if (mod && e.shiftKey && (e.key === "h" || e.key === "H")) {
      e.preventDefault();
      if (st.selection.length > 0) {
        const anyVisible = st.selection.some((id) => !G.isNodeHidden(st.doc.nodes, id));
        const willHide = anyVisible;
        for (const id of st.selection) {
          st.patchNode(id, {
            hidden: willHide,
            visible: !willHide,
            style: { ...(st.doc.nodes[id]?.style ?? {}), opacity: willHide ? 0 : 1 },
          });
        }
        if (willHide) {
          st.setSelection([]);
        }
      }
      return;
    }
    // Shift + A = Add flex / wrap in flex
    if (!mod && e.shiftKey && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      if (st.selection.length === 1) {
        st.addFlex(st.selection[0]);
      }
      return;
    }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      st.setSelection(
        page.rootNodeIds.filter(
          (id) => Boolean(st.doc.nodes[id]) && !G.isNodeHidden(st.doc.nodes, id)
        )
      );
      return;
    }
    if (mod && (e.key === "c" || e.key === "C")) {
      const copied = copySelectedNodes();
      if (copied) {
        e.preventDefault();
        return;
      }
    }
    if (mod && (e.key === "v" || e.key === "V")) {
      e.preventDefault();
      executePaste();
      return;
    }
    if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      st.duplicateSelection();
      return;
    }
    if (mod && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      zoomByStep(1);
      return;
    }
    if (mod && e.key === "-") {
      e.preventDefault();
      zoomByStep(-1);
      return;
    }
    if (e.shiftKey && !mod && e.code === "Digit0") {
      e.preventDefault();
      zoomTo100();
      return;
    }
    if (e.shiftKey && !mod && e.code === "Digit1") {
      e.preventDefault();
      zoomToFit();
      return;
    }
    if (e.shiftKey && !mod && e.code === "Digit2") {
      e.preventDefault();
      zoomToSelection();
      return;
    }

    // M4: hide-UI toggles (Phase 3 §1). "." hides/shows all chrome;
    if (e.key === "." || e.key === ">") {
      e.preventDefault();
      st.setUiMode(st.uiMode === "hidden" || st.uiMode === "collapsed" ? "full" : "hidden");
      return;
    }

    // Depth-gap batch: "/" opens cursor chat, anchored at our last
    // known cursor position (viewport centre when the pointer has
    // never been over the canvas). Solo (no transport at all) gets a
    // hint instead — there is nobody to talk to.
    if (e.key === "/") {
      e.preventDefault();
      if (st.collabMode === "off") {
        st.showToast({
          message:
            "Cursor chat needs a live session — open this file in a second tab",
        });
      } else {
        const anchor = st.localCursor
          ? G.canvasToScreen(st.viewport, st.localCursor)
          : { x: st.canvasSize.w / 2, y: st.canvasSize.h / 2 };
        setChatDraft({ text: "", anchor });
      }
      return;
    }

    if (e.altKey && e.shiftKey && (e.key === "O" || e.key === "o")) {
      e.preventDefault();
      st.organizeFrames();
      return;
    }

    switch (e.key) {
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown": {
        if (st.editingPathId) return; // arrows don't nudge in anchor mode
        if (st.selection.length === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE : NUDGE_SMALL;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        st.moveSelectionBy(dx, dy);
        break;
      }
      case "Delete":
      case "Backspace":
        e.preventDefault();
        // M4: in anchor mode, Delete removes the SELECTED ANCHOR.
        if (st.editingPathId && st.selectedAnchorIndex != null) {
          st.deletePathAnchor(st.editingPathId, st.selectedAnchorIndex);
        } else {
          st.deleteSelection();
        }
        break;
      case "Enter":
        // M4: Enter finishes an open pen path.
        if (pen) {
          e.preventDefault();
          finishPen(false);
        }
        break;
      case "Escape":
        // M4 first: finish an open pen path; then leave anchor mode.
        // Then the M3 chain: cancel a comment draft, close an open
        // thread, leave comment mode — only then step selection out.
        if (pen) finishPen(false);
        else if (st.editingPathId) {
          st.setEditingPathId(null);
          st.setSelectedAnchorIndex(null);
        } else if (st.commentDraft) st.setCommentDraft(null);
        else if (st.activeCommentId) st.setActiveCommentId(null);
        else if (st.activeTool === "comment") st.setActiveTool("move");
        else st.escapeSelection();
        break;
      case "n":
        e.preventDefault();
        cycleArtboard(1);
        break;
      case "N":
        e.preventDefault();
        cycleArtboard(-1);
        break;
      case "v":
        st.setActiveTool("move");
        break;
      case "h":
        st.setActiveTool("pan");
        break;
      case "f":
        st.setActiveTool("frame");
        break;
      case "r":
        st.setActiveTool("rect");
        break;
      case "t":
        st.setActiveTool("text");
        break;
      case "p":
        st.setActiveTool("pen");
        break;
      case "c":
        st.setActiveTool("comment");
        break;
    }
  };

  const onKeyUp = (e) => {
    if (e.key === " ") setSpaceHeld(false);
    if (e.key === "Alt") setAltHeld(false);
  };

  // -- overlay geometry ------------------------------------------------------------

  const selRects = selection
    .filter((id) => doc.nodes[id] && !G.isNodeHidden(doc.nodes, id))
    .map((id) => ({ id, rect: rectOf(doc.nodes, id) }));
  const unionRect =
    selRects.length > 1
      ? G.rectUnion(selRects.map((s) => s.rect))
      : null;
  const singleNode = selRects.length === 1 ? doc.nodes[selRects[0].id] : null;
  const singleParent = singleNode?.parentId
    ? doc.nodes[singleNode.parentId]
    : null;
  const singleInFlowFlexChild =
    (singleParent?.layout?.mode === "flex" || singleParent?.layout?.mode === "grid") && !singleNode?.position?.absolute;
  const singleRect = selRects.length === 1 ? selRects[0].rect : null;

  // Parent frames of currently selected child layers (shown with dotted outline)
  const parentFrames = useMemo(() => {
    if (previewing || uiMode === "hidden") return [];
    const pIds = new Set();
    for (const id of selection) {
      const node = doc.nodes[id];
      if (node?.parentId && doc.nodes[node.parentId]) {
        const parent = doc.nodes[node.parentId];
        if (!selection.includes(parent.id) && (parent.type === "frame" || parent.type === "rect")) {
          pIds.add(parent.id);
        }
      }
    }
    return Array.from(pIds)
      .map((pId) => ({
        id: pId,
        node: doc.nodes[pId],
        rect: rectOf(doc.nodes, pId),
      }))
      .filter((p) => p.rect && p.rect.w > 0 && p.rect.h > 0);
  }, [selection, doc.nodes, previewing, uiMode]);

  const cursor =
    panning || activeTool === "pan"
      ? panning
        ? "var(--cursor-hand-closed, grabbing)"
        : "var(--cursor-hand-open, grab)"
      : spaceHeld
        ? "var(--cursor-hand-open, grab)"
        : activeTool === "pen"
          ? "var(--cursor-pen, crosshair)"
          : activeTool === "comment"
            ? "var(--cursor-comment, crosshair)"
            : activeTool === "frame" ||
                activeTool === "rect" ||
                activeTool === "ellipse" ||
                activeTool === "slice"
              ? "var(--cursor-crosshair, crosshair)"
              : activeTool === "text"
                ? "var(--cursor-text, text)"
                : (sessionRef.current?.isDuplicating || altHeld)
                  ? "var(--cursor-arrow-duplicate, copy)"
                  : "var(--cursor-default, default)";

  // Depth-gap batch: hovering a guide strip (or dragging a guide)
  // switches to the axis resize cursor — v guides resize horizontally.
  const dragGuideKind = guideDrag
    ? (doc.nodes[guideDrag.frameId]?.guides?.find(
        (g) => g.id === guideDrag.guideId,
      )?.kind ?? null)
    : null;
  const guideCursorKind =
    dragGuideKind ?? (activeTool === "move" ? (guideHover?.kind ?? null) : null);

  const activePadSide =
    sessionRef.current?.kind === "padding"
      ? sessionRef.current.side
      : hoveredPaddingSide;
  const paddingCursor =
    activePadSide && !panning && !spaceHeld
      ? activePadSide === "t" || activePadSide === "b"
        ? PADDING_CURSOR_V
        : PADDING_CURSOR_H
      : null;

  const activeMarSide =
    sessionRef.current?.kind === "margin"
      ? sessionRef.current.side
      : hoveredMarginSide;
  const marginCursor =
    activeMarSide && !panning && !spaceHeld
      ? activeMarSide === "t" || activeMarSide === "b"
        ? MARGIN_CURSOR_V
        : MARGIN_CURSOR_H
      : null;

  const isGapActive = sessionRef.current?.kind === "gap" || hoveredGapIndex !== null;
  const gapDir = sessionRef.current?.dir ?? (singleNode?.layout?.direction ?? "column");
  const gapCursor = isGapActive && !panning && !spaceHeld
    ? (gapDir === "row" ? "var(--cursor-resize-col, col-resize)" : "var(--cursor-resize-row, row-resize)")
    : null;

  const isRotateActive = sessionRef.current?.kind === "rotate";
  const effectiveCursor =
    (isRotateActive ? "var(--cursor-rotate, crosshair)" : null) ??
    (sessionRef.current?.isDuplicating && !panning && !spaceHeld ? "var(--cursor-arrow-duplicate, copy)" : null) ??
    gapCursor ??
    paddingCursor ??
    marginCursor ??
    (guideCursorKind && !panning && !spaceHeld
      ? guideCursorKind === "v"
        ? "var(--cursor-resize-ew, ew-resize)"
        : "var(--cursor-resize-ns, ns-resize)"
      : cursor);

  const outlineStyle = {
    position: "absolute",
    border: "1.5px solid var(--accent)",
    pointerEvents: "none",
    boxSizing: "border-box",
    zIndex: 25,
  };

  // Depth-gap batch: the guide line to highlight — the one being
  // dragged (at its transient store position, accent colour) or the
  // one under the pointer (its own guide colour). Canvas coords.
  const guideLineViz = (() => {
    if (previewing) return null;
    if (!guideDrag && activeTool !== "move") return null;
    if (guideDrag) {
      const frame = doc.nodes[guideDrag.frameId];
      const g = frame?.guides?.find((x) => x.id === guideDrag.guideId);
      if (!frame || !g || (g.kind !== "v" && g.kind !== "h")) return null;
      const rect = rectOf(doc.nodes, frame.id);
      return {
        kind: g.kind,
        lineAt: (g.kind === "v" ? rect.x : rect.y) + guideDrag.pos,
        rect,
        active: true,
        color: g.color,
      };
    }
    if (guideHover) {
      const frame = doc.nodes[guideHover.frameId];
      const g = frame?.guides?.find((x) => x.id === guideHover.guideId);
      if (!g) return null;
      return {
        kind: guideHover.kind,
        lineAt: guideHover.lineAt,
        rect: guideHover.rect,
        active: false,
        color: g.color,
      };
    }
    return null;
  })();

  // Attach global keyboard shortcuts so layer ordering and hotkeys work
  // whether canvas or sidebar has active focus.
  useEffect(() => {
    const handleGlobalKeyDown = (e) => onKeyDown(e);
    const handleGlobalKeyUp = (e) => onKeyUp(e);
    window.addEventListener("keydown", handleGlobalKeyDown);
    window.addEventListener("keyup", handleGlobalKeyUp);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
      window.removeEventListener("keyup", handleGlobalKeyUp);
    };
  }, [onKeyDown, onKeyUp]);

  return (
    <main
      ref={containerRef}
      data-canvas-viewport="true"
      tabIndex={0}
      className="relative flex-1 w-full h-full min-h-0 min-w-0 overflow-hidden outline-none"
      style={{ background: page?.background || "var(--surface-canvas)", cursor: effectiveCursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerEnter={() => {
        isPointerOverCanvasRef.current = true;
      }}
      onPointerLeave={() => {
        isPointerOverCanvasRef.current = false;
        // M6: leaving the canvas hides our cursor for everyone.
        cursorSentRef.current = { at: 0, x: null, y: null, page: null };
        store.getState().setLocalCursor(null);
        setGuideHover(null);
        setHoveredNodeId(null);
      }}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onBlur={() => {
        setSpaceHeld(false);
        setAltHeld(false);
      }}
      onContextMenu={onContextMenu}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >

      {/* world */}
      <div
        className="absolute left-0 top-0"
        style={{
          width: 1,
          height: 1,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          transformOrigin: "0 0",
        }}
      >
        {page.rootNodeIds
          .filter((id) => Boolean(renderDoc.nodes[id]))
          .map((id, idx, arr) => (
            <CanvasNode
              key={id}
              node={renderDoc.nodes[id]}
              nodes={renderDoc.nodes}
              tokens={tokens}
              assets={renderDoc.assets ?? {}}
              zIndexOverride={arr.length - idx + 1}
            />
          ))}
        {/* M4: pen preview — the in-progress path + rubber segment to the
            cursor, drawn in the world (canvas coords) so it scales. */}
        {pen && (
          <svg
            width="1"
            height="1"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              overflow: "visible",
              pointerEvents: "none",
              zIndex: 999999,
            }}
          >
            <path
              d={
                anchorsToD(pen.anchors, false) +
                (pen.cursor
                  ? ` L ${Math.round(pen.cursor.x * 100) / 100} ${Math.round(pen.cursor.y * 100) / 100}`
                  : "")
              }
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1.5 / viewport.zoom}
            />
            {pen.anchors.map((a, i) => (
              <circle
                key={i}
                cx={a.x}
                cy={a.y}
                r={3.5 / viewport.zoom}
                fill={
                  i === 0 && pen.hoverClose
                    ? "var(--accent)"
                    : "var(--surface-content)"
                }
                stroke="var(--accent)"
                strokeWidth={1.5 / viewport.zoom}
              />
            ))}
          </svg>
        )}
        {draft && (
          <div
            style={{
              position: "absolute",
              left: draft.x,
              top: draft.y,
              width: Math.max(0, draft.w),
              height: Math.max(0, draft.h),
              background:
                activeTool === "frame"
                  ? "rgba(255,255,255,0.65)"
                  : activeTool === "ellipse"
                    ? "rgba(16,185,129,0.25)"
                    : "rgba(59,130,246,0.25)",
              border: "1px solid var(--accent)",
              boxSizing: "border-box",
              zIndex: 999999,
              pointerEvents: "none",
            }}
          />
        )}
      </div>

      {/* Parent frame dotted outline when a child layer is selected */}
      {!previewing && uiMode !== "hidden" && parentFrames.map(({ id, rect, node }) => {
        if (hoveredNodeId === id) return null;
        const scr = G.canvasRectToScreen(viewport, rect);
        if (isNaN(scr.x) || isNaN(scr.y) || isNaN(scr.w) || isNaN(scr.h)) return null;

        const rot = nodeCanvasRotation(doc.nodes, id);
        const hasRot = rot % 360 !== 0;

        const r = node?.style?.radius;
        const borderRadius = typeof r === "number"
          ? `${r * viewport.zoom}px`
          : typeof r === "object"
            ? `${(r.tl ?? 0) * viewport.zoom}px ${(r.tr ?? 0) * viewport.zoom}px ${(r.br ?? 0) * viewport.zoom}px ${(r.bl ?? 0) * viewport.zoom}px`
            : undefined;

        return (
          <div
            key={`parent-dotted-${id}`}
            style={{
              position: "absolute",
              left: scr.x,
              top: scr.y,
              width: scr.w,
              height: scr.h,
              border: "1px dashed #0D99FF",
              borderRadius,
              pointerEvents: "none",
              boxSizing: "border-box",
              zIndex: 14,
              transformOrigin: "center center",
              transform: hasRot ? `rotate(${rot}deg)` : undefined,
            }}
          />
        );
      })}

      {/* selection overlay (screen space) */}
      {selRects.map(({ id, rect }) => {
        if (id === editingTextId) return null;
        const node = doc.nodes[id];
        const rot = nodeCanvasRotation(doc.nodes, id);
        const scr = G.canvasRectToScreen(viewport, rect);
        return (
          <div
            key={id}
            style={{
              ...outlineStyle,
              left: scr.x,
              top: scr.y,
              width: scr.w,
              height: scr.h,
              pointerEvents: "none",
              ...(rot && selRects.length === 1
                ? {
                    transform: `rotate(${rot}deg)`,
                    transformOrigin: "center center",
                  }
                : {}),
            }}
          />
        );
      })}

      {/* Layer constraint lines connecting to parent frame edges based on selected side (only when absolute position) */}
      {!previewing && uiMode !== "hidden" && !sessionRef.current && !editingTextId && singleNode && singleRect && singleNode.parentId && Boolean(singleNode.position?.absolute) && (() => {
        const parentNode = doc.nodes[singleNode.parentId];
        if (!parentNode) return null;
        const parentRect = rectOf(doc.nodes, singleNode.parentId);
        if (!parentRect) return null;

        const singleScr = G.canvasRectToScreen(viewport, singleRect);
        const parentScr = G.canvasRectToScreen(viewport, parentRect);

        const hConstraint = singleNode.constraints?.horizontal ?? "start";
        const vConstraint = singleNode.constraints?.vertical ?? "start";

        const elemMidX = singleScr.x + singleScr.w / 2;
        const elemMidY = singleScr.y + singleScr.h / 2;

        return (
          <div key={`constraint-lines-${singleNode.id}`} className="pointer-events-none">
            {/* Top constraint line */}
            {(vConstraint === "start" || vConstraint === "stretch" || vConstraint === "scale") && singleScr.y > parentScr.y && (
              <div
                style={{
                  position: "absolute",
                  left: elemMidX,
                  top: parentScr.y,
                  width: 0,
                  height: singleScr.y - parentScr.y,
                  borderLeft: "1px dashed #0D99FF",
                  zIndex: 15,
                }}
              />
            )}

            {/* Bottom constraint line */}
            {(vConstraint === "end" || vConstraint === "stretch" || vConstraint === "scale") && parentScr.y + parentScr.h > singleScr.y + singleScr.h && (
              <div
                style={{
                  position: "absolute",
                  left: elemMidX,
                  top: singleScr.y + singleScr.h,
                  width: 0,
                  height: (parentScr.y + parentScr.h) - (singleScr.y + singleScr.h),
                  borderLeft: "1px dashed #0D99FF",
                  zIndex: 15,
                }}
              />
            )}

            {/* Center vertical constraint line */}
            {vConstraint === "center" && (
              <div
                style={{
                  position: "absolute",
                  left: elemMidX,
                  top: Math.min(elemMidY, parentScr.y + parentScr.h / 2),
                  width: 0,
                  height: Math.abs(elemMidY - (parentScr.y + parentScr.h / 2)),
                  borderLeft: "1px dashed #0D99FF",
                  zIndex: 15,
                }}
              />
            )}

            {/* Left constraint line */}
            {(hConstraint === "start" || hConstraint === "stretch" || hConstraint === "scale") && singleScr.x > parentScr.x && (
              <div
                style={{
                  position: "absolute",
                  left: parentScr.x,
                  top: elemMidY,
                  width: singleScr.x - parentScr.x,
                  height: 0,
                  borderTop: "1px dashed #0D99FF",
                  zIndex: 15,
                }}
              />
            )}

            {/* Right constraint line */}
            {(hConstraint === "end" || hConstraint === "stretch" || hConstraint === "scale") && parentScr.x + parentScr.w > singleScr.x + singleScr.w && (
              <div
                style={{
                  position: "absolute",
                  left: singleScr.x + singleScr.w,
                  top: elemMidY,
                  width: (parentScr.x + parentScr.w) - (singleScr.x + singleScr.w),
                  height: 0,
                  borderTop: "1px dashed #0D99FF",
                  zIndex: 15,
                }}
              />
            )}

            {/* Center horizontal constraint line */}
            {hConstraint === "center" && (
              <div
                style={{
                  position: "absolute",
                  left: Math.min(elemMidX, parentScr.x + parentScr.w / 2),
                  top: elemMidY,
                  width: Math.abs(elemMidX - (parentScr.x + parentScr.w / 2)),
                  height: 0,
                  borderTop: "1px dashed #0D99FF",
                  zIndex: 15,
                }}
              />
            )}
          </div>
        );
      })()}

      {/* Layer Hover Indicator & Sizing Badge (clean Figma / Paper style) */}
      {!previewing && uiMode !== "hidden" && !sessionRef.current && !editingTextId && (() => {
        const targetId = hoveredNodeId;
        const isDescendantOfSelection = (() => {
          let p = doc.nodes[targetId]?.parentId;
          while (p) {
            if (selection.includes(p)) return true;
            p = doc.nodes[p]?.parentId;
          }
          return false;
        })();
        if (!targetId || selection.includes(targetId)) return null;
        const targetNode = doc.nodes[targetId];
        if (!targetNode || G.isNodeHidden(doc.nodes, targetId)) return null;

        const targetRect = rectOf(doc.nodes, targetId);
        if (!targetRect || targetRect.w <= 0 || targetRect.h <= 0) return null;
        const targetScr = G.canvasRectToScreen(viewport, targetRect);
        if (isNaN(targetScr.x) || isNaN(targetScr.y) || isNaN(targetScr.w) || isNaN(targetScr.h)) return null;

        const targetRot = nodeCanvasRotation(doc.nodes, targetId);
        const hasTargetRot = targetRot % 360 !== 0;

        const badgeText = formatSizingBadge(targetNode, targetRect);

        // Border radius of target
        const r = targetNode.style?.radius;
        const borderRadius = typeof r === "number"
          ? `${r * viewport.zoom}px`
          : typeof r === "object"
            ? `${(r.tl ?? 0) * viewport.zoom}px ${(r.tr ?? 0) * viewport.zoom}px ${(r.br ?? 0) * viewport.zoom}px ${(r.bl ?? 0) * viewport.zoom}px`
            : undefined;

        // If a child of targetNode is already selected, or if any selection is inside this frame hierarchy,
        // do NOT show outlines on sibling children
        const hasSelectedDescendant = (targetNode.childIds || []).some(
          (cid) => selection.includes(cid) || G.subtreeIds(doc.nodes, cid).some((sid) => selection.includes(sid))
        );

        // First level children: when hovering a frame, show dotted borders on its direct children
        // matching the reference: outer hovered frame has solid outline, inner children have dotted outlines
        const firstLevelKids = hasSelectedDescendant
          ? []
          : (targetNode.childIds || [])
              .map((cid) => {
                if (selection.includes(cid)) return null;
                const cNode = doc.nodes[cid];
                if (!cNode || cNode.hidden || cNode.style?.opacity === 0) return null;
                const cRect = rectOf(doc.nodes, cid);
                if (!cRect || cRect.w <= 0 || cRect.h <= 0) return null;
                const cScr = G.canvasRectToScreen(viewport, cRect);
                if (isNaN(cScr.x) || isNaN(cScr.y) || isNaN(cScr.w) || isNaN(cScr.h)) return null;
                const cr = cNode.style?.radius;
                const cBorderRadius = typeof cr === "number"
                  ? `${cr * viewport.zoom}px`
                  : typeof cr === "object"
                    ? `${(cr.tl ?? 0) * viewport.zoom}px ${(cr.tr ?? 0) * viewport.zoom}px ${(cr.br ?? 0) * viewport.zoom}px ${(cr.bl ?? 0) * viewport.zoom}px`
                    : undefined;
                const kidRot = nodeCanvasRotation(doc.nodes, cid);
                const hasKidRot = kidRot % 360 !== 0;
                return { id: cid, scr: cScr, borderRadius: cBorderRadius, rot: kidRot, hasRot: hasKidRot };
              })
              .filter(Boolean);

        return (
          <div className="pointer-events-none absolute inset-0 overflow-visible" style={{ zIndex: 18 }}>
            {/* Target Hover Outline (solid blue outline, outline/border only, no overlay color) */}
            <div
              style={{
                position: "absolute",
                left: targetScr.x,
                top: targetScr.y,
                width: targetScr.w,
                height: targetScr.h,
                border: "1.5px solid #0D99FF",
                borderRadius,
                boxSizing: "border-box",
                background: "transparent",
                transformOrigin: "center center",
                transform: hasTargetRot ? `rotate(${targetRot}deg)` : undefined,
              }}
            />

            {/* First-level children: crisp dot borders, no overlay color */}
            {firstLevelKids.map((k) => (
              <div
                key={`hover-kid-${k.id}`}
                style={{
                  position: "absolute",
                  left: k.scr.x,
                  top: k.scr.y,
                  width: k.scr.w,
                  height: k.scr.h,
                  border: "1px dotted #0D99FF",
                  borderRadius: k.borderRadius,
                  boxSizing: "border-box",
                  background: "transparent",
                  transformOrigin: "center center",
                  transform: k.hasRot ? `rotate(${k.rot}deg)` : undefined,
                }}
              />
            ))}
          </div>
        );
      })()}
      {unionRect &&
        !editingTextId &&
        (() => {
          const scr = G.canvasRectToScreen(viewport, unionRect);
          return (
            <>
              <div
                style={{ ...outlineStyle, left: scr.x, top: scr.y, width: scr.w, height: scr.h }}
              />
              <div
                style={{
                  position: "absolute",
                  left: scr.x + scr.w / 2,
                  top: (canvasSize?.h && scr.y + scr.h + 24 > canvasSize.h)
                    ? scr.y - 20
                    : scr.y + scr.h + 3,
                  transform: "translateX(-50%)",
                  background: "#0D99FF",
                  color: "#ffffff",
                  fontFamily: "var(--ui-font)",
                  fontSize: 11,
                  fontWeight: 500,
                  lineHeight: "16px",
                  letterSpacing: "0.01em",
                  padding: "1px 6px",
                  borderRadius: 2,
                  boxShadow: "0 1px 2px rgba(0,0,0,0.18)",
                  whiteSpace: "nowrap",
                  zIndex: 30,
                  pointerEvents: "none",
                }}
              >
                {Math.round(unionRect.w)} × {Math.round(unionRect.h)}
              </div>
            </>
          );
        })()}
      {singleRect &&
        editingPathId !== singleNode?.id &&
        (() => {
          const scr = G.canvasRectToScreen(viewport, singleRect);
          const rot = nodeCanvasRotation(doc.nodes, singleNode?.id);
          const hasRot = rot % 360 !== 0;
          const originCenter = { x: scr.x + scr.w / 2, y: scr.y + scr.h / 2 };
          const isFlex = Boolean(singleNode?.layout?.mode === "flex" || singleNode?.layout?.mode === "grid");

          const padT = Math.round(
            (singleNode?.layout?.padding?.t ??
              singleNode?.layout?.padding?.v ??
              0) * viewport.zoom,
          );
          const padB = Math.round(
            (singleNode?.layout?.padding?.b ??
              singleNode?.layout?.padding?.v ??
              0) * viewport.zoom,
          );
          const padL = Math.round(
            (singleNode?.layout?.padding?.l ??
              singleNode?.layout?.padding?.h ??
              0) * viewport.zoom,
          );
          const padR = Math.round(
            (singleNode?.layout?.padding?.r ??
              singleNode?.layout?.padding?.h ??
              0) * viewport.zoom,
          );

          const rawPadT = formatPaddingVal(
            singleNode?.layout?.padding?.t ??
            singleNode?.layout?.padding?.v ??
            0,
          );
          const rawPadB = formatPaddingVal(
            singleNode?.layout?.padding?.b ??
            singleNode?.layout?.padding?.v ??
            0,
          );
          const rawPadL = formatPaddingVal(
            singleNode?.layout?.padding?.l ??
            singleNode?.layout?.padding?.h ??
            0,
          );
          const rawPadR = formatPaddingVal(
            singleNode?.layout?.padding?.r ??
            singleNode?.layout?.padding?.h ??
            0,
          );

          const isContainer = singleNode?.type === "frame" || singleNode?.type === "group";
          const padObj = (singleNode && isContainer)
            ? {
                t: rawPadT,
                b: rawPadB,
                l: rawPadL,
                r: rawPadR,
                h: singleNode?.layout?.padding?.h ?? rawPadL,
                v: singleNode?.layout?.padding?.v ?? rawPadT,
              }
            : null;

          const activeSide =
            sessionRef.current?.kind === "padding"
              ? sessionRef.current.side
              : hoveredPaddingSide;

          const marT = Math.round(
            (singleNode?.layout?.margin?.t ??
              singleNode?.layout?.margin?.v ??
              0) * viewport.zoom,
          );
          const marB = Math.round(
            (singleNode?.layout?.margin?.b ??
              singleNode?.layout?.margin?.v ??
              0) * viewport.zoom,
          );
          const marL = Math.round(
            (singleNode?.layout?.margin?.l ??
              singleNode?.layout?.margin?.h ??
              0) * viewport.zoom,
          );
          const marR = Math.round(
            (singleNode?.layout?.margin?.r ??
              singleNode?.layout?.margin?.h ??
              0) * viewport.zoom,
          );

          const rawMarT = formatPaddingVal(
            singleNode?.layout?.margin?.t ??
            singleNode?.layout?.margin?.v ??
            0,
          );
          const rawMarB = formatPaddingVal(
            singleNode?.layout?.margin?.b ??
            singleNode?.layout?.margin?.v ??
            0,
          );
          const rawMarL = formatPaddingVal(
            singleNode?.layout?.margin?.l ??
            singleNode?.layout?.margin?.h ??
            0,
          );
          const rawMarR = formatPaddingVal(
            singleNode?.layout?.margin?.r ??
            singleNode?.layout?.margin?.h ??
            0,
          );

          const hasMargin = Boolean(singleNode && singleNode.parentId);

          const marObj = hasMargin
            ? {
                t: rawMarT,
                b: rawMarB,
                l: rawMarL,
                r: rawMarR,
                h: singleNode?.layout?.margin?.h ?? rawMarL,
                v: singleNode?.layout?.margin?.v ?? rawMarT,
              }
            : null;

          const activeMarSide =
            sessionRef.current?.kind === "margin"
              ? sessionRef.current.side
              : hoveredMarginSide;

          const topMarLineY = scr.y - marT;
          const bottomMarLineY = scr.y + scr.h + marB;
          const leftMarLineX = scr.x - marL;
          const rightMarLineX = scr.x + scr.w + marR;

          const topLineY = scr.y + padT;
          const bottomLineY = scr.y + scr.h - padB;
          const leftLineX = scr.x + padL;
          const rightLineX = scr.x + scr.w - padR;

          const topHandleY = Math.max(scr.y + 7, topLineY);
          const bottomHandleY = Math.min(scr.y + scr.h - 7, bottomLineY);
          const leftHandleX = Math.max(scr.x + 7, leftLineX);
          const rightHandleX = Math.min(scr.x + scr.w - 7, rightLineX);

          const isMouseOverSingleNodeOrDescendant = (() => {
            if (!hoveredNodeId) return false;
            if (hoveredNodeId === singleNode.id) return true;
            let cur = doc.nodes[hoveredNodeId];
            while (cur && cur.parentId) {
              if (cur.parentId === singleNode.id) return true;
              cur = doc.nodes[cur.parentId];
            }
            return false;
          })();

          const isFrameHovered =
            isMouseOverSingleNodeOrDescendant ||
            hoveredPaddingSide !== null ||
            hoveredMarginSide !== null ||
            sessionRef.current?.kind === "padding" ||
            sessionRef.current?.kind === "margin";

          return (
            <div
              key={`single-controls-${singleNode?.id}`}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: "100%",
                height: "100%",
                transformOrigin: `${originCenter.x}px ${originCenter.y}px`,
                transform: hasRot ? `rotate(${rot}deg)` : undefined,
                pointerEvents: "none",
                zIndex: 20,
              }}
            >
              {/* Padding Interactive Overlays & Boundary Lines */}
              {!editingTextId && padObj && (
                <>
                  {/* Soft Color Highlight on Hover/Active of Pill Line (like screenshot) */}
                  {activeSide === "t" && padT > 0 && (
                    <div
                      className="pointer-events-none absolute transition-opacity duration-150"
                      style={{
                        left: scr.x,
                        top: scr.y,
                        width: Math.max(0, scr.w),
                        height: padT,
                        backgroundColor: "rgba(13, 153, 255, 0.08)",
                        zIndex: 2,
                      }}
                    />
                  )}
                  {activeSide === "b" && padB > 0 && (
                    <div
                      className="pointer-events-none absolute transition-opacity duration-150"
                      style={{
                        left: scr.x,
                        top: scr.y + scr.h - padB,
                        width: Math.max(0, scr.w),
                        height: padB,
                        backgroundColor: "rgba(13, 153, 255, 0.08)",
                        zIndex: 2,
                      }}
                    />
                  )}
                  {activeSide === "l" && padL > 0 && (
                    <div
                      className="pointer-events-none absolute transition-opacity duration-150"
                      style={{
                        left: scr.x,
                        top: scr.y,
                        width: padL,
                        height: Math.max(0, scr.h),
                        backgroundColor: "rgba(13, 153, 255, 0.08)",
                        zIndex: 2,
                      }}
                    />
                  )}
                  {activeSide === "r" && padR > 0 && (
                    <div
                      className="pointer-events-none absolute transition-opacity duration-150"
                      style={{
                        left: scr.x + scr.w - padR,
                        top: scr.y,
                        width: padR,
                        height: Math.max(0, scr.h),
                        backgroundColor: "rgba(13, 153, 255, 0.08)",
                        zIndex: 2,
                      }}
                    />
                  )}

                  {/* 1. TOP PADDING PILL HANDLE & BADGE: active only on hover of pill line */}
                  <div
                    onPointerDown={(e) => onPaddingHandlePointerDown(e, "t", padObj)}
                    onPointerEnter={() => setHoveredPaddingSide("t")}
                    onPointerLeave={() => {
                      if (sessionRef.current?.kind !== "padding") {
                        setHoveredPaddingSide(null);
                      }
                    }}
                    style={{
                      position: "absolute",
                      left: scr.x + scr.w / 2,
                      top: topHandleY - 8,
                      transform: "translateX(-50%)",
                      width: 44,
                      height: 16,
                      cursor: PADDING_CURSOR_V,
                      zIndex: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      pointerEvents: "auto",
                    }}
                    title="Drag to resize top padding (Alt for opposite, Shift+Alt for all)"
                  >
                    {isFrameHovered && (
                      <div
                        className="pointer-events-none rounded-full transition-opacity duration-150"
                        style={{
                          width: 22,
                          height: 3,
                          borderRadius: 2,
                          backgroundColor: "#0D99FF",
                          opacity: activeSide === "t" ? 1 : 0.7,
                          boxShadow: activeSide === "t" ? "0 0.5px 3px rgba(13, 153, 255, 0.5)" : "none",
                        }}
                      />
                    )}
                  </div>
                  {activeSide === "t" && (
                    <div
                      className="pointer-events-none absolute z-30 flex items-center justify-center rounded-[4px] bg-[#0D99FF] px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-sm transition-opacity duration-150"
                      style={{
                        left: scr.x + scr.w / 2,
                        top: padT >= 28 ? topHandleY + 6 : topHandleY - 24,
                        transform: "translateX(-50%)",
                        opacity: 1,
                      }}
                    >
                      {formatPaddingVal(
                        activePaddingVal?.side === "t"
                          ? activePaddingVal.val
                          : rawPadT
                      )}
                    </div>
                  )}

                  {/* 2. BOTTOM PADDING PILL HANDLE & BADGE: active only on hover of pill line */}
                  <div
                    onPointerDown={(e) => onPaddingHandlePointerDown(e, "b", padObj)}
                    onPointerEnter={() => setHoveredPaddingSide("b")}
                    onPointerLeave={() => {
                      if (sessionRef.current?.kind !== "padding") {
                        setHoveredPaddingSide(null);
                      }
                    }}
                    style={{
                      position: "absolute",
                      left: scr.x + scr.w / 2,
                      top: bottomHandleY - 8,
                      transform: "translateX(-50%)",
                      width: 44,
                      height: 16,
                      cursor: PADDING_CURSOR_V,
                      zIndex: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      pointerEvents: "auto",
                    }}
                    title="Drag to resize bottom padding (Alt for opposite, Shift+Alt for all)"
                  >
                    {isFrameHovered && (
                      <div
                        className="pointer-events-none rounded-full transition-opacity duration-150"
                        style={{
                          width: 22,
                          height: 3,
                          borderRadius: 2,
                          backgroundColor: "#0D99FF",
                          opacity: activeSide === "b" ? 1 : 0.7,
                          boxShadow: activeSide === "b" ? "0 0.5px 3px rgba(13, 153, 255, 0.5)" : "none",
                        }}
                      />
                    )}
                  </div>
                  {activeSide === "b" && (
                    <div
                      className="pointer-events-none absolute z-30 flex items-center justify-center rounded-[4px] bg-[#0D99FF] px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-sm transition-opacity duration-150"
                      style={{
                        left: scr.x + scr.w / 2,
                        top: padB >= 28 ? bottomHandleY - 24 : bottomHandleY + 6,
                        transform: "translateX(-50%)",
                        opacity: 1,
                      }}
                    >
                      {formatPaddingVal(
                        activePaddingVal?.side === "b"
                          ? activePaddingVal.val
                          : rawPadB
                      )}
                    </div>
                  )}

                  {/* 3. LEFT PADDING PILL HANDLE & BADGE: active only on hover of pill line */}
                  <div
                    onPointerDown={(e) => onPaddingHandlePointerDown(e, "l", padObj)}
                    onPointerEnter={() => setHoveredPaddingSide("l")}
                    onPointerLeave={() => {
                      if (sessionRef.current?.kind !== "padding") {
                        setHoveredPaddingSide(null);
                      }
                    }}
                    style={{
                      position: "absolute",
                      left: leftHandleX - 8,
                      top: scr.y + scr.h / 2,
                      transform: "translateY(-50%)",
                      width: 16,
                      height: 44,
                      cursor: PADDING_CURSOR_H,
                      zIndex: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      pointerEvents: "auto",
                    }}
                    title="Drag to resize left padding (Alt for opposite, Shift+Alt for all)"
                  >
                    {isFrameHovered && (
                      <div
                        className="pointer-events-none rounded-full transition-opacity duration-150"
                        style={{
                          width: 3,
                          height: 22,
                          borderRadius: 2,
                          backgroundColor: "#0D99FF",
                          opacity: activeSide === "l" ? 1 : 0.7,
                          boxShadow: activeSide === "l" ? "0 0.5px 3px rgba(13, 153, 255, 0.5)" : "none",
                        }}
                      />
                    )}
                  </div>
                  {activeSide === "l" && (
                    <div
                      className="pointer-events-none absolute z-30 flex items-center justify-center rounded-[4px] bg-[#0D99FF] px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-sm transition-opacity duration-150"
                      style={{
                        left: padL >= 35 ? leftHandleX - 36 : leftHandleX + 6,
                        top: scr.y + scr.h / 2 - 11,
                        opacity: 1,
                      }}
                    >
                      {formatPaddingVal(
                        activePaddingVal?.side === "l"
                          ? activePaddingVal.val
                          : rawPadL
                      )}
                    </div>
                  )}

                  {/* 4. RIGHT PADDING PILL HANDLE & BADGE: active only on hover of pill line */}
                  <div
                    onPointerDown={(e) => onPaddingHandlePointerDown(e, "r", padObj)}
                    onPointerEnter={() => setHoveredPaddingSide("r")}
                    onPointerLeave={() => {
                      if (sessionRef.current?.kind !== "padding") {
                        setHoveredPaddingSide(null);
                      }
                    }}
                    style={{
                      position: "absolute",
                      left: rightHandleX - 8,
                      top: scr.y + scr.h / 2,
                      transform: "translateY(-50%)",
                      width: 16,
                      height: 44,
                      cursor: PADDING_CURSOR_H,
                      zIndex: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      pointerEvents: "auto",
                    }}
                    title="Drag to resize right padding (Alt for opposite, Shift+Alt for all)"
                  >
                    {isFrameHovered && (
                      <div
                        className="pointer-events-none rounded-full transition-opacity duration-150"
                        style={{
                          width: 3,
                          height: 22,
                          borderRadius: 2,
                          backgroundColor: "#0D99FF",
                          opacity: activeSide === "r" ? 1 : 0.7,
                          boxShadow: activeSide === "r" ? "0 0.5px 3px rgba(13, 153, 255, 0.5)" : "none",
                        }}
                      />
                    )}
                  </div>
                  {activeSide === "r" && (
                    <div
                      className="pointer-events-none absolute z-30 flex items-center justify-center rounded-[4px] bg-[#0D99FF] px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-sm transition-opacity duration-150"
                      style={{
                        left: padR >= 35 ? rightHandleX + 6 : rightHandleX - 36,
                        top: scr.y + scr.h / 2 - 11,
                        opacity: 1,
                      }}
                    >
                      {formatPaddingVal(
                        activePaddingVal?.side === "r"
                          ? activePaddingVal.val
                          : rawPadR
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Margin Interactive Overlays (Warm Amber/Orange #F97316) */}
              {!editingTextId && hasMargin && marObj && (
                <>
                  {/* Soft Color Highlight on Hover of Margin Area or Pill Line */}
                  <div
                    onPointerEnter={() => setHoveredMarginSide("t")}
                    onPointerLeave={() => {
                      if (sessionRef.current?.kind !== "margin") setHoveredMarginSide(null);
                    }}
                    style={{
                      position: "absolute",
                      left: scr.x,
                      top: scr.y - Math.max(marT, 14),
                      width: Math.max(0, scr.w),
                      height: Math.max(marT, 14),
                      backgroundColor: activeMarSide === "t" ? "rgba(249, 115, 22, 0.12)" : "transparent",
                      borderTop: activeMarSide === "t" ? "1px dashed rgba(249, 115, 22, 0.5)" : "none",
                      zIndex: 3,
                      pointerEvents: "auto",
                      cursor: MARGIN_CURSOR_V,
                    }}
                  />
                  <div
                    onPointerEnter={() => setHoveredMarginSide("b")}
                    onPointerLeave={() => {
                      if (sessionRef.current?.kind !== "margin") setHoveredMarginSide(null);
                    }}
                    style={{
                      position: "absolute",
                      left: scr.x,
                      top: scr.y + scr.h,
                      width: Math.max(0, scr.w),
                      height: Math.max(marB, 14),
                      backgroundColor: activeMarSide === "b" ? "rgba(249, 115, 22, 0.12)" : "transparent",
                      borderBottom: activeMarSide === "b" ? "1px dashed rgba(249, 115, 22, 0.5)" : "none",
                      zIndex: 3,
                      pointerEvents: "auto",
                      cursor: MARGIN_CURSOR_V,
                    }}
                  />
                  <div
                    onPointerEnter={() => setHoveredMarginSide("l")}
                    onPointerLeave={() => {
                      if (sessionRef.current?.kind !== "margin") setHoveredMarginSide(null);
                    }}
                    style={{
                      position: "absolute",
                      left: scr.x - Math.max(marL, 14),
                      top: scr.y,
                      width: Math.max(marL, 14),
                      height: Math.max(0, scr.h),
                      backgroundColor: activeMarSide === "l" ? "rgba(249, 115, 22, 0.12)" : "transparent",
                      borderLeft: activeMarSide === "l" ? "1px dashed rgba(249, 115, 22, 0.5)" : "none",
                      zIndex: 3,
                      pointerEvents: "auto",
                      cursor: MARGIN_CURSOR_H,
                    }}
                  />
                  <div
                    onPointerEnter={() => setHoveredMarginSide("r")}
                    onPointerLeave={() => {
                      if (sessionRef.current?.kind !== "margin") setHoveredMarginSide(null);
                    }}
                    style={{
                      position: "absolute",
                      left: scr.x + scr.w,
                      top: scr.y,
                      width: Math.max(marR, 14),
                      height: Math.max(0, scr.h),
                      backgroundColor: activeMarSide === "r" ? "rgba(249, 115, 22, 0.12)" : "transparent",
                      borderRight: activeMarSide === "r" ? "1px dashed rgba(249, 115, 22, 0.5)" : "none",
                      zIndex: 3,
                      pointerEvents: "auto",
                      cursor: MARGIN_CURSOR_H,
                    }}
                  />

                  {/* 1. TOP MARGIN PILL HANDLE & BADGE: active only on hover of pill line */}
                  <div
                    onPointerDown={(e) => onMarginHandlePointerDown(e, "t", marObj)}
                    onPointerEnter={() => setHoveredMarginSide("t")}
                    onPointerLeave={() => {
                      if (sessionRef.current?.kind !== "margin") {
                        setHoveredMarginSide(null);
                      }
                    }}
                    style={{
                      position: "absolute",
                      left: scr.x + scr.w / 2,
                      top: topMarLineY - 8,
                      transform: "translateX(-50%)",
                      width: 44,
                      height: 16,
                      cursor: MARGIN_CURSOR_V,
                      zIndex: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      pointerEvents: "auto",
                    }}
                    title="Drag to resize top margin (Alt for opposite, Shift+Alt for all)"
                  >
                    {isFrameHovered && (
                      <div
                        className="pointer-events-none rounded-full transition-opacity duration-150"
                        style={{
                          width: 22,
                          height: 3,
                          borderRadius: 2,
                          backgroundColor: "#F97316",
                          opacity: activeMarSide === "t" ? 1 : 0.7,
                          boxShadow: activeMarSide === "t" ? "0 0 4px rgba(249, 115, 22, 0.6)" : "none",
                        }}
                      />
                    )}
                  </div>
                  {activeMarSide === "t" && (
                    <div
                      className="pointer-events-none absolute z-30 flex items-center justify-center rounded-[4px] bg-[#F97316] px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-sm transition-opacity duration-150"
                      style={{
                        left: scr.x + scr.w / 2,
                        top: Math.min(scr.y - 6, topMarLineY - 20),
                        transform: "translateX(-50%)",
                        opacity: 1,
                      }}
                    >
                      {formatPaddingVal(
                        activeMarginVal?.side === "t"
                          ? activeMarginVal.val
                          : rawMarT
                      )}
                    </div>
                  )}

                  {/* 2. BOTTOM MARGIN PILL HANDLE & BADGE: active only on hover of pill line */}
                  <div
                    onPointerDown={(e) => onMarginHandlePointerDown(e, "b", marObj)}
                    onPointerEnter={() => setHoveredMarginSide("b")}
                    onPointerLeave={() => {
                      if (sessionRef.current?.kind !== "margin") {
                        setHoveredMarginSide(null);
                      }
                    }}
                    style={{
                      position: "absolute",
                      left: scr.x + scr.w / 2,
                      top: bottomMarLineY - 8,
                      transform: "translateX(-50%)",
                      width: 44,
                      height: 16,
                      cursor: MARGIN_CURSOR_V,
                      zIndex: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      pointerEvents: "auto",
                    }}
                    title="Drag to resize bottom margin (Alt for opposite, Shift+Alt for all)"
                  >
                    {isFrameHovered && (
                      <div
                        className="pointer-events-none rounded-full transition-opacity duration-150"
                        style={{
                          width: 22,
                          height: 3,
                          borderRadius: 2,
                          backgroundColor: "#F97316",
                          opacity: activeMarSide === "b" ? 1 : 0.7,
                          boxShadow: activeMarSide === "b" ? "0 0 4px rgba(249, 115, 22, 0.6)" : "none",
                        }}
                      />
                    )}
                  </div>
                  {activeMarSide === "b" && (
                    <div
                      className="pointer-events-none absolute z-30 flex items-center justify-center rounded-[4px] bg-[#F97316] px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-sm transition-opacity duration-150"
                      style={{
                        left: scr.x + scr.w / 2,
                        top: Math.max(scr.y + scr.h + 6, bottomMarLineY + 6),
                        transform: "translateX(-50%)",
                        opacity: 1,
                      }}
                    >
                      {formatPaddingVal(
                        activeMarginVal?.side === "b"
                          ? activeMarginVal.val
                          : rawMarB
                      )}
                    </div>
                  )}

                  {/* 3. LEFT MARGIN PILL HANDLE & BADGE: active only on hover of pill line */}
                  <div
                    onPointerDown={(e) => onMarginHandlePointerDown(e, "l", marObj)}
                    onPointerEnter={() => setHoveredMarginSide("l")}
                    onPointerLeave={() => {
                      if (sessionRef.current?.kind !== "margin") {
                        setHoveredMarginSide(null);
                      }
                    }}
                    style={{
                      position: "absolute",
                      left: leftMarLineX - 8,
                      top: scr.y + scr.h / 2,
                      transform: "translateY(-50%)",
                      width: 16,
                      height: 44,
                      cursor: MARGIN_CURSOR_H,
                      zIndex: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      pointerEvents: "auto",
                    }}
                    title="Drag to resize left margin (Alt for opposite, Shift+Alt for all)"
                  >
                    {isFrameHovered && (
                      <div
                        className="pointer-events-none rounded-full transition-opacity duration-150"
                        style={{
                          width: 3,
                          height: 22,
                          borderRadius: 2,
                          backgroundColor: "#F97316",
                          opacity: activeMarSide === "l" ? 1 : 0.7,
                          boxShadow: activeMarSide === "l" ? "0 0 4px rgba(249, 115, 22, 0.6)" : "none",
                        }}
                      />
                    )}
                  </div>
                  {activeMarSide === "l" && (
                    <div
                      className="pointer-events-none absolute z-30 flex items-center justify-center rounded-[4px] bg-[#F97316] px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-sm transition-opacity duration-150"
                      style={{
                        left: Math.min(scr.x - 38, leftMarLineX - 35),
                        top: scr.y + scr.h / 2 - 10,
                        opacity: 1,
                      }}
                    >
                      {formatPaddingVal(
                        activeMarginVal?.side === "l"
                          ? activeMarginVal.val
                          : rawMarL
                      )}
                    </div>
                  )}

                  {/* 4. RIGHT MARGIN PILL HANDLE & BADGE: active only on hover of pill line */}
                  <div
                    onPointerDown={(e) => onMarginHandlePointerDown(e, "r", marObj)}
                    onPointerEnter={() => setHoveredMarginSide("r")}
                    onPointerLeave={() => {
                      if (sessionRef.current?.kind !== "margin") {
                        setHoveredMarginSide(null);
                      }
                    }}
                    style={{
                      position: "absolute",
                      left: rightMarLineX - 8,
                      top: scr.y + scr.h / 2,
                      transform: "translateY(-50%)",
                      width: 16,
                      height: 44,
                      cursor: MARGIN_CURSOR_H,
                      zIndex: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      pointerEvents: "auto",
                    }}
                    title="Drag to resize right margin (Alt for opposite, Shift+Alt for all)"
                  >
                    {isFrameHovered && (
                      <div
                        className="pointer-events-none rounded-full transition-opacity duration-150"
                        style={{
                          width: 3,
                          height: 22,
                          borderRadius: 2,
                          backgroundColor: "#F97316",
                          opacity: activeMarSide === "r" ? 1 : 0.7,
                          boxShadow: activeMarSide === "r" ? "0 0 4px rgba(249, 115, 22, 0.6)" : "none",
                        }}
                      />
                    )}
                  </div>
                  {activeMarSide === "r" && (
                    <div
                      className="pointer-events-none absolute z-30 flex items-center justify-center rounded-[4px] bg-[#F97316] px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-sm transition-opacity duration-150"
                      style={{
                        left: Math.max(scr.x + scr.w + 6, rightMarLineX + 6),
                        top: scr.y + scr.h / 2 - 10,
                        opacity: 1,
                      }}
                    >
                      {formatPaddingVal(
                        activeMarginVal?.side === "r"
                          ? activeMarginVal.val
                          : rawMarR
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Flex Gap Interactive Overlays & Dashes */}
              {!editingTextId && isFlex && (() => {
                const flexDir =
                  singleNode.layout?.direction === "row" || singleNode.layout?.dir === "row"
                    ? "row"
                    : "column";
                const isCol = flexDir === "column";
                const rawGap = singleNode.layout?.gap ?? 0;
                const currentGap =
                  typeof rawGap === "number"
                    ? rawGap
                    : parseInt(String(rawGap), 10) || 0;

                const inFlowKids = (singleNode?.childIds || [])
                  .map((cid) => ({
                    id: cid,
                    node: doc.nodes[cid],
                    rect: rectOf(doc.nodes, cid),
                  }))
                  .filter(
                    (c) =>
                      c.node &&
                      !c.node.position?.absolute &&
                      c.rect &&
                      c.rect.w > 0 &&
                      c.rect.h > 0,
                  );

                if (inFlowKids.length <= 1) return null;

                if (isCol) {
                  inFlowKids.sort((a, b) => a.rect.y - b.rect.y);
                } else {
                  inFlowKids.sort((a, b) => a.rect.x - b.rect.x);
                }

                const gaps = [];
                for (let i = 0; i < inFlowKids.length - 1; i++) {
                  const c1 = inFlowKids[i];
                  const c2 = inFlowKids[i + 1];
                  const r1 = G.canvasRectToScreen(viewport, c1.rect);
                  const r2 = G.canvasRectToScreen(viewport, c2.rect);

                  if (isCol) {
                    const c1MarB =
                      (Number(
                        c1.node.layout?.margin?.b ??
                          c1.node.layout?.margin?.v ??
                          c1.node.margin?.b ??
                          c1.node.margin?.v ??
                          0
                      ) || 0) * viewport.zoom;
                    const c2MarT =
                      (Number(
                        c2.node.layout?.margin?.t ??
                          c2.node.layout?.margin?.v ??
                          c2.node.margin?.t ??
                          c2.node.margin?.v ??
                          0
                      ) || 0) * viewport.zoom;

                    const gapTop = r1.y + r1.h + c1MarB;
                    const gapBottom = r2.y - c2MarT;
                    const gapH = Math.max(0, gapBottom - gapTop);
                    const gapCenterY = (gapTop + gapBottom) / 2;
                    const bandLeft = scr.x + padL;
                    const bandWidth = Math.max(10, scr.w - padL - padR);

                    gaps.push({
                      index: i,
                      isCol: true,
                      bandLeft,
                      bandWidth,
                      gapTop,
                      gapH,
                      gapCenterY,
                    });
                  } else {
                    const c1MarR =
                      (Number(
                        c1.node.layout?.margin?.r ??
                          c1.node.layout?.margin?.h ??
                          c1.node.margin?.r ??
                          c1.node.margin?.h ??
                          0
                      ) || 0) * viewport.zoom;
                    const c2MarL =
                      (Number(
                        c2.node.layout?.margin?.l ??
                          c2.node.layout?.margin?.h ??
                          c2.node.margin?.l ??
                          c2.node.margin?.h ??
                          0
                      ) || 0) * viewport.zoom;

                    const gapLeft = r1.x + r1.w + c1MarR;
                    const gapRight = r2.x - c2MarL;
                    const gapW = Math.max(0, gapRight - gapLeft);
                    const gapCenterX = (gapLeft + gapRight) / 2;
                    const bandTop = scr.y + padT;
                    const bandHeight = Math.max(10, scr.h - padT - padB);

                    gaps.push({
                      index: i,
                      isCol: false,
                      bandTop,
                      bandHeight,
                      gapLeft,
                      gapW,
                      gapCenterX,
                    });
                  }
                }

                return gaps.map((g) => {
                  const isDraggingGap =
                    sessionRef.current?.kind === "gap" && sessionRef.current.index === g.index;
                  const isHoveredGap = hoveredGapIndex === g.index;
                  const isThisGapActive = isDraggingGap || isHoveredGap;
                  const displayGap = isDraggingGap
                    ? (activeGapVal ?? currentGap)
                    : currentGap;

                  if (g.isCol) {
                    const hitH = Math.max(18, g.gapH);
                    return (
                      <div
                        key={`gap-col-${g.index}`}
                        onPointerDown={(e) =>
                          onGapHandlePointerDown(e, singleNode.id, currentGap, "column", g.index)
                        }
                        onPointerEnter={() => setHoveredGapIndex(g.index)}
                        onPointerLeave={() => {
                          if (sessionRef.current?.kind !== "gap") {
                            setHoveredGapIndex(null);
                          }
                        }}
                        style={{
                          position: "absolute",
                          left: g.bandLeft,
                          top: g.gapCenterY - hitH / 2,
                          width: g.bandWidth,
                          height: hitH,
                          cursor: "row-resize",
                          zIndex: 25,
                          pointerEvents: "auto",
                        }}
                        title={`Drag to adjust gap (${currentGap}px)`}
                      >
                        {/* Soft purple highlight band when hovered/active */}
                        {isThisGapActive && (
                          <div
                            className="pointer-events-none absolute"
                            style={{
                              left: 0,
                              top: hitH / 2 - Math.max(2, g.gapH) / 2,
                              width: "100%",
                              height: Math.max(2, g.gapH),
                              background: "rgba(168, 85, 247, 0.12)",
                            }}
                          />
                        )}

                        {/* Exact center purple dash (visible on hover / active) */}
                        <div
                          className="pointer-events-none absolute transition-opacity duration-150"
                          style={{
                            left: "50%",
                            top: "50%",
                            transform: "translate(-50%, -50%)",
                            width: 18,
                            height: 2,
                            borderRadius: 2,
                            background: "#A855F7",
                            opacity: isDraggingGap ? 0 : (isHoveredGap || isThisGapActive) ? 1 : 0,
                            boxShadow: isHoveredGap ? "0 0.5px 2px rgba(168, 85, 247, 0.4)" : "none",
                          }}
                        />

                        {/* Purple badge pill with gap value */}
                        {isThisGapActive && (
                          <div
                            className="pointer-events-none absolute z-30 flex items-center justify-center rounded-[3px] bg-[#9333ea] px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm"
                            style={{
                              left: "50%",
                              top: "50%",
                              transform: "translate(-50%, -50%)",
                              lineHeight: "12px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {displayGap}
                          </div>
                        )}
                      </div>
                    );
                  } else {
                    const hitW = Math.max(18, g.gapW);
                    return (
                      <div
                        key={`gap-row-${g.index}`}
                        onPointerDown={(e) =>
                          onGapHandlePointerDown(e, singleNode.id, currentGap, "row", g.index)
                        }
                        onPointerEnter={() => setHoveredGapIndex(g.index)}
                        onPointerLeave={() => {
                          if (sessionRef.current?.kind !== "gap") {
                            setHoveredGapIndex(null);
                          }
                        }}
                        style={{
                          position: "absolute",
                          left: g.gapCenterX - hitW / 2,
                          top: g.bandTop,
                          width: hitW,
                          height: g.bandHeight,
                          cursor: "col-resize",
                          zIndex: 25,
                          pointerEvents: "auto",
                        }}
                        title={`Drag to adjust gap (${currentGap}px)`}
                      >
                        {/* Soft purple highlight band when hovered/active */}
                        {isThisGapActive && (
                          <div
                            className="pointer-events-none absolute"
                            style={{
                              left: hitW / 2 - Math.max(2, g.gapW) / 2,
                              top: 0,
                              width: Math.max(2, g.gapW),
                              height: "100%",
                              background: "rgba(168, 85, 247, 0.12)",
                            }}
                          />
                        )}

                        {/* Exact center purple vertical dash (visible on hover / active) */}
                        <div
                          className="pointer-events-none absolute transition-opacity duration-150"
                          style={{
                            left: "50%",
                            top: "50%",
                            transform: "translate(-50%, -50%)",
                            width: 2,
                            height: 18,
                            borderRadius: 2,
                            background: "#A855F7",
                            opacity: isDraggingGap ? 0 : (isHoveredGap || isThisGapActive) ? 1 : 0,
                            boxShadow: isHoveredGap ? "0 0.5px 2px rgba(168, 85, 247, 0.4)" : "none",
                          }}
                        />

                        {/* Purple badge pill with gap value */}
                        {isThisGapActive && (
                          <div
                            className="pointer-events-none absolute z-30 flex items-center justify-center rounded-[3px] bg-[#9333ea] px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm"
                            style={{
                              left: "50%",
                              top: "50%",
                              transform: "translate(-50%, -50%)",
                              lineHeight: "12px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {displayGap}
                          </div>
                        )}
                      </div>
                    );
                  }
                });
              })()}

              {/* Rotation-aware wrapper for handles, edges, and sizing badge */}
              {!editingTextId && (
                <div
                  style={{
                    position: "absolute",
                    left: scr.x,
                    top: scr.y,
                    width: scr.w,
                    height: scr.h,
                    transform: hasRot ? `rotate(${rot}deg)` : undefined,
                    transformOrigin: "center center",
                    pointerEvents: "none",
                  }}
                >
                  {/* 4 hoverable edge lines for top, bottom, left, right resize (Higher zIndex to always allow frame resizing) */}
                  <div
                    key="edge-n"
                    onPointerDown={(e) => onHandlePointerDown(e, "n")}
                    style={{
                      position: "absolute",
                      left: 0,
                      top: -EDGE_HIT_SIZE / 2,
                      width: Math.max(0, scr.w),
                      height: EDGE_HIT_SIZE,
                      cursor: "var(--cursor-resize-ns, ns-resize)",
                      zIndex: 10,
                      pointerEvents: "auto",
                    }}
                  />
                  <div
                    key="edge-s"
                    onPointerDown={(e) => onHandlePointerDown(e, "s")}
                    style={{
                      position: "absolute",
                      left: 0,
                      top: scr.h - EDGE_HIT_SIZE / 2,
                      width: Math.max(0, scr.w),
                      height: EDGE_HIT_SIZE,
                      cursor: "var(--cursor-resize-ns, ns-resize)",
                      zIndex: 10,
                      pointerEvents: "auto",
                    }}
                  />
                  <div
                    key="edge-w"
                    onPointerDown={(e) => onHandlePointerDown(e, "w")}
                    style={{
                      position: "absolute",
                      left: -EDGE_HIT_SIZE / 2,
                      top: 0,
                      width: EDGE_HIT_SIZE,
                      height: Math.max(0, scr.h),
                      cursor: "var(--cursor-resize-ew, ew-resize)",
                      zIndex: 10,
                      pointerEvents: "auto",
                    }}
                  />
                  <div
                    key="edge-e"
                    onPointerDown={(e) => onHandlePointerDown(e, "e")}
                    style={{
                      position: "absolute",
                      left: scr.w - EDGE_HIT_SIZE / 2,
                      top: 0,
                      width: EDGE_HIT_SIZE,
                      height: Math.max(0, scr.h),
                      cursor: "var(--cursor-resize-ew, ew-resize)",
                      zIndex: 10,
                      pointerEvents: "auto",
                    }}
                  />

                  {/* 8 resize handle boxes (4 corners + 4 edge centers) */}
                  {HANDLES.map((handle) => {
                    const pos = handleOffset(handle, { x: 0, y: 0, w: scr.w, h: scr.h });
                    return (
                      <div
                        key={handle}
                        onPointerDown={(e) => onHandlePointerDown(e, handle)}
                        style={{
                          position: "absolute",
                          left: pos.x,
                          top: pos.y,
                          width: HANDLE_SIZE,
                          height: HANDLE_SIZE,
                          background: "var(--surface-content)",
                          border: "1.5px solid var(--accent)",
                          boxSizing: "border-box",
                          cursor: HANDLE_CURSORS[handle],
                          zIndex: 12,
                          pointerEvents: "auto",
                        }}
                      />
                    );
                  })}

                  {/* 4 corner rotate hit zones — placed immediately outside the corner handles */}
                  {CORNER_HANDLES.map((handle) => {
                    const pos = handleOffset(handle, { x: 0, y: 0, w: scr.w, h: scr.h });
                    const ox = handle.includes("w") ? -16 : 8;
                    const oy = handle.includes("n") ? -16 : 8;
                    return (
                      <div
                        key={`rotate-${handle}`}
                        onPointerDown={(e) => onRotateHandlePointerDown(e, handle)}
                        title="Rotate"
                        style={{
                          position: "absolute",
                          left: pos.x + ox,
                          top: pos.y + oy,
                          width: 18,
                          height: 18,
                          cursor: "var(--cursor-rotate, crosshair)",
                          zIndex: 14,
                          pointerEvents: "auto",
                        }}
                      />
                    );
                  })}

                  {/* Sizing Badge matching Screenshot (358 × Fit 32) centered below single selection */}
                  {singleNode && singleRect && (() => {
                    const badgeText = formatSizingBadge(singleNode, singleRect);
                    if (!badgeText) return null;
                    return (
                      <div
                        style={{
                          position: "absolute",
                          left: scr.w / 2,
                          top: scr.h + 4,
                          transform: "translateX(-50%)",
                          background: "#0D99FF",
                          color: "#ffffff",
                          fontFamily: "var(--ui-font)",
                          fontSize: 11,
                          fontWeight: 500,
                          lineHeight: "16px",
                          letterSpacing: "0.01em",
                          padding: "1px 6px",
                          borderRadius: 2,
                          boxShadow: "0 1px 2px rgba(0,0,0,0.18)",
                          whiteSpace: "nowrap",
                          zIndex: 30,
                          pointerEvents: "none",
                        }}
                      >
                        {badgeText}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })()}

      {/* marquee */}
      {marquee &&
        (() => {
          const scr = G.canvasRectToScreen(viewport, marquee);
          return (
            <div
              style={{
                position: "absolute",
                left: scr.x,
                top: scr.y,
                width: scr.w,
                height: scr.h,
                border: "1px solid var(--accent)",
                background: "rgba(59,130,246,0.08)",
                pointerEvents: "none",
                boxSizing: "border-box",
              }}
            />
          );
        })()}

      {/* Auto Alignment Guides (Smart Guides with Red/Pink Lines and Dots matching Figma) */}
      {snapViz && (
        <>
          {/* Horizontal Alignment Guides */}
          {(snapViz.hList || (snapViz.h ? [snapViz.h] : [])).map((line, i) => {
            const movingRect = line.movingRect;
            const targetRect = line.targetRect ?? line.parentRect;

            if (line.kind === "gap" && targetRect && movingRect) {
              let gY1 = line.gapDirection === "bottom" ? targetRect.y + targetRect.h : movingRect.y + movingRect.h;
              let gY2 = line.gapDirection === "bottom" ? movingRect.y : targetRect.y;
              if (gY2 < gY1) {
                const tmp = gY1;
                gY1 = gY2;
                gY2 = tmp;
              }
              const overlapX1 = Math.max(targetRect.x, movingRect.x);
              const overlapX2 = Math.min(targetRect.x + targetRect.w, movingRect.x + movingRect.w);
              const centerX = overlapX2 > overlapX1 ? (overlapX1 + overlapX2) / 2 : targetRect.x + targetRect.w / 2;
              const scrY1 = viewport.y + gY1 * viewport.zoom;
              const scrY2 = viewport.y + gY2 * viewport.zoom;
              const scrX = viewport.x + centerX * viewport.zoom;
              const scrH = Math.max(1, scrY2 - scrY1);
              return (
                <Fragment key={`snap-gap-h-${i}-${line.at}`}>
                  <div
                    className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: scrX, top: scrY1, width: 12, height: 1, backgroundColor: "#EF4444", zIndex: 35 }}
                  />
                  <div
                    className="pointer-events-none absolute -translate-x-1/2"
                    style={{ left: scrX, top: scrY1, width: 1, height: scrH, backgroundColor: "#EF4444", zIndex: 35 }}
                  />
                  <div
                    className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: scrX, top: scrY2, width: 12, height: 1, backgroundColor: "#EF4444", zIndex: 35 }}
                  />
                  <div
                    className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 z-40 flex items-center justify-center rounded-[4px] bg-[#EF4444] px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm"
                    style={{ left: scrX, top: (scrY1 + scrY2) / 2 }}
                  >
                    {Math.round(line.gap ?? (gY2 - gY1))}
                  </div>
                </Fragment>
              );
            }

            let minX = movingRect ? movingRect.x : line.at;
            let maxX = movingRect ? movingRect.x + movingRect.w : line.at;
            if (targetRect) {
              minX = Math.min(minX, targetRect.x);
              maxX = Math.max(maxX, targetRect.x + targetRect.w);
            } else {
              minX -= 40;
              maxX += 40;
            }
            const scrLeft = viewport.x + minX * viewport.zoom;
            const scrWidth = Math.max(2, (maxX - minX) * viewport.zoom);
            const scrY = viewport.y + line.at * viewport.zoom;

            // Collect snap points (dots) along this horizontal line
            const dotXValues = new Set();
            if (movingRect) {
              dotXValues.add(movingRect.x);
              dotXValues.add(movingRect.x + movingRect.w);
              if (line.movingEdge === "center") {
                dotXValues.add(movingRect.x + movingRect.w / 2);
              }
            }
            if (targetRect) {
              dotXValues.add(targetRect.x);
              dotXValues.add(targetRect.x + targetRect.w);
              if (line.kind?.includes("center")) {
                dotXValues.add(targetRect.x + targetRect.w / 2);
              }
            }

            return (
              <Fragment key={`snap-h-${i}-${line.at}`}>
                {/* Horizontal Guide Line */}
                <div
                  className="pointer-events-none absolute"
                  style={{
                    top: scrY,
                    left: scrLeft,
                    width: scrWidth,
                    height: 1,
                    backgroundColor: "#EF4444",
                    zIndex: 35,
                  }}
                />
                {/* Dots at alignment points */}
                {Array.from(dotXValues).map((xVal, dIdx) => (
                  <div
                    key={`snap-h-dot-${i}-${dIdx}`}
                    className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{
                      left: viewport.x + xVal * viewport.zoom,
                      top: scrY,
                      width: 5,
                      height: 5,
                      backgroundColor: "#EF4444",
                      boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.4)",
                      zIndex: 36,
                    }}
                  />
                ))}
              </Fragment>
            );
          })}

          {/* Vertical Alignment Guides */}
          {(snapViz.vList || (snapViz.v ? [snapViz.v] : [])).map((line, i) => {
            const movingRect = line.movingRect;
            const targetRect = line.targetRect ?? line.parentRect;

            if (line.kind === "gap" && targetRect && movingRect) {
              let gX1 = line.gapDirection === "right" ? targetRect.x + targetRect.w : movingRect.x + movingRect.w;
              let gX2 = line.gapDirection === "right" ? movingRect.x : targetRect.x;
              if (gX2 < gX1) {
                const tmp = gX1;
                gX1 = gX2;
                gX2 = tmp;
              }
              const overlapY1 = Math.max(targetRect.y, movingRect.y);
              const overlapY2 = Math.min(targetRect.y + targetRect.h, movingRect.y + movingRect.h);
              const centerY = overlapY2 > overlapY1 ? (overlapY1 + overlapY2) / 2 : (targetRect.y + targetRect.h / 2);
              const scrX1 = viewport.x + gX1 * viewport.zoom;
              const scrX2 = viewport.x + gX2 * viewport.zoom;
              const scrY = viewport.y + centerY * viewport.zoom;
              const scrW = Math.max(1, scrX2 - scrX1);
              return (
                <Fragment key={`snap-gap-v-${i}-${line.at}`}>
                  <div
                    className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: scrX1, top: scrY, width: 1, height: 12, backgroundColor: "#EF4444", zIndex: 35 }}
                  />
                  <div
                    className="pointer-events-none absolute -translate-y-1/2"
                    style={{ left: scrX1, top: scrY, width: scrW, height: 1, backgroundColor: "#EF4444", zIndex: 35 }}
                  />
                  <div
                    className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: scrX2, top: scrY, width: 1, height: 12, backgroundColor: "#EF4444", zIndex: 35 }}
                  />
                  <div
                    className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 z-40 flex items-center justify-center rounded-[4px] bg-[#EF4444] px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm"
                    style={{ left: (scrX1 + scrX2) / 2, top: scrY }}
                  >
                    {Math.round(line.gap ?? (gX2 - gX1))}
                  </div>
                </Fragment>
              );
            }

            let minY = movingRect ? movingRect.y : line.at;
            let maxY = movingRect ? movingRect.y + movingRect.h : line.at;
            if (targetRect) {
              minY = Math.min(minY, targetRect.y);
              maxY = Math.max(maxY, targetRect.y + targetRect.h);
            } else {
              minY -= 40;
              maxY += 40;
            }
            const scrTop = viewport.y + minY * viewport.zoom;
            const scrHeight = Math.max(2, (maxY - minY) * viewport.zoom);
            const scrX = viewport.x + line.at * viewport.zoom;

            // Collect snap points (dots) along this vertical line
            const dotYValues = new Set();
            if (movingRect) {
              dotYValues.add(movingRect.y);
              dotYValues.add(movingRect.y + movingRect.h);
              if (line.movingEdge === "center") {
                dotYValues.add(movingRect.y + movingRect.h / 2);
              }
            }
            if (targetRect) {
              dotYValues.add(targetRect.y);
              dotYValues.add(targetRect.y + targetRect.h);
              if (line.kind?.includes("center")) {
                dotYValues.add(targetRect.y + targetRect.h / 2);
              }
            }

            return (
              <Fragment key={`snap-v-${i}-${line.at}`}>
                {/* Vertical Guide Line */}
                <div
                  className="pointer-events-none absolute"
                  style={{
                    left: scrX,
                    top: scrTop,
                    width: 1,
                    height: scrHeight,
                    backgroundColor: "#EF4444",
                    zIndex: 35,
                  }}
                />
                {/* Dots at alignment points */}
                {Array.from(dotYValues).map((yVal, dIdx) => (
                  <div
                    key={`snap-v-dot-${i}-${dIdx}`}
                    className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{
                      left: scrX,
                      top: viewport.y + yVal * viewport.zoom,
                      width: 5,
                      height: 5,
                      backgroundColor: "#EF4444",
                      boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.4)",
                      zIndex: 36,
                    }}
                  />
                ))}
              </Fragment>
            );
          })}
        </>
      )}

      {/* Depth-gap batch: guide hover/drag highlight — a 2px line over
          the hovered or dragged guide, spanning its frame. */}
      {guideLineViz &&
        (guideLineViz.kind === "v" ? (
          <div
            className="pointer-events-none absolute"
            data-guide-line={guideLineViz.active ? "drag" : "hover"}
            style={{
              left: viewport.x + guideLineViz.lineAt * viewport.zoom - 1,
              top: viewport.y + guideLineViz.rect.y * viewport.zoom,
              width: 2,
              height: guideLineViz.rect.h * viewport.zoom,
              background: guideLineViz.active
                ? "var(--accent)"
                : guideLineViz.color,
              opacity: guideLineViz.active ? 1 : 0.9,
              zIndex: 16,
            }}
          />
        ) : (
          <div
            className="pointer-events-none absolute"
            data-guide-line={guideLineViz.active ? "drag" : "hover"}
            style={{
              top: viewport.y + guideLineViz.lineAt * viewport.zoom - 1,
              left: viewport.x + guideLineViz.rect.x * viewport.zoom,
              height: 2,
              width: guideLineViz.rect.w * viewport.zoom,
              background: guideLineViz.active
                ? "var(--accent)"
                : guideLineViz.color,
              opacity: guideLineViz.active ? 1 : 0.9,
              zIndex: 16,
            }}
          />
        ))}

      {/* Depth-gap batch: flex reorder — a translucent ghost of the
          dragged node follows the pointer; the insertion line (2px,
          selection blue) spans the parent's cross axis at the slot. */}
      {reorderViz &&
        (() => {
          const ghost = G.canvasRectToScreen(viewport, reorderViz.ghost);
          const line = reorderViz.line;
          const vertical = line?.w === 0;
          return (
            <div
              className="pointer-events-none absolute inset-0"
              style={{ zIndex: 26 }}
            >
              <div
                style={{
                  position: "absolute",
                  left: ghost.x,
                  top: ghost.y,
                  width: ghost.w,
                  height: ghost.h,
                  background: "rgba(59,130,246,0.18)",
                  border: "1.5px solid var(--accent)",
                  boxSizing: "border-box",
                  opacity: 0.85,
                  overflow: "hidden",
                }}
              >
                <span
                  className="block truncate px-1 py-0.5 text-[10px] font-medium"
                  style={{ color: "var(--accent)" }}
                >
                  {reorderViz.name}
                </span>
              </div>
              {line && line.isCell ? (
                <div
                  data-reorder="cell-highlight"
                  style={{
                    position: "absolute",
                    left: viewport.x + line.x * viewport.zoom,
                    top: viewport.y + line.y * viewport.zoom,
                    width: line.w * viewport.zoom,
                    height: line.h * viewport.zoom,
                    border: "2px dashed var(--accent)",
                    borderRadius: "4px",
                    background: "rgba(59,130,246,0.12)",
                    boxSizing: "border-box",
                  }}
                />
              ) : line ? (
                <div
                  data-reorder="insertion-line"
                  style={{
                    position: "absolute",
                    left:
                      viewport.x +
                      line.x * viewport.zoom -
                      (vertical ? 1 : 0),
                    top:
                      viewport.y +
                      line.y * viewport.zoom -
                      (vertical ? 0 : 1),
                    width: vertical ? 2 : line.w * viewport.zoom,
                    height: vertical ? line.h * viewport.zoom : 2,
                    background: "var(--accent)",
                  }}
                />
              ) : null}
            </div>
          );
        })()}

      {/* Drop target frame highlight when hovering over a candidate frame during drag */}
      {dropTargetFrameId &&
        doc.nodes[dropTargetFrameId] &&
        (() => {
          const r = rectOf(doc.nodes, dropTargetFrameId);
          const scr = G.canvasRectToScreen(viewport, r);
          const tf = doc.nodes[dropTargetFrameId];
          const rot = nodeCanvasRotation(doc.nodes, dropTargetFrameId);
          const hasRot = rot % 360 !== 0;
          return (
            <div
              key="drop-target-highlight"
              className="pointer-events-none absolute border-[1.5px] border-dashed border-[#0EA5E9] dark:border-[#38BDF8] rounded-md z-20 transition-all duration-75"
              style={{
                left: scr.x - 1,
                top: scr.y - 1,
                width: scr.w + 2,
                height: scr.h + 2,
                backgroundColor: "rgba(14, 165, 233, 0.06)",
                transformOrigin: "center center",
                transform: hasRot ? `rotate(${rot}deg)` : undefined,
              }}
            >
              <div className="absolute top-1.5 left-2 flex items-center gap-1 text-[11px] font-medium text-[#0284C7] dark:text-[#38BDF8] bg-white/95 dark:bg-[#18181B]/95 px-2 py-0.5 rounded-md shadow-xs border border-[#BAE6FD] dark:border-sky-900/50 backdrop-blur-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-[#0EA5E9] dark:bg-[#38BDF8]" />
                <span>Place in {tf.name}</span>
              </div>
            </div>
          );
        })()}

      {/* File / Image drag over canvas indicator */}
      {isDragOverCanvas && (
        <div className="pointer-events-none absolute inset-0 z-50 border-2 border-dashed border-[#0D99FF] bg-[#0D99FF]/5 flex items-center justify-center transition-all animate-in fade-in duration-100">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-[#18181B] border border-[#0D99FF]/40 shadow-2xl text-xs font-semibold text-[#0D99FF] backdrop-blur-md">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
              <circle cx="9" cy="9" r="2"/>
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
            </svg>
            <span>Drop image on canvas</span>
          </div>
        </div>
      )}

      {/* M4: anchor-edit overlay — handle lines for the selected anchor
          (screen-space SVG), then the anchor + handle dots themselves */}
      {editingPathId &&
        doc.nodes[editingPathId]?.type === "path" &&
        (() => {
          const node = doc.nodes[editingPathId];
          const anchors = anchorsInCanvas(doc.nodes, node);
          const sel = anchors[selectedAnchorIndex ?? -1];
          return (
            <>
              {sel && (sel.in || sel.out) && (
                <svg
                  className="pointer-events-none absolute inset-0"
                  style={{ width: "100%", height: "100%", zIndex: 24 }}
                >
                  {sel.in &&
                    (() => {
                      const a = G.canvasToScreen(viewport, sel);
                      const b = G.canvasToScreen(viewport, sel.in);
                      return (
                        <line
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          stroke="var(--accent)"
                          strokeWidth={1}
                        />
                      );
                    })()}
                  {sel.out &&
                    (() => {
                      const a = G.canvasToScreen(viewport, sel);
                      const b = G.canvasToScreen(viewport, sel.out);
                      return (
                        <line
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          stroke="var(--accent)"
                          strokeWidth={1}
                        />
                      );
                    })()}
                </svg>
              )}
              {anchors.map((a, i) => {
                const scr = G.canvasToScreen(viewport, a);
                const selected = i === selectedAnchorIndex;
                return (
                  <div
                    key={`a-${i}`}
                    data-anchor-idx={i}
                    title={a.smooth ? "Anchor (smooth) — Alt+click for corner" : "Anchor (corner) — Alt+click for smooth"}
                    style={{
                      position: "absolute",
                      left: scr.x - 5,
                      top: scr.y - 5,
                      width: 10,
                      height: 10,
                      background: selected
                        ? "var(--accent)"
                        : "var(--surface-content)",
                      border: "1.5px solid var(--accent)",
                      boxSizing: "border-box",
                      cursor: "move",
                      zIndex: 25,
                    }}
                  />
                );
              })}
              {sel &&
                [
                  ["in", sel.in],
                  ["out", sel.out],
                ]
                  .filter(([, p]) => p)
                  .map(([which, p]) => {
                    const scr = G.canvasToScreen(viewport, p);
                    return (
                      <div
                        key={which}
                        data-anchor-idx={selectedAnchorIndex}
                        data-handle={which}
                        title="Bézier handle"
                        style={{
                          position: "absolute",
                          left: scr.x - 4,
                          top: scr.y - 4,
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "var(--surface-content)",
                          border: "1.5px solid var(--accent)",
                          boxSizing: "border-box",
                          cursor: "move",
                          zIndex: 25,
                        }}
                      />
                    );
                  })}
            </>
          );
        })()}

      {/* comment pins (M3) — page coords, numbered per page, locked to layer if attached.
          Hidden while previewing a version (M7): pins belong to the
          live doc, not the snapshot. */}
      {!previewing && (() => {
        const pageComments = (doc.comments ?? [])
          .filter((c) => !c.pageId || c.pageId === activePageId)
          .filter((c) => showResolvedComments || !c.resolved)
          .slice()
          .sort((a, b) => {
            if (Boolean(a.resolved) !== Boolean(b.resolved)) {
              return Number(a.resolved) - Number(b.resolved);
            }
            return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
          });

        return pageComments.map((c, idx) => {
          const n = idx + 1;
          const nodeRect = c.nodeId && doc.nodes[c.nodeId]
            ? (G.absoluteRect(doc.nodes, c.nodeId) || rectOf(doc.nodes, c.nodeId))
            : null;
          const canvasPos = (nodeRect && c.relX != null && c.relY != null)
            ? { x: nodeRect.x + c.relX, y: nodeRect.y + c.relY }
            : { x: c.x, y: c.y };
          const scr = G.canvasToScreen(viewport, canvasPos);
          const active = c.id === activeCommentId;
          const isHovered = hoveredCommentId === c.id;
          const firstMsg = c.messages?.[0];
          const author = firstMsg?.author || "You";
          const text = firstMsg?.text || "";
          const replyCount = (c.messages?.length || 1) - 1;

          return (
            <Fragment key={c.id}>
              <button
                data-comment-pin={c.id}
                title={text || "Comment"}
                onPointerEnter={() => handleCommentEnter(c.id)}
                onPointerLeave={handleCommentLeave}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const st = store.getState();
                  st.setCommentDraft(null);
                  st.setActiveCommentId(c.id);
                  st.setCommentsPanelOpen(true);
                }}
                className="absolute flex items-center justify-center rounded-full text-[11px] font-bold cursor-pointer transition-transform hover:scale-110 select-none"
                style={{
                  left: scr.x,
                  top: scr.y,
                  width: 24,
                  height: 24,
                  transform: "translate(-50%, -100%)",
                  background: c.resolved
                    ? "var(--text-2)"
                    : "var(--accent-collab)",
                  color: "#fff",
                  opacity: c.resolved ? 0.6 : 1,
                  boxShadow: active
                    ? "0 0 0 2px var(--surface-content), 0 0 0 4px var(--accent-collab)"
                    : isHovered
                      ? "0 0 0 2px var(--surface-content), 0 2px 8px rgba(0,0,0,0.35)"
                      : "0 1px 4px rgba(0,0,0,0.3)",
                  zIndex: isHovered ? 50 : (active ? 40 : 20),
                }}
              >
                {n}
              </button>

              {/* Hover chat bubble tooltip */}
              {isHovered && (
                <div
                  data-comment-bubble={c.id}
                  onPointerEnter={() => handleCommentEnter(c.id)}
                  onPointerLeave={handleCommentLeave}
                  onClick={(e) => {
                    e.stopPropagation();
                    const st = store.getState();
                    st.setCommentDraft(null);
                    st.setActiveCommentId(c.id);
                    st.setCommentsPanelOpen(true);
                  }}
                  className="pointer-events-auto absolute z-50 flex flex-col rounded-xl border border-[var(--line)] bg-[var(--surface-content)] p-3 shadow-2xl transition-all cursor-pointer animate-in fade-in zoom-in-95 duration-100"
                  style={{
                    left: scr.x,
                    top: scr.y - 28,
                    transform: "translate(-50%, -100%)",
                    minWidth: 220,
                    maxWidth: 290,
                  }}
                >
                  {/* Invisible bridge to catch pointer movement between pin and bubble */}
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: -12,
                      height: 14,
                      pointerEvents: "auto",
                    }}
                  />

                  {/* Header: badge, author, time */}
                  <div className="flex items-center justify-between gap-2 mb-1.5 pb-1 border-b border-[var(--line)]/50">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--accent-collab)] text-[10px] font-bold text-white">
                        {n}
                      </span>
                      <span className="text-xs font-semibold text-[var(--text-1)] truncate">
                        {author}
                      </span>
                    </div>
                    <span className="text-[10px] text-[var(--text-2)] shrink-0 font-medium">
                      {timeAgo(c.createdAt)}
                    </span>
                  </div>

                  {/* Comment message */}
                  <div className="text-xs text-[var(--text-1)] leading-relaxed break-words line-clamp-3 select-none">
                    {text || "(No text)"}
                  </div>

                  {/* Replies footer */}
                  {replyCount > 0 && (
                    <div className="mt-2 pt-1.5 border-t border-[var(--line)]/40 flex items-center gap-1 text-[11px] font-medium text-[var(--accent-collab)]">
                      <span>💬</span>
                      <span>
                        {replyCount} {replyCount === 1 ? "reply" : "replies"}
                      </span>
                    </div>
                  )}

                  {/* Downward pointer beak */}
                  <div
                    className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 border-b border-r border-[var(--line)] bg-[var(--surface-content)]"
                  />
                </div>
              )}
            </Fragment>
          );
        });
      })()}
      {!previewing &&
        commentDraft &&
        commentDraft.pageId === activePageId &&
        (() => {
          const nodeRect = commentDraft.nodeId && doc.nodes[commentDraft.nodeId]
            ? (G.absoluteRect(doc.nodes, commentDraft.nodeId) || rectOf(doc.nodes, commentDraft.nodeId))
            : null;
          const canvasPos = (nodeRect && commentDraft.relX != null && commentDraft.relY != null)
            ? { x: nodeRect.x + commentDraft.relX, y: nodeRect.y + commentDraft.relY }
            : { x: commentDraft.x, y: commentDraft.y };
          const scr = G.canvasToScreen(viewport, canvasPos);
          return (
            <div
              className="pointer-events-none absolute flex items-center justify-center rounded-full text-[var(--type-micro)] font-semibold"
              style={{
                left: scr.x,
                top: scr.y,
                width: 24,
                height: 24,
                transform: "translate(-50%, -100%)",
                background: "var(--accent-collab)",
                color: "#fff",
                boxShadow: "0 0 0 2px var(--surface-content), 0 0 0 4px var(--accent-collab)",
                zIndex: 30,
              }}
            >
              +
            </div>
          );
        })()}

      {/* size pill */}
      {pill && (
        <div
          className="pointer-events-none absolute whitespace-nowrap px-1.5 py-0.5 text-[11px] font-medium leading-none"
          style={{
            left: pill.x,
            top: pill.y,
            transform: "translateX(-50%)",
            background: "#0D99FF",
            color: "#ffffff",
            fontFamily: "var(--ui-font)",
            borderRadius: 2,
            boxShadow: "0 1px 2px rgba(0,0,0,0.18)",
            zIndex: 30,
          }}
        >
          {pill.text}
        </div>
      )}

      {/* M6: remote peers — their selections (dashed outline in the
          peer colour + name tag) and their live cursors (arrow + name
          flag), only for peers on THIS page. Screen space, no pointer
          events: remote presence never intercepts local gestures.
          Hidden while previewing a version (M7) — peers are editing
          the live doc, not the snapshot. */}
      {!previewing && Object.values(peers ?? {}).map((peer) => {
        if (!peer?.identity || peer.pageId !== activePageId) return null;
        const color = peer.identity.color;
        return (
          <div key={peer.identity.id} className="pointer-events-none absolute inset-0" style={{ zIndex: 26 }}>
            {(peer.selection ?? [])
              .filter((id) => doc.nodes[id])
              .map((id) => {
                const scr = G.canvasRectToScreen(viewport, rectOf(doc.nodes, id));
                return (
                  <div key={id}>
                    <div
                      style={{
                        position: "absolute",
                        left: scr.x,
                        top: scr.y,
                        width: scr.w,
                        height: scr.h,
                        border: `1.5px dashed ${color}`,
                        boxSizing: "border-box",
                      }}
                    />
                    <div
                      className="absolute whitespace-nowrap rounded-[var(--radius-sm)] px-1 py-px text-[9px] font-semibold text-white"
                      style={{
                        left: scr.x,
                        top: scr.y - 15,
                        background: color,
                      }}
                    >
                      {peer.identity.name}
                    </div>
                  </div>
                );
              })}
            {peer.cursor && (
              <div
                className="absolute"
                style={{
                  left: G.canvasToScreen(viewport, peer.cursor).x,
                  top: G.canvasToScreen(viewport, peer.cursor).y,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" style={{ display: "block", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.35))" }}>
                  <path
                    d="M1 1 L1 13.5 L4.8 10.8 L7 15.8 L9.2 14.8 L7 10 L11.5 10 Z"
                    fill={color}
                    stroke="#fff"
                    strokeWidth="1.2"
                  />
                </svg>
                <div
                  className="absolute whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-semibold text-white"
                  style={{ left: 12, top: 13, background: color }}
                >
                  {peer.identity.name}
                </div>
                {/* Depth-gap batch: the peer's cursor-chat bubble —
                    pruned HERE, in the render pass, on expiry. */}
                {peer.chat && peer.chat.expiresAt > Date.now() && (
                  <div
                    style={{
                      position: "absolute",
                      left: 14,
                      top: -8,
                      transform: "translateY(-100%)",
                    }}
                  >
                    <ChatBubble text={peer.chat.text} />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Depth-gap batch: our own cursor-chat bubble, floating at our
          cursor for its 4 s (the Collab hook clears localChat at
          expiry, which re-renders and removes it). */}
      {!previewing &&
        localChat &&
        localChat.expiresAt > Date.now() &&
        localCursor &&
        (() => {
          const scr = G.canvasToScreen(viewport, localCursor);
          return (
            <div
              className="pointer-events-none absolute"
              style={{ left: scr.x, top: scr.y, zIndex: 27 }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 14,
                  top: -8,
                  transform: "translateY(-100%)",
                }}
              >
                <ChatBubble text={localChat.text} />
              </div>
            </div>
          );
        })()}

      {/* Depth-gap batch: cursor-chat composer — opens on "/" at our
          last cursor position; Enter sends, Esc cancels, blur closes. */}
      {chatDraft && (
        <div
          className="absolute z-40"
          data-cursor-chat="composer"
          style={{
            left: chatDraft.anchor.x + 14,
            top: chatDraft.anchor.y + 14,
          }}
        >
          <div className="relative">
            <input
              autoFocus
              value={chatDraft.text}
              maxLength={CURSOR_CHAT_MAX_LEN}
              placeholder="Say something… (Enter to send)"
              onChange={(e) =>
                setChatDraft({
                  ...chatDraft,
                  text: e.target.value.replace(/[\r\n]+/g, " "),
                })
              }
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  store.getState().sendCursorChat(chatDraft.text);
                  setChatDraft(null);
                  containerRef.current?.focus();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setChatDraft(null);
                  containerRef.current?.focus();
                }
              }}
              onBlur={() => setChatDraft(null)}
              className="w-64 rounded-xl border border-black/10 dark:border-white/10 px-3 py-2 text-[12px] font-medium shadow-2xl outline-none bg-white dark:bg-[#1E1E1E] text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:border-[#0D99FF] focus:ring-2 focus:ring-[#0D99FF]/20 transition-all"
            />
            {/* Speech tail pointing back up-left toward cursor */}
            <div
              style={{
                position: "absolute",
                left: -4,
                top: 10,
                width: 8,
                height: 8,
                transform: "rotate(45deg)",
              }}
              className="bg-white dark:bg-[#1E1E1E] border-l border-b border-black/10 dark:border-white/10"
            />
          </div>
        </div>
      )}

      {/* text editing is handled in-place directly on CanvasNode so font, layout, and position stay 100% intact */}

      {/* M4: hidden picker for Place image / SVG (toolbar button / Ctrl+Shift+K) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.svg"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) placeImageFile(file);
        }}
      />

      {/* Right-click Context Menu */}
      <ContextMenu
        position={contextMenuPos}
        onClose={() => setContextMenuPos(null)}
        onZoomToFit={() => zoomToFit()}
        onCollapseAll={() => {
          window.dispatchEvent(new CustomEvent("sidebar:collapse-all"));
        }}
        onDelete={(id) => {
          const st = useEditorStore.getState();
          if (id && !st.selection.includes(id)) {
            st.setSelection([id]);
          }
          st.deleteSelection();
        }}
        onNextArtboard={() => cycleArtboard(1)}
        onPrevArtboard={() => cycleArtboard(-1)}
        onOrganizeFrames={(targetId) => {
          const st = useEditorStore.getState();
          st.organizeFrames?.(targetId ? [targetId] : null);
        }}
        onCursorChat={() => {
          const anchor = contextMenuPos
            ? { x: contextMenuPos.x, y: contextMenuPos.y }
            : { x: canvasSize.w / 2, y: canvasSize.h / 2 };
          setChatDraft({ text: "", anchor });
        }}
        onHideUi={() => {
          const st = store.getState();
          st.setUiMode(st.uiMode === "hidden" || st.uiMode === "collapsed" ? "full" : "hidden");
        }}
        onSelectLayer={(id) => {
          useEditorStore.getState().setSelection([id]);
        }}
        onSelectParent={(id) => {
          const st = useEditorStore.getState();
          const n = st.doc.nodes[id];
          if (n?.parentId) st.setSelection([n.parentId]);
        }}
        onSelectChildren={(id) => {
          const st = useEditorStore.getState();
          const n = st.doc.nodes[id];
          if (n?.childIds?.length) st.setSelection(n.childIds);
        }}
        onCopyNode={(id) => {
          copySelectedNodes(id);
        }}
        onCopyLink={(id) => {
          try {
            const url = new URL(window.location.href);
            url.hash = id;
            navigator.clipboard?.writeText(url.toString());
          } catch (_) {}
          useEditorStore.getState().showToast({ message: "Link copied to clipboard" });
        }}
        onCopyCode={(id, format) => {
          const st = useEditorStore.getState();
          const n = st.doc.nodes[id];
          if (!n) return;
          let code = "";
          if (format === "jsx") code = nodeToReact(n, st.doc);
          else if (format === "css") code = nodeToCss(n, st.doc);
          else if (format === "tailwind") code = nodeToTailwind(n, st.doc);
          else if (format === "svg") {
            code = `<svg width="${n.w || 100}" height="${n.h || 100}" viewBox="0 0 ${n.w || 100} ${n.h || 100}" xmlns="http://www.w3.org/2000/svg">\n  <rect width="${n.w || 100}" height="${n.h || 100}" fill="${n.style?.fill || '#dddddd'}" />\n</svg>`;
          } else if (format === "png") {
            code = nodeToReact(n, st.doc);
          }
          try {
            navigator.clipboard?.writeText(code);
          } catch (_) {}
          st.showToast({ message: `Copied as ${format.toUpperCase()}` });
        }}
        onPaste={(targetId) => {
          handlePasteNode(targetId);
        }}
        onPasteOnTop={(targetId) => {
          handlePasteNode(targetId, { onTop: true });
        }}
        onPasteToReplace={(targetId) => {
          handlePasteNode(targetId, { replace: true });
        }}
        onDuplicate={(id) => {
          const st = useEditorStore.getState();
          if (id && !st.selection.includes(id)) {
            st.setSelection([id]);
          }
          st.duplicateSelection();
        }}
        onCopyStyles={(id) => {
          const st = useEditorStore.getState();
          const n = st.doc.nodes[id];
          if (n?.style) {
            copiedStylesRef.current = structuredClone(n.style);
            st.showToast({ message: "Styles copied" });
          }
        }}
        hasCopiedStyles={Boolean(copiedStylesRef.current)}
        onPasteStyles={(id) => {
          if (copiedStylesRef.current) {
            useEditorStore.getState().patchNodeStyle(id, copiedStylesRef.current);
            useEditorStore.getState().showToast({ message: "Styles pasted" });
          }
        }}
        onRename={(id) => {
          window.dispatchEvent(
            new CustomEvent("canvas:rename-node", { detail: { id } })
          );
        }}
        onFrameSelection={(id) => {
          handleFrameSelection(id);
        }}
        onWrapInFlex={(id) => {
          useEditorStore.getState().addFlex(id);
        }}
        onRemoveFlex={(id) => {
          useEditorStore.getState().removeFlex(id);
        }}
        onUngroup={(id) => {
          handleUngroup(id);
        }}
        onBringToFront={(id) => handleMoveZ(id, "front")}
        onSendToBack={(id) => handleMoveZ(id, "back")}
        onMoveUp={(id) => handleMoveZ(id, "forward")}
        onMoveDown={(id) => handleMoveZ(id, "backward")}
        onToggleVisibility={(id) => {
          const st = useEditorStore.getState();
          const n = st.doc.nodes[id];
          if (n) {
            const isHidden = G.isNodeHidden(st.doc.nodes, id);
            const willHide = !isHidden;
            st.patchNode(id, {
              hidden: willHide,
              visible: !willHide,
              style: { ...(n.style ?? {}), opacity: willHide ? 0 : 1 },
            });
            if (willHide) {
              const subtree = new Set(G.subtreeIds(st.doc.nodes, id));
              const nextSel = st.selection.filter((sid) => !subtree.has(sid));
              if (nextSel.length !== st.selection.length) {
                st.setSelection(nextSel);
              }
            }
          }
        }}
        onToggleLock={(id) => {
          const st = useEditorStore.getState();
          const n = st.doc.nodes[id];
          if (n) st.patchNode(id, { locked: !n.locked });
        }}
      />

      {/* Pasting indicator badge with loading circle spinner at bottom */}
      {pasting && (
        <div
          className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full border border-white/10 bg-[#18181b]/95 px-3.5 py-1.5 text-xs font-medium text-white shadow-2xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          <svg
            className="h-3.5 w-3.5 animate-spin text-[#0D99FF]"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3"
            />
            <path
              className="opacity-90"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>Pasting...</span>
        </div>
      )}
    </main>
  );
}
