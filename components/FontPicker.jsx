"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, Check, X } from "lucide-react";
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

export function FontPicker({
  value = "Manrope",
  onChange,
  onOpenTheme,
  themeButtonRef,
  isThemeActive = false,
  tokenName = null,
}) {
  const [open, setOpen] = useState(false);
  const [fonts, setFonts] = useState(DEFAULT_POPULAR_FONTS);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [displayCount, setDisplayCount] = useState(60);
  const [coords, setCoords] = useState({ x: 0, y: 0, width: 280, ready: false });

  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const searchInputRef = useRef(null);
  const listRef = useRef(null);

  // Ensure current font is loaded on initial render
  useEffect(() => {
    if (value) {
      loadGoogleFont(value);
    }
  }, [value]);

  // Load the full catalog of ~1,968 Google fonts
  useEffect(() => {
    getGoogleFontsCatalog().then((catalog) => {
      if (Array.isArray(catalog) && catalog.length > 0) {
        setFonts(catalog);
      }
    });
  }, []);

  // Compute position relative to the trigger input
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const pad = 12;
    const popoverWidth = Math.max(rect.width, 280);
    const popoverHeight = 360;

    let x = rect.left;
    let y = rect.bottom + 4;

    if (x + popoverWidth > window.innerWidth - pad) {
      x = Math.max(pad, window.innerWidth - popoverWidth - pad);
    }
    if (y + popoverHeight > window.innerHeight - pad) {
      // Place above if overflowing bottom
      y = Math.max(pad, rect.top - popoverHeight - 4);
    }

    setCoords({ x, y, width: popoverWidth, ready: true });
  }, [open]);

  // Focus search input when popover opens
  useEffect(() => {
    if (open) {
      setDisplayCount(60);
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
    setSearch("");
  }, [open]);

  // Click outside and Escape key handling
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Filtered fonts based on search query and category
  const filteredFonts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return fonts.filter((f) => {
      const matchCat = category === "all" || f.category === category;
      if (!matchCat) return false;
      if (!q) return true;
      return f.family.toLowerCase().includes(q);
    });
  }, [fonts, search, category]);

  const displayedFonts = useMemo(() => {
    return filteredFonts.slice(0, displayCount);
  }, [filteredFonts, displayCount]);

  // Preload visible font previews in the dropdown
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      // Preload first 20 fonts for instant preview
      displayedFonts.slice(0, 20).forEach((f) => {
        loadGoogleFont(f.family, f.variants);
      });
    }, 100);
    return () => clearTimeout(timer);
  }, [open, displayedFonts]);

  // Infinite scroll loader
  const handleScroll = (e) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
      if (displayCount < filteredFonts.length) {
        setDisplayCount((prev) => Math.min(prev + 50, filteredFonts.length));
      }
    }
  };

  const handleSelect = (font) => {
    loadGoogleFont(font.family, font.variants);
    onChange(font.family);
    setOpen(false);
  };

  return (
    <>
      {/* Closed Trigger Input */}
      <div
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        className="relative flex h-[var(--row-field-h)] items-center justify-between rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] transition-colors cursor-pointer select-none"
        title="Choose font family"
      >
        <div className="flex items-center gap-2 overflow-hidden mr-2 min-w-0">
          <span className="font-serif italic font-semibold text-[13px] text-[var(--text-2)] select-none shrink-0">
            𝐹
          </span>
          <span
            style={{ fontFamily: value || "sans-serif" }}
            className="truncate text-xs font-medium text-[var(--text-1)]"
            title={tokenName ? `Variable: ${tokenName}` : value}
          >
            {tokenName || value || "Manrope"}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-1">
          {onOpenTheme && (
            <button
              ref={themeButtonRef}
              type="button"
              data-token-popover-trigger="true"
              onClick={(e) => {
                e.stopPropagation();
                onOpenTheme();
              }}
              className={`flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer ${
                isThemeActive || Boolean(tokenName)
                  ? "text-[var(--accent)]"
                  : ""
              }`}
              title="Theme font variables"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
              >
                <circle cx="4" cy="4" r="1.8" />
                <circle cx="10" cy="4" r="1.8" />
                <circle cx="4" cy="10" r="1.8" />
                <circle cx="10" cy="10" r="1.8" />
              </svg>
            </button>
          )}
          <ChevronDown
            size={11}
            className={`text-[var(--text-2)] shrink-0 transition-transform duration-150 ${
              open ? "rotate-180" : ""
            }`}
          />
        </div>
      </div>

      {/* Popover Dropdown Portal */}
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[10002] flex flex-col rounded-2xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] text-[13px] text-[#18181B] dark:text-[#EDEDED] shadow-2xl animate-in fade-in zoom-in-95 duration-100 overflow-hidden"
            style={{
              left: `${coords.x}px`,
              top: `${coords.y}px`,
              width: `${coords.width}px`,
              maxHeight: "360px",
              opacity: coords.ready ? 1 : 0,
            }}
          >
            {/* Header: Search input */}
            <div className="p-2 border-b border-[#E4E4E7] dark:border-[#2E2E32]">
              <div className="relative flex items-center h-8 w-full rounded-lg bg-[#F4F4F5] dark:bg-[#27272A] px-2.5">
                <Search size={13} className="text-[#71717A] dark:text-[#A1A1AA] shrink-0 mr-1.5" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setDisplayCount(60);
                  }}
                  placeholder={`Search ${fonts.length > 50 ? `${fonts.length.toLocaleString()} ` : ""}fonts…`}
                  className="w-full bg-transparent text-xs text-[#18181B] dark:text-white placeholder-[#71717A] outline-none"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setDisplayCount(60);
                      searchInputRef.current?.focus();
                    }}
                    className="text-[#71717A] hover:text-[#18181B] dark:hover:text-white p-0.5 cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Category filter pills */}
              <div className="flex items-center gap-1 mt-1.5 overflow-x-auto no-scrollbar py-0.5">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setCategory(cat.id);
                      setDisplayCount(60);
                    }}
                    className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors cursor-pointer shrink-0 ${
                      category === cat.id
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
              ref={listRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto no-scrollbar p-1.5 space-y-0.5 max-h-[250px]"
            >
              {displayedFonts.length === 0 ? (
                <div className="py-6 text-center text-xs text-[#71717A]">
                  No fonts matching &ldquo;{search}&rdquo;
                </div>
              ) : (
                displayedFonts.map((font) => {
                  const isSelected = font.family === value;
                  return (
                    <button
                      key={font.family}
                      type="button"
                      onClick={() => handleSelect(font)}
                      onMouseEnter={() => loadGoogleFont(font.family, font.variants)}
                      className={`flex w-full items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                        isSelected
                          ? "bg-[#0D99FF]/10 text-[#0D99FF] font-medium"
                          : "hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] text-[#18181B] dark:text-[#EDEDED]"
                      }`}
                    >
                      <div className="flex flex-col min-w-0 mr-2 flex-1">
                        <span
                          style={{ fontFamily: font.family }}
                          className="text-[13px] truncate leading-tight"
                        >
                          {font.family}
                        </span>
                        <span className="text-[10px] text-[#A1A1AA] dark:text-[#71717A] capitalize font-mono leading-none mt-0.5">
                          {font.category}
                        </span>
                      </div>
                      {isSelected && (
                        <Check
                          size={14}
                          className="text-[#0D99FF] shrink-0"
                          strokeWidth={2.2}
                        />
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer font counter */}
            <div className="shrink-0 px-3 py-1.5 border-t border-[#E4E4E7]/80 dark:border-[#2C2C2E] flex items-center justify-between text-[10px] text-[#71717A]">
              <span>
                Showing {Math.min(displayedFonts.length, filteredFonts.length)} of{" "}
                {filteredFonts.length.toLocaleString()}
              </span>
              <span>Google Fonts</span>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
