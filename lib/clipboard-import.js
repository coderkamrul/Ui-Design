// lib/clipboard-import.js — browser glue for external clipboard import.
//
// Owns everything the pure converter (lib/snapshot-import.js) cannot:
// the hidden render-pass that measures the pasted HTML (most snapshot
// elements carry no width/height in their inline style — their
// geometry exists only as layout output, and this app's absolute node
// model needs real numbers), remote image fetching through the app's
// dataURL asset convention (downscale to 1600px, the Inspector rule),
// and insertion into the store as ONE history commit.
//
// Entry point: handleClipboardPayload({ html, text, files }, opts) —
// shared by the canvas `paste` event and drag-`drop` (components/
// CanvasView.jsx). Returns true when the payload was handled; false
// means "nothing usable" and the caller falls back to the internal
// node clipboard.
import { useEditor, useToasts, toast } from "./store.js";
import { addNode, createNode, absolutePosition } from "./model.js";
import { bboxOf, screenToCanvas } from "./geometry.js";
import {
  classifyClipboard,
  convertPlainTree,
  parseHtmlFragment,
  flattenElements,
  parseStyleAttribute,
  px,
  resolveImportedImages,
  isBigPaste,
  svgDimensions,
  measureHtml,
} from "./snapshot-import.js";

// Ctrl+V records its Shift state here (EditorShell keydown) because
// the paste event itself carries no modifier information; it selects
// the internal "paste over selection" behaviour and, for imports,
// aligning the pasted block to the first selected node.
export const pasteState = { overSelection: false };

export function isEditableTarget(t) {
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

const doubleRaf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const timeout = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Image resolution through the app's asset convention: fetched bytes
// become a dataURL inside the doc, downscaled to a 1600px max
// dimension (the Inspector's fileToDataURL rule). Any failure → null,
// which the converter's resolver counts into the grouped toast.
// ---------------------------------------------------------------------------
function blobToDataURL(blob, max = 1600) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

async function resolveRemoteImage(src) {
  if (typeof src !== "string" || !src) return null;
  if (src.startsWith("data:")) return src;
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    if (blob.type === "image/svg+xml") return blobToDataURL(blob);
    return blobToDataURL(blob);
  } catch {
    return null; // CORS / network / decode — counted by the caller
  }
}

// ---------------------------------------------------------------------------
// Insertion — one store commit for the whole import.
// ---------------------------------------------------------------------------
function viewCentreWorld() {
  const vp = useEditor.getState().viewport;
  return screenToCanvas(vp, { x: window.innerWidth / 2, y: window.innerHeight / 2 });
}

function insertConverted(result, { frameId = null, at = null, overSelection = false } = {}) {
  const st = useEditor.getState();
  if (!st.doc) return [];
  let roots = result.roots;
  // Multiple roots are wrapped so the import stays one selectable unit.
  if (roots.length > 1 && !frameId) {
    const bbox = bboxOf(roots.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })));
    if (bbox) {
      const wrap = createNode("frame", {
        name: "Imported", x: bbox.x, y: bbox.y,
        w: Math.max(1, bbox.w), h: Math.max(1, bbox.h), fills: [],
      });
      for (const root of roots) {
        root.parentId = wrap.id;
        root.x -= bbox.x;
        root.y -= bbox.y;
        wrap.childIds.push(root.id);
      }
      result.all.push(wrap);
      roots = [wrap];
    }
  }
  const bbox = bboxOf(roots.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })));
  let dx = 0;
  let dy = 0;
  if (bbox) {
    if (frameId && at) {
      const frame = st.doc.nodes[frameId];
      const fw = frame ? absolutePosition(st.doc, frameId) : { x: 0, y: 0 };
      dx = at.x - fw.x - bbox.x;
      dy = at.y - fw.y - bbox.y;
    } else if (!frameId && at) {
      dx = at.x - bbox.x;
      dy = at.y - bbox.y;
    } else if (!frameId && overSelection && st.selection.length && st.doc.nodes[st.selection[0]]) {
      const tw = absolutePosition(st.doc, st.selection[0]);
      dx = tw.x - bbox.x;
      dy = tw.y - bbox.y;
    } else if (!frameId) {
      const c = viewCentreWorld();
      dx = c.x - (bbox.x + bbox.w / 2);
      dy = c.y - (bbox.y + bbox.h / 2);
    }
  }
  const insertedIds = roots.map((r) => r.id);
  st.commit((draft) => {
    const page = draft.pages.find((p) => p.id === st.activePageId) || draft.pages[0];
    for (const n of result.all) draft.nodes[n.id] = n;
    const parent = frameId ? draft.nodes[frameId] : null;
    for (const root of roots) {
      root.x = Math.round((root.x + dx) * 100) / 100;
      root.y = Math.round((root.y + dy) * 100) / 100;
      if (root.position) {
        root.position.x = root.x;
        root.position.y = root.y;
      } else {
        root.position = { x: root.x, y: root.y, absolute: false };
      }
      if (parent) {
        root.parentId = parent.id;
        parent.childIds.push(root.id);
        if (parent.layout?.mode === "flex" || parent.layout?.mode === "grid") {
          root.position.absolute = false;
          root.x = 0;
          root.y = 0;
          root.position.x = 0;
          root.position.y = 0;
        }
      } else {
        root.parentId = null;
        page.rootIds.push(root.id);
      }
    }
  });
  return insertedIds;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
