"use client";

import { useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createFile,
  duplicateFile,
  ensureSeeded,
  listFiles,
  loadFile,
  saveFile,
  updateFileMeta,
} from "@/lib/persistence";
import {
  isValidDoc,
  normalizeDoc,
  resolvePaint,
  resolvePaintColor,
} from "@/lib/model";
import { absoluteRect } from "@/lib/geometry";
import { computeAccurateNodeRect, computePageUnionBounds } from "@/lib/thumbnail";
import { cleanAndNormalizeHtml } from "@/lib/richtext";
import { loadPlanId, planOf, savePlanId, withinLimit } from "@/lib/plans";
import UpgradeDialog from "@/components/UpgradeDialog";
import { signOut, useSession } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  Search,
  Clock,
  BookOpen,
  Users,
  LayoutGrid,
  Archive,
  Settings,
  Plus,
  Minus,
  UserPlus,
  Download,
  Laptop,
  ChevronDown,
  Check,
  Pencil,
  MoreHorizontal,
  Copy,
  ExternalLink,
  X,
  Upload,
  List,
  Sparkles,
  LogOut,
  User,
  Shield,
  Layers,
  FileText,
  Trash2,
} from "lucide-react";

function formatEditedTime(iso) {
  if (!iso) return "Edited recently";
  const diffMins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMins < 1) return "Edited just now";
  if (diffMins < 60) return `Edited ${diffMins}m ago`;
  const hours = Math.floor(diffMins / 60);
  if (hours < 24) return `Edited ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Edited ${days}d ago`;
  return `Edited ${new Date(iso).toLocaleDateString()}`;
}

function getFill(fill, fallback) {
  if (!fill) return fallback;
  if (typeof fill === "string") return fill;
  if (fill.kind === "solid") return fill.color || fallback;
  if (fill.kind === "none") return "none";
  if (fill.color) return fill.color;
  return fallback;
}

function fitCss(fit) {
  if (fit === "fill") return "100% 100%";
  if (fit === "contain") return "contain";
  if (fit === "tile") return "auto";
  return "cover";
}

function fillProps(node, tokens, assets) {
  const fills = node.style?.fills?.length
    ? node.style.fills
    : node.style?.fill
      ? [node.style.fill]
      : [];
  if (!fills.length) return {};

  const visibleFills = fills.filter((f) => f && f.visible !== false && !f.hidden);
  if (!visibleFills.length) return {};

  if (visibleFills.length === 1) {
    const fill = visibleFills[0];
    if (fill.kind === "gradient") {
      return { backgroundImage: resolvePaint(fill, tokens) };
    }
    if (fill.kind === "image") {
      const url = assets?.[fill.assetId] || fill.url;
      if (!url) return {};
      return {
        backgroundImage: `url(${url})`,
        backgroundSize: fitCss(fill.fit),
        backgroundPosition: "center",
        backgroundRepeat: fill.fit === "tile" ? "repeat" : "no-repeat",
      };
    }
    const css = resolvePaint(fill, tokens);
    return css ? { backgroundColor: css } : {};
  }

  const bgImages = [];
  const bgSizes = [];
  const bgPositions = [];
  const bgRepeats = [];

  for (const fill of visibleFills) {
    if (fill.kind === "gradient") {
      bgImages.push(resolvePaint(fill, tokens) || "none");
      bgSizes.push("100% 100%");
      bgPositions.push("center");
      bgRepeats.push("no-repeat");
    } else if (fill.kind === "image") {
      const url = assets?.[fill.assetId] || fill.url;
      if (url) {
        bgImages.push(`url(${url})`);
        bgSizes.push(fitCss(fill.fit));
        bgPositions.push("center");
        bgRepeats.push(fill.fit === "tile" ? "repeat" : "no-repeat");
      }
    } else {
      const cssColor = resolvePaint(fill, tokens) || fill.color || "#FFFFFF";
      bgImages.push(`linear-gradient(${cssColor}, ${cssColor})`);
      bgSizes.push("100% 100%");
      bgPositions.push("center");
      bgRepeats.push("no-repeat");
    }
  }

  if (!bgImages.length) return {};
  return {
    backgroundImage: bgImages.join(", "),
    backgroundSize: bgSizes.join(", "),
    backgroundPosition: bgPositions.join(", "),
    backgroundRepeat: bgRepeats.join(", "),
  };
}

const JUSTIFY_MAP = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  "space-between": "space-between",
};
const ALIGN_MAP = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
};

/**
 * MiniNode: Recursive lightweight HTML/CSS renderer for thumbnail preview.
 * Preserves exact layout, rich text, colors, buttons, images & gradients.
 */
