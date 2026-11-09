/**
 * Snapping math (M4) — pure and import-free, so it runs in the browser,
 * in Next's build, and in scripts/snap-test.mjs. The small size/origin
 * helpers below mirror lib/geometry.js (duplicated deliberately, the
 * same pattern lib/flex.js uses for token resolution, so this module can
 * be loaded standalone by the test runner).
 *
 * Snap lines are CANVAS-space coordinates: `v` lines are vertical (an x
 * position the moving rect's left/centre/right can align to), `h` lines
 * horizontal. Each line is { at, kind } with kind "edge" | "center" |
 * "guide".
 */

/** Pixel size of a node (mirrors lib/geometry.js nodeSizePx). */
function nodeSizePx(node) {
  if (!node) return { w: 0, h: 0 };
  const w =
    node.size?.w?.kind === "fixed"
      ? (node.size.w.px ?? 0)
      : node.type === "text" && node.text
        ? Math.max(1, (node.text.content?.length ?? 0) * (node.text.fontSize ?? 14) * 0.55)
        : (node.size?.w?.px ?? 0);
  const h =
    node.size?.h?.kind === "fixed"
      ? (node.size.h.px ?? 0)
      : node.type === "text" && node.text
        ? (node.text.fontSize ?? 14) * (node.text.lineHeight ?? 1.25)
        : (node.size?.h?.px ?? 0);
  return { w, h };
}

