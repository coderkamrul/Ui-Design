"use client";

/**
 * Theme tab (M2) — full CRUD over the file's design tokens.
 *
 * Matches the layout and styling of our build:
 * - Header with token count, search toggle, and category add menu (+).
 * - Empty state with "Theme tokens", "Create tokens to get started...",
 *   "Create token" and "Use starter theme" (90 starter tokens).
 * - Category accordion: Color, Opacity, Radius, Spacing, Container,
 *   Breakpoint, Font family, Font weight, Font size, Line height, Letter spacing.
 * - Each row renders: Category-specific icon + Name on left, formatted Value on right.
 * - Floating Token Editor popover on click matching user's exact popup HTML and SVGs:
 *   - Duplicate, Delete, and Close header SVGs.
 *   - Live preview box (Color swatch, scaled Quick brown fox, or big light-gray {val} px).
 *   - Name & Value rows with Tailwind v4 presets dropdown combobox.
 *   - Color Value input with embedded swatch, hex input, 100% opacity, and 4-dots variable button.
 *   - ThemeColorPopover matches the exact width of the Color Value input.
 */
import { useState, useRef, useEffect } from "react";
import {
  Search,
  Plus,
  LayoutGrid,
  ChevronRight,
  ChevronDown,
  Square,
  Grid,
  Maximize2,
  ArrowUpRight,
  Monitor,
  Folder,
  Check,
} from "lucide-react";
import {
  DEFAULT_POPULAR_FONTS,
  getGoogleFontsCatalog,
  loadGoogleFont,
} from "@/lib/google-fonts";
import { TOKEN_TYPES, getToken, resolveToken } from "@/lib/model";
import { useEditorStore } from "@/lib/store";
import ColorPickerModal from "./ColorPickerModal";
import ThemeColorPopover from "./ThemeColorPopover";

const TYPE_LABELS = {
  color: "Color",
  opacity: "Opacity",
  radius: "Radius",
  spacing: "Spacing",
  container: "Container",
  breakpoint: "Breakpoint",
  fontFamily: "Font family",
  fontWeight: "Font weight",
  fontSize: "Font size",
  lineHeight: "Line height",
  letterSpacing: "Letter spacing",
};

const DEFAULT_TOKEN_VALUES = {
  color: "#3b82f6",
  opacity: "100%",
  radius: "8",
  spacing: "16",
  container: "1280",
  breakpoint: "768",
  fontFamily: "Inter",
  fontWeight: "400",
  fontSize: "16",
  lineHeight: "1.5",
  letterSpacing: "0",
};

const CATEGORY_ITEMS = [
  { id: "color", label: "Color", icon: "square" },
  { id: "opacity", label: "Opacity", icon: "grid" },
  { id: "radius", label: "Radius", icon: "maximize" },
  { id: "spacing", label: "Spacing", icon: "arrow" },
  { id: "container", label: "Container", icon: "container" },
  { id: "breakpoint", label: "Breakpoint", icon: "monitor" },
  { id: "fontFamily", label: "Font family", icon: "font" },
  { id: "fontWeight", label: "Font weight", icon: "weight" },
  { id: "fontSize", label: "Font size", icon: "size" },
  { id: "lineHeight", label: "Line height", icon: "line" },
  { id: "letterSpacing", label: "Letter spacing", icon: "tracking" },
];

