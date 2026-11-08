/**
 * Utility functions for parsing and creating SVG, Group, Polygon, and Path node structures.
 * Supports standard SVGs, nested <g> groups, <polygon>, <polyline>, <rect>, <circle>, <ellipse>, <line>,
 * and complex/geo SVGs with style classes and transforms.
 */

let svgNodeSeq = 1;
function genSvgNodeId(doc, localIds = new Set()) {
  let id = `svg-node-${Date.now().toString(36)}-${svgNodeSeq++}`;
  while ((doc && doc.nodes && doc.nodes[id]) || localIds.has(id)) {
    id = `svg-node-${Date.now().toString(36)}-${svgNodeSeq++}`;
  }
  return id;
}

export const PRESET_SVGS = [
  // ── Navigation ──
  {
    id: "arrow-right",
    name: "Arrow Right",
    category: "Navigation",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`,
  },
  {
    id: "arrow-left",
    name: "Arrow Left",
    category: "Navigation",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>`,
  },
  {
    id: "arrow-up",
    name: "Arrow Up",
    category: "Navigation",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>`,
  },
  {
    id: "arrow-down",
    name: "Arrow Down",
    category: "Navigation",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>`,
  },
  {
    id: "chevron-right",
    name: "Chevron Right",
    category: "Navigation",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`,
  },
  {
    id: "chevron-left",
    name: "Chevron Left",
    category: "Navigation",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`,
  },
  {
    id: "chevron-down",
    name: "Chevron Down",
    category: "Navigation",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
  },
  {
    id: "chevron-up",
    name: "Chevron Up",
    category: "Navigation",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>`,
  },
  {
    id: "external-link",
    name: "External Link",
    category: "Navigation",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`,
  },
  {
    id: "menu",
    name: "Menu",
    category: "Navigation",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>`,
  },

  // ── Actions ──
  {
    id: "search",
    name: "Search",
    category: "Actions",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
  },
  {
    id: "plus",
    name: "Plus",
    category: "Actions",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`,
  },
  {
    id: "check",
    name: "Checkmark",
    category: "Actions",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
  },
  {
    id: "x",
    name: "Close (X)",
    category: "Actions",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  },
  {
    id: "pencil",
    name: "Edit (Pencil)",
    category: "Actions",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`,
  },
  {
    id: "trash",
    name: "Trash",
    category: "Actions",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
  },
  {
    id: "copy",
    name: "Copy",
    category: "Actions",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
  },
  {
    id: "download",
    name: "Download",
    category: "Actions",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`,
  },
  {
    id: "upload",
    name: "Upload",
    category: "Actions",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>`,
  },
  {
    id: "share",
    name: "Share",
    category: "Actions",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/></svg>`,
  },
  {
    id: "settings",
    name: "Settings",
    category: "Actions",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
  },
  {
    id: "sliders",
    name: "Sliders",
    category: "Actions",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="1" x2="7" y1="14" y2="14"/><line x1="9" x2="15" y1="8" y2="8"/><line x1="17" x2="23" y1="16" y2="16"/></svg>`,
  },

  // ── General / UI ──
  {
    id: "home",
    name: "Home",
    category: "General",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  },
  {
    id: "user",
    name: "User",
    category: "General",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  },
  {
    id: "users",
    name: "Users",
    category: "General",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  },
  {
    id: "bell",
    name: "Bell (Notification)",
    category: "General",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  },
  {
    id: "mail",
    name: "Mail",
    category: "General",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`,
  },
  {
    id: "lock",
    name: "Lock",
    category: "General",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  },
  {
    id: "unlock",
    name: "Unlock",
    category: "General",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`,
  },
  {
    id: "shield",
    name: "Shield",
    category: "General",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/></svg>`,
  },
  {
    id: "heart",
    name: "Heart",
    category: "General",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`,
  },
  {
    id: "star",
    name: "Star",
    category: "General",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  },
  {
    id: "sparkles",
    name: "Sparkles",
    category: "General",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>`,
  },
  {
    id: "zap",
    name: "Zap (Lightning)",
    category: "General",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  },
  {
    id: "globe",
    name: "Globe",
    category: "General",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" x2="22" y1="12" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  },
  {
    id: "calendar",
    name: "Calendar",
    category: "General",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>`,
  },
  {
    id: "clock",
    name: "Clock",
    category: "General",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  },
  {
    id: "folder",
    name: "Folder",
    category: "General",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>`,
  },
  {
    id: "file-text",
    name: "File Document",
    category: "General",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>`,
  },
  {
    id: "bookmark",
    name: "Bookmark",
    category: "General",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>`,
  },

  // ── Media ──
  {
    id: "image",
    name: "Image",
    category: "Media",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
  },
  {
    id: "camera",
    name: "Camera",
    category: "Media",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>`,
  },
  {
    id: "video",
    name: "Video",
    category: "Media",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>`,
  },
  {
    id: "music",
    name: "Music",
    category: "Media",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  },
  {
    id: "volume",
    name: "Volume",
    category: "Media",
    width: 24,
    height: 24,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`,
  },
];

/**
 * Parses any SVG string or snippet into an SVG container node + child nodes (Groups, Paths, Polygons).
 */
export function parseSvgToNodes(
  doc,
  rawSvg,
  parentId = null,
  pos = { x: 0, y: 0 },
  customSize = null
) {
  if (!rawSvg) return null;
  let text = String(rawSvg).trim();
  if (!text) return null;

  // Wrap bare path strings or snippets if needed
  if (!text.includes("<svg") && (text.startsWith("M") || text.includes("<path") || text.includes("<polygon") || text.includes("<g"))) {
    text = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${
      text.startsWith("<") ? text : `<path d="${text}" />`
    }</svg>`;
  }

  let docXml;
  if (typeof window !== "undefined" && window.DOMParser) {
    const parser = new DOMParser();
    docXml = parser.parseFromString(text, "image/svg+xml");
  } else {
    return null;
  }

  const svgEl = docXml.querySelector("svg");
  if (!svgEl) return null;

  // 1. Calculate viewBox & dimensions
  let viewBox = svgEl.getAttribute("viewBox");
  let w = parseFloat(svgEl.getAttribute("width")) || 0;
  let h = parseFloat(svgEl.getAttribute("height")) || 0;

  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
      if (!w) w = parts[2];
      if (!h) h = parts[3];
    }
  } else if (w && h) {
    viewBox = `0 0 ${w} ${h}`;
  } else {
    viewBox = "0 0 16 16";
    w = 16;
    h = 16;
  }

  const intrinsicW = Math.max(1, w || 16);
  const intrinsicH = Math.max(1, h || 16);
  const aspectRatio = intrinsicW / intrinsicH;

  if (customSize?.preserveAspectRatio && customSize?.size) {
    if (aspectRatio >= 1) {
      w = customSize.size;
      h = Math.round(customSize.size / aspectRatio);
    } else {
      h = customSize.size;
      w = Math.round(customSize.size * aspectRatio);
    }
  } else if (customSize?.preserveAspectRatio && customSize?.w && !customSize?.h) {
    w = customSize.w;
    h = Math.round(customSize.w / aspectRatio);
  } else if (customSize?.preserveAspectRatio && customSize?.h && !customSize?.w) {
    h = customSize.h;
    w = Math.round(customSize.h * aspectRatio);
  } else {
    if (customSize?.w) w = customSize.w;
    if (customSize?.h) h = customSize.h;
  }

  const finalW = Math.max(8, Math.round(w || 16));
  const finalH = Math.max(8, Math.round(h || 16));

  // 2. Parse CSS classes from <style> blocks
  const classStyles = {};
  svgEl.querySelectorAll("style").forEach((styleEl) => {
    const cssText = styleEl.textContent || "";
    const ruleRegex = /\.([a-zA-Z0-9_-]+)\s*\{([^}]+)\}/g;
    let match;
    while ((match = ruleRegex.exec(cssText)) !== null) {
      const className = match[1];
      const declarations = match[2];
      classStyles[className] = classStyles[className] || {};
      declarations.split(";").forEach((decl) => {
        const idx = decl.indexOf(":");
        if (idx > -1) {
          const prop = decl.slice(0, idx).trim().toLowerCase();
          const val = decl.slice(idx + 1).trim();
          if (prop && val) {
            classStyles[className][prop] = val;
          }
        }
      });
    }
  });

  const createdIds = new Set();
  const svgId = genSvgNodeId(doc, createdIds);
  createdIds.add(svgId);
  const allChildNodes = [];

  const generateId = () => {
    const id = genSvgNodeId(doc, createdIds);
    createdIds.add(id);
    return id;
  };

  // Parse root <svg> inline style and presentation attributes for inheritance
  const rootStyleAttr = svgEl.getAttribute("style") || "";
  const rootInlineMap = {};
  if (rootStyleAttr) {
    rootStyleAttr.split(";").forEach((pair) => {
      const idx = pair.indexOf(":");
      if (idx > -1) {
        rootInlineMap[pair.slice(0, idx).trim().toLowerCase()] = pair.slice(idx + 1).trim();
      }
    });
  }

  const defaultFillRule = svgEl.getAttribute("fill-rule") || rootInlineMap["fill-rule"] || "nonzero";
  const defaultClipRule = svgEl.getAttribute("clip-rule") || rootInlineMap["clip-rule"] || null;
  const defaultStroke = svgEl.getAttribute("stroke") || rootInlineMap["stroke"] || null;
  const defaultFill = svgEl.getAttribute("fill") || rootInlineMap["fill"] || null;
  const defaultStrokeWidth = (svgEl.getAttribute("stroke-width") || rootInlineMap["stroke-width"])
    ? parseFloat(svgEl.getAttribute("stroke-width") || rootInlineMap["stroke-width"])
    : null;
  const defaultStrokeLinecap = svgEl.getAttribute("stroke-linecap") || rootInlineMap["stroke-linecap"] || "round";
  const defaultStrokeLinejoin = svgEl.getAttribute("stroke-linejoin") || rootInlineMap["stroke-linejoin"] || "round";

  function getElementStyle(el, inherited = {}) {
    const inlineStyle = el.getAttribute("style") || "";
    const inlineMap = {};
    if (inlineStyle) {
      inlineStyle.split(";").forEach((pair) => {
        const idx = pair.indexOf(":");
        if (idx > -1) {
          inlineMap[pair.slice(0, idx).trim().toLowerCase()] = pair.slice(idx + 1).trim();
        }
      });
    }

    const classAttr = el.getAttribute("class") || "";
    let classStyle = {};
    if (classAttr) {
      classAttr.split(/\s+/).forEach((c) => {
        if (classStyles[c]) {
          classStyle = { ...classStyle, ...classStyles[c] };
        }
      });
    }

    const getVal = (prop) => {
      if (el.hasAttribute(prop)) return el.getAttribute(prop);
      if (inlineMap[prop] !== undefined) return inlineMap[prop];
      if (classStyle[prop] !== undefined) return classStyle[prop];
      if (inherited[prop] !== undefined) return inherited[prop];
      return undefined;
    };

    return {
      fill: getVal("fill"),
      stroke: getVal("stroke"),
      strokeWidth: getVal("stroke-width"),
      strokeLinecap: getVal("stroke-linecap") || inherited.strokeLinecap || "round",
      strokeLinejoin: getVal("stroke-linejoin") || inherited.strokeLinejoin || "round",
      opacity: getVal("opacity") ?? inherited.opacity,
      fillRule: getVal("fill-rule") || inherited.fillRule || defaultFillRule || "nonzero",
      clipRule: getVal("clip-rule") || inherited.clipRule || defaultClipRule || null,
      transform: el.getAttribute("transform") || null,
    };
  }

  // 3. Recursive element processor
  function processElement(el, currentParentId, inheritedStyles = {}) {
    if (!el || el.nodeType !== 1) return null;
    const tag = el.tagName.toLowerCase();

    // Skip metadata, defs, titles
    if (tag === "defs" || tag === "style" || tag === "title" || tag === "desc" || tag === "metadata") {
      return null;
    }

    const styles = getElementStyle(el, inheritedStyles);

    // Group handling (<g>)
    if (tag === "g") {
      const childElements = Array.from(el.children).filter((c) => {
        const t = c.tagName?.toLowerCase();
        return t && t !== "defs" && t !== "style" && t !== "title" && t !== "desc" && t !== "metadata";
      });

      if (childElements.length === 0) return null;

      // Detect if this <g> has any real transform or visual styling
      const hasTransform = Boolean(styles.transform && styles.transform.trim() !== "matrix(1,0,0,1,0,0)");
      const hasOpacity = styles.opacity !== undefined && parseFloat(styles.opacity) < 1;
      const hasFill = styles.fill !== undefined && styles.fill !== inheritedStyles.fill;
      const hasStroke = styles.stroke !== undefined && styles.stroke !== inheritedStyles.stroke;
      const hasUniqueFillRule = styles.fillRule && styles.fillRule !== inheritedStyles.fillRule;
      const hasUniqueClipRule = styles.clipRule && styles.clipRule !== inheritedStyles.clipRule;
      const hasClip = el.hasAttribute("clip-path") || el.hasAttribute("mask");

      // Optimization: Collapse redundant empty single-child wrapper groups (common in Illustrator/Affinity exports)
      if (
        childElements.length === 1 &&
        !hasTransform &&
        !hasOpacity &&
        !hasFill &&
        !hasStroke &&
        !hasUniqueFillRule &&
        !hasUniqueClipRule &&
        !hasClip
      ) {
        return processElement(childElements[0], currentParentId, styles);
      }

      const groupId = generateId();
      let rawName = el.getAttribute("id") || el.getAttribute("name");
      let groupName = "Group";
      if (rawName) {
        rawName = rawName.replace(/^#/, "");
        groupName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
      }

      const groupNode = {
        id: groupId,
        type: "group",
        name: groupName,
        parentId: currentParentId,
        childIds: [],
        position: { x: 0, y: 0 },
        size: {
          w: { kind: "fixed", px: finalW },
          h: { kind: "fixed", px: finalH },
        },
        transform: styles.transform || null,
        fillRule: styles.fillRule,
        clipRule: styles.clipRule,
        style: {
          opacity: styles.opacity ? parseFloat(styles.opacity) : 1,
        },
      };

      allChildNodes.push(groupNode);

      // Process children of <g>
      childElements.forEach((childEl) => {
        const childId = processElement(childEl, groupId, styles);
        if (childId) {
          groupNode.childIds.push(childId);
        }
      });

      return groupId;
    }

    // Shape elements
    let d = "";
    let nodeType = "path";
    let defaultNodeName = "Path";

    if (tag === "path") {
      d = el.getAttribute("d") || "";
      nodeType = "path";
      defaultNodeName = "Path";
    } else if (tag === "polygon") {
      const coords = (el.getAttribute("points") || "").trim().match(/-?[\d.]+(?:e-?\d+)?/gi);
      if (coords && coords.length >= 4) {
        d = `M ${coords[0]} ${coords[1]}`;
        for (let i = 2; i < coords.length - 1; i += 2) {
          d += ` L ${coords[i]} ${coords[i + 1]}`;
        }
        d += " Z";
      }
      nodeType = "polygon";
      defaultNodeName = "Polygon";
    } else if (tag === "polyline") {
      const coords = (el.getAttribute("points") || "").trim().match(/-?[\d.]+(?:e-?\d+)?/gi);
      if (coords && coords.length >= 4) {
        d = `M ${coords[0]} ${coords[1]}`;
        for (let i = 2; i < coords.length - 1; i += 2) {
          d += ` L ${coords[i]} ${coords[i + 1]}`;
        }
      }
      nodeType = "path";
      defaultNodeName = "Polyline";
    } else if (tag === "line") {
      const x1 = parseFloat(el.getAttribute("x1")) || 0;
      const y1 = parseFloat(el.getAttribute("y1")) || 0;
      const x2 = parseFloat(el.getAttribute("x2")) || 0;
      const y2 = parseFloat(el.getAttribute("y2")) || 0;
      d = `M ${x1} ${y1} L ${x2} ${y2}`;
      nodeType = "path";
      defaultNodeName = "Line";
    } else if (tag === "rect") {
      const x = parseFloat(el.getAttribute("x")) || 0;
      const y = parseFloat(el.getAttribute("y")) || 0;
      const rw = parseFloat(el.getAttribute("width")) || 0;
      const rh = parseFloat(el.getAttribute("height")) || 0;
      const rx = parseFloat(el.getAttribute("rx")) || 0;
      const ry = parseFloat(el.getAttribute("ry")) || rx || 0;
      if (rw > 0 && rh > 0) {
        if (rx > 0 || ry > 0) {
          const effRx = Math.min(rx || ry, rw / 2);
          const effRy = Math.min(ry || rx, rh / 2);
          d = `M ${x + effRx} ${y} h ${rw - 2 * effRx} a ${effRx} ${effRy} 0 0 1 ${effRx} ${effRy} v ${rh - 2 * effRy} a ${effRx} ${effRy} 0 0 1 -${effRx} ${effRy} h -${rw - 2 * effRx} a ${effRx} ${effRy} 0 0 1 -${effRx} -${effRy} v -${rh - 2 * effRy} a ${effRx} ${effRy} 0 0 1 ${effRx} -${effRy} Z`;
        } else {
          d = `M ${x} ${y} h ${rw} v ${rh} h -${rw} Z`;
        }
      }
      nodeType = "path";
      defaultNodeName = "Rectangle";
    } else if (tag === "circle") {
      const cx = parseFloat(el.getAttribute("cx")) || 0;
      const cy = parseFloat(el.getAttribute("cy")) || 0;
      const r = parseFloat(el.getAttribute("r")) || 0;
      if (r > 0) {
        d = `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 -${2 * r} 0 Z`;
      }
      nodeType = "path";
      defaultNodeName = "Circle";
    } else if (tag === "ellipse") {
      const cx = parseFloat(el.getAttribute("cx")) || 0;
      const cy = parseFloat(el.getAttribute("cy")) || 0;
      const rx = parseFloat(el.getAttribute("rx")) || 0;
      const ry = parseFloat(el.getAttribute("ry")) || 0;
      if (rx > 0 && ry > 0) {
        d = `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${2 * rx} 0 a ${rx} ${ry} 0 1 0 -${2 * rx} 0 Z`;
      }
      nodeType = "path";
      defaultNodeName = "Ellipse";
    }

    if (!d) return null;

    let stroke = styles.stroke !== undefined ? styles.stroke : defaultStroke;
    let fill = styles.fill !== undefined ? styles.fill : defaultFill;

    if (stroke === "none") stroke = null;
    if (fill === "none") fill = null;

    // If neither stroke nor fill is specified, default fill to currentColor / dark
    if (!stroke && !fill) {
      fill = "#18181B";
    }

    if (stroke === "currentColor") stroke = "#18181B";
    if (fill === "currentColor") fill = "#18181B";

    const strokeWidth = parseFloat(styles.strokeWidth || defaultStrokeWidth) || (stroke ? 1.3 : 0);
    const opacity = styles.opacity ? parseFloat(styles.opacity) : 1;

    const childId = generateId();
    let rawId = el.getAttribute("id");
    let name = defaultNodeName;
    if (rawId) {
      rawId = rawId.replace(/^#/, "");
      name = rawId.charAt(0).toUpperCase() + rawId.slice(1);
    }

    const node = {
      id: childId,
      type: nodeType,
      name,
      parentId: currentParentId,
      childIds: [],
      position: { x: 0, y: 0 },
      size: {
        w: { kind: "fixed", px: finalW },
        h: { kind: "fixed", px: finalH },
      },
      d,
      fillRule: styles.fillRule || "nonzero",
      clipRule: styles.clipRule || undefined,
      strokeLinecap: styles.strokeLinecap,
      strokeLinejoin: styles.strokeLinejoin,
      transform: styles.transform,
      style: {
        fill: fill && fill !== "none" ? { kind: "solid", color: fill } : null,
        stroke: stroke && stroke !== "none" ? { width: strokeWidth, paint: { kind: "solid", color: stroke, alpha: 1 } } : null,
        opacity: isNaN(opacity) ? 1 : opacity,
      },
    };

    allChildNodes.push(node);
    return childId;
  }

  // 4. Process root SVG children
  const topLevelChildIds = [];
  const initialInheritedStyles = {
    fillRule: defaultFillRule,
    clipRule: defaultClipRule,
    stroke: defaultStroke,
    fill: defaultFill,
    strokeWidth: defaultStrokeWidth,
    strokeLinecap: defaultStrokeLinecap,
    strokeLinejoin: defaultStrokeLinejoin,
  };

  Array.from(svgEl.children).forEach((childEl) => {
    const id = processElement(childEl, svgId, initialInheritedStyles);
    if (id) {
      topLevelChildIds.push(id);
    }
  });

  const svgNode = {
    id: svgId,
    type: "svg",
    name: "SVG",
    parentId: parentId ?? null,
    childIds: topLevelChildIds,
    viewBox: viewBox || `0 0 ${finalW} ${finalH}`,
    fillRule: defaultFillRule || "nonzero",
    clipRule: defaultClipRule || undefined,
    layout: { mode: "freeform" },
    position: { x: Math.round(pos.x || 0), y: Math.round(pos.y || 0) },
    size: {
      w: { kind: "fixed", px: finalW },
      h: { kind: "fixed", px: finalH },
    },
    style: {
      radius: 0,
      opacity: 1,
      fillRule: defaultFillRule || "nonzero",
    },
  };

  return { svgNode, pathNodes: allChildNodes };
}