async function importHtml(html, opts = {}) {
  const st = useEditor.getState();
  if (!st.doc || st.previewVersionId) return false;
  const big = isBigPaste({ htmlLength: html.length });
  const toastId = big ? toast("Pasting…", { duration: 600000 }) : null;
  try {
    if (big) await doubleRaf(); // let the spinner paint before the parse
    const plainRoots = parseHtmlFragment(html);
    const measurements = await measureHtml(html, plainRoots);
    const result = convertPlainTree(plainRoots, { measurements });
    if (!result.roots.length) {
      toast("Nothing could be imported from that HTML");
      return true;
    }
    const { failed } = await resolveImportedImages(result, resolveRemoteImage);
    let frameId = opts.frameId || null;
    if (!frameId && !opts.at && st.selection.length === 1) {
      const sel = st.doc.nodes[st.selection[0]];
      if (sel && sel.type === "frame") frameId = sel.id;
    }
    const ids = insertConverted(result, {
      frameId,
      at: opts.at || null,
      overSelection: opts.overSelection,
    });
    if (ids.length) st.setSelection(ids);
    if (failed > 0) toast(`Failed to load ${failed} image${failed === 1 ? "" : "s"}`);
    return true;
  } finally {
    if (toastId) useToasts.getState().dismiss(toastId);
  }
}

function extractSvgMarkup(text) {
  if (typeof text !== "string") return null;
  const start = text.indexOf("<svg");
  const end = text.lastIndexOf("</svg>");
  if (start < 0 || end < 0) return null;
  return text.slice(start, end + "</svg>".length).replace(/<script[\s\S]*?<\/script>/gi, "");
}

async function importSvgText(text, opts = {}) {
  const st = useEditor.getState();
  if (!st.doc || st.previewVersionId) return false;
  const markup = extractSvgMarkup(text);
  if (!markup) return false;
  const dims = svgDimensions(markup);
  const at = opts.at || viewCentreWorld();
  let id = null;
  st.commit((draft) => {
    const page = draft.pages.find((p) => p.id === st.activePageId) || draft.pages[0];
    const n = createNode("svg", {
      name: "SVG",
      x: Math.round(at.x - (dims.w || 100) / 2),
      y: Math.round(at.y - (dims.h || 100) / 2),
      w: dims.w || 100,
      h: dims.h || 100,
      svgMarkup: markup,
      viewBox: dims.viewBox,
    });
    addNode(draft, page.id, n);
    id = n.id;
  });
  if (id) st.setSelection([id]);
  return true;
}

async function importImageFiles(files, opts = {}) {
  const st = useEditor.getState();
  if (!st.doc || st.previewVersionId) return false;
  const base = opts.at || viewCentreWorld();
  const placed = [];
  let i = 0;
  for (const file of files) {
    const at = { x: base.x + i * 16, y: base.y + i * 16 };
    i += 1;
    if (file.type === "image/svg+xml") {
      await importSvgText(await file.text(), { at });
      continue;
    }
    const dataUrl = await blobToDataURL(file);
    if (!dataUrl) {
      toast("That image could not be read");
      continue;
    }
    // Natural (post-downscale) dimensions from a probe decode.
    const dims = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.width, h: img.height });
      img.onerror = () => resolve({ w: 200, h: 150 });
      img.src = dataUrl;
    });
    let id = null;
    st.commit((draft) => {
      const page = draft.pages.find((p) => p.id === st.activePageId) || draft.pages[0];
      const n = createNode("image", {
        name: "Image",
        x: Math.round(at.x - dims.w / 2),
        y: Math.round(at.y - dims.h / 2),
        w: dims.w,
        h: dims.h,
        src: dataUrl,
      });
      addNode(draft, page.id, n);
      id = n.id;
    });
    if (id) placed.push(id);
  }
  if (placed.length) st.setSelection(placed);
  return true;
}

async function importPlainText(text, opts = {}) {
  const st = useEditor.getState();
  if (!st.doc || st.previewVersionId) return false;
  const content = (text || "").replace(/\n$/, "");
  if (!content.trim()) return false;
  const at = opts.at || viewCentreWorld();
  let id = null;
  st.commit((draft) => {
    const page = draft.pages.find((p) => p.id === st.activePageId) || draft.pages[0];
    const n = createNode("text", {
      name: "Text",
      x: Math.round(at.x),
      y: Math.round(at.y),
      text: { content },
    });
    n.wMode = "Fit";
    n.hMode = "Fit";
    addNode(draft, page.id, n);
    id = n.id;
  });
  if (id) st.setSelection([id]);
  return true;
}

/**
 * Classify + import one clipboard/drop payload. `opts.at` is a world
 * point for drop positioning; `opts.overSelection` mirrors the
 * internal paste-over-selection behaviour.
 */
export async function handleClipboardPayload(payload, opts = {}) {
  const cls = classifyClipboard(payload);
  switch (cls.kind) {
    case "svg":
      return importSvgText(cls.text, opts);
    case "files":
      return importImageFiles(cls.files, opts);
    case "html":
      return importHtml(cls.html, opts);
    case "text":
      return importPlainText(cls.text, opts);
    default:
      return false;
  }
}
