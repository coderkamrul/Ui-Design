// lib/grid.js — Native CSS Grid layout engine, track parser, and style builders.
//
// Provides first-class support for CSS Grid containers and children, matching
// the app's token system, canvas rendering pipeline, and Inspector controls.

import { resolveNumeric } from "./model.js";

/** Default configuration for a CSS Grid container. */
export function defaultGrid() {
  return {
    mode: "grid",
    display: "grid", // "grid" | "inline-grid"
    columns: "repeat(2, 1fr)",
    rows: "auto",
    autoFlow: "row", // "row" | "column" | "row dense" | "column dense"
    autoColumns: "auto",
    autoRows: "auto",
    gap: 16,
    columnGap: 16,
    rowGap: 16,
    justifyItems: "stretch", // "start" | "end" | "center" | "stretch"
    alignItems: "stretch",   // "start" | "end" | "center" | "stretch"
    justifyContent: "start", // "start" | "end" | "center" | "stretch" | "space-between" | "space-around" | "space-evenly"
    alignContent: "start",   // "start" | "end" | "center" | "stretch" | "space-between" | "space-around" | "space-evenly"
    padding: { t: 0, r: 0, b: 0, l: 0, h: 0, v: 0 },
    areas: "", // grid-template-areas string
  };
}

/**
 * Parse a CSS grid-template-columns or grid-template-rows string into structured tracks.
 * Handles simple sizes (px, fr, %, auto, min-content, max-content) and repeat(N, size).
 *
 * @param {string} trackStr
 * @returns {Array<{ id: string, size: number|string, unit: string, raw: string }>}
 */
export function parseGridTracks(trackStr) {
  if (!trackStr || typeof trackStr !== "string") {
    return [{ id: "t1", size: 1, unit: "fr", raw: "1fr" }, { id: "t2", size: 1, unit: "fr", raw: "1fr" }];
  }
  const str = trackStr.trim();
  const tracks = [];
  let trackCounter = 1;

  // Check for repeat(count, track) pattern
  const repeatMatch = /^repeat\(\s*(\d+)\s*,\s*([^)]+)\s*\)$/i.exec(str);
  if (repeatMatch) {
    const count = Math.min(24, Math.max(1, parseInt(repeatMatch[1], 10) || 1));
    const innerTrack = repeatMatch[2].trim();
    for (let i = 0; i < count; i++) {
      tracks.push(parseSingleTrack(innerTrack, `t${trackCounter++}`));
    }
    return tracks;
  }

  // Tokenize by space, respecting parentheses (e.g. minmax(100px, 1fr))
  const tokens = [];
  let cur = "";
  let parenDepth = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);

    if (/\s/.test(ch) && parenDepth === 0) {
      if (cur.trim()) tokens.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) tokens.push(cur.trim());

  for (const token of tokens) {
    // If token itself is a repeat(...)
    const rep = /^repeat\(\s*(\d+)\s*,\s*([^)]+)\s*\)$/i.exec(token);
    if (rep) {
      const count = Math.min(24, Math.max(1, parseInt(rep[1], 10) || 1));
      const sub = rep[2].trim();
      for (let i = 0; i < count; i++) {
        tracks.push(parseSingleTrack(sub, `t${trackCounter++}`));
      }
    } else {
      tracks.push(parseSingleTrack(token, `t${trackCounter++}`));
    }
  }

  return tracks.length ? tracks : [{ id: "t1", size: 1, unit: "fr", raw: "1fr" }];
}

function parseSingleTrack(token, id) {
  const t = token.trim();
  if (t === "auto") return { id, size: "auto", unit: "auto", raw: "auto" };
  if (t === "min-content") return { id, size: "min-content", unit: "min-content", raw: "min-content" };
  if (t === "max-content") return { id, size: "max-content", unit: "max-content", raw: "max-content" };

  if (/^\d+(\.\d+)?fr$/i.test(t)) {
    const n = parseFloat(t);
    return { id, size: isNaN(n) ? 1 : n, unit: "fr", raw: t };
  }
  if (/^\d+(\.\d+)?px$/i.test(t)) {
    const n = parseFloat(t);
    return { id, size: isNaN(n) ? 100 : n, unit: "px", raw: t };
  }
  if (/^\d+(\.\d+)?%$/i.test(t)) {
    const n = parseFloat(t);
    return { id, size: isNaN(n) ? 50 : n, unit: "%", raw: t };
  }
  if (/^\d+(\.\d+)?$/.test(t)) {
    const n = parseFloat(t);
    return { id, size: isNaN(n) ? 1 : n, unit: "fr", raw: `${n}fr` };
  }
  // Complex tracks like minmax(...) or calc(...)
  return { id, size: t, unit: "custom", raw: t };
}

/**
 * Serialize an array of track objects back to a standard CSS grid template string.
 *
 * @param {Array<{ size: number|string, unit: string, raw?: string }>} tracks
 * @returns {string}
 */
