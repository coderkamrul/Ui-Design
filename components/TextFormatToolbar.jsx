"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Palette,
  RemoveFormatting,
  ChevronDown,
  Search,
  Check,
  X,
} from "lucide-react";
import {
  DEFAULT_POPULAR_FONTS,
  getGoogleFontsCatalog,
  loadGoogleFont,
} from "@/lib/google-fonts";

const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "sans-serif", label: "Sans" },
  { id: "serif", label: "Serif" },
  { id: "display", label: "Display" },
  { id: "handwriting", label: "Script" },
  { id: "monospace", label: "Mono" },
];

const PRESET_COLORS = [
  "#000000",
  "#FFFFFF",
  "#64748B",
  "#3F74EE",
  "#0D99FF",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
];

export default function TextFormatToolbar({
  coords,
  activeFormats = {},
  defaultFontFamily = "Inter",
  onApplyStyle,
  onClearFormatting,
  onClose,
  onInteractionStart,
  onInteractionEnd,
}) {
  const [mounted, setMounted] = useState(false);
  const [showFontMenu, setShowFontMenu] = useState(false);
  const [showColorMenu, setShowColorMenu] = useState(false);
  const [fonts, setFonts] = useState(DEFAULT_POPULAR_FONTS);
  const [fontSearch, setFontSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [displayCount, setDisplayCount] = useState(60);
  const [customColor, setCustomColor] = useState("#3F74EE");
  const toolbarRef = useRef(null);
  const fontSearchInputRef = useRef(null);

  useEffect(() => {
    setMounted(true);
    // Fetch full catalog of ~1,968 Google fonts
    getGoogleFontsCatalog().then((catalog) => {
      if (Array.isArray(catalog) && catalog.length > 0) {
        setFonts(catalog);
      }
    });
  }, []);

  const currentFont = activeFormats.fontFamily || defaultFontFamily || "Inter";

  useEffect(() => {
    if (currentFont) {
      loadGoogleFont(currentFont);
    }
  }, [currentFont]);

  const filteredFonts = useMemo(() => {
    let list = fonts;
    if (category !== "all") {
      list = list.filter((f) => f.category === category);
    }
    if (fontSearch.trim()) {
      const q = fontSearch.toLowerCase();
      list = list.filter((f) => f.family.toLowerCase().includes(q));
    }
    return list;
  }, [fonts, category, fontSearch]);

  const displayedFonts = useMemo(
    () => filteredFonts.slice(0, displayCount),
    [filteredFonts, displayCount],
  );

  const handleFontScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 100) {
      setDisplayCount((prev) => prev + 40);
    }
  };

  if (!mounted || !coords) return null;

  // Position floating toolbar directly above selection (centered horizontally)
  const toolbarWidth = 360;
  let left = coords.x - toolbarWidth / 2;
  left = Math.max(16, Math.min(window.innerWidth - toolbarWidth - 16, left));
  let top = coords.y - 48;
  if (top < 16) {
    // If too close to viewport top, flip below selection
    top = coords.bottom ? coords.bottom + 10 : coords.y + 36;
  }

  const preventBlur = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onInteractionStart?.();
  };

  return createPortal(
    <div
      ref={toolbarRef}
      data-rich-text-toolbar="true"
      onPointerDown={preventBlur}
      onMouseDown={preventBlur}
      style={{ left: `${left}px`, top: `${top}px` }}
      className="fixed z-[99999] flex items-center gap-0.5 rounded-full bg-[#18181B]/95 dark:bg-[#1E1E1E]/95 text-white p-1 shadow-2xl border border-white/10 backdrop-blur-md select-none text-xs animate-in fade-in zoom-in-95 duration-100"
    >
      {/* Font Family Trigger */}
      <div className="relative">
        <button
          type="button"
          onPointerDown={(e) => {
            preventBlur(e);
            onInteractionStart?.();
          }}
          onMouseDown={(e) => {
            preventBlur(e);
            onInteractionStart?.();
          }}
          onClick={() => {
            onInteractionStart?.();
            setShowFontMenu((v) => {
              const next = !v;
              if (next) {
                setDisplayCount(60);
                setTimeout(() => fontSearchInputRef.current?.focus(), 50);
              }
              return next;
            });
            setShowColorMenu(false);
          }}
          className="flex h-7 items-center gap-1.5 px-2.5 rounded-full hover:bg-white/15 transition-colors cursor-pointer text-xs font-medium max-w-[130px]"
          title={`Font: ${currentFont}`}
        >
          <span className="truncate" style={{ fontFamily: currentFont }}>
            {currentFont}
          </span>
          <ChevronDown
            size={11}
            className={`shrink-0 text-white/60 transition-transform duration-150 ${
              showFontMenu ? "rotate-180" : ""
            }`}
          />
        </button>

        {showFontMenu && (
          <div
            data-rich-text-toolbar="true"
            onPointerDown={(e) => {
              e.stopPropagation();
              onInteractionStart?.();
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              onInteractionStart?.();
            }}
            className="absolute left-0 bottom-full mb-2 w-72 max-h-[350px] rounded-2xl bg-[#18181B] border border-white/15 shadow-2xl overflow-hidden flex flex-col p-1.5 z-50 text-xs"
          >
            {/* Search Input */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 mb-1.5">
              <Search size={13} className="text-white/50 shrink-0" />
              <input
                ref={fontSearchInputRef}
                type="text"
                value={fontSearch}
                onChange={(e) => {
                  setFontSearch(e.target.value);
                  setDisplayCount(60);
                }}
                onFocus={() => onInteractionStart?.()}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onInteractionStart?.();
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  onInteractionStart?.();
                }}
                placeholder={`Search ${fonts.length > 50 ? `${fonts.length.toLocaleString()} ` : ""}fonts…`}
                className="w-full bg-transparent text-white text-xs outline-none placeholder:text-white/40"
              />
              {fontSearch && (
                <button
                  type="button"
                  onClick={() => {
                    setFontSearch("");
                    setDisplayCount(60);
                    fontSearchInputRef.current?.focus();
                  }}
                  className="text-white/50 hover:text-white p-0.5 cursor-pointer"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Category Filter Pills */}
            <div className="flex items-center gap-1 mb-1.5 overflow-x-auto no-scrollbar px-1 py-0.5 shrink-0">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onPointerDown={preventBlur}
                  onMouseDown={preventBlur}
                  onClick={() => {
                    setCategory(cat.id);
                    setDisplayCount(60);
                  }}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors cursor-pointer shrink-0 ${
                    category === cat.id
                      ? "bg-[#0D99FF] text-white"
                      : "bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Font List */}
            <div
              onScroll={handleFontScroll}
              className="flex-1 overflow-y-auto space-y-0.5 max-h-[220px] pr-0.5"
            >
              {/* Custom font option if search doesn't match */}
              {fontSearch.trim() &&
                !filteredFonts.some(
                  (f) =>
                    f.family.toLowerCase() === fontSearch.trim().toLowerCase(),
                ) && (
                  <button
                    type="button"
                    onPointerDown={preventBlur}
                    onMouseDown={preventBlur}
                    onClick={() => {
                      const custom = fontSearch.trim();
                      loadGoogleFont(custom);
                      onApplyStyle({ fontFamily: custom });
                      setShowFontMenu(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg truncate cursor-pointer transition-colors bg-[#0D99FF]/20 border border-[#0D99FF]/50 text-white hover:bg-[#0D99FF]/30 font-medium mb-1"
                  >
                    Use font &ldquo;{fontSearch.trim()}&rdquo;
                  </button>
                )}

              {displayedFonts.length === 0 ? (
                <div className="py-6 text-center text-xs text-white/50">
                  No fonts matching &ldquo;{fontSearch}&rdquo;
                </div>
              ) : (
                displayedFonts.map((f) => {
                  const isSelected =
                    f.family.toLowerCase() === currentFont.toLowerCase();
                  return (
                    <button
                      key={f.family}
                      type="button"
                      onPointerDown={preventBlur}
                      onMouseDown={preventBlur}
                      onClick={() => {
                        loadGoogleFont(f.family, f.variants);
                        onApplyStyle({ fontFamily: f.family });
                        setShowFontMenu(false);
                      }}
                      onMouseEnter={() => loadGoogleFont(f.family, f.variants)}
                      className={`flex w-full items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                        isSelected
                          ? "bg-[#0D99FF]/25 text-[#0D99FF] font-medium"
                          : "text-white/85 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <div className="flex flex-col min-w-0 mr-2 flex-1">
                        <span
                          style={{ fontFamily: f.family }}
                          className="text-xs truncate leading-tight"
                        >
                          {f.family}
                        </span>
                        <span className="text-[10px] text-white/40 capitalize font-mono leading-none mt-0.5">
                          {f.category}
                        </span>
                      </div>
                      {isSelected && (
                        <Check
                          size={14}
                          className="text-[#0D99FF] shrink-0"
                          strokeWidth={2.4}
                        />
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="shrink-0 px-2.5 pt-1.5 pb-0.5 border-t border-white/10 flex items-center justify-between text-[10px] text-white/45">
              <span>
                Showing {Math.min(displayedFonts.length, filteredFonts.length)} of{" "}
                {filteredFonts.length.toLocaleString()}
              </span>
              <span>Google Fonts</span>
            </div>
          </div>
        )}
      </div>

      <div className="h-4 w-px bg-white/15 mx-0.5" />

      {/* Bold */}
      <button
        type="button"
        onPointerDown={preventBlur}
        onMouseDown={preventBlur}
        onClick={() => {
          onApplyStyle({ fontWeight: activeFormats.isBold ? "normal" : "700" });
        }}
        className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors cursor-pointer ${
          activeFormats.isBold
            ? "bg-[#0D99FF] text-white"
            : "text-white/80 hover:bg-white/15 hover:text-white"
        }`}
        title="Bold (Ctrl+B)"
      >
        <Bold size={13} strokeWidth={2.6} />
      </button>

      {/* Italic */}
      <button
        type="button"
        onPointerDown={preventBlur}
        onMouseDown={preventBlur}
        onClick={() => {
          onApplyStyle({ fontStyle: activeFormats.isItalic ? "normal" : "italic" });
        }}
        className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors cursor-pointer ${
          activeFormats.isItalic
            ? "bg-[#0D99FF] text-white"
            : "text-white/80 hover:bg-white/15 hover:text-white"
        }`}
        title="Italic (Ctrl+I)"
      >
        <Italic size={13} strokeWidth={2.4} />
      </button>

      {/* Underline */}
      <button
        type="button"
        onPointerDown={preventBlur}
        onMouseDown={preventBlur}
        onClick={() => {
          onApplyStyle({ textDecoration: activeFormats.isUnderline ? "none" : "underline" });
        }}
        className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors cursor-pointer ${
          activeFormats.isUnderline
            ? "bg-[#0D99FF] text-white"
            : "text-white/80 hover:bg-white/15 hover:text-white"
        }`}
        title="Underline (Ctrl+U)"
      >
        <Underline size={13} strokeWidth={2.4} />
      </button>

      {/* Strikethrough */}
      <button
        type="button"
        onPointerDown={preventBlur}
        onMouseDown={preventBlur}
        onClick={() => {
          onApplyStyle({ textDecoration: activeFormats.isStrike ? "none" : "line-through" });
        }}
        className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors cursor-pointer ${
          activeFormats.isStrike
            ? "bg-[#0D99FF] text-white"
            : "text-white/80 hover:bg-white/15 hover:text-white"
        }`}
        title="Strikethrough"
      >
        <Strikethrough size={13} strokeWidth={2.4} />
      </button>

      <div className="h-4 w-px bg-white/15 mx-0.5" />

      {/* Color Picker Popover */}
      <div className="relative">
        <button
          type="button"
          onPointerDown={preventBlur}
          onMouseDown={preventBlur}
          onClick={() => {
            setShowColorMenu((v) => !v);
            setShowFontMenu(false);
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/15 transition-colors cursor-pointer"
          title="Text Color"
        >
          <div
            className="w-4 h-4 rounded-full border border-white/30 shadow-xs"
            style={{ backgroundColor: activeFormats.color || "#FFFFFF" }}
          />
        </button>

        {showColorMenu && (
          <div
            data-rich-text-toolbar="true"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-48 rounded-xl bg-[#18181B] border border-white/15 shadow-2xl p-2.5 z-50 text-xs flex flex-col gap-2"
          >
            <div className="text-[11px] font-medium text-white/60">Color presets</div>
            <div className="grid grid-cols-5 gap-1.5">
              {PRESET_COLORS.map((col) => (
                <button
                  key={col}
                  type="button"
                  onPointerDown={preventBlur}
                  onMouseDown={preventBlur}
                  onClick={() => {
                    onApplyStyle({ color: col });
                    setShowColorMenu(false);
                  }}
                  className="w-6 h-6 rounded-md border border-white/20 hover:scale-110 transition-transform cursor-pointer shadow-xs"
                  style={{ backgroundColor: col }}
                />
              ))}
            </div>
            <div className="flex items-center gap-1.5 pt-1 border-t border-white/10">
              <input
                type="color"
                value={customColor}
                onChange={(e) => {
                  setCustomColor(e.target.value);
                  onApplyStyle({ color: e.target.value });
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onInteractionStart?.();
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  onInteractionStart?.();
                }}
                className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer"
              />
              <input
                type="text"
                value={customColor}
                onChange={(e) => {
                  setCustomColor(e.target.value);
                  if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) {
                    onApplyStyle({ color: e.target.value });
                  }
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onInteractionStart?.();
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  onInteractionStart?.();
                }}
                className="flex-1 bg-white/10 rounded px-1.5 py-1 text-white text-[11px] font-mono outline-none border border-white/10"
                placeholder="#3F74EE"
              />
            </div>
          </div>
        )}
      </div>

      <div className="h-4 w-px bg-white/15 mx-0.5" />

      {/* Clear Formatting */}
      <button
        type="button"
        onPointerDown={preventBlur}
        onMouseDown={preventBlur}
        onClick={onClearFormatting}
        className="flex h-7 w-7 items-center justify-center rounded-full text-white/70 hover:bg-white/15 hover:text-white transition-colors cursor-pointer"
        title="Clear Formatting"
      >
        <RemoveFormatting size={13} strokeWidth={2.2} />
      </button>
    </div>,
    document.body,
  );
}
