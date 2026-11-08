"use client";

import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Check, Search, Unlink } from "lucide-react";
import { useEditorStore } from "@/lib/store";
import { loadGoogleFont } from "@/lib/google-fonts";

const DEFAULT_FONT_FAMILY_TOKENS = [
  {
    name: "Font / Sans",
    value: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },
  {
    name: "Font / Serif",
    value: "Georgia, 'Times New Roman', serif",
  },
  {
    name: "Font / Mono",
    value: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  },
  {
    name: "Font / Inter",
    value: "Inter, sans-serif",
  },
  {
    name: "Font / Playfair",
    value: "Playfair Display, serif",
  },
];

export default function ThemeFontPopover({
  tokens = [],
  currentFont = "Manrope",
  selectedTokenId = null,
  selectedTokenName = null,
  onSelectToken,
  onDetachToken,
  onClose,
  className = "",
  triggerRef = null,
}) {
  const sentinelRef = useRef(null);
  const popoverRef = useRef(null);
  const searchInputRef = useRef(null);
  const [mounted, setMounted] = useState(false);
  const [search, setSearch] = useState("");
  const [coords, setCoords] = useState({
    top: 0,
    left: 0,
    width: 280,
    maxHeight: 360,
    ready: false,
    openAbove: false,
  });

  const addToken = useEditorStore((s) => s.addToken);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Collect font family tokens from doc tokens
  const docFontTokens = (tokens || [])
    .filter((t) => t.type === "fontFamily")
    .map((t) => ({ id: t.id, name: t.name, value: t.value }));

  // Combined available font family tokens
  const existingNames = new Set(
    docFontTokens.map((t) => (t.name || "").toLowerCase().trim())
  );
  const availableTokens = [
    ...docFontTokens,
    ...DEFAULT_FONT_FAMILY_TOKENS.filter(
      (t) => !existingNames.has(t.name.toLowerCase().trim())
    ),
  ];

  // Load preview fonts when popover mounts
  useEffect(() => {
    availableTokens.forEach((t) => {
      if (t.value && !t.value.includes(",")) {
        loadGoogleFont(t.value);
      }
    });
  }, [availableTokens.length]);

  // Compute dynamic coordinates relative to triggerRef
  useLayoutEffect(() => {
    if (!mounted || typeof window === "undefined") return;

    const computeCoords = () => {
      const anchor =
        triggerRef?.current ||
        sentinelRef.current?.parentElement ||
        sentinelRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const popoverWidth = 280;
      const popoverHeight = 360;
      const pad = 12;

      const spaceBelow = window.innerHeight - rect.bottom - pad;
      const spaceAbove = rect.top - pad;

      const openAbove =
        (spaceBelow < 330 && spaceAbove > 200) ||
        (spaceBelow < 180 && spaceAbove > spaceBelow);

      let top;
      let maxHeight;

      if (openAbove) {
        maxHeight = Math.min(popoverHeight, Math.max(160, spaceAbove - 6));
        top = Math.max(pad, rect.top - maxHeight - 6);
      } else {
        maxHeight = Math.min(popoverHeight, Math.max(160, spaceBelow - 6));
        top = Math.max(
          pad,
          Math.min(window.innerHeight - maxHeight - pad, rect.bottom + 6)
        );
      }

      // Horizontal positioning: align to right edge if on right half
      let left;
      if (rect.left > window.innerWidth / 2) {
        left = rect.right - popoverWidth;
        if (left < pad) left = pad;
        if (left + popoverWidth > window.innerWidth - pad) {
          left = window.innerWidth - popoverWidth - pad;
        }
      } else {
        left = rect.left;
        if (left + popoverWidth > window.innerWidth - pad) {
          left = Math.max(pad, window.innerWidth - popoverWidth - pad);
        }
      }

      setCoords({
        top: Math.round(top),
        left: Math.round(left),
        width: popoverWidth,
        maxHeight: Math.round(maxHeight),
        ready: true,
        openAbove,
      });
    };

    computeCoords();

    window.addEventListener("resize", computeCoords);
    window.addEventListener("scroll", computeCoords, true);
    return () => {
      window.removeEventListener("resize", computeCoords);
      window.removeEventListener("scroll", computeCoords, true);
    };
  }, [mounted, triggerRef]);

  // Close on outside click
  useEffect(() => {
    if (!mounted) return;
    const onMouseDown = (e) => {
      const anchor =
        triggerRef?.current || sentinelRef.current?.parentElement;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target) &&
        (!anchor || !anchor.contains(e.target))
      ) {
        if (!e.target.closest("[data-token-popover-trigger]")) {
          onClose?.();
        }
      }
    };
    window.addEventListener("mousedown", onMouseDown, true);
    return () => window.removeEventListener("mousedown", onMouseDown, true);
  }, [mounted, onClose, triggerRef]);

  // Focus search input
  useEffect(() => {
    if (mounted) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [mounted]);

  const handleAddNewToken = () => {
    const count = docFontTokens.length + 1;
    const name = `Font / Custom ${count}`;
    const newId = addToken({
      type: "fontFamily",
      name,
      value: currentFont || "sans-serif",
    });
    onSelectToken?.({
      id: newId,
      name,
      value: currentFont || "sans-serif",
    });
    onClose?.();
  };

  const filteredTokens = availableTokens.filter((tok) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      tok.name.toLowerCase().includes(q) ||
      tok.value.toLowerCase().includes(q)
    );
  });

  return (
    <>
      <span
        ref={sentinelRef}
        className="pointer-events-none absolute inset-0"
        style={{ visibility: "hidden" }}
      />

      {mounted &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            data-theme-font-popover="true"
            style={{
              position: "fixed",
              left: `${coords.left}px`,
              top: `${coords.top}px`,
              width: `${coords.width}px`,
              maxHeight: `${coords.maxHeight}px`,
              zIndex: 10005,
              opacity: coords.ready ? 1 : 0,
            }}
            className={`flex flex-col rounded-xl border border-[#E4E4E7] dark:border-[var(--line)] bg-white dark:bg-[#1E1E1E] p-2 text-[#18181B] dark:text-[var(--text-1)] shadow-2xl select-none font-sans transition-opacity duration-150 ease-out ${
              className || ""
            }`}
          >
            {/* Header: Title and Search */}
            <div className="flex items-center justify-between pb-1.5 border-b border-[#E4E4E7]/60 dark:border-[var(--line)]/60">
              <span className="text-[11px] font-semibold text-[#71717A] dark:text-[#A1A1AA] uppercase tracking-wider">
                Font Variables
              </span>

            </div>

            {/* Search Input */}
            <div className="py-2">
              <div className="relative flex items-center h-7 w-full rounded-md bg-[#F4F4F5] dark:bg-[#27272A] px-2">
                <Search
                  size={12}
                  className="text-[#71717A] dark:text-[#A1A1AA] shrink-0 mr-1.5"
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search font variables…"
                  className="w-full bg-transparent text-xs text-[#18181B] dark:text-white placeholder-[#71717A] outline-none"
                />
              </div>
            </div>

            {/* Token List */}
            <div className="flex-1 overflow-y-auto no-scrollbar space-y-0.5 max-h-[220px] pr-0.5">
              {filteredTokens.length === 0 ? (
                <div className="py-6 text-center text-xs text-[#71717A]">
                  No font variables found
                </div>
              ) : (
                filteredTokens.map((tok, idx) => {
                  const isSelected =
                    (selectedTokenId && tok.id === selectedTokenId) ||
                    (selectedTokenName && tok.name === selectedTokenName) ||
                    (!selectedTokenId &&
                      !selectedTokenName &&
                      currentFont &&
                      (tok.value === currentFont ||
                        tok.value.toLowerCase().includes(currentFont.toLowerCase())));

                  return (
                    <button
                      key={tok.id || `${tok.name}-${idx}`}
                      type="button"
                      onClick={() => {
                        onSelectToken?.(tok);
                        onClose?.();
                      }}
                      className={`flex w-full items-center justify-between px-2 py-1.5 rounded-lg text-left transition-colors cursor-pointer group ${
                        isSelected
                          ? "bg-[#0D99FF]/10 text-[#0D99FF]"
                          : "hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] text-[#18181B] dark:text-[#EDEDED]"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 mr-2 flex-1">
                        <span className="font-serif italic font-semibold text-[13px] text-[#71717A] group-hover:text-[#18181B] dark:group-hover:text-white shrink-0">
                          𝐹
                        </span>
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-xs font-medium truncate leading-tight">
                            {tok.name}
                          </span>
                          <span className="text-[10px] text-[#71717A] truncate font-mono mt-0.5 opacity-80">
                            {tok.value}
                          </span>
                        </div>
                      </div>

                      {/* Font preview glyph + checkmark */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          style={{ fontFamily: tok.value }}
                          className="text-sm font-normal text-[#71717A] dark:text-[#A1A1AA] select-none"
                        >
                          Ag
                        </span>
                        {isSelected && (
                          <Check size={13} className="text-[#0D99FF] shrink-0" />
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer: Detach option if variable is bound */}
            {(selectedTokenId || selectedTokenName) && (
              <div className="pt-2 mt-1 border-t border-[#E4E4E7]/60 dark:border-[var(--line)]/60">
                <button
                  type="button"
                  onClick={() => {
                    onDetachToken?.();
                    onClose?.();
                  }}
                  className="flex w-full items-center justify-center gap-1.5 py-1 px-2 rounded-md text-xs text-[#71717A] hover:text-[#EA4133] hover:bg-[#EA4133]/10 transition-colors cursor-pointer"
                >
                  <Unlink size={12} />
                  <span>Detach variable</span>
                </button>
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
