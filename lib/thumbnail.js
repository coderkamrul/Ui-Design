import { resolvePaintColor } from "./model";

/**
 * Compute an accurate layout bounding box for a node, even when size is auto/flex.
 */
export function computeAccurateNodeRect(nodes, id, visited = new Set()) {
  if (!nodes || !id || visited.has(id)) return { x: 0, y: 0, w: 1200, h: 800 };
  visited.add(id);

  const node = nodes[id];
  if (!node) return { x: 0, y: 0, w: 1200, h: 800 };

  const x = Number(node.position?.x ?? node.x ?? 0);
  const y = Number(node.position?.y ?? node.y ?? 0);

  let w =
    node.size?.w?.kind === "fixed" && node.size.w.px
      ? Number(node.size.w.px)
      : Number(node.w ?? 1200);

  let h =
    node.size?.h?.kind === "fixed" && node.size.h.px
      ? Number(node.size.h.px)
      : Number(node.h ?? 0);

  // If height is auto or unset, measure children layout
  if ((!h || h <= 0 || node.size?.h?.kind === "auto") && node.childIds?.length) {
    const isFlex = node.layout?.mode === "flex";
    const isCol = node.layout?.direction === "column";
    const padT = Number(node.layout?.padding?.t ?? 16);
    const padB = Number(node.layout?.padding?.b ?? 16);
    const gap = Number(node.layout?.gap ?? 16);

    let contentH = 0;
    if (isFlex && isCol) {
      let totalChildrenH = 0;
      node.childIds.forEach((cid) => {
        const cr = computeAccurateNodeRect(nodes, cid, new Set(visited));
        totalChildrenH += cr.h;
      });
      totalChildrenH += Math.max(0, node.childIds.length - 1) * gap;
      contentH = padT + totalChildrenH + padB;
    } else {
      let maxChildBottom = 0;
      node.childIds.forEach((cid) => {
        const cr = computeAccurateNodeRect(nodes, cid, new Set(visited));
        maxChildBottom = Math.max(maxChildBottom, cr.y + cr.h);
      });
      contentH = Math.max(maxChildBottom + padB, 200);
    }
    h = Math.max(contentH, 400);
  } else if (!h || h <= 0) {
    h = 800;
  }

  return { x, y, w: Math.max(w, 100), h: Math.max(h, 100) };
}

/**
 * Compute the union bounding box of all root nodes on a page.
 */
export function computePageUnionBounds(nodes, rootIds) {
  if (!nodes || !rootIds?.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const id of rootIds) {
    const n = nodes[id];
    if (!n || n.hidden || n.visible === false) continue;
    const r = computeAccurateNodeRect(nodes, id);
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }

  if (!isFinite(minX) || maxX <= minX || maxY <= minY) return null;

  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
  };
}

/**
 * Capture high-resolution JPEG thumbnail from real rendered canvas DOM with zoom-to-fit.
 * Runs client-side during document save/autosave.
 */
export async function captureCanvasThumbnail(doc, activePageId) {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  if (!doc?.pages?.length || !doc?.nodes) return null;

  const page = doc.pages.find((p) => p.id === activePageId) || doc.pages[0];
  if (!page) return null;

  const rootIds = (page.rootNodeIds || []).filter((id) => {
    const n = doc.nodes[id];
    return n && !n.hidden && n.visible !== false;
  });
  if (!rootIds.length) return null;

  try {
    const { toJpeg } = await import("html-to-image");

    // Zoom to fit all root artboards on the canvas
    const union = computePageUnionBounds(doc.nodes, rootIds);
    if (!union || union.w <= 0 || union.h <= 0) return null;

    const targetW = 480;
    const targetH = 310;
    const pad = 24;
    const scale = Math.min((targetW - pad * 2) / union.w, (targetH - pad * 2) / union.h);
    const offsetX = (targetW - union.w * scale) / 2 - union.x * scale;
    const offsetY = (targetH - union.h * scale) / 2 - union.y * scale;

    const stage = document.createElement("div");
    stage.style.position = "fixed";
    stage.style.left = "-9999px";
    stage.style.top = "-9999px";
    stage.style.width = `${targetW}px`;
    stage.style.height = `${targetH}px`;
    stage.style.overflow = "hidden";
    stage.style.background = page.background || "#F5F5F7";
    stage.style.zIndex = "-9999";
    stage.style.pointerEvents = "none";

    const worldClone = document.createElement("div");
    worldClone.style.position = "absolute";
    worldClone.style.left = "0px";
    worldClone.style.top = "0px";
    worldClone.style.transformOrigin = "0 0";
    worldClone.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;

    for (const id of rootIds) {
      const el = document.querySelector(`[data-node-id="${id}"]`);
      if (el) {
        const clone = el.cloneNode(true);
        clone.style.boxShadow =
          "0 10px 30px -4px rgba(0, 0, 0, 0.16), 0 2px 8px -1px rgba(0, 0, 0, 0.08)";
        worldClone.appendChild(clone);
      }
    }

    stage.appendChild(worldClone);
    document.body.appendChild(stage);

    try {
      const dataUrl = await toJpeg(stage, {
        quality: 0.88,
        pixelRatio: 1,
        backgroundColor: page.background || "#F5F5F7",
        skipFonts: true,
        cacheBust: false,
      });
      return dataUrl;
    } finally {
      if (stage.parentNode) {
        stage.parentNode.removeChild(stage);
      }
    }
  } catch (err) {
    console.warn("canvas-tool: captureCanvasThumbnail error:", err);
    return null;
  }
}
