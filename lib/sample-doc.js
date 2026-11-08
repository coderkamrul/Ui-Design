/**
 * Sample data for the M0 skeleton. Pure data, no behaviour.
 *
 * `sampleFiles` feeds the dashboard cards; `sampleDoc` is the one fully
 * modelled document (a {@link DesignFile} from lib/model.js) and feeds the
 * editor shell. In production, ids are ULIDs and this data comes from the
 * files API (M3); readable slugs are used here so the skeleton is easy to
 * follow.
 */
import { starterTokens } from "./theme.js";

/** Dashboard card metadata. `swatch` tints the card's mini preview. */
export const sampleFiles = [
  {
    id: "file-scratchpad",
    title: "Scratchpad",
    editedLabel: "Your permanent draft",
    swatch: "oklch(0.85 0.05 250)",
    isScratchpad: true,
  },
  {
    id: "file-landing",
    title: "Landing Page",
    editedLabel: "Edited 2 hours ago",
    swatch: "oklch(0.62 0.19 256)",
  },
  {
    id: "file-welcome",
    title: "Welcome to Paper",
    editedLabel: "Edited 3 hours ago",
    swatch: "oklch(0.7 0.15 160)",
  },
  {
    id: "file-paper-ui",
    title: "Paper Desing ui",
    editedLabel: "Edited 13 hours ago",
    swatch: "oklch(0.65 0.16 220)",
  },
  {
    id: "file-liquid-metal",
    title: "Liquid Metal Playground",
    editedLabel: "Edited 1 day ago",
    swatch: "oklch(0.68 0.17 45)",
  },
];

/** Look up dashboard metadata for a file id (editor top-bar title). */
export function getSampleFile(id) {
  return sampleFiles.find((f) => f.id === id);
}

