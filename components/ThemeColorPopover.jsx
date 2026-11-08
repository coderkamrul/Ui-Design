"use client";

import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Plus, Check } from "lucide-react";
import { useEditorStore } from "@/lib/store";

export default function ThemeColorPopover({
  tokens = [],
  currentColor = "#EA4133",
  onSelectToken,
  onClose,
  className = "",
  selectedId = null,
  triggerRef = null,
}) {
  const sentinelRef = useRef(null);
  const popoverRef = useRef(null);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState({
    top: 0,
    left: 0,
    width: 250,
    maxHeight: 320,
    ready: false,
    openAbove: false,
  });

  const [viewMode, setViewMode] = useState("list"); // 'list' | 'grid'
  const [swatchSize, setSwatchSize] = useState(24); // 16 to 36 px

  const addToken = useEditorStore((s) => s.addToken);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Collect ONLY color tokens defined in the theme / document
  const availableTokens = tokens
    .filter((t) => t.type === "color")
    .map((t) => ({ id: t.id, name: t.name, value: t.value }));

  // Dynamically compute positioning with auto-flip to top when not enough space below
  useLayoutEffect(() => {
    if (!mounted || typeof window === "undefined") return;

    const computeCoords = () => {
      const anchor =
        triggerRef?.current ||
        sentinelRef.current?.parentElement ||
        sentinelRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const popoverWidth = 250;
      const popoverHeight = 320;
      const pad = 12;

      const spaceBelow = window.innerHeight - rect.bottom - pad;
      const spaceAbove = rect.top - pad;

      // Auto-flip: if space below is less than required (~330px) and there's space above, open ABOVE (top)
      const openAbove = (spaceBelow < 330 && spaceAbove > 200) || (spaceBelow < 180 && spaceAbove > spaceBelow);

      let top;
      let maxHeight;

      if (openAbove) {
        maxHeight = Math.min(popoverHeight, Math.max(160, spaceAbove - 6));
        top = Math.max(pad, rect.top - maxHeight - 6);
      } else {
        maxHeight = Math.min(popoverHeight, Math.max(160, spaceBelow - 6));
        top = Math.max(pad, Math.min(window.innerHeight - maxHeight - pad, rect.bottom + 6));
      }

      // Horizontal positioning: clamp within viewport
      let left;
      if (rect.left > window.innerWidth / 2) {
        // Anchor is on right half of screen: align with right edge of anchor
        left = rect.right - popoverWidth;
        if (left < pad) left = pad;
        if (left + popoverWidth > window.innerWidth - pad) {
          left = window.innerWidth - popoverWidth - pad;
        }
      } else {
        // Anchor is on left half: align with left edge of anchor
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

  // Close on click outside
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

  const handleAddNewToken = () => {
    const count = availableTokens.length + 1;
    const name = `color-${count}`;
    addToken({
      type: "color",
      name,
      value: currentColor,
    });
  };

  return (
    <>
      {/* Sentinel element to track trigger element position */}
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
            data-theme-color-popover="true"
            style={{
              position: "fixed",
              left: `${coords.left}px`,
              top: `${coords.top}px`,
              width: `${coords.width}px`,
              maxHeight: `${coords.maxHeight}px`,
              zIndex: 9999,
              opacity: coords.ready ? 1 : 0,
            }}
            className={`flex flex-col rounded-xl border border-[#E4E4E7] dark:border-[var(--line)] bg-white dark:bg-[#1E1E1E] p-1.5 text-[#18181B] dark:text-[var(--text-1)] shadow-2xl select-none font-sans transition-opacity duration-150 ease-out ${className || ""}`}
          >
            {/* -------------------- Top Control Strip -------------------- */}
            <div className="flex shrink-0 items-center justify-between border-b border-[#E4E4E7]/60 dark:border-[var(--line)]/60 px-1.5 pb-2 pt-0.5">
              <div className="flex items-center gap-1.5 flex-1 mr-2">
                {/* List View Toggle */}
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className={`flex h-5 w-5 items-center justify-center rounded transition-colors cursor-pointer ${
                    viewMode === "list"
                      ? "bg-[#EAEAEA] dark:bg-[var(--surface-hover)] text-[#18181B] dark:text-[var(--text-1)] font-semibold shadow-2xs"
                      : "text-[#71717A] dark:text-[var(--text-2)] hover:text-[#18181B] dark:hover:text-[var(--text-1)]"
                  }`}
                  title="List view"
                >
                  <svg width="12" height="10" viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <line x1="0" y1="2" x2="12" y2="2" />
                    <line x1="0" y1="8" x2="12" y2="8" />
                  </svg>
                </button>

                {/* Swatch Size Slider */}
                <input
                  type="range"
                  min="16"
                  max="36"
                  value={swatchSize}
                  onChange={(e) => setSwatchSize(Number(e.target.value))}
                  className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-[#E4E4E7] dark:bg-[var(--line)] accent-zinc-500"
                  title="Adjust swatch size"
                />

                {/* Grid View Toggle */}
                <button
                  type="button"
                  onClick={() => setViewMode("grid")}
                  className={`flex h-5 w-5 items-center justify-center rounded transition-colors cursor-pointer ${
                    viewMode === "grid"
                      ? "bg-[#EAEAEA] dark:bg-[var(--surface-hover)] text-[#18181B] dark:text-[var(--text-1)] font-semibold shadow-2xs"
                      : "text-[#71717A] dark:text-[var(--text-2)] hover:text-[#18181B] dark:hover:text-[var(--text-1)]"
                  }`}
                  title="Grid view"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <rect x="1" y="1" width="4" height="4" rx="0.5" />
                    <rect x="7" y="1" width="4" height="4" rx="0.5" />
                    <rect x="1" y="7" width="4" height="4" rx="0.5" />
                    <rect x="7" y="7" width="4" height="4" rx="0.5" />
                  </svg>
                </button>
              </div>

              {/* Add Token Button (+) */}
              <button
                type="button"
                onClick={handleAddNewToken}
                className="flex h-5 w-5 items-center justify-center rounded hover:bg-[#F4F4F5] dark:hover:bg-[var(--surface-hover)] text-[#71717A] dark:text-[var(--text-2)] hover:text-[#18181B] dark:hover:text-[var(--text-1)] transition-colors cursor-pointer"
                title="Create token from current color"
              >
                <Plus size={13} />
              </button>
            </div>

            {/* -------------------- Token List / Grid -------------------- */}
            <div
              className="flex-1 min-h-0 overflow-y-auto no-scrollbar py-1 flex flex-col gap-0.5"
              style={{ maxHeight: `${Math.max(120, coords.maxHeight - 48)}px` }}
            >
              {availableTokens.length === 0 ? (
                <div className="py-6 px-3 text-center text-xs text-[#71717A] dark:text-[var(--text-3)] flex flex-col items-center gap-2">
                  <span>No color variables in theme</span>
                  <button
                    type="button"
                    onClick={handleAddNewToken}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#F4F4F5] dark:bg-[var(--surface-hover)] hover:bg-[#EAEAEA] dark:hover:bg-white/10 text-xs font-medium text-[#18181B] dark:text-[var(--text-1)] transition-colors cursor-pointer"
                  >
                    <Plus size={12} />
                    <span>Create variable</span>
                  </button>
                </div>
              ) : viewMode === "list" ? (
                availableTokens.map((token) => {
                  const cleanName =
                    (token.name || "").replace(/^color[-/\s]?/i, "") || token.name;
                  const isSelected = selectedId
                    ? token.id === selectedId
                    : token.value?.toLowerCase() === currentColor?.toLowerCase();

                  return (
                    <button
                      key={token.id || token.name}
                      type="button"
                      onClick={() => {
                        onSelectToken?.(token);
                        onClose?.();
                      }}
                      className={`group flex w-full items-center justify-between rounded-md px-1.5 py-1 text-left transition-colors cursor-pointer ${
                        isSelected
                          ? "bg-[#EAEAEA] dark:bg-[var(--surface-hover)] font-medium"
                          : "hover:bg-[#F4F4F5] dark:hover:bg-[var(--surface-hover)] text-[#18181B] dark:text-[var(--text-1)]"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {/* Rounded Color Rectangle */}
                        <div
                          className="shrink-0 rounded border border-black/15 shadow-2xs"
                          style={{
                            width: `${swatchSize}px`,
                            height: `${Math.round(swatchSize * 0.65)}px`,
                            backgroundColor: token.value,
                          }}
                        />
                        {/* Token Name */}
                        <span className="truncate text-xs font-normal text-[#18181B] dark:text-[var(--text-1)]">
                          {cleanName}
                        </span>
                      </div>
                      {isSelected && (
                        <Check size={12} className="shrink-0 ml-1 text-[#0D99FF]" />
                      )}
                    </button>
                  );
                })
              ) : (
                /* Grid Mode */
                <div className="grid grid-cols-4 gap-1.5 p-1">
                  {availableTokens.map((token) => (
                    <button
                      key={token.name}
                      type="button"
                      onClick={() => {
                        onSelectToken?.(token);
                        onClose?.();
                      }}
                      className="aspect-square w-full rounded border border-black/15 shadow-xs hover:scale-110 transition-transform cursor-pointer"
                      style={{ backgroundColor: token.value }}
                      title={`${token.name} (${token.value})`}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