/** Canvas-space origin of a node, summing ancestor positions. */
function absoluteOrigin(nodes, id) {
  let x = 0,
    y = 0;
  if (!nodes) return { x, y };
  let cur = nodes[id];
  while (cur) {
    x += cur.position?.x ?? 0;
    y += cur.position?.y ?? 0;
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
  return { x, y };
}

function absoluteRect(nodes, id) {
  if (!nodes || !nodes[id]) return { x: 0, y: 0, w: 0, h: 0 };
  const node = nodes[id];
  const origin = absoluteOrigin(nodes, id);
  const { w, h } = nodeSizePx(node);
  return { x: origin.x, y: origin.y, w, h };
}

/**
 * Collect every snap line a drag should consider:
 * - edges + centres of every node NOT in the moving subtree (the moving
 *   nodes themselves and their descendants are excluded; ancestors —
 *   e.g. the frame a child is being dragged inside — ARE included, so a
 *   child can snap to its own frame's edges);
 * - frame guides passed in as `frameGuides`: [{ rect, guides }] where
 *   `rect` is the frame's canvas-space rect and `guides` its guide list
 *   (v/h positions are frame-local; grid guides contribute their inner
 *   column boundaries).
 *
 * @param {Object.<string, Object>} nodes The document node table.
 * @param {string[]} movingIds Effective moving roots.
 * @param {Array<{ rect: {x,y,w,h}, guides: Array }>} [frameGuides]
 * @returns {{ v: Array<{at: number, kind: string}>,
 *             h: Array<{at: number, kind: string}> }}
 */
export function collectSnapLines(nodes, movingIds, frameGuides = [], parentId = null, getRect = null, allowedNodeIds = null) {
  const moving = new Set(movingIds);
  const isMoving = (id) => {
    let cur = nodes[id];
    while (cur) {
      if (moving.has(cur.id)) return true;
      cur = cur.parentId ? nodes[cur.parentId] : null;
    }
    return false;
  };

  const v = [];
  const h = [];
  const stationaryItems = [];
  for (const node of Object.values(nodes)) {
    if (isMoving(node.id)) continue;
    if (allowedNodeIds && !allowedNodeIds.has(node.id)) continue;
    if (node.hidden || node.visible === false || node.style?.opacity === 0) continue;
    const r = (getRect ? getRect(node.id) : null) ?? absoluteRect(nodes, node.id);
    if (!r || (r.w === 0 && r.h === 0)) continue;
    stationaryItems.push({ node, r });
    const isParent = Boolean(parentId && node.id === parentId);
    const edgeKind = isParent ? "parent-edge" : "edge";
    const centerKind = isParent ? "parent-center" : "center";
    v.push(
      { at: r.x, kind: edgeKind, edge: "start", parentRect: isParent ? r : undefined, nodeRect: r },
      { at: r.x + r.w / 2, kind: centerKind, edge: "center", parentRect: isParent ? r : undefined, nodeRect: r },
      { at: r.x + r.w, kind: edgeKind, edge: "end", parentRect: isParent ? r : undefined, nodeRect: r },
    );
    h.push(
      { at: r.y, kind: edgeKind, edge: "start", parentRect: isParent ? r : undefined, nodeRect: r },
      { at: r.y + r.h / 2, kind: centerKind, edge: "center", parentRect: isParent ? r : undefined, nodeRect: r },
      { at: r.y + r.h, kind: edgeKind, edge: "end", parentRect: isParent ? r : undefined, nodeRect: r },
    );

    // If this is the parent frame with padding, add inner padding bounds for precision alignment
    if (isParent && node.layout) {
      const padT = typeof node.layout.padding?.t === "number" ? node.layout.padding.t : (node.layout.padding?.v ?? 0);
      const padB = typeof node.layout.padding?.b === "number" ? node.layout.padding.b : (node.layout.padding?.v ?? 0);
      const padL = typeof node.layout.padding?.l === "number" ? node.layout.padding.l : (node.layout.padding?.h ?? 0);
      const padR = typeof node.layout.padding?.r === "number" ? node.layout.padding.r : (node.layout.padding?.h ?? 0);
      if (typeof padL === "number" && padL > 0) {
        v.push({ at: r.x + padL, kind: "parent-edge", edge: "inner-start", parentRect: r, nodeRect: r });
      }
      if (typeof padR === "number" && padR > 0) {
        v.push({ at: r.x + r.w - padR, kind: "parent-edge", edge: "inner-end", parentRect: r, nodeRect: r });
      }
      if (typeof padT === "number" && padT > 0) {
        h.push({ at: r.y + padT, kind: "parent-edge", edge: "inner-start", parentRect: r, nodeRect: r });
      }
      if (typeof padB === "number" && padB > 0) {
        h.push({ at: r.y + r.h - padB, kind: "parent-edge", edge: "inner-end", parentRect: r, nodeRect: r });
      }
    }
  }

  // Detect gaps ONLY among stationary direct siblings (e.g. root frames or children of same parent)
  const movingParentId = parentId ?? null;
  const stationarySiblings = stationaryItems.filter(
    ({ node }) => (node.parentId ?? null) === movingParentId && (movingParentId !== null || node.type === "frame" || !node.parentId)
  );

  const detectedGaps = new Set();
  if (stationarySiblings.length >= 2) {
    for (let i = 0; i < stationarySiblings.length; i++) {
      for (let j = i + 1; j < stationarySiblings.length; j++) {
        const itemA = stationarySiblings[i];
        const itemB = stationarySiblings[j];
        const rA = itemA.r;
        const rB = itemB.r;
        const gapX = rB.x >= rA.x + rA.w ? rB.x - (rA.x + rA.w) : (rA.x >= rB.x + rB.w ? rA.x - (rB.x + rB.w) : null);
        if (gapX != null && gapX >= 8 && gapX <= 400) {
          detectedGaps.add(Math.round(gapX));
        }
        const gapY = rB.y >= rA.y + rA.h ? rB.y - (rA.y + rA.h) : (rA.y >= rB.y + rB.h ? rA.y - (rB.y + rB.h) : null);
        if (gapY != null && gapY >= 8 && gapY <= 400) {
          detectedGaps.add(Math.round(gapY));
        }
      }
    }
  }

  // Add gap alignment snap lines around stationary siblings ONLY when real gaps are detected
  if (detectedGaps.size > 0 && stationarySiblings.length >= 2) {
    for (const { r } of stationarySiblings) {
      for (const g of detectedGaps) {
        v.push(
          { at: r.x + r.w + g, kind: "gap", edge: "start", gap: g, gapDirection: "right", nodeRect: r },
          { at: r.x - g, kind: "gap", edge: "end", gap: g, gapDirection: "left", nodeRect: r },
        );
        h.push(
          { at: r.y + r.h + g, kind: "gap", edge: "start", gap: g, gapDirection: "bottom", nodeRect: r },
          { at: r.y - g, kind: "gap", edge: "end", gap: g, gapDirection: "top", nodeRect: r },
        );
      }
    }
  }

  for (const fg of frameGuides) {
    const { rect, guides } = fg;
    for (const g of guides ?? []) {
      if (g.hidden) continue;
      if (g.kind === "v") {
        v.push({ at: rect.x + g.pos, kind: "guide", frameRect: rect });
      } else if (g.kind === "h") {
        h.push({ at: rect.y + g.pos, kind: "guide", frameRect: rect });
      } else if (g.kind === "grid" && g.count > 1) {
        for (let i = 1; i < g.count; i++) {
          v.push({ at: rect.x + (rect.w * i) / g.count, kind: "guide", frameRect: rect });
        }
      } else if (g.kind === "column" && g.count > 0) {
        const count = Math.max(1, g.count ?? 12);
        const gutter = g.gutter ?? 8;
        const margin = g.margin ?? 0;
        const align = g.align ?? "stretch";
        let colWidth = g.size ?? 40;
        let startX = margin;
        if (align === "stretch") {
          const availW = Math.max(0, rect.w - 2 * margin);
          colWidth = Math.max(1, (availW - (count - 1) * gutter) / count);
        } else if (align === "center") {
          const totalW = count * colWidth + (count - 1) * gutter;
          startX = (rect.w - totalW) / 2;
        } else if (align === "end") {
          const totalW = count * colWidth + (count - 1) * gutter;
          startX = rect.w - margin - totalW;
        }
        for (let i = 0; i < count; i++) {
          const x1 = rect.x + startX + i * (colWidth + gutter);
          const x2 = x1 + colWidth;
          v.push({ at: x1, kind: "guide", frameRect: rect });
          v.push({ at: x2, kind: "guide", frameRect: rect });
        }
      } else if (g.kind === "row" && g.count > 0) {
        const count = Math.max(1, g.count ?? 12);
        const gutter = g.gutter ?? 8;
        const margin = g.margin ?? 0;
        const align = g.align ?? "stretch";
        let rowHeight = g.size ?? 40;
        let startY = margin;
        if (align === "stretch") {
          const availH = Math.max(0, rect.h - 2 * margin);
          rowHeight = Math.max(1, (availH - (count - 1) * gutter) / count);
        } else if (align === "center") {
          const totalH = count * rowHeight + (count - 1) * gutter;
          startY = (rect.h - totalH) / 2;
        } else if (align === "end") {
          const totalH = count * rowHeight + (count - 1) * gutter;
          startY = rect.h - margin - totalH;
        }
        for (let i = 0; i < count; i++) {
          const y1 = rect.y + startY + i * (rowHeight + gutter);
          const y2 = y1 + rowHeight;
          h.push({ at: y1, kind: "guide", frameRect: rect });
          h.push({ at: y2, kind: "guide", frameRect: rect });
        }
      }
    }
  }
  return { v, h };
}

/**
 * Snap a moving rect (canvas space, ALREADY translated by the raw drag
 * delta) to the nearest line within `threshold` canvas units, per axis.
 * The rect's left/centre/right (top/centre/bottom) are all candidates;
 * the smallest adjustment wins. Returns the correction { dx, dy } to ADD
 * to the raw delta and all active lines per axis.
 */
export function computeSnap(movingRect, lines, threshold) {
  const findBest = (edges, candidates) => {
    let delta = null;
    let bestDist = Infinity;
    for (const cand of candidates ?? []) {
      for (const e of edges) {
        if (cand.kind === "gap" && cand.edge && cand.edge !== e.name) continue;
        const d = cand.at - e.pos;
        if (Math.abs(d) <= threshold && Math.abs(d) < bestDist) {
          bestDist = Math.abs(d);
          delta = d;
        }
      }
    }
    if (delta === null) return { delta: 0, activeLines: [], line: null };

    // Find ALL lines that match this exact snapped delta (within 0.05px)
    const activeLines = [];
    const seenAt = new Set();
    for (const cand of candidates ?? []) {
      for (const e of edges) {
        if (cand.kind === "gap" && cand.edge && cand.edge !== e.name) continue;
        const d = cand.at - e.pos;
        if (Math.abs(d - delta) < 0.05) {
          const key = `${Math.round(cand.at * 100)}_${e.name}_${cand.kind}`;
          if (!seenAt.has(key)) {
            seenAt.add(key);
            activeLines.push({
              at: cand.at,
              kind: cand.kind,
              gap: cand.gap,
              gapDirection: cand.gapDirection,
              movingEdge: e.name,
              targetRect: cand.nodeRect ?? cand.parentRect ?? cand.frameRect,
              parentRect: cand.parentRect,
              movingRect,
            });
          }
        }
      }
    }
    return { delta, activeLines, line: activeLines[0] ?? null };
  };

  const vx = findBest(
    [
      { pos: movingRect.x, name: "start" },
      { pos: movingRect.x + movingRect.w / 2, name: "center" },
      { pos: movingRect.x + movingRect.w, name: "end" },
    ],
    lines?.v,
  );

  const hy = findBest(
    [
      { pos: movingRect.y, name: "start" },
      { pos: movingRect.y + movingRect.h / 2, name: "center" },
      { pos: movingRect.y + movingRect.h, name: "end" },
    ],
    lines?.h,
  );

  return {
    dx: vx.delta,
    dy: hy.delta,
    activeV: vx.line,
    activeH: hy.line,
    activeVLines: vx.activeLines,
    activeHLines: hy.activeLines,
  };
}

/**
 * Snap a resizing rect's moving edges to the nearest candidate line.
 * For example, handle "e" snaps rect.x + rect.w + rawDx to nearest vertical line.
 * If user pulls cursor past threshold, it releases (stickiness).
 */
export function computeResizeSnap(startRect, handle, rawDx, rawDy, lines, threshold) {
  let dx = rawDx;
  let dy = rawDy;
  let activeV = null;
  let activeH = null;

  const moveW = handle.includes("w");
  const moveE = handle.includes("e");
  const moveN = handle.includes("n");
  const moveS = handle.includes("s");

  const bestLine = (currentPos, candidates) => {
    let delta = null;
    let line = null;
    for (const cand of candidates ?? []) {
      const d = cand.at - currentPos;
      if (Math.abs(d) <= threshold) {
        // Prioritize parent-edge if close
        const isBetter =
          delta === null ||
          Math.abs(d) < Math.abs(delta) ||
          (cand.kind === "parent-edge" && Math.abs(d) <= Math.abs(delta) + 1.5);
        if (isBetter) {
          delta = d;
          line = cand;
        }
      }
    }
    return { delta: delta ?? 0, line };
  };

  // Horizontal edge snap
  if (moveE) {
    const currentRight = startRect.x + startRect.w + rawDx;
    const res = bestLine(currentRight, lines?.v);
    if (res.line) {
      dx += res.delta;
      activeV = res.line;
    }
  } else if (moveW) {
    const currentLeft = startRect.x + rawDx;
    const res = bestLine(currentLeft, lines?.v);
    if (res.line) {
      dx += res.delta;
      activeV = res.line;
    }
  }

  // Vertical edge snap
  if (moveS) {
    const currentBottom = startRect.y + startRect.h + rawDy;
    const res = bestLine(currentBottom, lines?.h);
    if (res.line) {
      dy += res.delta;
      activeH = res.line;
    }
  } else if (moveN) {
    const currentTop = startRect.y + rawDy;
    const res = bestLine(currentTop, lines?.h);
    if (res.line) {
      dy += res.delta;
      activeH = res.line;
    }
  }

  return { dx, dy, activeV, activeH };
}