function MiniNode({ id, nodes, tokens, assets }) {
  const node = nodes[id];
  if (!node || node.hidden || node.visible === false || node.style?.opacity === 0) return null;

  const bgStyle = fillProps(node, tokens, assets);
  const isFlex = node.layout?.mode === "flex";
  const isAbs = !!node.position?.absolute;

  const posStyle = isAbs || !isFlex
    ? {
        position: isAbs ? "absolute" : (node.parentId ? "absolute" : "relative"),
        left: `${node.position?.x ?? node.x ?? 0}px`,
        top: `${node.position?.y ?? node.y ?? 0}px`,
      }
    : { position: "relative" };

  const sizeStyle = {};
  if (node.size?.w?.kind === "fixed" && node.size.w.px != null) {
    sizeStyle.width = `${node.size.w.px}px`;
  } else if (node.size?.w?.kind === "fill") {
    sizeStyle.width = "100%";
  } else if (node.w) {
    sizeStyle.width = `${node.w}px`;
  }

  if (node.size?.h?.kind === "fixed" && node.size.h.px != null) {
    sizeStyle.height = `${node.size.h.px}px`;
  } else if (node.size?.h?.kind === "fill") {
    sizeStyle.height = "100%";
  } else if (node.h) {
    sizeStyle.height = `${node.h}px`;
  }

  const mar = node.layout?.margin || node.margin;
  const marginStyle = mar ? {
    marginTop: `${mar.t ?? mar.v ?? 0}px`,
    marginRight: `${mar.r ?? mar.h ?? 0}px`,
    marginBottom: `${mar.b ?? mar.v ?? 0}px`,
    marginLeft: `${mar.l ?? mar.h ?? 0}px`,
  } : {};

  const flexStyle = isFlex ? {
    display: "flex",
    flexDirection: node.layout.direction || "column",
    gap: `${node.layout.gap ?? 0}px`,
    justifyContent: JUSTIFY_MAP[node.layout.alignMain] || "flex-start",
    alignItems: ALIGN_MAP[node.layout.alignCross] || "flex-start",
    flexWrap: node.layout.wrap ? "wrap" : "nowrap",
    paddingTop: `${node.layout.padding?.t ?? node.layout.padding?.v ?? 0}px`,
    paddingRight: `${node.layout.padding?.r ?? node.layout.padding?.h ?? 0}px`,
    paddingBottom: `${node.layout.padding?.b ?? node.layout.padding?.v ?? 0}px`,
    paddingLeft: `${node.layout.padding?.l ?? node.layout.padding?.h ?? 0}px`,
  } : {};

  const radius = node.style?.radius ? `${node.style.radius}px` : undefined;
  const border = node.style?.border?.width && !node.style.border.hidden
    ? `${node.style.border.width}px ${node.style.border.style || "solid"} ${resolvePaintColor(node.style.border.paint, tokens) || node.style.border.color || "#000"}`
    : undefined;
  const overflow = (node.clipContent || node.style?.overflow === "hidden") ? "hidden" : "visible";

  if (node.type === "text") {
    const textColor = resolvePaintColor(node.style?.fill || node.text?.fill, tokens) || node.text?.color || "#18181B";
    if (node.text?.html) {
      const isTrunc = Boolean(node.text.truncation);
      return (
        <div
          style={{
            ...posStyle,
            ...sizeStyle,
            ...marginStyle,
            color: textColor,
            lineHeight: node.text.lineHeight || 1.25,
            whiteSpace: isTrunc ? "nowrap" : "pre-wrap",
            overflow: isTrunc ? "hidden" : undefined,
            textOverflow: isTrunc ? "ellipsis" : undefined,
          }}
          dangerouslySetInnerHTML={{ __html: cleanAndNormalizeHtml(node.text.html) }}
        />
      );
    }
    const isTrunc = Boolean(node.text?.truncation);
    return (
      <div
        style={{
          ...posStyle,
          ...sizeStyle,
          ...marginStyle,
          fontSize: `${node.text?.fontSize || 14}px`,
          fontWeight: node.text?.fontWeight || 400,
          color: textColor,
          fontFamily: node.text?.fontFamily || "Inter, sans-serif",
          lineHeight: node.text?.lineHeight || 1.25,
          textAlign: node.text?.align || "left",
          whiteSpace: isTrunc ? "nowrap" : "pre-wrap",
          overflow: isTrunc ? "hidden" : undefined,
          textOverflow: isTrunc ? "ellipsis" : undefined,
        }}
      >
        {node.text?.content || ""}
      </div>
    );
  }

  if (node.type === "image" && (node.image?.src || node.src)) {
    return (
      <img
        src={node.image?.src || node.src}
        alt=""
        style={{
          ...posStyle,
          ...sizeStyle,
          ...marginStyle,
          borderRadius: radius,
          objectFit: "cover",
          display: "block",
        }}
      />
    );
  }

  if (node.type === "svg") {
    const w = node.size?.w?.px || node.w || 24;
    const h = node.size?.h?.px || node.h || 24;
    const vb = node.viewBox || `0 0 ${w} ${h}`;
    const fill = resolvePaintColor(node.style?.fill, tokens) || "#000";
    return (
      <svg
        viewBox={vb}
        style={{
          ...posStyle,
          ...sizeStyle,
          ...marginStyle,
          display: "block",
          fill,
        }}
      >
        {(node.childIds || []).map((cid) => {
          const c = nodes[cid];
          if (!c) return null;
          return (
            <path
              key={cid}
              d={c.d || c.path?.d}
              fill={resolvePaintColor(c.style?.fill, tokens) || fill}
              stroke={resolvePaintColor(c.style?.stroke?.paint || c.style?.stroke, tokens)}
              strokeWidth={c.style?.stroke?.width}
            />
          );
        })}
      </svg>
    );
  }

  if (node.type === "path") {
    const d = node.d || node.path?.d;
    if (!d) return null;
    return (
      <svg
        style={{
          ...posStyle,
          ...sizeStyle,
          ...marginStyle,
          overflow: "visible",
        }}
      >
        <path
          d={d}
          fill={resolvePaintColor(node.style?.fill, tokens) || "none"}
          stroke={resolvePaintColor(node.style?.stroke?.paint || node.style?.stroke, tokens) || "#000"}
          strokeWidth={node.style?.stroke?.width ?? 1.5}
        />
      </svg>
    );
  }

  if (node.type === "ellipse") {
    return (
      <div
        style={{
          ...posStyle,
          ...sizeStyle,
          ...marginStyle,
          borderRadius: "50%",
          backgroundColor:
            resolvePaintColor(node.style?.fill, tokens) || node.style?.fill?.color || "#D9DEE8",
          opacity: node.style?.opacity ?? 1,
          display: "block",
        }}
      />
    );
  }

  return (
    <div
      style={{
        ...posStyle,
        ...sizeStyle,
        ...marginStyle,
        ...flexStyle,
        ...bgStyle,
        borderRadius: radius,
        border,
        overflow,
        opacity: node.style?.opacity ?? 1,
      }}
    >
      {node.childIds?.map((cid) => (
        <MiniNode key={cid} id={cid} nodes={nodes} tokens={tokens} assets={assets} />
      ))}
    </div>
  );
}

/**
 * DocumentThumbnailPreview:
 * Precision canvas miniature preview with scaled artboard sheets.
 */
