/**
 * Pure geometry helpers for the canvas core (M1): coordinate conversion
 * between screen space (CSS pixels inside the canvas container) and canvas
 * space (document units), rect math, zoom helpers and tree queries over the
 * normalised node table from lib/model.js.
 *
 * No imports and no DOM access, so the same module runs in the browser, in
 * Next's build, and in the standalone node test (scripts/geom-test.mjs).
 *
 * Conventions:
 * - A viewport is { x, y, zoom }: a canvas point p renders at screen point
 *   p * zoom + (x, y) inside the canvas container.
 * - A rect is { x, y, w, h } in whichever space the function name says.
 * - Node positions in the document are PARENT-RELATIVE; "absolute" rects
 *   here are canvas-space (root-frame) coordinates.
 */

export const MIN_ZOOM = 0.02; // 2% — Phase 3 spec range
export const MAX_ZOOM = 256; // 25,600%
export const MIN_SIZE = 1; // nodes can shrink to 1px, never 0 (Phase 3 §8)

export function clampZoom(zoom) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Screen point -> canvas point. */
export function screenToCanvas(vp, p) {
  return { x: (p.x - vp.x) / vp.zoom, y: (p.y - vp.y) / vp.zoom };
}

/** Canvas point -> screen point. */
export function canvasToScreen(vp, p) {
  return { x: p.x * vp.zoom + vp.x, y: p.y * vp.zoom + vp.y };
}

/** Canvas-space rect -> screen-space rect. */
export function canvasRectToScreen(vp, r) {
  const tl = canvasToScreen(vp, r);
  return { x: tl.x, y: tl.y, w: r.w * vp.zoom, h: r.h * vp.zoom };
}

