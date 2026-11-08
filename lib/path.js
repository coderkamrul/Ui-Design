/**
 * Path / bézier math (M4) — pure and import-free, so it runs in the
 * browser, in Next's build, and in scripts/path-test.mjs.
 *
 * A path node stores anchors in NODE-LOCAL coordinates (the node's own
 * origin is the anchors' bounding-box minimum — see normalizeAnchors):
 *
 *   anchor = { x, y,
 *              in:  { x, y } | null,   // incoming control point
 *              out: { x, y } | null,   // outgoing control point
 *              smooth: boolean }
 *
 * Control points live in the SAME coordinate space as the anchor point
 * (not as relative offsets). A segment between two anchors is a straight
 * line when neither side has a handle, and a cubic bézier otherwise.
 * `smooth` anchors keep their two handles mirrored (same distance,
 * opposite direction) while dragging; corner anchors move handles
 * independently. Toggling smooth OFF keeps the handle positions and just
 * unlinks the mirroring (a defensible simplification — see Phase 5 §9).
 */

/** Round to 2 decimals for compact, stable path data strings. */
function fmt(n) {
  return Math.round(n * 100) / 100;
}

function pt(p) {
  return `${fmt(p.x)} ${fmt(p.y)}`;
}

/**
 * Bounding box of the ANCHOR POINTS only (handles may extend past it).
 * Returns { x, y, w, h } where x/y is the minimum corner.
 */
export function pathBounds(anchors) {
  if (!anchors || anchors.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const a of anchors) {
    x1 = Math.min(x1, a.x);
    y1 = Math.min(y1, a.y);
    x2 = Math.max(x2, a.x);
    y2 = Math.max(y2, a.y);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** One segment from anchor `a` to anchor `b` (line or cubic). */
function segment(a, b) {
  if (a.out || b.in) {
    const c1 = a.out ?? a;
    const c2 = b.in ?? b;
    return `C ${pt(c1)}, ${pt(c2)}, ${pt(b)}`;
  }
  return `L ${pt(b)}`;
}

/**
 * Build an SVG path `d` string from anchors. Open paths end at the last
 * anchor; closed paths add the closing segment back to the first anchor
 * plus `Z`.
 */
export function anchorsToD(anchors, closed = false) {
  if (!anchors || anchors.length === 0) return "";
  const parts = [`M ${pt(anchors[0])}`];
  for (let i = 1; i < anchors.length; i++) {
    parts.push(segment(anchors[i - 1], anchors[i]));
  }
  if (closed && anchors.length >= 2) {
    parts.push(segment(anchors[anchors.length - 1], anchors[0]));
    parts.push("Z");
  }
  return parts.join(" ");
}

/** The point mirrored through `around` (same distance, opposite side). */
export function mirrorPoint(p, around) {
  return { x: 2 * around.x - p.x, y: 2 * around.y - p.y };
}

/**
 * Move one handle of an anchor to `point`. When the anchor is smooth, the
 * opposite handle mirrors (same distance, opposite direction). Returns a
 * NEW anchor; the input is not mutated.
 */
export function mirrorHandle(anchor, which, point) {
  const next = { ...anchor, [which]: { x: point.x, y: point.y } };
  if (anchor.smooth) {
    const other = which === "out" ? "in" : "out";
    next[other] = mirrorPoint(point, anchor);
  }
  return next;
}

/**
 * Toggle an anchor between corner and smooth. Returns a NEW anchor.
 *
 * - smooth → corner: handle positions are KEPT; only the `smooth` flag
 *   clears, unlinking future mirroring.
 * - corner → smooth: existing handles are mirrored into line (the `out`
 *   handle drives when both exist; a lone handle mirrors to the other
 *   side). With NO handles, they are created along the neighbours'
 *   direction at 1/3 of the distance to each neighbour (mirrored when
 *   only one neighbour exists).
 *
 * `prev` / `next` are the neighbouring anchors (null at open ends).
 */
export function toggleAnchorSmooth(anchor, prev, next) {
  if (anchor.smooth) return { ...anchor, smooth: false };

  const out = { ...anchor, smooth: true };
  if (out.out && out.in) {
    out.in = mirrorPoint(out.out, out);
  } else if (out.out && !out.in) {
    out.in = mirrorPoint(out.out, out);
  } else if (!out.out && out.in) {
    out.out = mirrorPoint(out.in, out);
  } else {
    // No handles yet: create them from the neighbours' direction.
    if (next) {
      out.out = {
        x: anchor.x + (next.x - anchor.x) / 3,
        y: anchor.y + (next.y - anchor.y) / 3,
      };
    }
    if (prev) {
      out.in = {
        x: anchor.x + (prev.x - anchor.x) / 3,
        y: anchor.y + (prev.y - anchor.y) / 3,
      };
    }
    if (out.out && !out.in) out.in = mirrorPoint(out.out, out);
    if (out.in && !out.out) out.out = mirrorPoint(out.in, out);
  }
  return out;
}

/**
 * Shift anchors so their bounding-box minimum sits at (0, 0) — the
 * node-local invariant. Returns the shifted anchors, the `offset` that
 * was subtracted (the node's origin in the input coordinate space), and
 * the bounding-box `size`. Handles shift with their anchors.
 */
export function normalizeAnchors(anchors) {
  const b = pathBounds(anchors);
  const shiftPt = (p) => (p ? { x: p.x - b.x, y: p.y - b.y } : null);
  return {
    anchors: (anchors ?? []).map((a) => ({
      x: a.x - b.x,
      y: a.y - b.y,
      in: shiftPt(a.in),
      out: shiftPt(a.out),
      smooth: !!a.smooth,
    })),
    offset: { x: b.x, y: b.y },
    size: { w: b.w, h: b.h },
  };
}