/** The sample document rendered by the editor shell. */
export const sampleDoc = {
  id: "file-landing",
  teamId: "team-my-team",
  title: "Landing Page — Draft",
  createdBy: "you",
  updatedAt: "2026-11-05T00:00:00.000Z",
  comments: [],
  assets: {},

  // Per-file tokens ("Theme"). 90 starter tokens matching spec and UI.
  tokens: starterTokens().map((t, idx) => {
    if (t.name === "Brand / 500") {
      return { id: "tok-brand", ...t };
    }
    if (t.name === "Spacing / 24") {
      return { id: "tok-gap", ...t };
    }
    return { id: `tok-${idx + 1}`, ...t };
  }),

  pages: [
    {
      id: "page-1",
      name: "Page 1",
      background: "#EEEEEE",
      rootNodeIds: ["frame-hero", "frame-card", "frame-flex", "path-wave"],
    },
    {
      id: "page-templates",
      name: "Templates",
      background: "#EEEEEE",
      rootNodeIds: ["frame-templates-catalog", "frame-notes"],
    },
    {
      id: "page-design-system",
      name: "Design System",
      background: "#EEEEEE",
      rootNodeIds: [],
    },
  ],

  nodes: {
    "frame-hero": {
      id: "frame-hero",
      type: "frame",
      name: "Hero frame",
      parentId: null,
      childIds: ["rect-accent", "text-headline"],
      layout: { mode: "freeform" },
      position: { x: 96, y: 72 },
      size: { w: { kind: "fixed", px: 480 }, h: { kind: "fixed", px: 320 } },
      style: { fill: { kind: "solid", color: "#FFFFFF" }, radius: 8 },
    },
    "rect-accent": {
      id: "rect-accent",
      type: "rect",
      name: "Accent rectangle",
      parentId: "frame-hero",
      childIds: [],
      layout: { mode: "freeform" },
      position: { x: 40, y: 40 },
      size: { w: { kind: "fixed", px: 200 }, h: { kind: "fixed", px: 120 } },
      // Fill is BOUND to the Brand / Primary colour token.
      style: { fill: { kind: "token", tokenId: "tok-brand" }, radius: 6 },
    },
    "text-headline": {
      id: "text-headline",
      type: "text",
      name: "Headline",
      parentId: "frame-hero",
      childIds: [],
      layout: { mode: "freeform" },
      position: { x: 40, y: 188 },
      size: { w: { kind: "fixed", px: 360 }, h: { kind: "fit" } },
      style: { fill: { kind: "solid", color: "#1F1F1F" } },
      text: {
        content: "Design in the browser",
        fontSize: 28,
        fontWeight: 600,
        lineHeight: 1.2,
      },
    },
    "frame-card": {
      id: "frame-card",
      type: "frame",
      name: "Card frame",
      parentId: null,
      childIds: ["rect-media", "text-card"],
      layout: { mode: "freeform" },
      position: { x: 640, y: 72 },
      size: { w: { kind: "fixed", px: 300 }, h: { kind: "fixed", px: 200 } },
      style: { fill: { kind: "solid", color: "#FFFFFF" }, radius: 8 },
      // M4: a grid guide — 4 translucent columns inside the frame.
      guides: [
        {
          id: "guide-card-grid",
          kind: "grid",
          count: 4,
          color: "#E5484D",
          opacity: 0.12,
        },
      ],
    },
    // M4: an open bézier path (anchors node-local; the node's position /
    // size are the anchors' bounding box: 160 × 50 at 700, 470).
    "path-wave": {
      id: "path-wave",
      type: "path",
      name: "Wave path",
      parentId: null,
      childIds: [],
      layout: { mode: "freeform" },
      position: { x: 700, y: 470 },
      size: { w: { kind: "fixed", px: 160 }, h: { kind: "fixed", px: 50 } },
      style: {
        stroke: {
          width: 3,
          paint: { kind: "solid", color: "#3F74EE", alpha: 1 },
        },
      },
      path: {
        closed: false,
        anchors: [
          { x: 0, y: 50, in: null, out: { x: 30, y: 0 }, smooth: true },
          {
            x: 80,
            y: 0,
            in: { x: 50, y: 0 },
            out: { x: 110, y: 50 },
            smooth: true,
          },
          { x: 160, y: 50, in: { x: 130, y: 50 }, out: null, smooth: false },
        ],
      },
    },
    "rect-media": {
      id: "rect-media",
      type: "rect",
      name: "Card media",
      parentId: "frame-card",
      childIds: [],
      layout: { mode: "freeform" },
      position: { x: 24, y: 24 },
      size: { w: { kind: "fixed", px: 252 }, h: { kind: "fixed", px: 96 } },
      style: { fill: { kind: "solid", color: "#DCE4EE" }, radius: 6 },
    },
    "text-card": {
      id: "text-card",
      type: "text",
      name: "Card title",
      parentId: "frame-card",
      childIds: [],
      layout: { mode: "freeform" },
      position: { x: 24, y: 136 },
      size: { w: { kind: "fixed", px: 252 }, h: { kind: "fit" } },
      style: { fill: { kind: "solid", color: "#1F1F1F" } },
      text: {
        content: "A second frame",
        fontSize: 16,
        fontWeight: 500,
        lineHeight: 1.3,
      },
    },
    // M2: a flex frame — row direction, gap BOUND to the spacing token,
    // three children exercising Fixed / Fill / cross-axis Fill (stretch).
    "frame-flex": {
      id: "frame-flex",
      type: "frame",
      name: "Flex row",
      parentId: null,
      childIds: ["flex-a", "flex-b", "flex-c"],
      layout: {
        mode: "flex",
        direction: "row",
        reverse: false,
        wrap: false,
        gap: { tokenId: "tok-gap" },
        padding: { h: 16, v: 16 },
        alignMain: "start",
        alignCross: "start",
      },
      position: { x: 96, y: 440 },
      size: { w: { kind: "fixed", px: 560 }, h: { kind: "fixed", px: 160 } },
      style: { fill: { kind: "solid", color: "#FFFFFF" }, radius: 8 },
    },
    "flex-a": {
      id: "flex-a",
      type: "rect",
      name: "Flex fixed",
      parentId: "frame-flex",
      childIds: [],
      layout: { mode: "freeform" },
      position: { x: 0, y: 0 },
      size: { w: { kind: "fixed", px: 120 }, h: { kind: "fill" } },
      style: { fill: { kind: "solid", color: "#B9CFFB" }, radius: 6 },
    },
    "flex-b": {
      id: "flex-b",
      type: "rect",
      name: "Flex fill",
      parentId: "frame-flex",
      childIds: [],
      layout: { mode: "freeform" },
      position: { x: 0, y: 0 },
      size: { w: { kind: "fill" }, h: { kind: "fixed", px: 96 } },
      style: {
        fill: {
          kind: "gradient",
          gradientType: "linear",
          angle: 90,
          stops: [
            { color: "#6491F4", alpha: 1, at: 0 },
            { color: "#B9CFFB", alpha: 1, at: 100 },
          ],
        },
        radius: 6,
      },
    },
    "flex-c": {
      id: "flex-c",
      type: "rect",
      name: "Flex fixed 2",
      parentId: "frame-flex",
      childIds: [],
      layout: { mode: "freeform" },
      position: { x: 0, y: 0 },
      size: { w: { kind: "fixed", px: 96 }, h: { kind: "fixed", px: 96 } },
      style: { fill: { kind: "solid", color: "#3F74EE" }, radius: 6 },
    },
    "frame-notes": {
      id: "frame-notes",
      type: "frame",
      name: "Notes frame",
      parentId: null,
      childIds: ["text-notes"],
      layout: { mode: "freeform" },
      position: { x: 96, y: 72 },
      size: { w: { kind: "fixed", px: 420 }, h: { kind: "fixed", px: 160 } },
      style: { fill: { kind: "solid", color: "#FFFFFF" }, radius: 8 },
    },
    "text-notes": {
      id: "text-notes",
      type: "text",
      name: "Notes",
      parentId: "frame-notes",
      childIds: [],
      layout: { mode: "freeform" },
      position: { x: 24, y: 24 },
      size: { w: { kind: "fixed", px: 360 }, h: { kind: "fit" } },
      style: { fill: { kind: "solid", color: "#1F1F1F" } },
      text: {
        content: "Page 2 — double-click any text on Page 1 to edit it (M2).",
        fontSize: 14,
        fontWeight: 400,
        lineHeight: 1.4,
      },
    },
    "frame-templates-catalog": {
      id: "frame-templates-catalog",
      type: "frame",
      name: "Templates Catalog (1905px)",
      parentId: null,
      childIds: ["frame-button-row"],
      layout: { mode: "freeform" },
      position: { x: 80, y: 80 },
      size: { w: { kind: "fixed", px: 1905 }, h: { kind: "fixed", px: 900 } },
      style: { fill: { kind: "solid", color: "#FFFFFF" }, radius: 12 },
    },
    "frame-button-row": {
      id: "frame-button-row",
      type: "frame",
      name: "Frame",
      parentId: "frame-templates-catalog",
      childIds: ["btn-submit", "btn-login"],
      layout: {
        mode: "flex",
        direction: "row",
        gap: 12,
        align: "center",
        justify: "start",
        padding: { h: 24, v: 24 },
      },
      position: { x: 40, y: 40 },
      size: { w: { kind: "fit" }, h: { kind: "fit" } },
      style: { fill: null, radius: 0 },
    },
    "btn-submit": {
      id: "btn-submit",
      type: "frame",
      name: "Button",
      parentId: "frame-button-row",
      childIds: ["svg-submit", "text-submit"],
      layout: {
        mode: "flex",
        direction: "row",
        gap: 8,
        align: "center",
        justify: "center",
        padding: { h: 14, v: 8 },
      },
      position: { x: 0, y: 0 },
      size: { w: { kind: "fit" }, h: { kind: "fixed", px: 36 } },
      style: {
        fill: { kind: "solid", color: "#FFFFFF" },
        border: { width: 1, paint: { kind: "solid", color: "#E4E4E7" } },
        radius: 6,
      },
    },
    "svg-submit": {
      id: "svg-submit",
      type: "svg",
      name: "SVG",
      parentId: "btn-submit",
      childIds: ["path-plane-body", "path-plane-line"],
      viewBox: "0 0 16 16",
      layout: { mode: "freeform" },
      position: { x: 0, y: 0 },
      size: { w: { kind: "fixed", px: 16 }, h: { kind: "fixed", px: 16 } },
      style: { radius: 0, opacity: 1 },
    },
    "path-plane-body": {
      id: "path-plane-body",
      type: "path",
      name: "Path",
      parentId: "svg-submit",
      childIds: [],
      d: "M2.5 7.5L13.5 2.5L8.5 13.5L7 9L2.5 7.5Z",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      style: {
        stroke: { width: 1.3, paint: { kind: "solid", color: "#18181B", alpha: 1 } },
        fill: null,
      },
    },
    "path-plane-line": {
      id: "path-plane-line",
      type: "path",
      name: "Path",
      parentId: "svg-submit",
      childIds: [],
      d: "M7 9L13.5 2.5",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      style: {
        stroke: { width: 1.3, paint: { kind: "solid", color: "#18181B", alpha: 1 } },
        fill: null,
      },
    },
    "text-submit": {
      id: "text-submit",
      type: "text",
      name: "Submit",
      parentId: "btn-submit",
      childIds: [],
      layout: { mode: "freeform" },
      position: { x: 0, y: 0 },
      size: { w: { kind: "fit" }, h: { kind: "fit" } },
      style: { fill: { kind: "solid", color: "#18181B" } },
      text: { content: "Submit", fontSize: 13, fontWeight: 500, lineHeight: 1.2 },
    },
    "btn-login": {
      id: "btn-login",
      type: "frame",
      name: "Button",
      parentId: "frame-button-row",
      childIds: ["text-login"],
      layout: {
        mode: "flex",
        direction: "row",
        gap: 6,
        align: "center",
        justify: "center",
        padding: { h: 14, v: 8 },
      },
      position: { x: 0, y: 0 },
      size: { w: { kind: "fit" }, h: { kind: "fixed", px: 36 } },
      style: {
        fill: { kind: "solid", color: "#09090B" },
        radius: 6,
      },
    },
    "text-login": {
      id: "text-login",
      type: "text",
      name: "Login",
      parentId: "btn-login",
      childIds: [],
      layout: { mode: "freeform" },
      position: { x: 0, y: 0 },
      size: { w: { kind: "fit" }, h: { kind: "fit" } },
      style: { fill: { kind: "solid", color: "#FFFFFF" } },
      text: { content: "Login →", fontSize: 13, fontWeight: 500, lineHeight: 1.2 },
    },
  },
};