/** Build a rect from two opposite corners (any order). */
export function normalizeRect(x1, y1, x2, y2) {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

/** Intersection test — touching edges alone do NOT count as intersecting. */
export function rectsIntersect(a, b) {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

/** Smallest rect containing every rect in the list (list must be non-empty). */
export function rectUnion(rects) {
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * New viewport at `newZoom` such that the canvas point currently under the
 * screen point `screenPt` stays exactly under it (zoom-to-cursor invariant).
 */
export function zoomToCursor(vp, screenPt, newZoom) {
  const z = clampZoom(newZoom);
  const c = screenToCanvas(vp, screenPt);
  return { zoom: z, x: screenPt.x - c.x * z, y: screenPt.y - c.y * z };
}

/**
 * Viewport that fits `bounds` (canvas space) inside a container of
 * `size` ({ w, h } screen px), with `padding` screen px on every side.
 */
export function fitViewport(bounds, size, padding = 48, offsets = { left: 0, right: 0, top: 0, bottom: 0 }) {
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) {
    return { x: 0, y: 0, zoom: 1 };
  }
  const curW = size?.w > 50 ? size.w : (typeof window !== "undefined" ? window.innerWidth : 1280);
  const curH = size?.h > 50 ? size.h : (typeof window !== "undefined" ? window.innerHeight : 800);

  const rawOffL = offsets.left || 0;
  const rawOffR = offsets.right || 0;
  const rawOffT = offsets.top || 0;
  const rawOffB = offsets.bottom || 0;

  // Only apply side offsets if remaining visible width is at least 400px
  const useSideOffsets = curW - rawOffL - rawOffR >= 400;
  const offL = useSideOffsets ? rawOffL : 0;
  const offR = useSideOffsets ? rawOffR : 0;
  const offT = curH - rawOffT - rawOffB >= 300 ? rawOffT : 0;
  const offB = curH - rawOffT - rawOffB >= 300 ? rawOffB : 0;

  const availW = Math.max(100, curW - offL - offR - padding * 2);
  const availH = Math.max(100, curH - offT - offB - padding * 2);
  const zoom = Math.min(MAX_ZOOM, Math.max(0.1, Math.min(availW / bounds.w, availH / bounds.h)));
  return {
    zoom,
    x: offL + (curW - offL - offR - bounds.w * zoom) / 2 - bounds.x * zoom,
    y: offT + (curH - offT - offB - bounds.h * zoom) / 2 - bounds.y * zoom,
  };
}

/**
 * Concrete pixel size of a node. Fixed sizing is exact; "fit" text falls
 * back to a typographic estimate (fontSize × lineHeight tall, rough glyph
 * advance wide) — good enough for bounds/selection math in M1.
 */
export function nodeSizePx(node, tokens = []) {
  if (!node) return { w: 0, h: 0 };
  let w = 0;
  const isText = node.type === "text";
  const pxW = Number(node.size?.w?.px);
  const fallbackW = Number(typeof node.size?.w === "number" ? node.size.w : node.w);
  if (Number.isFinite(pxW) && pxW > 0) {
    w = pxW;
  } else if (Number.isFinite(fallbackW) && fallbackW > 0) {
    w = fallbackW;
  } else if (node.size?.w?.kind === "container" || (node.size?.w?.token && String(node.size.w.token).includes("container"))) {
    const tokenName = String(node.size?.w?.token || "");
    const match = tokenName.match(/(\d+)/);
    w = match ? parseInt(match[1], 10) : 1280;
  } else if (isText && node.text) {
    w = Math.max(1, (node.text.content?.length ?? 0) * (Number(node.text.fontSize) || 14) * 0.55);
  } else if (Number.isFinite(Number(node.size?.prevSize?.w?.px))) {
    w = Number(node.size.prevSize.w.px);
  } else if (Number.isFinite(Number(node.layout?.prevSize?.w?.px))) {
    w = Number(node.layout.prevSize.w.px);
  }

  let h = 0;
  const pxH = Number(node.size?.h?.px);
  const fallbackH = Number(typeof node.size?.h === "number" ? node.size.h : node.h);
  if (Number.isFinite(pxH) && pxH > 0) {
    h = pxH;
  } else if (Number.isFinite(fallbackH) && fallbackH > 0) {
    h = fallbackH;
  } else if (isText && node.text) {
    const isTrunc = Boolean(node.text.truncation);
    const lines = isTrunc ? 1 : ((node.text.content ?? "").split("\n").length || 1);
    h = lines * (Number(node.text.fontSize) || 14) * (Number(node.text.lineHeight) || 1.25);
  } else if (Number.isFinite(Number(node.size?.prevSize?.h?.px))) {
    h = Number(node.size.prevSize.h.px);
  } else if (Number.isFinite(Number(node.layout?.prevSize?.h?.px))) {
    h = Number(node.layout.prevSize.h.px);
  }

  return {
    w: Number.isFinite(w) && w >= 0 ? w : 0,
    h: Number.isFinite(h) && h >= 0 ? h : 0,
  };
}

/** Canvas-space origin (top-left) of a node, summing ancestor positions. */
export function absoluteOrigin(nodes, id) {
  let x = 0,
    y = 0;
  if (!nodes) return { x, y };
  let cur = nodes[id];
  while (cur) {
    const posX = Number.isFinite(Number(cur.position?.x))
      ? Number(cur.position.x)
      : (Number.isFinite(Number(cur.x)) ? Number(cur.x) : 0);
    const posY = Number.isFinite(Number(cur.position?.y))
      ? Number(cur.position.y)
      : (Number.isFinite(Number(cur.y)) ? Number(cur.y) : 0);
    x += posX;
    y += posY;
    if (cur.parentId && nodes[cur.parentId]) {
      const p = nodes[cur.parentId];
      if (p.type === "frame" && p.layout?.mode !== "flex" && p.layout?.mode !== "grid") {
        const padL = Number(p.layout?.padding?.l ?? p.layout?.padding?.h ?? p.padding?.l ?? 0) || 0;
        const padT = Number(p.layout?.padding?.t ?? p.layout?.padding?.v ?? p.padding?.t ?? 0) || 0;
        x += padL;
        y += padT;
      }
    }
    cur = cur.parentId ? nodes[cur.parentId] : null;
  }
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  };
}

/** Canvas-space rect of a node. */
export function absoluteRect(nodes, id) {
  if (!nodes || !nodes[id]) return { x: 0, y: 0, w: 0, h: 0 };
  const node = nodes[id];
  const origin = absoluteOrigin(nodes, id);
  let { w, h } = nodeSizePx(node);
  if ((w <= 0 || h <= 0) && node.childIds && node.childIds.length > 0) {
    const childRects = node.childIds
      .map((cid) => absoluteRect(nodes, cid))
      .filter((r) => Number.isFinite(r.w) && Number.isFinite(r.h) && r.w > 0 && r.h > 0);
    if (childRects.length > 0) {
      const minX = Math.min(origin.x, ...childRects.map((r) => r.x));
      const minY = Math.min(origin.y, ...childRects.map((r) => r.y));
      const maxR = Math.max(origin.x + w, ...childRects.map((r) => r.x + r.w));
      const maxB = Math.max(origin.y + h, ...childRects.map((r) => r.y + r.h));
      const safeMinX = Number.isFinite(minX) ? minX : origin.x;
      const safeMinY = Number.isFinite(minY) ? minY : origin.y;
      const safeW = Number.isFinite(maxR - safeMinX) ? Math.max(w, maxR - safeMinX) : w;
      const safeH = Number.isFinite(maxB - safeMinY) ? Math.max(h, maxB - safeMinY) : h;
      return {
        x: safeMinX,
        y: safeMinY,
        w: safeW,
        h: safeH,
      };
    }
  }
  return {
    x: Number.isFinite(origin.x) ? origin.x : 0,
    y: Number.isFinite(origin.y) ? origin.y : 0,
    w: Number.isFinite(w) ? w : 0,
    h: Number.isFinite(h) ? h : 0,
  };
}

/** Ids of a node plus all its descendants (node first). */
export function subtreeIds(nodes, id) {
  const out = [];
  const walk = (nid) => {
    const n = nodes[nid];
    if (!n) return;
    out.push(nid);
    for (const c of n.childIds ?? []) walk(c);
  };
  walk(id);
  return out;
}

/**
 * The "effective" selection for move/delete/duplicate: selected ids with no
 * selected ancestor. Children of a selected frame travel with the frame, so
 * acting on both would double-apply.
 */
export function selectionRoots(nodes, ids) {
  if (!nodes || !ids) return [];
  const set = new Set(ids);
  return ids.filter((id) => {
    let cur = nodes[id];
    if (!cur) return false;
    while (cur && cur.parentId) {
      if (set.has(cur.parentId)) return false;
      cur = nodes[cur.parentId];
    }
    return true;
  });
}

/** Union of the canvas-space rects of the given nodes (null when empty). */
export function selectionBounds(nodes, ids) {
  const roots = ids.filter((id) => nodes && nodes[id]);
  if (roots.length === 0) return null;
  return rectUnion(roots.map((id) => absoluteRect(nodes, id)));
}

/** Check if a node or any of its ancestors is hidden */
export function isNodeHidden(nodes, id) {
  let cur = nodes?.[id];
  while (cur) {
    if (cur.hidden || cur.visible === false || cur.style?.opacity === 0) return true;
    cur = cur.parentId ? nodes[cur.parentId] : null;
  }
  return false;
}

/** Union of the canvas-space rects of a page's top-level nodes. */
export function pageBounds(nodes, page) {
  if (!page || !page.rootNodeIds || page.rootNodeIds.length === 0) return null;
  const roots = page.rootNodeIds.filter((id) => Boolean(nodes?.[id]) && !isNodeHidden(nodes, id));
  if (roots.length === 0) return null;
  return rectUnion(roots.map((id) => absoluteRect(nodes, id)));
}

/**
 * Resize `start` (canvas-space rect) by dragging `handle`
 * ("nw"|"n"|"ne"|"e"|"se"|"s"|"sw"|"w") by (dx, dy) canvas units.
 * The edge/corner opposite the handle stays fixed; size clamps to MIN_SIZE.
 * With `keepAspect` (corner handles), the dragged corner follows the
 * dominant axis and the other dimension scales by the start ratio.
 */
export function resizeRect(start, handle, dx, dy, keepAspect = false) {
  let { x, y, w, h } = start;
  const moveW = handle.includes("w");
  const moveE = handle.includes("e");
  const moveN = handle.includes("n");
  const moveS = handle.includes("s");

  if (moveE) w = start.w + dx;
  if (moveW) {
    w = start.w - dx;
    x = start.x + dx;
  }
  if (moveS) h = start.h + dy;
  if (moveN) {
    h = start.h - dy;
    y = start.y + dy;
  }

  const isCorner = (moveW || moveE) && (moveN || moveS);
  if (keepAspect && isCorner && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    const scaleW = w / start.w;
    const scaleH = h / start.h;
    if (Math.abs(scaleW - 1) >= Math.abs(scaleH - 1)) {
      h = w / ratio;
    } else {
      w = h * ratio;
    }
    if (moveW) x = start.x + start.w - w;
    if (moveN) y = start.y + start.h - h;
  }

  if (w < MIN_SIZE) {
    if (moveW) x = start.x + start.w - MIN_SIZE;
    w = MIN_SIZE;
  }
  if (h < MIN_SIZE) {
    if (moveN) y = start.y + start.h - MIN_SIZE;
    h = MIN_SIZE;
  }
  return { x, y, w, h };
}

/**
 * The frame that should parent a new node created at canvas point `pt`:
 * the deepest frame whose canvas rect contains the point; ties (nested
 * siblings) resolve to the one painted last (topmost). Null = page root.
 */
export function findFrameAtPoint(nodes, page, pt) {
  let best = null; // { id, depth, order }
  let order = 0;
  const walk = (ids, depth) => {
    for (const id of ids) {
      const node = nodes[id];
      if (!node || node.hidden || node.visible === false || node.style?.opacity === 0) continue;
      const myOrder = order++;
      if (node.type === "frame") {
        const r = absoluteRect(nodes, id);
        const inside =
          pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;
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
  walk(page.rootNodeIds, 0);
  return best ? best.id : null;
}