function DocumentThumbnailPreview({ page, nodes, tokens, assets }) {
  const rootIds = useMemo(() => {
    return (page?.rootNodeIds || []).filter((id) => {
      const n = nodes?.[id];
      return n && !n.hidden && n.visible !== false;
    });
  }, [page?.rootNodeIds, nodes]);

  const bounds = useMemo(() => {
    if (!rootIds.length) return null;
    return computePageUnionBounds(nodes, rootIds);
  }, [rootIds, nodes]);

  if (!bounds || !rootIds.length) {
    return (
      <div className="relative h-full w-full flex items-center justify-center p-3">
        <div className="w-[82%] h-[78%] rounded-lg bg-white dark:bg-[#1E1E22] border border-[#E4E4E7] dark:border-[#2E2E32] shadow-xs flex flex-col items-center justify-center gap-1 text-[#A1A1AA]">
          <LayoutGrid size={18} strokeWidth={1.5} className="opacity-50" />
          <span className="text-[11px] font-medium">Empty canvas</span>
        </div>
      </div>
    );
  }

  // Card dimensions ~240 x 155 with comfortable 28px margins
  const availW = 212;
  const availH = 126;
  const scale = Math.min(availW / bounds.w, availH / bounds.h);

  return (
    <div className="relative h-full w-full overflow-hidden flex items-center justify-center pointer-events-none select-none">
      <div
        style={{
          width: `${bounds.w}px`,
          height: `${bounds.h}px`,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          position: "relative",
        }}
        className="shrink-0"
      >
        {rootIds.map((id) => {
          const n = nodes[id];
          const r = computeAccurateNodeRect(nodes, id);
          const left = r.x - bounds.x;
          const top = r.y - bounds.y;
          return (
            <div
              key={id}
              style={{
                position: "absolute",
                left: `${left}px`,
                top: `${top}px`,
                width: `${r.w}px`,
                height: `${r.h}px`,
                boxShadow:
                  "0 8px 30px -4px rgba(0, 0, 0, 0.16), 0 2px 8px -1px rgba(0, 0, 0, 0.08)",
                borderRadius: n.style?.radius ? `${n.style.radius}px` : "6px",
                overflow: "hidden",
              }}
            >
              <MiniNode id={id} nodes={nodes} tokens={tokens} assets={assets} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * RealCanvasThumbnail:
 * Production-ready canvas thumbnail renderer matching Figma & Paper Design:
 * - If saved raster/SVG thumbnail exists: renders high-res snapshot
 * - Scratchpad: clean white draft artboard with subtle pencil badge
 * - Liquid Metal: sleek metallic gradient shader artboard
 * - All other documents: scaled, pixel-perfect HTML/CSS artboard preview
 */
function RealCanvasThumbnail({ file, doc }) {
  const title = (file.title || "").toLowerCase();
  const isScratch = file.isScratchpad || title.includes("scratchpad");

  // Priority 1: High-res saved image thumbnail (JPEG/PNG/SVG snapshot)
  const thumbnail = file?.thumbnail || doc?.thumbnail;
  if (thumbnail) {
    return (
      <div className="relative h-full w-full flex items-center justify-center p-2.5 overflow-hidden pointer-events-none select-none bg-white/40 dark:bg-[#18181B]/40">
        <img
          src={thumbnail}
          alt={file?.title || "Thumbnail"}
          className="w-full h-full object-contain rounded-md shadow-xs transition-transform duration-200 group-hover:scale-[1.02]"
          loading="lazy"
        />
      </div>
    );
  }

  if (isScratch) {
    return (
      <div className="relative h-full w-full flex items-center justify-center p-3 pointer-events-none">
        <div className="w-[82%] h-[78%] rounded-lg bg-white dark:bg-[#1E1E22] border border-[#E4E4E7] dark:border-[#2E2E32] shadow-sm flex flex-col items-center justify-center gap-1.5 text-[#A1A1AA]">
          <Pencil size={18} strokeWidth={1.5} className="opacity-60" />
          <span className="text-[11px] font-medium tracking-wide">Quick Draft</span>
        </div>
      </div>
    );
  }

  if (title.includes("liquid metal") || file.id === "file-liquid-metal") {
    return (
      <div className="relative h-full w-full flex items-center justify-center overflow-hidden p-2.5 pointer-events-none">
        <div className="relative w-[80%] h-[76%] rounded-lg overflow-hidden shadow-xl border border-white/20">
          <div
            className="w-full h-full"
            style={{
              background: "linear-gradient(135deg, #fce043 0%, #fb7ba2 30%, #4facfe 70%, #00f2fe 100%)",
              filter: "contrast(1.25) saturate(1.3)",
            }}
          >
            <div
              className="w-full h-full opacity-65 mix-blend-overlay"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 35% 35%, rgba(255,255,255,0.95), transparent 45%), radial-gradient(circle at 65% 65%, rgba(0,0,0,0.85), transparent 55%)",
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (doc && doc.pages && doc.pages[0]) {
    const page = doc.pages[0];
    const nodes = doc.nodes || {};
    return (
      <DocumentThumbnailPreview
        page={page}
        nodes={nodes}
        tokens={doc.tokens || []}
        assets={doc.assets || {}}
      />
    );
  }

  // Fallback while loading
  return (
    <div className="relative h-full w-full flex items-center justify-center p-3 pointer-events-none">
      <div className="w-[82%] h-[78%] rounded-lg bg-white/60 dark:bg-[#1E1E22]/60 border border-[#E4E4E7]/60 dark:border-[#2E2E32]/60 shadow-xs animate-pulse" />
    </div>
  );
}

/**
 * FileMenu:
 * Action dropdown for each file (Rename, Duplicate, Export JSON, Archive)
 */
function FileMenu({ file, onRename, onChanged, onExport }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const [coords, setCoords] = useState(null);

  useLayoutEffect(() => {
    if (open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      const menuH = 160;
      let y = r.bottom + 4;
      if (y + menuH > window.innerHeight - 12) {
        y = Math.max(12, r.top - menuH - 4);
      }
      setCoords({ right: window.innerWidth - r.right, y });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e) => {
      if (e.target.closest("[data-file-menu]")) return;
      if (buttonRef.current && !buttonRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handleOutside);
    return () => window.removeEventListener("mousedown", handleOutside);
  }, [open]);

  const act = (fn) => (e) => {
    e.stopPropagation();
    setOpen(false);
    fn();
  };

  return (
    <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        className="flex h-6 w-6 items-center justify-center rounded-md text-[#71717A] hover:text-[#18181B] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
        title="File actions"
      >
        <MoreHorizontal size={14} />
      </button>

      {open && coords && typeof document !== "undefined" && createPortal(
        <div
          data-file-menu="true"
          style={{ position: "fixed", top: coords.y, right: coords.right, zIndex: 10020 }}
          className="w-44 rounded-xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] p-1 text-xs text-[#18181B] dark:text-[#EDEDED] shadow-2xl animate-in fade-in zoom-in-95 duration-100 select-none"
        >
          <button
            type="button"
            onClick={act(onRename)}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-left"
          >
            <Pencil size={12} className="text-[#71717A]" />
            <span>Rename</span>
          </button>
          <button
            type="button"
            onClick={act(async () => {
              await duplicateFile(file.id);
              onChanged();
            })}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-left"
          >
            <Copy size={12} className="text-[#71717A]" />
            <span>Duplicate</span>
          </button>
          <button
            type="button"
            onClick={act(() => onExport(file))}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-left"
          >
            <Download size={12} className="text-[#71717A]" />
            <span>Export JSON</span>
          </button>
          <div className="my-1 border-t border-[#E4E4E7]/60 dark:border-[#2E2E32]" />
          <button
            type="button"
            onClick={act(async () => {
              await updateFileMeta(file.id, { archived: !file.archived });
              onChanged();
            })}
            className={`flex w-full items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-left ${
              file.archived ? "text-[#0D99FF]" : "text-[#71717A] hover:text-[#EA4133]"
            }`}
          >
            <Archive size={12} />
            <span>{file.archived ? "Unarchive" : "Archive"}</span>
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

function FileTitleEditor({ file, onDone }) {
  const [val, setVal] = useState(file.title);
  return (
    <input
      type="text"
      value={val}
      autoFocus
      onChange={(e) => setVal(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={async () => {
        const next = val.trim();
        if (next && next !== file.title) {
          await updateFileMeta(file.id, { title: next });
        }
        onDone();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setVal(file.title);
          onDone();
        }
      }}
      className="h-6 w-full rounded-md border border-[#0D99FF] bg-white dark:bg-zinc-800 px-1 text-xs font-semibold text-[#18181B] dark:text-white outline-none shadow-2xs"
    />
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const { status, user } = useSession();

  const [files, setFiles] = useState(null);
  const [docCache, setDocCache] = useState({});
  const [view, setView] = useState("grid"); // "grid" | "list"
  const [section, setSection] = useState("recents"); // "recents" | "files" | "archive"
  const [search, setSearch] = useState("");
  const [renamingId, setRenamingId] = useState(null);

  // Modals
  const [planId, setPlanIdState] = useState("free");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [desktopAppOpen, setDesktopAppOpen] = useState(false);
  const [learnOpen, setLearnOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [teamCardMinimized, setTeamCardMinimized] = useState(false);
  const [toast, setToast] = useState(null);

  const searchInputRef = useRef(null);
  const importInputRef = useRef(null);
  const userMenuRef = useRef(null);

  useEffect(() => {
    setPlanIdState(loadPlanId());
  }, []);

  const showToast = (message) => setToast({ id: Date.now(), message });
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Auth gate
  useEffect(() => {
    if (configured && status === "signed-out") router.replace("/login");
  }, [configured, status, router]);

  // Close user dropdown on outside click
  useEffect(() => {
    if (!userMenuOpen) return;
    const handleOutside = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleOutside);
    return () => window.removeEventListener("mousedown", handleOutside);
  }, [userMenuOpen]);

  // Global search shortcut Cmd+F / Ctrl+F
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const refresh = async () => {
    const list = await listFiles();
    setFiles(list);
  };

  useEffect(() => {
    if (configured && status !== "signed-in") return;
    let cancelled = false;
    (async () => {
      await ensureSeeded();
      const list = await listFiles();
      if (!cancelled) setFiles(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [configured, status]);

  useEffect(() => {
    if (!files) return;
    let cancelled = false;
    files.forEach(async (f) => {
      try {
        const d = await loadFile(f.id);
        if (!cancelled && d) {
          setDocCache((prev) => (prev[f.id] ? prev : { ...prev, [f.id]: d }));
        }
      } catch (err) {
        // quiet catch
      }
    });
    return () => {
      cancelled = true;
    };
  }, [files]);

  const visibleFiles = useMemo(() => {
    if (!files) return [];
    return files.filter((f) => {
      if (section === "archive") {
        if (!f.archived) return false;
      } else {
        if (f.archived) return false;
      }
      if (search.trim()) {
        return f.title.toLowerCase().includes(search.toLowerCase());
      }
      return true;
    });
  }, [files, section, search]);

  const newFile = async () => {
    const activeCount = (files ?? []).filter((f) => !f.archived).length;
    if (!withinLimit(planId, "maxFiles", activeCount)) {
      showToast(
        `The Free plan includes ${planOf(planId).maxFiles} files — upgrade for unlimited files.`
      );
      setUpgradeOpen(true);
      return;
    }
    const meta = await createFile("Untitled");
    if (meta) router.push(`/file/${meta.id}`);
  };

  const exportJson = async (file) => {
    const doc = await loadFile(file.id);
    if (!doc) {
      showToast("Could not load that file to export");
      return;
    }
    const blob = new Blob([JSON.stringify(doc, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${file.title || "paper-design"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importJson = async (picked) => {
    if (!picked) return;
    try {
      const text = await picked.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        showToast("Invalid JSON file");
        return;
      }
      if (!isValidDoc(parsed)) {
        showToast("JSON is missing required document structure (pages + nodes)");
        return;
      }
      const title =
        typeof parsed.title === "string" && parsed.title.trim()
          ? parsed.title.trim()
          : "Imported file";
      const meta = await createFile(title);
      if (!meta) {
        showToast("Import failed — could not create file");
        return;
      }
      await saveFile(
        meta.id,
        normalizeDoc(parsed, { id: meta.id, title: meta.title })
      );
      await refresh();
      showToast(`Imported “${meta.title}” successfully`);
    } catch (err) {
      showToast(`Import failed: ${err.message}`);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  const displayName = useMemo(() => {
    if (user?.user_metadata?.full_name) return user.user_metadata.full_name;
    if (!user?.email) return "Kamrul Hasan";
    const namePart = user.email.split("@")[0];
    const cleaned = namePart.replace(/[0-9_.-]+/g, " ").trim();
    if (!cleaned) return "Kamrul Hasan";
    return (
      cleaned
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ") || "Kamrul Hasan"
    );
  }, [user]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white dark:bg-[#121214] text-[#18181B] dark:text-[#EDEDED] font-sans antialiased selection:bg-[#0D99FF]/20 select-none">
      {/* =========================================================================
          LEFT SIDEBAR (Matching Reference Screenshot & Paper Design)
         ========================================================================= */}
      <aside className="flex w-[240px] shrink-0 flex-col border-r border-[#E4E4E7] dark:border-[#222226] bg-[#FAFAFA] dark:bg-[#18181A] text-xs">
        {/* Top: User Profile Menu */}
        <div className="relative px-3 pt-3.5 pb-2" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => setUserMenuOpen((o) => !o)}
            className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 hover:bg-[#EAEAEA] dark:hover:bg-[#252528] transition-colors cursor-pointer group"
          >
            <div className="flex items-center gap-2 min-w-0 mr-1">
              {/* Colorful circular avatar */}
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-[#0D99FF] via-[#7B61FF] to-[#FF6B6B] text-[11px] font-bold text-white shadow-2xs">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <span className="truncate font-semibold text-xs text-[#18181B] dark:text-white">
                {displayName}
              </span>
            </div>
            <ChevronDown
              size={12}
              className={`text-[#71717A] group-hover:text-[#18181B] dark:group-hover:text-white transition-transform duration-150 ${
                userMenuOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {/* User Popover Menu */}
          {userMenuOpen && (
            <div className="absolute left-3 top-12 z-50 w-56 rounded-xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] p-1.5 text-xs text-[#18181B] dark:text-[#EDEDED] shadow-xl animate-in fade-in zoom-in-95 duration-100">
              <div className="px-2.5 py-2 border-b border-[#E4E4E7]/60 dark:border-[#2E2E32]">
                <div className="font-semibold text-xs text-[#18181B] dark:text-white truncate">
                  {displayName}
                </div>
                <div className="text-[11px] text-[#71717A] truncate mt-0.5">
                  {user?.email || "kamrul@paper.design"}
                </div>
              </div>

              <div className="py-1">
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    setSettingsOpen(true);
                  }}
                  className="flex w-full items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-left"
                >
                  <User size={13} className="text-[#71717A]" />
                  <span>Account settings</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    setUpgradeOpen(true);
                  }}
                  className="flex w-full items-center justify-between px-2 py-1.5 rounded-lg hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-left"
                >
                  <div className="flex items-center gap-2">
                    <Sparkles size={13} className="text-amber-500" />
                    <span>Manage plan</span>
                  </div>
                  <span className="text-[10px] uppercase font-bold text-[#0D99FF] bg-[#0D99FF]/10 px-1.5 py-0.5 rounded">
                    {planOf(planId).name}
                  </span>
                </button>
              </div>

              <div className="my-1 border-t border-[#E4E4E7]/60 dark:border-[#2E2E32]" />

              <button
                type="button"
                onClick={handleSignOut}
                className="flex w-full items-center gap-2 px-2 py-1.5 rounded-lg text-[#EA4133] hover:bg-[#EA4133]/10 transition-colors cursor-pointer text-left"
              >
                <LogOut size={13} />
                <span>Log out</span>
              </button>
            </div>
          )}
        </div>

        {/* Search Bar Input */}
        <div className="px-3 pb-3">
          <div className="relative flex items-center h-8 w-full rounded-lg bg-[#ECECEE] dark:bg-[#242428] px-2.5 transition-colors focus-within:bg-white dark:focus-within:bg-[#1E1E22] focus-within:ring-1 focus-within:ring-[#0D99FF] focus-within:border-[#0D99FF]">
            <Search size={13} className="text-[#71717A] shrink-0 mr-1.5" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="w-full bg-transparent text-xs text-[#18181B] dark:text-white placeholder-[#71717A] outline-none"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-[#71717A] hover:text-[#18181B] dark:hover:text-white p-0.5 cursor-pointer"
              >
                <X size={12} />
              </button>
            ) : (
              <kbd className="hidden sm:inline-flex h-4 items-center gap-0.5 rounded border border-[#D4D4D8] dark:border-[#3F3F46] bg-white dark:bg-[#1E1E22] px-1 text-[9px] font-medium text-[#71717A] select-none">
                ⌘F
              </kbd>
            )}
          </div>
        </div>

        {/* Top Nav: Recents & Learn */}
        <nav className="px-2 space-y-0.5">
          <button
            type="button"
            onClick={() => {
              setSection("recents");
              setSearch("");
            }}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 font-medium transition-colors cursor-pointer text-left ${
              section === "recents"
                ? "bg-[#EAEAEA] dark:bg-[#26262A] text-[#18181B] dark:text-white"
                : "text-[#52525B] dark:text-[#A1A1AA] hover:bg-[#EAEAEA]/60 dark:hover:bg-[#222226] hover:text-[#18181B] dark:hover:text-white"
            }`}
          >
            <Clock size={14} className="shrink-0" />
            <span>Recents</span>
          </button>
          <button
            type="button"
            onClick={() => setLearnOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 font-medium text-[#52525B] dark:text-[#A1A1AA] hover:bg-[#EAEAEA]/60 dark:hover:bg-[#222226] hover:text-[#18181B] dark:hover:text-white transition-colors cursor-pointer text-left"
          >
            <BookOpen size={14} className="shrink-0" />
            <span>Learn</span>
          </button>
        </nav>

        {/* Team Section */}
        <div className="mt-4 px-2 space-y-0.5">
          {/* Team Header */}
          <div className="flex items-center justify-between px-2.5 py-1 text-[#71717A]">
            <div className="flex items-center gap-1.5 min-w-0">
              <Users size={13} className="shrink-0 text-[#71717A]" />
              <span className="font-semibold text-xs text-[#18181B] dark:text-white truncate">
                Kamrul&apos;s Team
              </span>
            </div>
            <button
              type="button"
              onClick={() => setUpgradeOpen(true)}
              className="rounded border border-[#D4D4D8] dark:border-[#3F3F46] bg-white dark:bg-[#222226] px-1.5 py-0.5 text-[10px] font-medium text-[#71717A] hover:text-[#0D99FF] hover:border-[#0D99FF] transition-colors cursor-pointer"
            >
              {planOf(planId).name}
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setSection("files");
              setSearch("");
            }}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 font-medium transition-colors cursor-pointer text-left ${
              section === "files"
                ? "bg-[#EAEAEA] dark:bg-[#26262A] text-[#18181B] dark:text-white"
                : "text-[#52525B] dark:text-[#A1A1AA] hover:bg-[#EAEAEA]/60 dark:hover:bg-[#222226] hover:text-[#18181B] dark:hover:text-white"
            }`}
          >
            <LayoutGrid size={14} className="shrink-0" />
            <span>Files</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSection("archive");
              setSearch("");
            }}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 font-medium transition-colors cursor-pointer text-left ${
              section === "archive"
                ? "bg-[#EAEAEA] dark:bg-[#26262A] text-[#18181B] dark:text-white"
                : "text-[#52525B] dark:text-[#A1A1AA] hover:bg-[#EAEAEA]/60 dark:hover:bg-[#222226] hover:text-[#18181B] dark:hover:text-white"
            }`}
          >
            <Archive size={14} className="shrink-0" />
            <span>Archive</span>
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 font-medium text-[#52525B] dark:text-[#A1A1AA] hover:bg-[#EAEAEA]/60 dark:hover:bg-[#222226] hover:text-[#18181B] dark:hover:text-white transition-colors cursor-pointer text-left"
          >
            <Settings size={14} className="shrink-0" />
            <span>Settings</span>
          </button>
        </div>

        {/* Spacer */}
        <div className="flex-1 min-h-4" />

        {/* Add Members Callout Widget */}
        {!teamCardMinimized && (
          <div className="mx-2.5 mb-2 rounded-xl border border-[#E4E4E7] dark:border-[#27272A] bg-white dark:bg-[#1E1E22] p-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-xs text-[#18181B] dark:text-white">
                Add members to your team
              </span>
              <button
                type="button"
                onClick={() => setTeamCardMinimized(true)}
                className="text-[#71717A] hover:text-[#18181B] dark:hover:text-white transition-colors cursor-pointer"
                title="Minimize"
              >
                <Minus size={12} />
              </button>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-[#71717A] dark:text-[#A1A1AA]">
              Paper is better with others. Add your colleagues for free.
            </p>
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#E4E4E7] dark:border-[#3F3F46] bg-white dark:bg-[#27272A] py-1.5 px-3 text-xs font-semibold text-[#18181B] dark:text-white hover:bg-[#F4F4F5] dark:hover:bg-[#323236] transition-colors cursor-pointer shadow-2xs"
            >
              <UserPlus size={12} />
              <span>Invite members</span>
            </button>
          </div>
        )}

        {/* Bottom Actions: Desktop App & Footer Links */}
        <div className="px-2.5 pb-3 pt-1 space-y-2 border-t border-[#E4E4E7]/60 dark:border-[#222226]">
          <button
            type="button"
            onClick={() => setDesktopAppOpen(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E22] py-1.5 px-3 font-medium text-[#18181B] dark:text-white hover:bg-[#F4F4F5] dark:hover:bg-[#28282C] transition-colors cursor-pointer shadow-2xs"
          >
            <Download size={13} className="text-[#71717A]" />
            <span>Get desktop app</span>
          </button>

          <div className="flex items-center justify-center gap-2 text-[11px] text-[#71717A]">
            <button
              type="button"
              onClick={() => showToast("You are on Paper v2.4 (Latest)")}
              className="hover:underline hover:text-[#18181B] dark:hover:text-white transition-colors cursor-pointer"
            >
              What&apos;s new
            </button>
            <span>•</span>
            <button
              type="button"
              onClick={() => showToast("Feedback link copied to clipboard")}
              className="hover:underline hover:text-[#18181B] dark:hover:text-white transition-colors cursor-pointer"
            >
              Feedback
            </button>
          </div>
        </div>
      </aside>

      {/* =========================================================================
          MAIN CONTENT AREA (Recents / Files / Archive)
         ========================================================================= */}
      <main className="flex-1 overflow-y-auto bg-white dark:bg-[#121214]">
        <div className="mx-auto max-w-[1400px] px-8 py-7">
          {/* Header Row: Title & Action Buttons */}
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-[#18181B] dark:text-white tracking-tight">
                {section === "archive"
                  ? "Archive"
                  : section === "files"
                  ? "Files"
                  : "Recents"}
              </h1>
              {search && (
                <span className="text-xs font-medium text-[#71717A] bg-[#F4F4F5] dark:bg-[#202024] px-2 py-0.5 rounded-full">
                  {visibleFiles.length} {visibleFiles.length === 1 ? "result" : "results"}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const picked = e.target.files?.[0];
                  e.target.value = "";
                  importJson(picked);
                }}
              />

              {/* + New file Button matching Reference Screenshot */}
              <button
                type="button"
                onClick={newFile}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-[#18181B] dark:bg-white text-white dark:text-[#18181B] hover:bg-black dark:hover:bg-zinc-200 px-3.5 text-xs font-semibold shadow-xs transition-colors cursor-pointer"
              >
                <Plus size={13} strokeWidth={2.5} />
                <span>New file</span>
              </button>

              {/* View Toggle Segmented Buttons [ ⊞ | ☰ ] */}
              <div className="flex items-center rounded-lg border border-[#E4E4E7] dark:border-[#2E2E32] bg-[#F4F4F5] dark:bg-[#1E1E22] p-0.5">
                <button
                  type="button"
                  onClick={() => setView("grid")}
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors cursor-pointer ${
                    view === "grid"
                      ? "bg-white dark:bg-[#2C2C30] text-[#18181B] dark:text-white shadow-2xs"
                      : "text-[#71717A] hover:text-[#18181B] dark:hover:text-white"
                  }`}
                  title="Grid view"
                >
                  <LayoutGrid size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setView("list")}
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors cursor-pointer ${
                    view === "list"
                      ? "bg-white dark:bg-[#2C2C30] text-[#18181B] dark:text-white shadow-2xs"
                      : "text-[#71717A] hover:text-[#18181B] dark:hover:text-white"
                  }`}
                  title="List view"
                >
                  <List size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* Files Content View */}
          {files === null ? (
            <div className="flex h-64 items-center justify-center text-xs text-[#71717A]">
              Loading files…
            </div>
          ) : visibleFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#E4E4E7] dark:border-[#2E2E32] py-20 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F4F4F5] dark:bg-[#1E1E22] text-[#71717A] mb-3">
                {section === "archive" ? <Archive size={18} /> : <FileText size={18} />}
              </div>
              <div className="text-sm font-semibold text-[#18181B] dark:text-white">
                {search
                  ? `No files matching “${search}”`
                  : section === "archive"
                  ? "No archived files"
                  : "No files yet"}
              </div>
              <p className="mt-1 max-w-sm text-xs text-[#71717A] leading-relaxed">
                {search
                  ? "Try checking your spelling or search for another keyword."
                  : section === "archive"
                  ? "Files you archive from the menu will appear here."
                  : "Create your first design document or import an existing JSON file to get started."}
              </p>
              {section !== "archive" && !search && (
                <button
                  type="button"
                  onClick={newFile}
                  className="mt-4 flex items-center gap-1.5 rounded-lg bg-[#18181B] dark:bg-white text-white dark:text-[#18181B] px-4 py-2 text-xs font-semibold shadow-xs hover:bg-black dark:hover:bg-zinc-200 transition-colors cursor-pointer"
                >
                  <Plus size={13} strokeWidth={2.5} />
                  <span>Create new file</span>
                </button>
              )}
            </div>
          ) : view === "grid" ? (
            /* ===================================================================
               GRID VIEW (Matching Figma & Paper Design Cards)
               =================================================================== */
            <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,260px))] gap-6">
              {visibleFiles.map((file) => {
                const isRenaming = renamingId === file.id;
                const isScratch = file.isScratchpad || file.title.toLowerCase().includes("scratchpad");

                return (
                  <div
                    key={file.id}
                    className="group relative flex flex-col rounded-2xl border border-[#E4E4E7] dark:border-[#27272A] bg-white dark:bg-[#18181B] overflow-hidden hover:border-[#0D99FF]/60 hover:shadow-xl dark:hover:border-[#0D99FF]/50 transition-all duration-200 cursor-pointer"
                    onClick={() => {
                      if (!isRenaming) router.push(`/file/${file.id}`);
                    }}
                  >
                    {/* Top Preview Frame (Figma / Paper Design thumbnail canvas) */}
                    <div className="relative h-[155px] w-full bg-[#F5F6F8] dark:bg-[#141416] overflow-hidden flex items-center justify-center select-none border-b border-[#E4E4E7]/60 dark:border-[#27272A]/70">
                      {/* Subtle dot grid pattern on canvas */}
                      <div
                        className="absolute inset-0 opacity-40 pointer-events-none"
                        style={{
                          backgroundImage: "radial-gradient(circle, rgba(0,0,0,0.14) 1px, transparent 1px)",
                          backgroundSize: "12px 12px",
                        }}
                      />
                      <RealCanvasThumbnail file={file} doc={docCache[file.id]} />
                    </div>

                    {/* Bottom Meta Bar */}
                    <div className="flex items-center justify-between p-3 min-h-[54px] bg-white dark:bg-[#18181B]">
                      <div className="min-w-0 flex-1 mr-2">
                        {isRenaming ? (
                          <FileTitleEditor
                            file={file}
                            onDone={() => {
                              setRenamingId(null);
                              refresh();
                            }}
                          />
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-semibold text-xs text-[#18181B] dark:text-white group-hover:text-[#0D99FF] transition-colors">
                              {file.title}
                            </span>
                            {isScratch && (
                              <span className="text-[9px] font-semibold tracking-wide uppercase text-[#71717A] bg-[#F4F4F5] dark:bg-[#27272A] px-1.5 py-0.5 rounded-sm shrink-0">
                                Draft
                              </span>
                            )}
                          </div>
                        )}
                        <div className="text-[11px] text-[#71717A] dark:text-[#A1A1AA] truncate mt-0.5">
                          {isScratch ? "Permanent draft" : formatEditedTime(file.updatedAt)}
                        </div>
                      </div>

                      {!isRenaming && (
                        <FileMenu
                          file={file}
                          onRename={() => setRenamingId(file.id)}
                          onChanged={refresh}
                          onExport={exportJson}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ===================================================================
               LIST VIEW (Clean Shadcn Data Table)
               =================================================================== */
            <div className="rounded-xl border border-[#E4E4E7] dark:border-[#222226] overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#FAFAFA] dark:bg-[#18181A] text-[#71717A] border-b border-[#E4E4E7] dark:border-[#222226]">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Name</th>
                    <th className="py-2.5 px-4 font-semibold">Last edited</th>
                    <th className="py-2.5 px-4 font-semibold">Access</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4E4E7]/60 dark:divide-[#222226]">
                  {visibleFiles.map((file) => (
                    <tr
                      key={file.id}
                      onClick={() => router.push(`/file/${file.id}`)}
                      className="hover:bg-[#F4F4F5]/60 dark:hover:bg-[#1E1E22] transition-colors cursor-pointer group"
                    >
                      <td className="py-3 px-4 font-medium text-[#18181B] dark:text-white">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-8 w-11 rounded-md border border-[#E4E4E7] dark:border-[#2E2E32] overflow-hidden shrink-0">
                            <RealCanvasThumbnail file={file} doc={docCache[file.id]} />
                          </div>
                          {renamingId === file.id ? (
                            <div className="flex-1 max-w-xs" onClick={(e) => e.stopPropagation()}>
                              <FileTitleEditor
                                file={file}
                                onDone={() => {
                                  setRenamingId(null);
                                  refresh();
                                }}
                              />
                            </div>
                          ) : (
                            <span className="truncate group-hover:text-[#0D99FF] transition-colors">
                              {file.title}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-[#71717A]">
                        {file.isScratchpad ? "Permanent draft" : formatEditedTime(file.updatedAt)}
                      </td>
                      <td className="py-3 px-4 text-[#71717A]">
                        <span className="rounded-full bg-[#F4F4F5] dark:bg-[#202024] px-2 py-0.5 text-[10px] font-medium text-[#71717A]">
                          {file.share?.access || "Private"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end">
                          <FileMenu
                            file={file}
                            onRename={() => setRenamingId(file.id)}
                            onChanged={refresh}
                            onExport={exportJson}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* =========================================================================
          DIALOGS & MODALS
         ========================================================================= */}

      {/* Invite Members Dialog */}
      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#E4E4E7]/60 dark:border-[#2E2E32]">
              <div className="flex items-center gap-2">
                <UserPlus size={16} className="text-[#0D99FF]" />
                <h3 className="font-semibold text-sm text-[#18181B] dark:text-white">
                  Invite colleagues to Kamrul&apos;s Team
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInviteOpen(false)}
                className="text-[#71717A] hover:text-[#18181B] dark:hover:text-white p-1 rounded-md"
              >
                <X size={14} />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#71717A] mb-1">
                  Email addresses
                </label>
                <input
                  type="email"
                  placeholder="colleague@company.com"
                  className="w-full h-9 rounded-lg border border-[#E4E4E7] dark:border-[#3F3F46] bg-transparent px-3 text-xs outline-none focus:border-[#0D99FF] focus:ring-1 focus:ring-[#0D99FF]"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  setInviteOpen(false);
                  showToast("Invitation sent!");
                }}
                className="w-full h-9 rounded-lg bg-[#18181B] dark:bg-white text-white dark:text-[#18181B] text-xs font-semibold hover:bg-black transition-colors"
              >
                Send invitation
              </button>

              <div className="relative my-4 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[#E4E4E7] dark:border-[#2E2E32]" />
                </div>
                <span className="relative bg-white dark:bg-[#1E1E1E] px-2 text-[10px] text-[#71717A] uppercase tracking-wider">
                  Or share invite link
                </span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value="https://paper.design/invite/team-my-team?token=k83f2a"
                  className="flex-1 h-9 rounded-lg border border-[#E4E4E7] dark:border-[#3F3F46] bg-[#F4F4F5] dark:bg-[#27272A] px-3 text-xs text-[#71717A] outline-none font-mono"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      "https://paper.design/invite/team-my-team?token=k83f2a"
                    );
                    showToast("Invite link copied to clipboard!");
                  }}
                  className="h-9 px-3 rounded-lg border border-[#E4E4E7] dark:border-[#3F3F46] hover:bg-[#F4F4F5] dark:hover:bg-[#27272A] text-xs font-medium flex items-center gap-1.5"
                >
                  <Copy size={13} />
                  <span>Copy</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Get Desktop App Dialog */}
      {desktopAppOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#E4E4E7]/60 dark:border-[#2E2E32]">
              <div className="flex items-center gap-2">
                <Laptop size={16} className="text-[#0D99FF]" />
                <h3 className="font-semibold text-sm text-[#18181B] dark:text-white">
                  Download Paper Desktop App
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDesktopAppOpen(false)}
                className="text-[#71717A] hover:text-[#18181B] dark:hover:text-white p-1 rounded-md"
              >
                <X size={14} />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <p className="text-xs text-[#71717A] leading-relaxed">
                Enjoy offline access, global font system sync, native performance, and system shortcut integrations.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setDesktopAppOpen(false);
                    showToast("Downloading Paper for macOS (Universal)…");
                  }}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl border border-[#E4E4E7] dark:border-[#3F3F46] hover:border-[#0D99FF] hover:bg-[#0D99FF]/5 transition-all text-center"
                >
                  <Download size={20} className="text-[#0D99FF]" />
                  <div>
                    <div className="text-xs font-semibold text-[#18181B] dark:text-white">
                      macOS
                    </div>
                    <div className="text-[10px] text-[#71717A]">Apple Silicon & Intel</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDesktopAppOpen(false);
                    showToast("Downloading Paper for Windows (x64)…");
                  }}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl border border-[#E4E4E7] dark:border-[#3F3F46] hover:border-[#0D99FF] hover:bg-[#0D99FF]/5 transition-all text-center"
                >
                  <Download size={20} className="text-[#0D99FF]" />
                  <div>
                    <div className="text-xs font-semibold text-[#18181B] dark:text-white">
                      Windows
                    </div>
                    <div className="text-[10px] text-[#71717A]">64-bit installer</div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Learn & Documentation Dialog */}
      {learnOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#E4E4E7]/60 dark:border-[#2E2E32]">
              <div className="flex items-center gap-2">
                <BookOpen size={16} className="text-[#0D99FF]" />
                <h3 className="font-semibold text-sm text-[#18181B] dark:text-white">
                  Learn Paper Design
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setLearnOpen(false)}
                className="text-[#71717A] hover:text-[#18181B] dark:hover:text-white p-1 rounded-md"
              >
                <X size={14} />
              </button>
            </div>

            <div className="mt-4 space-y-3.5 text-xs text-[#52525B] dark:text-[#A1A1AA] max-h-[380px] overflow-y-auto pr-1">
              <div className="p-3 rounded-xl bg-[#F4F4F5] dark:bg-[#26262A] border border-[#E4E4E7]/60">
                <div className="font-semibold text-xs text-[#18181B] dark:text-white">
                  ⚡ Auto Layout (Flexbox)
                </div>
                <div className="text-[11px] mt-1 text-[#71717A] leading-relaxed">
                  Select any layer or frame and click <strong>Add flex</strong> (or Shift+A) to convert it to a responsive flex layout with automatic padding, gap, and child alignment.
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#F4F4F5] dark:bg-[#26262A] border border-[#E4E4E7]/60">
                <div className="font-semibold text-xs text-[#18181B] dark:text-white">
                  🎨 Theme Typography & Colors
                </div>
                <div className="text-[11px] mt-1 text-[#71717A] leading-relaxed">
                  Click the 4-circle variable icon button on any Color or Font property to browse, search, and bind tokens from your central design system.
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#F4F4F5] dark:bg-[#26262A] border border-[#E4E4E7]/60">
                <div className="font-semibold text-xs text-[#18181B] dark:text-white">
                  💾 Real-time Auto-save
                </div>
                <div className="text-[11px] mt-1 text-[#71717A] leading-relaxed">
                  Every change is saved automatically with debounced syncing. You can also press <strong>Ctrl+S</strong> / <strong>Cmd+S</strong> to save instantly at any moment.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Dialog */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#E4E4E7]/60 dark:border-[#2E2E32]">
              <div className="flex items-center gap-2">
                <Settings size={16} className="text-[#0D99FF]" />
                <h3 className="font-semibold text-sm text-[#18181B] dark:text-white">
                  Workspace Settings
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="text-[#71717A] hover:text-[#18181B] dark:hover:text-white p-1 rounded-md"
              >
                <X size={14} />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block text-xs font-medium text-[#71717A] mb-1">
                  Workspace Name
                </label>
                <input
                  type="text"
                  defaultValue="Kamrul's Team"
                  className="w-full h-9 rounded-lg border border-[#E4E4E7] dark:border-[#3F3F46] bg-transparent px-3 text-xs outline-none"
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl border border-[#E4E4E7] dark:border-[#3F3F46]">
                <div>
                  <div className="font-semibold text-xs text-[#18181B] dark:text-white">
                    Current Plan: {planOf(planId).name}
                  </div>
                  <div className="text-[11px] text-[#71717A]">
                    {planId === "pro" ? "Unlimited files & AI generations" : "3 files included on Free plan"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSettingsOpen(false);
                    setUpgradeOpen(true);
                  }}
                  className="rounded-lg bg-[#0D99FF] text-white px-3 py-1.5 text-xs font-semibold hover:bg-[#0b82d8] transition-colors"
                >
                  Upgrade
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upgrade Dialog */}
      {upgradeOpen && (
        <UpgradeDialog
          planId={planId}
          onPlanChange={(next) => {
            setPlanIdState(savePlanId(next));
            showToast(
              next === "pro"
                ? "Welcome to Pro! Unlimited files unlocked."
                : "Switched back to Free plan."
            );
          }}
          onClose={() => setUpgradeOpen(false)}
        />
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 shadow-2xl text-xs font-medium flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-150"
          style={{
            background: "#18181B",
            color: "#FFFFFF",
          }}
          role="status"
        >
          <Check size={13} className="text-emerald-400" />
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
