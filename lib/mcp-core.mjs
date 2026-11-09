/**
 * Shared MCP Core Engine — used by both:
 * 1. mcp/server.mjs (Local stdio CLI / Desktop)
 * 2. app/api/mcp/route.js (Web Remote SSE & HTTP)
 *
 * Provides all 22 tools, schemas, document validation, and mutation logic.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

export const PROTOCOL_VERSION = "2024-11-05";
export const SERVER_INFO = { name: "canvas-tool", version: "1.1.0" };

export const FILES_DIR = resolve(
  process.env.CANVAS_TOOL_DIR ?? join(process.cwd(), "canvastool-files"),
);
mkdirSync(FILES_DIR, { recursive: true });

export function filePath(fileId) {
  if (
    typeof fileId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fileId) ||
    fileId.includes("..")
  ) {
    throw new Error(`Invalid fileId: ${JSON.stringify(fileId)}`);
  }
  return join(FILES_DIR, `${fileId}.json`);
}

export function isValidDoc(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return false;
  if (!Array.isArray(doc.pages) || doc.pages.length === 0) return false;
  if (!doc.nodes || typeof doc.nodes !== "object" || Array.isArray(doc.nodes)) {
    return false;
  }
  return doc.pages.every(
    (p) =>
      p &&
      typeof p === "object" &&
      typeof p.id === "string" &&
      Array.isArray(p.rootNodeIds),
  );
}

export function loadDoc(fileId) {
  const path = filePath(fileId);
  if (!existsSync(path)) throw new Error(`No such file: ${fileId}`);
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`File ${fileId} is not valid JSON`);
  }
  if (!isValidDoc(doc)) {
    throw new Error(`File ${fileId} is not a canvas-tool document`);
  }
  return doc;
}

export function saveDoc(fileId, doc) {
  doc.id = fileId;
  doc.updatedAt = new Date().toISOString();
  const path = filePath(fileId);
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2));
  renameSync(tmp, path);
  return doc;
}

export function newFileId() {
  return `file-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

export function createBlankDoc(id, title) {
  return {
    id,
    teamId: "team-my-team",
    title,
    createdBy: "mcp-agent",
    updatedAt: new Date().toISOString(),
    tokens: [],
    pages: [
      { id: "page-1", name: "Page 1", background: "#EEEEEE", rootNodeIds: [] },
    ],
    nodes: {},
    comments: [],
    assets: {},
  };
}

export const BASE_NAMES = {
  frame: "Frame",
  rect: "Rectangle",
  text: "Text",
  path: "Path",
  image: "Image",
  shader: "Shader",
  svg: "Svg",
  group: "Group",
};

export const NODE_TYPES = Object.keys(BASE_NAMES);

export function nextNodeId(doc) {
  let n = 1;
  while (doc.nodes[`node-${n}`]) n++;
  return `node-${n}`;
}

export function nextName(doc, type) {
  const base = BASE_NAMES[type] ?? "Node";
  const taken = new Set(Object.values(doc.nodes).map((nd) => nd.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export function newPageId(doc) {
  let n = (doc.pages?.length || 0) + 1;
  while (doc.pages?.some((p) => p.id === `page-${n}`)) n++;
  return `page-${n}`;
}

export function defaultStyle(type) {
  switch (type) {
    case "frame":
      return { fill: { kind: "solid", color: "#FFFFFF" }, radius: 0 };
    case "rect":
      return { fill: { kind: "solid", color: "#D9DEE8" }, radius: 0 };
    case "text":
      return { fill: { kind: "solid", color: "#1F1F1F" } };
    case "path":
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

export function defaultShader() {
  return {
    preset: "Aurora Veil",
    colors: ["#14406B", "#1FA8A0", "#8FE3C0", "#5B5BD6"],
    params: { scale: 1.2, rotation: 25, distortion: 55, softness: 80, grain: 10 },
  };
}

export function absoluteOrigin(doc, id) {
  let x = 0;
  let y = 0;
  let cur = doc.nodes[id];
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    x += cur.position?.x ?? 0;
    y += cur.position?.y ?? 0;
    cur = cur.parentId ? doc.nodes[cur.parentId] : null;
  }
  return { x, y };
}

export const num = (v, fallback) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export function parseSize(val, fallbackKind = "fixed", fallbackPx = 100) {
  if (val == null) return { kind: fallbackKind, px: fallbackPx };
  if (typeof val === "number" && Number.isFinite(val)) {
    return { kind: "fixed", px: Math.max(1, Math.round(val)) };
  }
  if (typeof val === "string") {
    if (val === "fit" || val === "auto") return { kind: "fit" };
    if (val === "fill" || val === "100%") return { kind: "fill" };
    const n = parseFloat(val);
    if (Number.isFinite(n)) return { kind: "fixed", px: Math.max(1, Math.round(n)) };
    return { kind: fallbackKind, px: fallbackPx };
  }
  if (typeof val === "object") {
    const kind = ["fixed", "fit", "fill"].includes(val.kind) ? val.kind : fallbackKind;
    const px =
      typeof val.px === "number" && Number.isFinite(val.px)
        ? Math.max(1, Math.round(val.px))
        : fallbackPx;
    return kind === "fixed" ? { kind: "fixed", px } : { kind };
  }
  return { kind: fallbackKind, px: fallbackPx };
}

export function parseLayout(layout) {
  if (!layout || typeof layout !== "object") return { mode: "freeform" };
  const mode = layout.mode === "flex" ? "flex" : "freeform";
  if (mode === "freeform") return { mode: "freeform" };

  const direction = layout.direction === "row" ? "row" : "column";
  const wrap = Boolean(layout.wrap);
  const reverse = Boolean(layout.reverse);
  const gap =
    typeof layout.gap === "number" && Number.isFinite(layout.gap)
      ? Math.max(0, Math.round(layout.gap))
      : 0;

  let padding = { l: 0, t: 0, r: 0, b: 0, h: 0, v: 0 };
  if (typeof layout.padding === "number" && Number.isFinite(layout.padding)) {
    const p = Math.max(0, Math.round(layout.padding));
    padding = { l: p, t: p, r: p, b: p, h: p, v: p };
  } else if (layout.padding && typeof layout.padding === "object") {
    const l = num(layout.padding.l, num(layout.padding.left, num(layout.padding.h, 0)));
    const r = num(layout.padding.r, num(layout.padding.right, num(layout.padding.h, 0)));
    const t = num(layout.padding.t, num(layout.padding.top, num(layout.padding.v, 0)));
    const b = num(layout.padding.b, num(layout.padding.bottom, num(layout.padding.v, 0)));
    padding = {
      l: Math.max(0, Math.round(l)),
      r: Math.max(0, Math.round(r)),
      t: Math.max(0, Math.round(t)),
      b: Math.max(0, Math.round(b)),
      h: Math.max(0, Math.round((l + r) / 2)),
      v: Math.max(0, Math.round((t + b) / 2)),
    };
  }

  const rawMain = layout.alignMain || layout.justifyContent;
  const alignMainMap = {
    "flex-start": "start",
    start: "start",
    center: "center",
    "flex-end": "end",
    end: "end",
    "space-between": "space-between",
    "space-around": "space-around",
  };
  const alignMain = alignMainMap[rawMain] || "start";

  const rawCross = layout.alignCross || layout.alignItems;
  const alignCrossMap = {
    "flex-start": "start",
    start: "start",
    center: "center",
    "flex-end": "end",
    end: "end",
    stretch: "stretch",
  };
  const alignCross = alignCrossMap[rawCross] || "start";

  return {
    mode: "flex",
    direction,
    wrap,
    reverse,
    gap,
    padding,
    alignMain,
    alignCross,
  };
}

export function parseStyle(specStyle = {}, type, spec = {}) {
  const base = defaultStyle(type);
  const merged = { ...base, ...(specStyle || {}) };

  const textColor =
    spec.text?.color ||
    spec.color ||
    specStyle?.color ||
    (typeof spec.text === "object" ? spec.text.color : null);

  const explicitNullFill = spec.fill === null || specStyle?.fill === null;
  const rawFill = explicitNullFill
    ? null
    : (spec.fill ??
      specStyle?.fill ??
      (type === "text" && textColor ? { kind: "solid", color: textColor } : null));

  if (explicitNullFill || rawFill === "none" || rawFill === "transparent") {
    merged.fill = null;
    merged.fills = [];
  } else if (typeof rawFill === "string") {
    merged.fill = { kind: "solid", color: rawFill };
  } else if (rawFill && typeof rawFill === "object") {
    merged.fill = rawFill;
  }

  const rawFills = spec.fills ?? specStyle?.fills;
  if (explicitNullFill || rawFill === "none" || rawFill === "transparent") {
    merged.fills = [];
  } else if (Array.isArray(rawFills)) {
    merged.fills = rawFills;
  } else if (merged.fill) {
    merged.fills = [merged.fill];
  }

  const rawStroke = spec.stroke ?? specStyle?.stroke;
  if (rawStroke && typeof rawStroke === "object") {
    merged.stroke = {
      width: num(rawStroke.width, 1),
      style: rawStroke.style || "solid",
      align: rawStroke.align || "inside",
      paint:
        typeof rawStroke.color === "string"
          ? { kind: "solid", color: rawStroke.color, alpha: num(rawStroke.alpha, 1) }
          : rawStroke.paint || { kind: "solid", color: "#1F1F1F", alpha: 1 },
    };
  }

  const rawShadows = spec.shadows ?? specStyle?.shadows;
  if (Array.isArray(rawShadows)) {
    merged.shadows = rawShadows.map((sh) => ({
      kind: sh.kind === "inner" ? "inner" : "drop",
      x: num(sh.x, 0),
      y: num(sh.y, 4),
      blur: num(sh.blur, 8),
      spread: num(sh.spread, 0),
      color: sh.color || "rgba(0,0,0,0.1)",
    }));
  }

  const rawRadius = spec.radius ?? specStyle?.radius;
  if (typeof rawRadius === "number") {
    merged.radius = Math.max(0, Math.round(rawRadius));
  } else if (rawRadius && typeof rawRadius === "object") {
    merged.radius = rawRadius;
  }

  const rawOpacity = spec.opacity ?? specStyle?.opacity;
  if (typeof rawOpacity === "number") {
    merged.opacity = Math.max(0, Math.min(1, rawOpacity));
  }
  const rawBlend = spec.blendMode ?? specStyle?.blendMode;
  if (typeof rawBlend === "string") {
    merged.blendMode = rawBlend;
  }
  const rawOverflow = spec.overflow ?? specStyle?.overflow;
  if (typeof rawOverflow === "string") {
    merged.overflow = rawOverflow;
  }

  return merged;
}

export function parseText(specText, defaultContent = "Text") {
  let content = defaultContent;
  let html = undefined;
  let fontSize = 16;
  let fontWeight = 400;
  let fontFamily = "Inter";
  let lineHeight = 1.25;
  let letterSpacing = 0;
  let align = "left";
  let color = undefined;
  let italic = false;
  let underline = false;
  let strikethrough = false;
  let textCase = "none";

  if (typeof specText === "string") {
    content = specText;
  } else if (specText && typeof specText === "object") {
    if (typeof specText.content === "string") content = specText.content;
    if (typeof specText.html === "string") html = specText.html;
    if (typeof specText.fontSize === "number") fontSize = specText.fontSize;
    if (specText.fontWeight != null) fontWeight = specText.fontWeight;
    if (typeof specText.fontFamily === "string") fontFamily = specText.fontFamily;
    if (typeof specText.lineHeight === "number") lineHeight = specText.lineHeight;
    if (typeof specText.letterSpacing === "number") letterSpacing = specText.letterSpacing;
    if (typeof specText.align === "string") align = specText.align;
    if (typeof specText.color === "string") color = specText.color;
    if (typeof specText.italic === "boolean") italic = specText.italic;
    if (typeof specText.underline === "boolean") underline = specText.underline;
    if (typeof specText.strikethrough === "boolean") strikethrough = specText.strikethrough;
    if (typeof specText.case === "string") textCase = specText.case;
  }

  const res = {
    content,
    fontSize,
    fontWeight,
    lineHeight,
    letterSpacing,
    align,
  };
  if (html) res.html = html;
  if (fontFamily) res.fontFamily = fontFamily;
  if (color) res.color = color;
  if (italic) res.italic = true;
  if (underline) res.underline = true;
  if (strikethrough) res.strikethrough = true;
  if (textCase !== "none") res.case = textCase;

  return res;
}

export function buildNode(doc, spec, parentId) {
  const type = spec?.type;
  if (!NODE_TYPES.includes(type)) {
    throw new Error(
      `node.type must be one of ${NODE_TYPES.join(", ")}; got ${JSON.stringify(type)}`,
    );
  }
  if (parentId != null && !doc.nodes[parentId]) {
    throw new Error(`Parent node not found: ${parentId}`);
  }
  const isContainerType = (t) => t === "frame" || t === "svg" || t === "group";
  if (parentId != null && !isContainerType(doc.nodes[parentId].type)) {
    throw new Error(`Parent ${parentId} is not a container — cannot contain nodes`);
  }
  const origin = parentId ? absoluteOrigin(doc, parentId) : { x: 0, y: 0 };
  const defaultW = type === "frame" ? 480 : 240;
  const defaultH = type === "frame" ? 320 : type === "text" ? 40 : 160;

  const node = {
    id: nextNodeId(doc),
    type,
    name:
      typeof spec.name === "string" && spec.name.trim()
        ? spec.name.trim()
        : nextName(doc, type),
    parentId: parentId ?? null,
    childIds: [],
    layout: parseLayout(spec.layout),
    position: {
      x: Math.round(num(spec.x, 0) - origin.x),
      y: Math.round(num(spec.y, 0) - origin.y),
    },
    size: {
      w: parseSize(
        spec.size?.w ?? spec.w,
        type === "text" && spec.w == null && spec.size?.w == null ? "fit" : "fixed",
        defaultW,
      ),
      h: parseSize(
        spec.size?.h ?? spec.h,
        (type === "text" ||
          (type === "frame" && parentId != null && spec.layout?.mode === "flex")) &&
          spec.h == null &&
          spec.size?.h == null
          ? "fit"
          : "fixed",
        defaultH,
      ),
    },
    style: parseStyle(spec.style, type, spec),
  };

  if (spec.position?.absolute || spec.absolute) {
    node.position.absolute = true;
  }
  if (typeof spec.hidden === "boolean") node.hidden = spec.hidden;
  if (typeof spec.visible === "boolean") node.visible = spec.visible;
  if (typeof spec.locked === "boolean") node.locked = spec.locked;

  if (type === "frame") {
    const isParentFrame = parentId == null;
    node.clipContent =
      typeof spec.clipContent === "boolean" ? spec.clipContent : isParentFrame;
    if (node.clipContent && !node.style.overflow) {
      node.style.overflow = "hidden";
    }
  }

  if (type === "text") {
    node.text = parseText(spec.text);
    if (node.text.color && !spec.fill && !spec.style?.fill) {
      node.style.fill = { kind: "solid", color: node.text.color };
    }
  }

  if (type === "path") {
    node.path = {
      anchors: Array.isArray(spec.anchors) ? spec.anchors : spec.path?.anchors ?? [],
      closed: !!(spec.closed ?? spec.path?.closed),
    };
    if (spec.d) node.d = spec.d;
    if (spec.viewBox) node.viewBox = spec.viewBox;
    if (spec.strokeWidth != null) node.strokeWidth = spec.strokeWidth;
    if (spec.strokeLinecap) node.strokeLinecap = spec.strokeLinecap;
    if (spec.strokeLinejoin) node.strokeLinejoin = spec.strokeLinejoin;
  }

  if (type === "svg") {
    node.viewBox = spec.viewBox || "0 0 24 24";
  }

  if (type === "shader") {
    node.shader =
      spec.shader && typeof spec.shader === "object" ? spec.shader : defaultShader();
  }

  if (type === "image") {
    node.image = {
      assetId: spec.assetId ?? spec.image?.assetId ?? "placeholder",
      fit: spec.fit ?? spec.image?.fit ?? "cover",
      ...(spec.url || spec.image?.url ? { url: spec.url || spec.image?.url } : {}),
    };
  }

  return node;
}

export function attach(doc, page, node) {
  doc.nodes[node.id] = node;
  if (node.parentId) {
    const parent = doc.nodes[node.parentId];
    parent.childIds = [...(parent.childIds ?? []), node.id];
  } else {
    page.rootNodeIds = [...page.rootNodeIds, node.id];
  }
}

export function subtreeIds(doc, id) {
  const out = [];
  const walk = (nid) => {
    const node = doc.nodes[nid];
    if (!node) return;
    out.push(nid);
    for (const child of node.childIds ?? []) walk(child);
  };
  walk(id);
  return out;
}

export function detach(doc, id) {
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

export function applyNodePatch(doc, nodeId, patch = {}) {
  const node = doc.nodes[nodeId];
  if (!node) throw new Error(`Node not found: ${nodeId}`);

  if (typeof patch.name === "string" && patch.name.trim()) {
    node.name = patch.name.trim();
  }
  if (typeof patch.rotation === "number") node.rotation = patch.rotation;
  if (typeof patch.hidden === "boolean") node.hidden = patch.hidden;
  if (typeof patch.visible === "boolean") node.visible = patch.visible;
  if (typeof patch.locked === "boolean") node.locked = patch.locked;
  if (typeof patch.clipContent === "boolean") {
    node.clipContent = patch.clipContent;
    if (node.clipContent) {
      node.style = { ...(node.style ?? {}), overflow: "hidden" };
    }
  }

  if (patch.x != null || patch.y != null) {
    const origin = node.parentId ? absoluteOrigin(doc, node.parentId) : { x: 0, y: 0 };
    node.position = {
      ...(node.position ?? {}),
      x: Math.round(num(patch.x, origin.x + (node.position?.x ?? 0)) - origin.x),
      y: Math.round(num(patch.y, origin.y + (node.position?.y ?? 0)) - origin.y),
    };
  }
  if (typeof patch.absolute === "boolean") {
    node.position = { ...(node.position ?? {}), absolute: patch.absolute };
  }

  if (patch.w != null || patch.h != null || patch.size != null) {
    const currentW = node.size?.w ?? { kind: "fixed", px: 100 };
    const currentH = node.size?.h ?? { kind: "fixed", px: 100 };
    node.size = {
      w:
        patch.size?.w != null
          ? parseSize(patch.size.w, currentW.kind, currentW.px)
          : patch.w != null
            ? parseSize(patch.w, currentW.kind, currentW.px)
            : currentW,
      h:
        patch.size?.h != null
          ? parseSize(patch.size.h, currentH.kind, currentH.px)
          : patch.h != null
            ? parseSize(patch.h, currentH.kind, currentH.px)
            : currentH,
    };
  }

  if (patch.layout && typeof patch.layout === "object") {
    if (patch.layout.mode === "freeform") {
      node.layout = { mode: "freeform" };
    } else {
      node.layout = parseLayout({
        ...(node.layout ?? {}),
        ...patch.layout,
        mode: patch.layout.mode ?? "flex",
      });
    }
  }

  if (patch.text != null) {
    const currentText = node.text ?? {};
    if (typeof patch.text === "string") {
      node.text = { ...currentText, content: patch.text };
    } else if (typeof patch.text === "object") {
      node.text = { ...currentText, ...parseText(patch.text, currentText.content) };
    }
  }

  if (patch.style && typeof patch.style === "object") {
    const style = { ...(node.style ?? {}) };
    for (const [key, value] of Object.entries(patch.style)) {
      if (key === "fill") {
        if (typeof value === "string") {
          style.fill = { kind: "solid", color: value };
        } else if (value && typeof value === "object") {
          style.fill = value;
        }
      } else if (key === "fills" && Array.isArray(value)) {
        style.fills = value;
      } else if (key === "opacity" && typeof value === "number") {
        style.opacity = Math.max(0, Math.min(1, value));
      } else if (key === "radius") {
        style.radius = typeof value === "number" ? Math.max(0, Math.round(value)) : value;
      } else if (key === "stroke" && typeof value === "object") {
        style.stroke = value;
      } else if (key === "shadows" && Array.isArray(value)) {
        style.shadows = value;
      } else if (key === "blendMode" && typeof value === "string") {
        style.blendMode = value;
      } else if (key === "overflow" && typeof value === "string") {
        style.overflow = value;
      }
    }
    node.style = style;
  }

  if (patch.image && typeof patch.image === "object") {
    node.image = { ...(node.image ?? {}), ...patch.image };
  }
  if (patch.shader && typeof patch.shader === "object") {
    node.shader = { ...(node.shader ?? {}), ...patch.shader };
  }
  if (patch.path && typeof patch.path === "object") {
    node.path = { ...(node.path ?? {}), ...patch.path };
  }

  return node;
}

export function buildTreeRecursive(doc, page, spec, parentId, createdNodes = []) {
  const node = buildNode(doc, spec, parentId);
  attach(doc, page, node);
  createdNodes.push(node);

  if (Array.isArray(spec.children) && spec.children.length > 0) {
    for (const childSpec of spec.children) {
      buildTreeRecursive(doc, page, childSpec, node.id, createdNodes);
    }
  }

  return node;
}

function requireArgs(args, keys) {
  for (const key of keys) {
    if (args?.[key] == null) throw new Error(`Missing required argument: ${key}`);
  }
}

export const toolHandlers = {
  list_files() {
    const files = [];
    for (const entry of readdirSync(FILES_DIR)) {
      if (!entry.endsWith(".json")) continue;
      const fileId = entry.slice(0, -".json".length);
      try {
        const doc = JSON.parse(readFileSync(join(FILES_DIR, entry), "utf8"));
        if (!isValidDoc(doc)) continue;
        files.push({
          id: fileId,
          title: typeof doc.title === "string" ? doc.title : fileId,
          pages: doc.pages.length,
          nodes: Object.keys(doc.nodes).length,
          updatedAt: doc.updatedAt ?? null,
        });
      } catch {
        // Skip unreadable files
      }
    }
    files.sort((a, b) => a.id.localeCompare(b.id));
    return { files };
  },

  read_file(args) {
    requireArgs(args, ["fileId"]);
    return loadDoc(args.fileId);
  },

  create_file(args) {
    const title =
      typeof args?.title === "string" && args.title.trim()
        ? args.title.trim()
        : "Untitled";
    const id = newFileId();
    const doc = saveDoc(id, createBlankDoc(id, title));
    return { id: doc.id, title: doc.title };
  },

  duplicate_file(args) {
    requireArgs(args, ["fileId"]);
    const doc = loadDoc(args.fileId);
    const newId = newFileId();
    const cloned = JSON.parse(JSON.stringify(doc));
    cloned.id = newId;
    cloned.title =
      typeof args.title === "string" && args.title.trim()
        ? args.title.trim()
        : `${doc.title || "File"} (Copy)`;
    saveDoc(newId, cloned);
    return { id: newId, title: cloned.title };
  },

  delete_file(args) {
    requireArgs(args, ["fileId"]);
    const p = filePath(args.fileId);
    if (!existsSync(p)) throw new Error(`No such file: ${args.fileId}`);
    rmSync(p);
    return { deletedFileId: args.fileId };
  },

  list_pages(args) {
    requireArgs(args, ["fileId"]);
    const doc = loadDoc(args.fileId);
    return {
      fileId: args.fileId,
      pages: (doc.pages || []).map((p) => ({
        id: p.id,
        name: p.name,
        background: p.background ?? "#EEEEEE",
        icon: p.icon ?? null,
        isDivider: !!p.isDivider,
        nodeCount: (p.rootNodeIds || []).length,
      })),
    };
  },

  create_page(args) {
    requireArgs(args, ["fileId"]);
    const doc = loadDoc(args.fileId);
    const pageId = newPageId(doc);
    const name =
      typeof args.name === "string" && args.name.trim()
        ? args.name.trim()
        : `Page ${(doc.pages?.length || 0) + 1}`;
    const page = {
      id: pageId,
      name,
      background: args.background || "#EEEEEE",
      rootNodeIds: [],
    };
    if (args.icon) page.icon = args.icon;
    doc.pages.push(page);
    saveDoc(args.fileId, doc);
    return { page };
  },

  update_page(args) {
    requireArgs(args, ["fileId", "pageId", "patch"]);
    const doc = loadDoc(args.fileId);
    const page = doc.pages.find((p) => p.id === args.pageId);
    if (!page) throw new Error(`No such page: ${args.pageId}`);
    if (typeof args.patch.name === "string" && args.patch.name.trim()) {
      page.name = args.patch.name.trim();
    }
    if (typeof args.patch.background === "string") {
      page.background = args.patch.background;
    }
    if (typeof args.patch.icon === "string") {
      page.icon = args.patch.icon;
    }
    saveDoc(args.fileId, doc);
    return { page };
  },

  delete_page(args) {
    requireArgs(args, ["fileId", "pageId"]);
    const doc = loadDoc(args.fileId);
    if ((doc.pages || []).length <= 1) {
      throw new Error("Cannot delete the only page in the document");
    }
    const page = doc.pages.find((p) => p.id === args.pageId);
    if (!page) throw new Error(`No such page: ${args.pageId}`);

    const toDelete = [];
    for (const rootId of page.rootNodeIds || []) {
      toDelete.push(...subtreeIds(doc, rootId));
    }
    for (const id of toDelete) delete doc.nodes[id];
    doc.pages = doc.pages.filter((p) => p.id !== args.pageId);
    saveDoc(args.fileId, doc);
    return { deletedPageId: args.pageId, removedNodeCount: toDelete.length };
  },

  list_nodes(args) {
    requireArgs(args, ["fileId"]);
    const doc = loadDoc(args.fileId);
    const brief = (node, depth) => ({
      id: node.id,
      type: node.type,
      name: node.name,
      parentId: node.parentId ?? null,
      depth,
      x: node.position?.x,
      y: node.position?.y,
      w: node.size?.w?.kind === "fixed" ? node.size.w.px : node.size?.w?.kind,
      h: node.size?.h?.kind === "fixed" ? node.size.h.px : node.size?.h?.kind,
      layoutMode: node.layout?.mode ?? "freeform",
      ...(node.type === "text" ? { text: node.text?.content ?? "" } : {}),
    });
    if (args.pageId != null) {
      const page = doc.pages.find((p) => p.id === args.pageId);
      if (!page) throw new Error(`No such page in ${args.fileId}: ${args.pageId}`);
      const out = [];
      const walk = (ids, depth) => {
        for (const id of ids) {
          const node = doc.nodes[id];
          if (!node) continue;
          out.push(brief(node, depth));
          walk(node.childIds ?? [], depth + 1);
        }
      };
      walk(page.rootNodeIds, 0);
      return { fileId: args.fileId, pageId: page.id, nodes: out };
    }
    return {
      fileId: args.fileId,
      nodes: Object.values(doc.nodes).map((n) => brief(n, null)),
    };
  },

  get_node(args) {
    requireArgs(args, ["fileId", "nodeId"]);
    const doc = loadDoc(args.fileId);
    const node = doc.nodes[args.nodeId];
    if (!node) throw new Error(`No such node: ${args.nodeId}`);
    return { node };
  },

  add_node(args) {
    requireArgs(args, ["fileId", "pageId", "node"]);
    const doc = loadDoc(args.fileId);
    const page = doc.pages.find((p) => p.id === args.pageId);
    if (!page) throw new Error(`No such page in ${args.fileId}: ${args.pageId}`);
    const node = buildNode(doc, args.node, args.parentId ?? null);
    attach(doc, page, node);
    saveDoc(args.fileId, doc);
    return { node };
  },

  create_tree(args) {
    requireArgs(args, ["fileId", "pageId", "root"]);
    const doc = loadDoc(args.fileId);
    const page = doc.pages.find((p) => p.id === args.pageId);
    if (!page) throw new Error(`No such page in ${args.fileId}: ${args.pageId}`);
    const createdNodes = [];
    const rootNode = buildTreeRecursive(
      doc,
      page,
      args.root,
      args.parentId ?? null,
      createdNodes,
    );
    saveDoc(args.fileId, doc);
    return {
      rootId: rootNode.id,
      createdCount: createdNodes.length,
      nodeIds: createdNodes.map((n) => n.id),
      root: rootNode,
    };
  },

  update_node(args) {
    requireArgs(args, ["fileId", "nodeId", "patch"]);
    const doc = loadDoc(args.fileId);
    const node = applyNodePatch(doc, args.nodeId, args.patch ?? {});
    saveDoc(args.fileId, doc);
    return { node };
  },

  batch_update_nodes(args) {
    requireArgs(args, ["fileId", "updates"]);
    if (!Array.isArray(args.updates)) {
      throw new Error("updates must be an array of { nodeId, patch }");
    }
    const doc = loadDoc(args.fileId);
    const updated = [];
    for (const item of args.updates) {
      if (!item.nodeId || !doc.nodes[item.nodeId]) continue;
      const patched = applyNodePatch(doc, item.nodeId, item.patch ?? {});
      updated.push(patched);
    }
    saveDoc(args.fileId, doc);
    return { updatedCount: updated.length, nodes: updated };
  },

  duplicate_node(args) {
    requireArgs(args, ["fileId", "nodeId"]);
    const doc = loadDoc(args.fileId);
    const source = doc.nodes[args.nodeId];
    if (!source) throw new Error(`No such node: ${args.nodeId}`);

    const subIds = subtreeIds(doc, args.nodeId);
    const idMap = new Map();
    for (const oldId of subIds) {
      idMap.set(oldId, nextNodeId({ nodes: { ...doc.nodes, ...Object.fromEntries(idMap) } }));
    }

    const clonedSubtree = [];
    for (const oldId of subIds) {
      const orig = doc.nodes[oldId];
      const clone = JSON.parse(JSON.stringify(orig));
      clone.id = idMap.get(oldId);
      clone.name = `${orig.name} (Copy)`;
      clone.parentId = orig.parentId ? idMap.get(orig.parentId) ?? orig.parentId : null;
      clone.childIds = (orig.childIds ?? []).map((cid) => idMap.get(cid) ?? cid);
      if (oldId === args.nodeId) {
        clone.parentId = args.parentId ?? orig.parentId;
        clone.position = {
          ...(clone.position ?? {}),
          x: (clone.position?.x ?? 0) + 20,
          y: (clone.position?.y ?? 0) + 20,
        };
      }
      doc.nodes[clone.id] = clone;
      clonedSubtree.push(clone);
    }

    const rootClone = clonedSubtree.find((n) => n.id === idMap.get(args.nodeId));
    if (rootClone.parentId) {
      const parent = doc.nodes[rootClone.parentId];
      if (parent) parent.childIds = [...(parent.childIds ?? []), rootClone.id];
    } else {
      const page = doc.pages[0];
      page.rootNodeIds = [...page.rootNodeIds, rootClone.id];
    }

    saveDoc(args.fileId, doc);
    return { clonedNode: rootClone, totalCloned: clonedSubtree.length };
  },

  reparent_node(args) {
    requireArgs(args, ["fileId", "nodeId"]);
    const doc = loadDoc(args.fileId);
    const node = doc.nodes[args.nodeId];
    if (!node) throw new Error(`No such node: ${args.nodeId}`);

    const newParentId = args.newParentId ?? null;
    if (newParentId && !doc.nodes[newParentId]) {
      throw new Error(`Target parent node not found: ${newParentId}`);
    }
    if (newParentId && doc.nodes[newParentId].type !== "frame") {
      throw new Error(`Target parent must be a frame: ${newParentId}`);
    }

    detach(doc, args.nodeId);
    node.parentId = newParentId;

    if (newParentId) {
      const parent = doc.nodes[newParentId];
      parent.childIds = parent.childIds ?? [];
      const idx =
        args.insertIndex != null && args.insertIndex >= 0 && args.insertIndex <= parent.childIds.length
          ? args.insertIndex
          : parent.childIds.length;
      parent.childIds.splice(idx, 0, node.id);
    } else {
      const page = doc.pages[0];
      const idx =
        args.insertIndex != null && args.insertIndex >= 0 && args.insertIndex <= page.rootNodeIds.length
          ? args.insertIndex
          : page.rootNodeIds.length;
      page.rootNodeIds.splice(idx, 0, node.id);
    }

    saveDoc(args.fileId, doc);
    return { node };
  },

  delete_node(args) {
    requireArgs(args, ["fileId", "nodeId"]);
    const doc = loadDoc(args.fileId);
    if (!doc.nodes[args.nodeId]) {
      throw new Error(`No such node in ${args.fileId}: ${args.nodeId}`);
    }
    const removed = subtreeIds(doc, args.nodeId);
    detach(doc, args.nodeId);
    for (const id of removed) delete doc.nodes[id];
    saveDoc(args.fileId, doc);
    return { removed };
  },

  list_tokens(args) {
    requireArgs(args, ["fileId"]);
    const doc = loadDoc(args.fileId);
    return { fileId: args.fileId, tokens: doc.tokens || [] };
  },

  add_token(args) {
    requireArgs(args, ["fileId", "token"]);
    const doc = loadDoc(args.fileId);
    doc.tokens = doc.tokens || [];
    let seq = doc.tokens.length + 1;
    let id = `tok-${seq}`;
    while (doc.tokens.some((t) => t.id === id)) {
      seq++;
      id = `tok-${seq}`;
    }
    const token = {
      id,
      type: args.token.type || "color",
      name: args.token.name || `Token ${seq}`,
      value: args.token.value || "#000000",
    };
    doc.tokens.push(token);
    saveDoc(args.fileId, doc);
    return { token };
  },

  update_token(args) {
    requireArgs(args, ["fileId", "tokenId", "patch"]);
    const doc = loadDoc(args.fileId);
    const token = (doc.tokens || []).find((t) => t.id === args.tokenId);
    if (!token) throw new Error(`Token not found: ${args.tokenId}`);
    if (typeof args.patch.name === "string" && args.patch.name.trim()) {
      token.name = args.patch.name.trim();
    }
    if (args.patch.value != null) {
      token.value = args.patch.value;
    }
    saveDoc(args.fileId, doc);
    return { token };
  },

  delete_token(args) {
    requireArgs(args, ["fileId", "tokenId"]);
    const doc = loadDoc(args.fileId);
    doc.tokens = (doc.tokens || []).filter((t) => t.id !== args.tokenId);
    for (const n of Object.values(doc.nodes || {})) {
      if (n?.style?.fill?.tokenId === args.tokenId) {
        delete n.style.fill.tokenId;
        delete n.style.fill.tokenName;
      }
    }
    saveDoc(args.fileId, doc);
    return { deletedTokenId: args.tokenId };
  },
};

export const TOOLS = [
  {
    name: "list_files",
    description:
      "List all canvas-tool document files in the workspace directory, with title, page count, and node count.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "read_file",
    description: "Read a design file's full document JSON (tokens, pages, node tree, styles).",
    inputSchema: {
      type: "object",
      properties: { fileId: { type: "string", description: "The document file ID" } },
      required: ["fileId"],
    },
  },
  {
    name: "create_file",
    description: "Create a new blank canvas-tool document file.",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string", description: "Document title" } },
    },
  },
  {
    name: "duplicate_file",
    description: "Duplicate an existing design file.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "Source file ID to clone" },
        title: { type: "string", description: "Title for the copy" },
      },
      required: ["fileId"],
    },
  },
  {
    name: "delete_file",
    description: "Permanently delete a design file.",
    inputSchema: {
      type: "object",
      properties: { fileId: { type: "string", description: "File ID to delete" } },
      required: ["fileId"],
    },
  },
  {
    name: "list_pages",
    description: "List all pages in a design file (id, name, background, node count).",
    inputSchema: {
      type: "object",
      properties: { fileId: { type: "string", description: "Document file ID" } },
      required: ["fileId"],
    },
  },
  {
    name: "create_page",
    description: "Create a new page/canvas tab in the document.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "Document file ID" },
        name: { type: "string", description: "Page name (e.g. 'Checkout', 'Mobile')" },
        background: { type: "string", description: "Canvas background hex (default #EEEEEE)" },
        icon: { type: "string", description: "Optional page icon" },
      },
      required: ["fileId"],
    },
  },
  {
    name: "update_page",
    description: "Update page settings (rename, background color, icon).",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "Document file ID" },
        pageId: { type: "string", description: "Page ID (e.g. 'page-1')" },
        patch: {
          type: "object",
          properties: {
            name: { type: "string" },
            background: { type: "string" },
            icon: { type: "string" },
          },
        },
      },
      required: ["fileId", "pageId", "patch"],
    },
  },
  {
    name: "delete_page",
    description: "Delete a page and all its nodes. Cannot delete if it is the only page.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "Document file ID" },
        pageId: { type: "string", description: "Page ID to delete" },
      },
      required: ["fileId", "pageId"],
    },
  },
  {
    name: "list_nodes",
    description:
      "List nodes. With pageId: tree hierarchy in layer order with depth. Without pageId: all nodes flat.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        pageId: { type: "string" },
      },
      required: ["fileId"],
    },
  },
  {
    name: "get_node",
    description: "Get full details of a specific node (geometry, flex layout, styles, text).",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        nodeId: { type: "string" },
      },
      required: ["fileId", "nodeId"],
    },
  },
  {
    name: "add_node",
    description:
      "Add a node (frame, rect, text, path, shader, image) with rich layout and styling support.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        pageId: { type: "string" },
        parentId: { type: "string", description: "Frame ID to nest inside (optional)" },
        node: {
          type: "object",
          description:
            "Node spec: { type, name?, x?, y?, w?, h?, layout?, style?, text?, fill?, radius?, opacity?, stroke?, shadows?, clipContent? }",
        },
      },
      required: ["fileId", "pageId", "node"],
    },
  },
  {
    name: "create_tree",
    description:
      "Generate an entire UI component or page layout hierarchy in one call (recursively creates all nested frames, text, shapes, and flex children).",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        pageId: { type: "string" },
        parentId: { type: "string", description: "Optional parent frame ID" },
        root: {
          type: "object",
          description:
            "Root node spec with nested 'children': [{ type, name, layout, style, text, children: [...] }]",
        },
      },
      required: ["fileId", "pageId", "root"],
    },
  },
  {
    name: "update_node",
    description:
      "Update any properties of a node (position, size, flex layout, typography, fill, stroke, shadows, corner radius, opacity, clipContent).",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        nodeId: { type: "string" },
        patch: {
          type: "object",
          description:
            "Patch object: { name?, x?, y?, w?, h?, size?, layout?, text?, style?, rotation?, hidden?, visible?, locked?, clipContent? }",
        },
      },
      required: ["fileId", "nodeId", "patch"],
    },
  },
  {
    name: "batch_update_nodes",
    description: "Apply patches to multiple nodes in a single atomic update.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        updates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              nodeId: { type: "string" },
              patch: { type: "object" },
            },
            required: ["nodeId", "patch"],
          },
        },
      },
      required: ["fileId", "updates"],
    },
  },
  {
    name: "duplicate_node",
    description: "Duplicate a node and its entire subtree.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        nodeId: { type: "string" },
        parentId: { type: "string", description: "Optional new parent frame" },
      },
      required: ["fileId", "nodeId"],
    },
  },
  {
    name: "reparent_node",
    description: "Move a node to a different parent frame or to the page root, with optional index ordering.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        nodeId: { type: "string" },
        newParentId: { type: "string", description: "Target frame ID or null for page root" },
        insertIndex: { type: "number", description: "Sibling index (optional)" },
      },
      required: ["fileId", "nodeId"],
    },
  },
  {
    name: "delete_node",
    description: "Delete a node and all its descendants.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        nodeId: { type: "string" },
      },
      required: ["fileId", "nodeId"],
    },
  },
  {
    name: "list_tokens",
    description: "List all design tokens in the file (color, typography, spacing, radius).",
    inputSchema: {
      type: "object",
      properties: { fileId: { type: "string" } },
      required: ["fileId"],
    },
  },
  {
    name: "add_token",
    description: "Add a new design token to the file.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        token: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["color", "fontFamily", "spacing", "radius", "shadow"] },
            name: { type: "string" },
            value: { type: "string" },
          },
          required: ["type", "name", "value"],
        },
      },
      required: ["fileId", "token"],
    },
  },
  {
    name: "update_token",
    description: "Update an existing design token.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        tokenId: { type: "string" },
        patch: {
          type: "object",
          properties: {
            name: { type: "string" },
            value: { type: "string" },
          },
        },
      },
      required: ["fileId", "tokenId", "patch"],
    },
  },
  {
    name: "delete_token",
    description: "Delete a design token and detach it from referencing nodes.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        tokenId: { type: "string" },
      },
      required: ["fileId", "tokenId"],
    },
  },
];

export function resultText(value) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

export function callTool(params) {
  const name = params?.name;
  const handler = toolHandlers[name];
  if (!handler) {
    return { ...resultText(`Unknown tool: ${name}`), isError: true };
  }
  try {
    return resultText(handler(params?.arguments ?? {}));
  } catch (err) {
    return { ...resultText(`Error: ${err.message}`), isError: true };
  }
}