const TAILWIND_V4_PRESETS = {
  radius: [
    { label: "none", value: "0" },
    { label: "xs", value: "2" },
    { label: "sm", value: "4" },
    { label: "md", value: "6" },
    { label: "lg", value: "8" },
    { label: "xl", value: "12" },
    { label: "2xl", value: "16" },
    { label: "3xl", value: "24" },
    { label: "full", value: "9999" },
  ],
  fontSize: [
    { label: "xs", value: "12" },
    { label: "sm", value: "14" },
    { label: "base", value: "16" },
    { label: "lg", value: "18" },
    { label: "xl", value: "20" },
    { label: "2xl", value: "24" },
    { label: "3xl", value: "30" },
    { label: "4xl", value: "36" },
    { label: "5xl", value: "48" },
    { label: "6xl", value: "60" },
    { label: "7xl", value: "72" },
    { label: "8xl", value: "96" },
  ],
  breakpoint: [
    { label: "sm", value: "640" },
    { label: "md", value: "768" },
    { label: "lg", value: "1024" },
    { label: "xl", value: "1280" },
    { label: "2xl", value: "1536" },
  ],
  container: [
    { label: "sm", value: "640" },
    { label: "md", value: "768" },
    { label: "lg", value: "1024" },
    { label: "xl", value: "1280" },
    { label: "2xl", value: "1536" },
  ],
  spacing: [
    { label: "0", value: "0" },
    { label: "0.5", value: "2" },
    { label: "1", value: "4" },
    { label: "1.5", value: "6" },
    { label: "2", value: "8" },
    { label: "2.5", value: "10" },
    { label: "3", value: "12" },
    { label: "3.5", value: "14" },
    { label: "4", value: "16" },
    { label: "5", value: "20" },
    { label: "6", value: "24" },
    { label: "7", value: "28" },
    { label: "8", value: "32" },
    { label: "9", value: "36" },
    { label: "10", value: "40" },
    { label: "11", value: "44" },
    { label: "12", value: "48" },
    { label: "14", value: "56" },
    { label: "16", value: "64" },
    { label: "20", value: "80" },
    { label: "24", value: "96" },
  ],
  opacity: [
    { label: "0", value: "0%" },
    { label: "5", value: "5%" },
    { label: "10", value: "10%" },
    { label: "20", value: "20%" },
    { label: "25", value: "25%" },
    { label: "30", value: "30%" },
    { label: "40", value: "40%" },
    { label: "50", value: "50%" },
    { label: "60", value: "60%" },
    { label: "70", value: "70%" },
    { label: "75", value: "75%" },
    { label: "80", value: "80%" },
    { label: "90", value: "90%" },
    { label: "95", value: "95%" },
    { label: "100", value: "100%" },
  ],
  fontWeight: [
    { label: "thin", value: "100" },
    { label: "extralight", value: "200" },
    { label: "light", value: "300" },
    { label: "normal", value: "400" },
    { label: "medium", value: "500" },
    { label: "semibold", value: "600" },
    { label: "bold", value: "700" },
    { label: "extrabold", value: "800" },
    { label: "black", value: "900" },
  ],
  lineHeight: [
    { label: "none", value: "100%" },
    { label: "tight", value: "125%" },
    { label: "snug", value: "137.5%" },
    { label: "normal", value: "150%" },
    { label: "relaxed", value: "162.5%" },
    { label: "loose", value: "200%" },
  ],
  letterSpacing: [
    { label: "tighter", value: "-0.05em" },
    { label: "tight", value: "-0.025em" },
    { label: "normal", value: "0em" },
    { label: "wide", value: "0.025em" },
    { label: "wider", value: "0.05em" },
    { label: "widest", value: "0.1em" },
  ],
  fontFamily: [
    { label: "sans", value: "Inter, ui-sans-serif, system-ui, sans-serif" },
    { label: "serif", value: "ui-serif, Georgia, Cambria, serif" },
    { label: "mono", value: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  ],
};

function renderTokenRowIcon(type, item, resolved) {
  if (type === "color") {
    return (
      <div
        style={{ backgroundColor: String(resolved || item.value) }}
        className="h-3.5 w-3.5 shrink-0 rounded-[3px] border border-black/10 dark:border-white/10 shadow-2xs"
      />
    );
  }
  if (type === "opacity") {
    return (
      <div className="grid grid-cols-2 gap-0.5 h-3.5 w-3.5 shrink-0 place-content-center text-[#71717A]">
        <span className="h-1 w-1 rounded-[0.5px] bg-current" />
        <span className="h-1 w-1 rounded-[0.5px] bg-current opacity-40" />
        <span className="h-1 w-1 rounded-[0.5px] bg-current opacity-40" />
        <span className="h-1 w-1 rounded-[0.5px] bg-current" />
      </div>
    );
  }
  if (type === "radius") {
    return (
      <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" className="shrink-0 text-[#71717A]">
        <path d="M2.5 9.5V5.5a3 3 0 0 1 3-3h4" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "spacing") {
    return (
      <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" className="shrink-0 text-[#71717A]">
        <path d="M3.5 8.5L8.5 3.5M8.5 3.5H4.5M8.5 3.5V7.5" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "container") {
    return (
      <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" className="shrink-0 text-[#71717A]">
        <rect x="2" y="2" width="3" height="8" rx="0.5" strokeWidth="1.2" />
        <rect x="7" y="2" width="3" height="8" rx="0.5" strokeWidth="1.2" />
      </svg>
    );
  }
  if (type === "breakpoint") {
    return (
      <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" className="shrink-0 text-[#71717A]">
        <rect x="1.5" y="2.5" width="9" height="6" rx="0.8" strokeWidth="1.2" />
        <path d="M4.5 10.5h3" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "fontFamily") {
    return (
      <span className="w-3.5 shrink-0 text-center font-serif italic text-[12px] leading-none text-[#71717A]">
        𝐹
      </span>
    );
  }
  if (type === "fontWeight") {
    return (
      <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" className="shrink-0 text-[#71717A]">
        <path d="M3.5 9.5L6 2.5L8.5 9.5M4.5 7.5h3M1.5 11h9" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "fontSize") {
    return (
      <span className="w-3.5 shrink-0 text-center text-[10px] font-sans font-medium tracking-tighter leading-none text-[#71717A]">
        ↕A
      </span>
    );
  }
  if (type === "lineHeight") {
    return (
      <span className="w-3.5 shrink-0 text-center text-[10px] font-sans font-medium tracking-tighter leading-none text-[#71717A]">
        ¯A
      </span>
    );
  }
  if (type === "letterSpacing") {
    return (
      <span className="w-3.5 shrink-0 text-center text-[10px] font-sans font-medium tracking-tighter leading-none text-[#71717A]">
        |A|
      </span>
    );
  }
  return (
    <span className="w-3.5 shrink-0 text-center font-mono text-[11px] text-[#71717A]">
      #
    </span>
  );
}

export default function ThemePanel({ sidebarWidth = 240, tokens: propTokens }) {
  const doc = useEditorStore((s) => s.doc);
  const tokens = propTokens || doc?.tokens || [];
  const addToken = useEditorStore((s) => s.addToken);
  const updateToken = useEditorStore((s) => s.updateToken);
  const deleteToken = useEditorStore((s) => s.deleteToken);
  const applyStarterTheme = useEditorStore((s) => s.applyStarterTheme);

  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [editingToken, setEditingToken] = useState(null);
  const [editorPos, setEditorPos] = useState({ top: 90, left: 248 });
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [aliasDropdownOpen, setAliasDropdownOpen] = useState(false);
  const [valueDropdownOpen, setValueDropdownOpen] = useState(false);
  const [hexInput, setHexInput] = useState("");
  const [isEditingHex, setIsEditingHex] = useState(false);
  const [isEditingAlpha, setIsEditingAlpha] = useState(false);
  const [alphaInputVal, setAlphaInputVal] = useState("100");
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const [message, setMessage] = useState(null);

  // Google Fonts API state for font family token value selection
  const [googleFonts, setGoogleFonts] = useState(DEFAULT_POPULAR_FONTS);
  const [fontSearch, setFontSearch] = useState("");
  const [fontCategory, setFontCategory] = useState("all");
  const [fontDisplayCount, setFontDisplayCount] = useState(50);
  const fontSearchInputRef = useRef(null);
  const fontListRef = useRef(null);

  useEffect(() => {
    getGoogleFontsCatalog().then((catalog) => {
      if (Array.isArray(catalog) && catalog.length > 0) {
        setGoogleFonts(catalog);
      }
    });
  }, []);

  useEffect(() => {
    if (editingToken?.type === "fontFamily" && editingToken?.value) {
      loadGoogleFont(String(editingToken.value));
    }
  }, [editingToken?.type, editingToken?.value]);

  const toggleCategory = (catId) => {
    setCollapsedCategories((prev) => ({
      ...prev,
      [catId]: !prev[catId],
    }));
  };

  const addMenuRef = useRef(null);
  const editorRef = useRef(null);
  const colorValueContainerRef = useRef(null);
  const valueDropdownRef = useRef(null);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (isAddMenuOpen && addMenuRef.current && !addMenuRef.current.contains(e.target)) {
        setIsAddMenuOpen(false);
      }
      if (valueDropdownOpen && valueDropdownRef.current && !valueDropdownRef.current.contains(e.target)) {
        setValueDropdownOpen(false);
      }
    };
    window.addEventListener("mousedown", handleOutsideClick);
    return () => window.removeEventListener("mousedown", handleOutsideClick);
  }, [isAddMenuOpen, valueDropdownOpen]);

  const handleCreateToken = (type = "color") => {
    setIsAddMenuOpen(false);
    const existingCount = tokens.filter((t) => t.type === type).length;
    const name = `${type}-${existingCount + 1}`;
    const newId = `tok_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const defaultValue = DEFAULT_TOKEN_VALUES[type] ?? "";
    const newToken = {
      id: newId,
      name,
      type,
      value: defaultValue,
    };
    addToken(newToken);
    setEditingToken(newToken);
    setCollapsedCategories((prev) => ({
      ...prev,
      [type]: false,
    }));
  };

  const handleDuplicateToken = (e) => {
    e?.stopPropagation?.();
    if (!editingToken) return;
    const newName = `${editingToken.name} copy`;
    const newId = `tok_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const newToken = {
      ...editingToken,
      id: newId,
      name: newName,
    };
    addToken(newToken);
    setEditingToken(newToken);
  };

  const handleDeleteToken = (e) => {
    e?.stopPropagation?.();
    if (!editingToken) return;
    deleteToken(editingToken.id);
    setEditingToken(null);
    setColorPickerOpen(false);
    setAliasDropdownOpen(false);
    setValueDropdownOpen(false);
  };

  const filteredTokens = searchQuery.trim()
    ? tokens.filter(
        (t) =>
          t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          String(t.value).toLowerCase().includes(searchQuery.toLowerCase())
      )
    : tokens;

  const renderTokenRow = (item) => {
    const isSelected = editingToken?.id === item.id;
    const resolved = resolveToken(tokens, item.id);
    const isColor = item.type === "color";

    return (
      <div
        key={item.id}
        data-token-row={item.id}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const isColorToken = isColor || item.type === "color";
          const estimatedH = isColorToken ? 360 : 255;
          const maxTop = window.innerHeight - estimatedH - 12;
          const top = Math.max(12, Math.min(maxTop, rect.top));
          setEditorPos({ top, left: sidebarWidth + 8 });
          setEditingToken(item);
          setColorPickerOpen(false);
          setAliasDropdownOpen(false);
          setValueDropdownOpen(false);
          setIsEditingHex(false);
        }}
        className={`flex cursor-pointer items-center justify-between rounded-[4px] py-1 text-left transition-colors ${
          isSelected
            ? "bg-[#EAEAEA] dark:bg-zinc-800 font-medium text-[#18181B] dark:text-white"
            : "text-[#18181B] dark:text-zinc-200 hover:bg-[#F4F4F5] dark:hover:bg-zinc-800/60"
        }`}
        style={{
          paddingLeft: "8px",
          paddingRight: "8px",
          height: "26px",
        }}
        title="Click to edit token"
      >
        {/* Left: Category Icon + Token Name */}
        <div className="flex flex-1 items-center gap-2 overflow-hidden mr-2 min-w-0">
          {renderTokenRowIcon(item.type, item, resolved)}
          <span className="truncate text-[12px]">
            {item.name}
          </span>
        </div>

        {/* Right: Value */}
        <span className="shrink-0 font-mono text-[11px] text-[#71717A]">
          {item.aliasOf
            ? `→ ${getToken(tokens, item.aliasOf)?.name ?? "alias"}`
            : isColor && typeof item.value === "string" && item.value.startsWith("#")
            ? item.value.toUpperCase()
            : String(item.value)}
        </span>
      </div>
    );
  };

  return (
    <div className="flex flex-1 min-h-0 h-full w-full flex-col text-xs font-sans select-none relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 relative">
        <span className="text-[12px] font-normal text-[#18181B] dark:text-zinc-200">
          {tokens.length === 0 ? "No tokens" : `${tokens.length} tokens`}
        </span>
        <div className="flex items-center gap-1.5 text-[#71717A]">
          <button
            type="button"
            onClick={() => setShowSearch(!showSearch)}
            className={`rounded p-1 transition-colors cursor-pointer ${
              showSearch
                ? "bg-[var(--surface-hover)] text-[#18181B] dark:text-white"
                : "hover:bg-[var(--surface-hover)] hover:text-[#18181B] dark:hover:text-white"
            }`}
            title="Search tokens"
          >
            <Search size={13} strokeWidth={1.5} />
          </button>

          {/* Plus Button with Category Menu */}
          <div className="relative" ref={addMenuRef}>
            <button
              type="button"
              onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
              className={`rounded p-1 transition-colors cursor-pointer ${
                isAddMenuOpen
                  ? "bg-[var(--text-1)] text-white"
                  : "hover:bg-[var(--surface-hover)] hover:text-[#18181B] dark:hover:text-white"
              }`}
              title="Add token category"
            >
              <Plus size={14} strokeWidth={1.5} />
            </button>

            {isAddMenuOpen && (
              <div className="absolute right-0 top-7 z-50 flex w-44 flex-col rounded-xl border border-[var(--line)] bg-[var(--surface-content)] py-1 text-xs text-[var(--text-1)] shadow-xl animate-in fade-in zoom-in-95 duration-100">
                {CATEGORY_ITEMS.map((cat, i) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => handleCreateToken(cat.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[var(--surface-hover)] ${
                      i === 3 || i === 6 ? "border-t border-[var(--line)] mt-0.5 pt-1.5" : ""
                    }`}
                  >
                    <span className="w-4 text-center text-[var(--text-2)] flex items-center justify-center">
                      {cat.id === "color" && <Square size={12} />}
                      {cat.id === "opacity" && <Grid size={12} />}
                      {cat.id === "radius" && <Maximize2 size={12} />}
                      {cat.id === "spacing" && <ArrowUpRight size={13} />}
                      {cat.id === "container" && "⊞"}
                      {cat.id === "breakpoint" && <Monitor size={12} />}
                      {cat.id === "fontFamily" && "𝐹"}
                      {cat.id === "fontWeight" && "A↔"}
                      {cat.id === "fontSize" && "↕A"}
                      {cat.id === "lineHeight" && "¯A"}
                      {cat.id === "letterSpacing" && "|A|"}
                    </span>
                    <span>{cat.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {showSearch && (
        <div className="border-b border-[var(--line)] p-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tokens…"
            className="h-[var(--row-field-h)] w-full rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 text-xs text-[var(--text-1)] outline-none"
            autoFocus
          />
        </div>
      )}

      {message && (
        <div className="flex items-center justify-between bg-[var(--surface-hover)] px-3 py-1.5 text-[var(--type-micro)] text-[var(--text-2)]">
          <span>{message}</span>
          <button
            type="button"
            onClick={() => setMessage(null)}
            className="hover:text-[var(--text-1)]"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
        {tokens.length === 0 ? (
          /* Empty state */
          <div className="flex h-full flex-col items-center justify-center p-6 text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--surface-hover)] text-[var(--text-2)]">
              <LayoutGrid size={28} />
            </div>
            <span className="mb-1 text-sm font-semibold text-[var(--text-1)]">
              Theme tokens
            </span>
            <p className="mb-5 max-w-[190px] text-[11px] leading-relaxed text-[var(--text-2)]">
              Create tokens to get started, or explore the starter theme.
            </p>
            <div className="flex w-full max-w-[180px] flex-col gap-2">
              <button
                type="button"
                onClick={() => handleCreateToken("color")}
                className="w-full rounded-md border border-[var(--line)] bg-[var(--surface-content)] py-1.5 px-3 text-xs font-medium text-[var(--text-1)] shadow-sm hover:bg-[var(--surface-hover)] transition-colors"
              >
                Create token
              </button>
              <button
                type="button"
                onClick={() => {
                  const added = applyStarterTheme();
                  setMessage(
                    added > 0
                      ? `Starter theme added (${added} tokens).`
                      : "Starter theme already applied."
                  );
                }}
                className="w-full rounded-md border border-[var(--line)] bg-[var(--surface-hover)] py-1.5 px-3 text-xs font-medium text-[var(--text-1)] transition-colors hover:bg-[var(--line)]"
              >
                Use starter theme
              </button>
            </div>
          </div>
        ) : (
          /* Categories List: ONLY renders categories that have tokens (> 0) */
          <div className="py-1">
            {CATEGORY_ITEMS.map((cat) => {
              const catTokens = filteredTokens.filter((t) => t.type === cat.id);
              if (catTokens.length === 0) return null;
              const isCollapsed = collapsedCategories[cat.id];

              return (
                <div key={cat.id} className="flex flex-col pb-1">
                  {/* Category Header */}
                  <div
                    onClick={() => toggleCategory(cat.id)}
                    className="flex cursor-pointer items-center justify-between px-3 py-1 text-[12px] font-normal text-[#18181B] dark:text-zinc-200 hover:bg-[var(--surface-hover)] transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      {isCollapsed ? (
                        <ChevronRight size={12} className="text-[#71717A]" />
                      ) : (
                        <ChevronDown size={12} className="text-[#71717A]" />
                      )}
                      <span>{cat.label}</span>
                    </div>
                    <span className="font-mono text-[11px] text-[#71717A]">
                      {catTokens.length}
                    </span>
                  </div>

                  {/* Category Tokens Flat List - indented inside category */}
                  {!isCollapsed && (
                    <div className="flex flex-col gap-0.5 pl-4 pr-1.5 pb-1">
                      {catTokens.map(renderTokenRow)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Token Editor Popover matching user's exact popup HTML and SVGs */}
      {editingToken && (
        <>
          <div
            ref={editorRef}
            data-token-editor="true"
            style={{ left: `${editorPos.left}px`, top: `${editorPos.top}px`, width: "300px" }}
            className="fixed z-50 flex flex-col gap-2.5 rounded-2xl border border-[#D4D4D8] dark:border-[var(--line)] bg-[#F4F4F5] dark:bg-[var(--surface-content)] p-3 text-xs text-[#18181B] dark:text-[var(--text-1)] shadow-2xl animate-in fade-in zoom-in-95 duration-100 font-sans"
          >
            {/* Header with Category Tab & User's exact Header SVGs */}
            <div className="flex items-center justify-between pb-0.5">
              <span className="rounded-t-md bg-white dark:bg-[var(--surface-hover)] px-3 py-1 font-medium text-xs text-[#18181B] dark:text-[var(--text-1)] border-t border-l border-r border-[#E4E4E7] dark:border-[var(--line)] shadow-2xs">
                {editingToken.type === "color" ? "Color" : TYPE_LABELS[editingToken.type] || editingToken.type}
              </span>
              <div className="grow" />
              <div className="flex items-center gap-1 text-[#71717A] dark:text-[var(--text-2)]">
                {/* Duplicate button */}
                <button
                  type="button"
                  onClick={handleDuplicateToken}
                  className="rounded p-1 hover:bg-[#E0E0E2] dark:hover:bg-[var(--surface-hover)] hover:text-[#18181B] dark:hover:text-[var(--text-1)] transition-colors cursor-pointer"
                  title="Duplicate token"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M4.5 0C3.67156 -3.62122e-08 3 0.67157 3 1.5L3 3H4V1.5C4 1.22386 4.22386 1 4.5 1L10.5 1C10.7761 1 11 1.22386 11 1.5V7.5C11 7.77614 10.7761 8 10.5 8H9V4.5C9 3.67158 8.32847 3 7.5 3L1.5 3C0.6717 3 2.9848e-07 3.67158 2.62268e-07 4.5L0 10.5C-3.62105e-08 11.3284 0.6717 12 1.5 12H7.5C8.32847 12 9 11.3284 9 10.5V9H10.5C11.3284 9 12 8.3284 12 7.5V1.5C12 0.67157 11.3284 2.9848e-07 10.5 2.62268e-07L4.5 0ZM7.5 4C7.77618 4 8 4.22386 8 4.5V10.5C8 10.7761 7.77618 11 7.5 11H1.5C1.2239 11 1 10.7761 1 10.5L1 4.5C1 4.22386 1.2239 4 1.5 4L7.5 4Z"></path>
                    <path d="M4.5 5.5V7.5M4.5 9.5V7.5M4.5 7.5H2.5M4.5 7.5H6.5" stroke="currentColor" fill="none"></path>
                  </svg>
                </button>
                {/* Delete button */}
                <button
                  type="button"
                  onClick={handleDeleteToken}
                  className="rounded p-1 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer"
                  title="Delete token"
                >
                  <svg width="11" height="12" viewBox="0 0 11 12" fill="none" stroke="currentColor" strokeLinecap="round">
                    <path d="M0 2.5H1.5M11 2.5H9.5M3 2.5L3.72361 1.05279C3.893 0.714002 4.23926 0.5 4.61803 0.5L6.38197 0.5C6.76074 0.5 7.107 0.714002 7.27639 1.05279L8 2.5M3 2.5H8M3 2.5H1.5M8 2.5H9.5M9.5 2.5L9.05247 10.5555C9.02303 11.0854 8.58475 11.5 8.05401 11.5H2.94599C2.41525 11.5 1.97697 11.0854 1.94753 10.5555L1.5 2.5"></path>
                  </svg>
                </button>
                {/* Close button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingToken(null);
                    setColorPickerOpen(false);
                    setAliasDropdownOpen(false);
                    setValueDropdownOpen(false);
                  }}
                  className="rounded p-1 hover:bg-[#E0E0E2] dark:hover:bg-[var(--surface-hover)] hover:text-[#18181B] dark:hover:text-[var(--text-1)] transition-colors cursor-pointer"
                  title="Close editor"
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeLinecap="round">
                    <path d="M0.465332 0.46447L4.00087 4M4.00087 4L7.53641 7.5355M4.00087 4L7.53641 0.46447M4.00087 4L0.465332 7.5355" vectorEffect="non-scaling-stroke"></path>
                  </svg>
                </button>
              </div>
            </div>

            {/* Big Live Preview Box */}
            {editingToken.type === "color" ? (
              <div
                onClick={() => setColorPickerOpen((prev) => !prev)}
                style={{ backgroundColor: String(editingToken.value) }}
                className="h-36 w-full rounded-xl border border-black/10 dark:border-[var(--line)] shadow-2xs cursor-pointer hover:ring-2 hover:ring-[#0D99FF] transition-all"
                title="Click to toggle color picker"
              />
            ) : editingToken.type === "fontSize" ? (
              <div className="flex h-36 w-full items-center justify-center overflow-hidden rounded-xl border border-[#E4E4E7] dark:border-[var(--line)] bg-white dark:bg-[var(--surface-content)] p-3 text-center">
                <span
                  style={{ fontSize: `${Math.min(54, Math.max(11, Number(editingToken.value) || 16))}px` }}
                  className="text-[#18181B] dark:text-[var(--text-1)] font-sans font-medium select-none truncate"
                >
                  Quick brown fox
                </span>
              </div>
            ) : editingToken.type === "letterSpacing" ? (
              <div className="flex h-36 w-full items-center justify-center overflow-hidden rounded-xl border border-[#E4E4E7] dark:border-[var(--line)] bg-white dark:bg-[var(--surface-content)] p-3 text-center">
                <span
                  style={{ letterSpacing: String(editingToken.value) }}
                  className="text-2xl text-[#18181B] dark:text-[var(--text-1)] font-sans font-medium select-none truncate"
                >
                  Quick brown fox
                </span>
              </div>
            ) : editingToken.type === "fontFamily" ? (
              <div className="flex h-36 w-full items-center justify-center overflow-hidden rounded-xl border border-[#E4E4E7] dark:border-[var(--line)] bg-white dark:bg-[var(--surface-content)] p-3 text-center">
                <span
                  style={{ fontFamily: String(editingToken.value) }}
                  className="text-2xl text-[#18181B] dark:text-[var(--text-1)] font-medium select-none truncate"
                >
                  Quick brown fox
                </span>
              </div>
            ) : editingToken.type === "fontWeight" ? (
              <div className="flex h-36 w-full items-center justify-center overflow-hidden rounded-xl border border-[#E4E4E7] dark:border-[var(--line)] bg-white dark:bg-[var(--surface-content)] p-3 text-center">
                <span
                  style={{ fontWeight: editingToken.value }}
                  className="text-2xl text-[#18181B] dark:text-[var(--text-1)] select-none truncate"
                >
                  Quick brown fox
                </span>
              </div>
            ) : editingToken.type === "lineHeight" ? (
              <div className="flex h-36 w-full items-center justify-center overflow-hidden rounded-xl border border-[#E4E4E7] dark:border-[var(--line)] bg-white dark:bg-[var(--surface-content)] p-3 text-center">
                <span
                  style={{ lineHeight: String(editingToken.value).includes("%") ? editingToken.value : `${editingToken.value}%` }}
                  className="text-base text-[#18181B] dark:text-[var(--text-1)] font-medium select-none text-center"
                >
                  Quick brown fox<br />jumps over lazy dog
                </span>
              </div>
            ) : editingToken.type === "opacity" ? (
              <div className="flex h-36 w-full items-center justify-center rounded-xl border border-[#E4E4E7] dark:border-[var(--line)] bg-[#1F1F1F]">
                <span
                  style={{ opacity: (parseFloat(editingToken.value) || 100) / 100 }}
                  className="font-mono text-3xl font-bold text-white select-none"
                >
                  {String(editingToken.value).replace("%", "")}%
                </span>
              </div>
            ) : (
              /* radius, breakpoint, spacing, container: Big centered light gray text matching Image 8 */
              <div className="flex h-36 w-full items-center justify-center rounded-xl border border-[#E4E4E7] dark:border-[var(--line)] bg-white dark:bg-[var(--surface-content)] font-mono text-[32px] text-zinc-300 dark:text-zinc-600 select-none">
                {String(editingToken.value).replace(/\s*px$/i, "")}&thinsp;px
              </div>
            )}

            {/* Name Input */}
            <div className="flex items-center gap-2">
              <span className="w-12 shrink-0 font-normal text-[#71717A] dark:text-[var(--text-2)] text-xs">
                Name
              </span>
              <input
                type="text"
                value={editingToken.name}
                onChange={(e) => {
                  const nextName = e.target.value;
                  setEditingToken({ ...editingToken, name: nextName });
                  updateToken(editingToken.id, { name: nextName });
                }}
                className="flex-1 h-8 rounded-lg border border-[#E4E4E7] dark:border-[var(--line)] bg-white dark:bg-[var(--surface-content)] px-2.5 text-xs text-[#18181B] dark:text-[var(--text-1)] outline-none focus:border-[#0D99FF] focus:ring-1 focus:ring-[#0D99FF]/20"
                placeholder="Token name…"
              />
            </div>

            {/* Value Input */}
            <div className="flex items-center gap-2">
              <span className="w-12 shrink-0 font-normal text-[#71717A] dark:text-[var(--text-2)] text-xs">
                Value
              </span>
              {editingToken.type === "color" ? (
                /* Color Value: Full-width container matching Name input, with 4-dots inside on right */
                <div className="relative flex-1" ref={colorValueContainerRef}>
                  <div
                    className={`flex h-8 w-full items-center justify-between rounded-lg border bg-white dark:bg-[var(--surface-content)] px-2.5 text-xs transition-all ${
                      colorPickerOpen || isEditingHex || aliasDropdownOpen
                        ? "border-[#0D99FF] ring-2 ring-[#0D99FF]/20"
                        : "border-[#E4E4E7] dark:border-[var(--line)] hover:border-zinc-400"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {/* Square Color Swatch */}
                      <div
                        onClick={() => setColorPickerOpen((prev) => !prev)}
                        style={{ backgroundColor: String(editingToken.value) }}
                        className="h-4 w-4 shrink-0 rounded-[3px] border border-black/15 dark:border-white/20 shadow-2xs cursor-pointer hover:scale-105 transition-transform"
                        title="Click to toggle color picker"
                      />
                      {/* Hex input or variable name */}
                      {editingToken.aliasOf && !isEditingHex ? (
                        <span
                          onClick={() => setAliasDropdownOpen(true)}
                          className="text-xs font-medium text-[var(--text-1)] truncate block cursor-pointer select-none"
                          title={`Variable: ${getToken(tokens, editingToken.aliasOf)?.name ?? editingToken.aliasName ?? editingToken.aliasOf}`}
                        >
                          {getToken(tokens, editingToken.aliasOf)?.name ?? editingToken.aliasName ?? editingToken.aliasOf}
                        </span>
                      ) : (
                        <input
                          type="text"
                          value={isEditingHex ? hexInput : String(editingToken.value).replace("#", "").toUpperCase()}
                          onFocus={(e) => {
                            setIsEditingHex(true);
                            setHexInput(String(editingToken.value).replace("#", "").toUpperCase());
                            e.target.select();
                          }}
                          onChange={(e) => {
                            const val = e.target.value;
                            setHexInput(val);
                            let h = val.trim().replace("#", "");
                            if (/^[0-9A-Fa-f]{6}$/.test(h)) {
                              const newHex = `#${h.toUpperCase()}`;
                              setEditingToken((prev) => ({ ...prev, value: newHex, aliasOf: undefined, aliasName: undefined }));
                              updateToken(editingToken.id, { value: newHex, aliasOf: undefined, aliasName: undefined });
                            }
                          }}
                          onBlur={() => {
                            setIsEditingHex(false);
                            let h = hexInput.trim().replace("#", "");
                            if (/^[0-9A-Fa-f]{3}$/.test(h)) {
                              h = h.split("").map((c) => c + c).join("");
                            }
                            if (/^[0-9A-Fa-f]{6}$/.test(h)) {
                              const newHex = `#${h.toUpperCase()}`;
                              setEditingToken((prev) => ({ ...prev, value: newHex, aliasOf: undefined, aliasName: undefined }));
                              updateToken(editingToken.id, { value: newHex, aliasOf: undefined, aliasName: undefined });
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.target.blur();
                            if (e.key === "Escape") setIsEditingHex(false);
                          }}
                          className="w-16 font-mono text-xs uppercase font-medium outline-none bg-transparent text-[#18181B] dark:text-[var(--text-1)] select-all cursor-text"
                          title="Click to edit hex code"
                        />
                      )}
                    </div>

                    {/* Opacity % - interactive input */}
                    <div className="flex items-center shrink-0 ml-1">
                      <input
                        type="text"
                        value={isEditingAlpha ? alphaInputVal : `${Math.round((editingToken.alpha ?? 1) * 100)}%`}
                        onFocus={(e) => {
                          setIsEditingAlpha(true);
                          setAlphaInputVal(String(Math.round((editingToken.alpha ?? 1) * 100)));
                          e.target.select();
                        }}
                        onChange={(e) => {
                          setAlphaInputVal(e.target.value.replace(/[^0-9]/g, ""));
                        }}
                        onBlur={() => {
                          setIsEditingAlpha(false);
                          const parsed = parseInt(alphaInputVal, 10);
                          const nextAlpha = isNaN(parsed) ? 1 : Math.max(0, Math.min(100, parsed)) / 100;
                          setEditingToken((prev) => ({ ...prev, alpha: nextAlpha }));
                          updateToken(editingToken.id, { alpha: nextAlpha });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.target.blur();
                          if (e.key === "Escape") setIsEditingAlpha(false);
                        }}
                        className="w-10 font-mono text-xs text-[#71717A] dark:text-[var(--text-2)] text-right outline-none bg-transparent select-all cursor-text hover:text-[#18181B] dark:hover:text-white"
                        title="Click to edit opacity %"
                      />
                    </div>

                    {/* Theme Variable Button (Selection colors 4-circle outline icon) */}
                    <button
                      type="button"
                      data-token-popover-trigger="true"
                      onClick={() => setAliasDropdownOpen((prev) => !prev)}
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors cursor-pointer ml-1.5 ${
                        aliasDropdownOpen || editingToken.aliasOf
                          ? "text-[#0D99FF]"
                          : "text-[#71717A] hover:text-[#18181B] dark:text-zinc-400 dark:hover:text-white"
                      }`}
                      title="Select defined variable / theme token"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                        <circle cx="4" cy="4" r="1.8" />
                        <circle cx="10" cy="4" r="1.8" />
                        <circle cx="4" cy="10" r="1.8" />
                        <circle cx="10" cy="10" r="1.8" />
                      </svg>
                    </button>
                  </div>

                  {/* Defined variables dropdown matching exact Value field width */}
                  {aliasDropdownOpen && (
                    <ThemeColorPopover
                      triggerRef={colorValueContainerRef}
                      tokens={tokens}
                      currentColor={String(editingToken.value)}
                      selectedId={editingToken.aliasOf}
                      onSelectToken={(selectedTok) => {
                        setEditingToken({
                          ...editingToken,
                          aliasOf: selectedTok.id || selectedTok.name,
                          aliasName: selectedTok.name,
                          value: selectedTok.value,
                        });
                        updateToken(editingToken.id, {
                          aliasOf: selectedTok.id || selectedTok.name,
                          aliasName: selectedTok.name,
                          value: selectedTok.value,
                        });
                        setAliasDropdownOpen(false);
                      }}
                      onClose={() => setAliasDropdownOpen(false)}
                      className="shadow-2xl"
                    />
                  )}
                </div>
              ) : (
                /* Non-color Tokens: Combobox with text input + Tailwind v4 presets dropdown */
                <div className="relative flex-1" ref={valueDropdownRef}>
                  <div
                    className={`flex h-8 w-full items-center justify-between rounded-lg border bg-white dark:bg-[var(--surface-content)] px-2.5 text-xs transition-all ${
                      valueDropdownOpen
                        ? "border-[#0D99FF] ring-2 ring-[#0D99FF]/20"
                        : "border-[#E4E4E7] dark:border-[var(--line)] hover:border-zinc-400"
                    }`}
                  >
                    <input
                      type="text"
                      value={editingToken.value ?? ""}
                      onFocus={() => setValueDropdownOpen(true)}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEditingToken({ ...editingToken, value: val });
                        updateToken(editingToken.id, { value: val });
                      }}
                      className="flex-1 font-mono text-xs outline-none bg-transparent text-[#18181B] dark:text-[var(--text-1)]"
                      placeholder="Value…"
                    />
                    <button
                      type="button"
                      onClick={() => setValueDropdownOpen((prev) => !prev)}
                      className="flex h-5 w-5 shrink-0 items-center justify-center text-[#71717A] hover:text-[#18181B] dark:text-zinc-400 dark:hover:text-white transition-colors cursor-pointer"
                      title="Toggle presets"
                    >
                      <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="currentColor">
                        <path d="M0.75 1.5L4 4.75L7.25 1.5" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>

                  {/* Dropdown presets with auto-flip to top when not enough space below */}
                  {valueDropdownOpen && (
                    editingToken.type === "fontFamily" ? (() => {
                      const rect = valueDropdownRef.current?.getBoundingClientRect();
                      const openUp = typeof window !== "undefined" && rect && (window.innerHeight - rect.bottom < 290) && (rect.top > 290);

                      const filteredFonts = googleFonts.filter((f) => {
                        const matchCat =
                          fontCategory === "all" ||
                          f.category?.toLowerCase() === fontCategory.toLowerCase();
                        const matchSearch =
                          !fontSearch || f.family.toLowerCase().includes(fontSearch.toLowerCase());
                        return matchCat && matchSearch;
                      });
                      const displayedFonts = filteredFonts.slice(0, fontDisplayCount);

                      const FONT_CATEGORIES = [
                        { id: "all", label: "All" },
                        { id: "sans-serif", label: "Sans" },
                        { id: "serif", label: "Serif" },
                        { id: "display", label: "Display" },
                        { id: "handwriting", label: "Script" },
                        { id: "monospace", label: "Mono" },
                      ];

                      return (
                        <div
                          className={`absolute right-0 z-50 w-[265px] rounded-xl border border-[#E4E4E7] dark:border-[var(--line)] bg-white dark:bg-[#1E1E1E] text-xs text-[#18181B] dark:text-[var(--text-1)] shadow-2xl animate-in fade-in zoom-in-95 duration-100 flex flex-col overflow-hidden ${
                            openUp ? "bottom-full mb-1.5" : "top-full mt-1.5"
                          }`}
                        >
                          {/* Search bar */}
                          <div className="p-2 border-b border-[#E4E4E7] dark:border-[var(--line)]">
                            <div className="relative flex items-center h-7 w-full rounded-lg bg-[#F4F4F5] dark:bg-zinc-800/80 px-2">
                              <Search size={12} className="text-[#71717A] shrink-0 mr-1.5" />
                              <input
                                ref={fontSearchInputRef}
                                type="text"
                                value={fontSearch}
                                onChange={(e) => {
                                  setFontSearch(e.target.value);
                                  setFontDisplayCount(50);
                                }}
                                placeholder={`Search ${googleFonts.length > 50 ? `${googleFonts.length.toLocaleString()} ` : ""}fonts…`}
                                className="w-full bg-transparent text-xs text-[#18181B] dark:text-white placeholder-[#71717A] outline-none"
                              />
                              {fontSearch && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFontSearch("");
                                    setFontDisplayCount(50);
                                  }}
                                  className="text-[#71717A] hover:text-[#18181B] dark:hover:text-white p-0.5"
                                >
                                  ×
                                </button>
                              )}
                            </div>

                            {/* Category filter pills */}
                            <div className="flex items-center gap-1 mt-1.5 overflow-x-auto no-scrollbar py-0.5">
                              {FONT_CATEGORIES.map((cat) => (
                                <button
                                  key={cat.id}
                                  type="button"
                                  onClick={() => {
                                    setFontCategory(cat.id);
                                    setFontDisplayCount(50);
                                  }}
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors cursor-pointer shrink-0 ${
                                    fontCategory === cat.id
                                      ? "bg-[#0D99FF] text-white"
                                      : "bg-transparent text-[#71717A] hover:text-[#18181B] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10"
                                  }`}
                                >
                                  {cat.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Font List */}
                          <div
                            ref={fontListRef}
                            onScroll={(e) => {
                              const el = e.currentTarget;
                              if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
                                setFontDisplayCount((prev) => Math.min(prev + 50, filteredFonts.length));
                              }
                            }}
                            className="overflow-y-auto no-scrollbar p-1 max-h-[210px] space-y-0.5"
                          >
                            {/* System Tailwind presets if no search and All category */}
                            {!fontSearch && fontCategory === "all" && (
                              <div className="mb-1 pb-1 border-b border-[#E4E4E7] dark:border-[var(--line)]">
                                <div className="px-2 py-0.5 text-[9px] font-bold text-[#71717A] uppercase tracking-wider">
                                  System Presets
                                </div>
                                {TAILWIND_V4_PRESETS.fontFamily.map((preset) => {
                                  const isSelected = String(editingToken.value) === String(preset.value);
                                  return (
                                    <button
                                      key={preset.label}
                                      type="button"
                                      onClick={() => {
                                        setEditingToken({ ...editingToken, value: preset.value });
                                        updateToken(editingToken.id, { value: preset.value });
                                        setValueDropdownOpen(false);
                                      }}
                                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1 text-left text-xs transition-colors cursor-pointer ${
                                        isSelected
                                          ? "bg-[#0D99FF]/10 text-[#0D99FF] font-medium"
                                          : "hover:bg-[#F4F4F5] dark:hover:bg-zinc-800/60 text-[#18181B] dark:text-zinc-200"
                                      }`}
                                    >
                                      <span className="font-mono">{preset.label}</span>
                                      <span className="font-mono text-[#71717A] text-[10px] truncate max-w-[140px]">{preset.value}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            {/* Google Fonts Section Header */}
                            {!fontSearch && fontCategory === "all" && (
                              <div className="px-2 py-0.5 text-[9px] font-bold text-[#71717A] uppercase tracking-wider">
                                Google Fonts
                              </div>
                            )}

                            {displayedFonts.length === 0 ? (
                              <div className="py-6 text-center text-xs text-[#71717A]">
                                No fonts matching &ldquo;{fontSearch}&rdquo;
                              </div>
                            ) : (
                              displayedFonts.map((font) => {
                                const isSelected = font.family === editingToken.value;
                                return (
                                  <button
                                    key={font.family}
                                    type="button"
                                    onClick={() => {
                                      loadGoogleFont(font.family, font.variants);
                                      setEditingToken({ ...editingToken, value: font.family });
                                      updateToken(editingToken.id, { value: font.family });
                                      setValueDropdownOpen(false);
                                    }}
                                    onMouseEnter={() => loadGoogleFont(font.family, font.variants)}
                                    className={`flex w-full items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                                      isSelected
                                        ? "bg-[#0D99FF]/10 text-[#0D99FF] font-medium"
                                        : "hover:bg-[#F4F4F5] dark:hover:bg-zinc-800/60 text-[#18181B] dark:text-zinc-200"
                                    }`}
                                  >
                                    <div className="flex flex-col min-w-0 mr-2 flex-1">
                                      <span
                                        style={{ fontFamily: font.family }}
                                        className="text-[13px] truncate leading-tight"
                                      >
                                        {font.family}
                                      </span>
                                      <span className="text-[10px] text-[#71717A] capitalize font-mono leading-none mt-0.5">
                                        {font.category}
                                      </span>
                                    </div>
                                    {isSelected && (
                                      <Check
                                        size={13}
                                        className="text-[#0D99FF] shrink-0"
                                        strokeWidth={2.2}
                                      />
                                    )}
                                  </button>
                                );
                              })
                            )}
                          </div>

                          {/* Footer */}
                          <div className="shrink-0 px-3 py-1.5 border-t border-[#E4E4E7] dark:border-[var(--line)] flex items-center justify-between text-[10px] text-[#71717A]">
                            <span>
                              Showing {Math.min(displayedFonts.length, filteredFonts.length)} of {filteredFonts.length.toLocaleString()}
                            </span>
                            <span>Google Fonts</span>
                          </div>
                        </div>
                      );
                    })() : TAILWIND_V4_PRESETS[editingToken.type] ? (() => {
                      const rect = valueDropdownRef.current?.getBoundingClientRect();
                      const openUp = typeof window !== "undefined" && rect && (window.innerHeight - rect.bottom < 220) && (rect.top > 220);
                      return (
                        <div className={`absolute left-0 z-50 max-h-[220px] w-full overflow-y-auto no-scrollbar rounded-xl border border-[#E4E4E7] dark:border-[var(--line)] bg-white dark:bg-[#1E1E1E] p-1 text-xs text-[#18181B] dark:text-[var(--text-1)] shadow-xl animate-in fade-in zoom-in-95 duration-100 ${
                          openUp ? "bottom-full mb-1.5" : "top-full mt-1.5"
                        }`}>
                          {TAILWIND_V4_PRESETS[editingToken.type].map((preset) => {
                            const isSelected = String(editingToken.value) === String(preset.value);
                            return (
                              <button
                                key={preset.label + preset.value}
                                type="button"
                                onClick={() => {
                                  const nextVal =
                                    isNaN(Number(preset.value)) ||
                                    preset.value.endsWith("%") ||
                                    preset.value.endsWith("em")
                                      ? preset.value
                                      : Number(preset.value);
                                  setEditingToken({ ...editingToken, value: nextVal });
                                  updateToken(editingToken.id, { value: nextVal });
                                  setValueDropdownOpen(false);
                                }}
                                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                                  isSelected
                                    ? "bg-[#EAEAEA] dark:bg-zinc-800 font-semibold text-[#18181B] dark:text-white"
                                    : "hover:bg-[#F4F4F5] dark:hover:bg-zinc-800/60 text-[#18181B] dark:text-zinc-200"
                                }`}
                              >
                                <span className="font-mono">{preset.label}</span>
                                <span className="font-mono text-[#71717A] text-[11px]">{preset.value}</span>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })() : null
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Color Picker Modal docked side-by-side to the right/left of token editor */}
          {colorPickerOpen && editingToken.type === "color" && (
            <ColorPickerModal
              color={String(editingToken.value)}
              alpha={1}
              onChange={(newHex) => {
                setEditingToken({ ...editingToken, value: newHex, aliasOf: undefined });
                updateToken(editingToken.id, { value: newHex, aliasOf: undefined });
              }}
              onClose={() => setColorPickerOpen(false)}
              position={{
                exactLeft:
                  typeof window !== "undefined" && editorPos.left + 300 + 8 + 440 > window.innerWidth
                    ? Math.max(10, editorPos.left - 440 - 8)
                    : editorPos.left + 300 + 8,
                exactTop: editorPos.top,
              }}
              ignoreClickRef={editorRef}
            />
          )}
        </>
      )}
    </div>
  );
}