export function serializeGridTracks(tracks) {
  if (!Array.isArray(tracks) || !tracks.length) return "1fr";

  // Check if all tracks are identical 1fr tracks
  const allOneFr = tracks.every((t) => t.unit === "fr" && Number(t.size) === 1);
  if (allOneFr && tracks.length > 1) {
    return `repeat(${tracks.length}, 1fr)`;
  }

  return tracks
    .map((t) => {
      if (t.unit === "auto" || t.unit === "min-content" || t.unit === "max-content") return t.unit;
      if (t.unit === "custom") return t.raw || String(t.size);
      if (t.unit === "fr") return `${t.size ?? 1}fr`;
      if (t.unit === "px") return `${t.size ?? 100}px`;
      if (t.unit === "%") return `${t.size ?? 50}%`;
      return String(t.raw || t.size || "1fr");
    })
    .join(" ");
}

/**
 * Builds React style properties for a CSS Grid container.
 *
 * @param {Object} layout Node's layout configuration
 * @param {Array} tokens Optional design tokens
 * @returns {Object} React style object
 */
export function gridContainerStyle(layout, tokens = []) {
  if (!layout) return {};
  const isInline = layout.display === "inline-grid";
  const colGap = resolveNumeric(layout.columnGap ?? layout.gap ?? 16, tokens);
  const rGap = resolveNumeric(layout.rowGap ?? layout.gap ?? 16, tokens);

  const padTop = resolveNumeric(layout.padding?.t ?? layout.padding?.v ?? 0, tokens);
  const padRight = resolveNumeric(layout.padding?.r ?? layout.padding?.h ?? 0, tokens);
  const padBottom = resolveNumeric(layout.padding?.b ?? layout.padding?.v ?? 0, tokens);
  const padLeft = resolveNumeric(layout.padding?.l ?? layout.padding?.h ?? 0, tokens);

  return {
    display: isInline ? "inline-grid" : "grid",
    gridTemplateColumns: layout.columns || "repeat(2, 1fr)",
    gridTemplateRows: layout.rows || "auto",
    gridAutoFlow: layout.autoFlow || "row",
    gridAutoColumns: layout.autoColumns || undefined,
    gridAutoRows: layout.autoRows || undefined,
    columnGap: `${colGap}px`,
    rowGap: `${rGap}px`,
    justifyItems: layout.justifyItems || "stretch",
    alignItems: layout.alignItems || "stretch",
    justifyContent: layout.justifyContent || "start",
    alignContent: layout.alignContent || "start",
    padding: `${padTop}px ${padRight}px ${padBottom}px ${padLeft}px`,
    ...(layout.areas ? { gridTemplateAreas: layout.areas } : {}),
  };
}

/**
 * Builds React style properties for an element inside a CSS Grid container.
 *
 * @param {Object} node Child node
 * @param {Object} parentLayout Parent Grid layout
 * @returns {Object} React style object
 */
export function gridChildStyle(node, parentLayout = null) {
  if (!node) return {};
  const gl = node.gridLayout || {};
  const pos = node.position || {};
  if (pos.absolute) return { position: "absolute" };

  const style = {};

  // Column placement: gridColumn or start/end
  if (gl.gridColumn) {
    style.gridColumn = gl.gridColumn;
  } else if (gl.gridColumnStart || gl.gridColumnEnd) {
    const start = gl.gridColumnStart || "auto";
    const end = gl.gridColumnEnd ? ` / ${gl.gridColumnEnd}` : "";
    style.gridColumn = `${start}${end}`;
  }

  // Row placement: gridRow or start/end
  if (gl.gridRow) {
    style.gridRow = gl.gridRow;
  } else if (gl.gridRowStart || gl.gridRowEnd) {
    const start = gl.gridRowStart || "auto";
    const end = gl.gridRowEnd ? ` / ${gl.gridRowEnd}` : "";
    style.gridRow = `${start}${end}`;
  }

  // Grid area
  if (gl.gridArea) {
    style.gridArea = gl.gridArea;
  }

  // Self alignments
  if (gl.justifySelf && gl.justifySelf !== "auto") {
    style.justifySelf = gl.justifySelf;
  }
  if (gl.alignSelf && gl.alignSelf !== "auto") {
    style.alignSelf = gl.alignSelf;
  }

  // Order
  if (typeof gl.order === "number" && gl.order !== 0) {
    style.order = gl.order;
  }

  // Sizing for grid item
  const sizeW = node.size?.w;
  const sizeH = node.size?.h;
  const wPx = sizeW?.px ?? (typeof node.w === "number" ? node.w : null);
  const hPx = sizeH?.px ?? (typeof node.h === "number" ? node.h : null);

  if (sizeW?.kind === "fill") {
    style.width = "100%";
  } else if (sizeW?.kind === "fit" || sizeW?.kind === "auto") {
    style.width = "fit-content";
  } else if (wPx != null && wPx > 0) {
    style.width = `${wPx}px`;
  }

  if (sizeH?.kind === "fill") {
    style.height = "100%";
  } else if (sizeH?.kind === "fit" || sizeH?.kind === "auto") {
    style.height = "fit-content";
  } else if (hPx != null && hPx > 0) {
    style.height = `${hPx}px`;
  }

  return style;
}
