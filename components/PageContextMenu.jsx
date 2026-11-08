"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FileText,
  ArrowRight,
  Lock,
  CheckCircle2,
  XCircle,
  Info,
  HelpCircle,
  PenTool,
  Spline,
  Image as ImageIcon,
  Table,
  Presentation,
  DraftingCompass,
  BookOpen,
  BarChart2,
  LineChart,
  PieChart,
  Trash2,
  Check,
  ChevronRight,
} from "lucide-react";

export const PAGE_ICON_SECTIONS = [
  // 1. Base
  [{ key: "page", label: "Page", Icon: FileText }],
  // 2. Status / symbols
  [
    { key: "arrow", label: "Arrow", Icon: ArrowRight },
    { key: "padlock", label: "Padlock", Icon: Lock },
    { key: "check", label: "Check", Icon: CheckCircle2 },
    { key: "cross", label: "Cross", Icon: XCircle },
    { key: "info", label: "Info", Icon: Info },
    { key: "question", label: "Question", Icon: HelpCircle },
  ],
  // 3. Design / Content
  [
    { key: "design", label: "Design", Icon: PenTool },
    { key: "vector", label: "Vector", Icon: Spline },
    { key: "images", label: "Images", Icon: ImageIcon },
    { key: "table", label: "Table", Icon: Table },
    { key: "presentation", label: "Presentation", Icon: Presentation },
    { key: "blueprint", label: "Blueprint", Icon: DraftingCompass },
    { key: "swatches", label: "Swatches", Icon: BookOpen },
  ],
  // 4. Charts
  [
    { key: "bar-chart", label: "Bar chart", Icon: BarChart2 },
    { key: "line-chart", label: "Line chart", Icon: LineChart },
    { key: "pie-chart", label: "Pie chart", Icon: PieChart },
  ],
  // 5. Cleanup
  [{ key: "junk", label: "Junk", Icon: Trash2 }],
];

export function resolvePageIconKey(page) {
  if (page?.icon) return page.icon;
  const name = (page?.name || "").toLowerCase();
  if (name.includes("template")) return "images";
  if (name.includes("design")) return "swatches";
  return "page";
}

export function getPageIconComponent(iconKey) {
  for (const group of PAGE_ICON_SECTIONS) {
    const found = group.find((item) => item.key === iconKey);
    if (found) return found.Icon;
  }
  return FileText;
}

export function PageContextMenu({
  position,
  page,
  onClose,
  onCopyLink,
  onRename,
  onAddDivider,
  onSelectIcon,
  onDeletePage,
  onDeleteDivider,
}) {
  const menuRef = useRef(null);
  const [mounted, setMounted] = useState(() => typeof document !== "undefined");
  const [showIconSubmenu, setShowIconSubmenu] = useState(false);
  const [coords, setCoords] = useState(() => ({
    x: position?.x ?? 0,
    y: position?.y ?? 0,
    ready: true,
  }));
  const closeTimerRef = useRef(null);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const openSubmenu = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setShowIconSubmenu(true);
  };

  const closeSubmenuWithDelay = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setShowIconSubmenu(false);
    }, 180);
  };

  useLayoutEffect(() => {
    if (!position) return;
    const pad = 12;
    let x = position.x;
    let y = position.y;

    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      if (x + rect.width > window.innerWidth - pad) {
        x = Math.max(pad, window.innerWidth - rect.width - pad);
      }
      if (y + rect.height > window.innerHeight - pad) {
        y = Math.max(pad, window.innerHeight - rect.height - pad);
      }
    }
    setCoords({ x, y, ready: true });
  }, [position, mounted]);

  useEffect(() => {
    if (!position) return;

    const handlePointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    const timer = setTimeout(() => {
      window.addEventListener("pointerdown", handlePointerDown, true);
      window.addEventListener("mousedown", handlePointerDown, true);
      window.addEventListener("keydown", handleKeyDown);
    }, 10);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [position, onClose]);

  if (!mounted || !position || !page) return null;

  const currentIconKey = resolvePageIconKey(page);
  const isDivider = Boolean(page.isDivider);

  // Check if submenu should open to left if close to right edge
  const openSubmenuToLeft = coords.x + 160 + 185 > (typeof window !== "undefined" ? window.innerWidth : 1200);

  return createPortal(
    <div
      ref={menuRef}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[10000] w-[160px] select-none rounded-xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] p-1 text-[12.5px] text-[#18181B] dark:text-[#EDEDED] shadow-xl shadow-black/10 animate-in fade-in zoom-in-95 duration-100 flex flex-col font-sans"
      style={{
        left: `${coords.x}px`,
        top: `${coords.y}px`,
        opacity: coords.ready ? 1 : 0,
      }}
    >
      {isDivider ? (
        <button
          type="button"
          onClick={() => {
            onDeleteDivider && onDeleteDivider(page.id);
            onClose();
          }}
          className="flex w-full items-center justify-between px-2.5 py-1 h-[28px] rounded-md text-left transition-colors hover:bg-red-50 dark:hover:bg-red-500/15 text-red-600 dark:text-red-400 cursor-pointer"
        >
          <span>Delete divider</span>
        </button>
      ) : (
        <>
          {/* 1. Copy link */}
          <button
            type="button"
            onClick={() => {
              onCopyLink && onCopyLink(page.id);
              onClose();
            }}
            className="flex w-full items-center justify-between px-2.5 py-1 h-[28px] rounded-md text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer"
          >
            <span>Copy link</span>
          </button>

          {/* 2. Rename page */}
          <button
            type="button"
            onClick={() => {
              onRename && onRename(page.id);
              onClose();
            }}
            className="flex w-full items-center justify-between px-2.5 py-1 h-[28px] rounded-md text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer"
          >
            <span>Rename page</span>
          </button>

          <div className="my-1 border-t border-[#E4E4E7]/80 dark:border-[#2C2C2E]" />

          {/* 3. Add divider */}
          <button
            type="button"
            onClick={() => {
              onAddDivider && onAddDivider(page.id);
              onClose();
            }}
            className="flex w-full items-center justify-between px-2.5 py-1 h-[28px] rounded-md text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer"
          >
            <span>Add divider</span>
          </button>

          {/* 4. Page icon... with Submenu */}
          <div
            className="relative"
            onMouseEnter={openSubmenu}
            onMouseLeave={closeSubmenuWithDelay}
          >
            <button
              type="button"
              onClick={() => {
                if (showIconSubmenu) {
                  setShowIconSubmenu(false);
                } else {
                  openSubmenu();
                }
              }}
              className={`flex w-full items-center justify-between px-2.5 py-1 h-[28px] rounded-md text-left transition-colors cursor-pointer ${
                showIconSubmenu
                  ? "bg-[#0D99FF] text-white"
                  : "hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] text-[#18181B] dark:text-[#EDEDED]"
              }`}
            >
              <span>Page icon...</span>
              <ChevronRight
                size={13}
                className={showIconSubmenu ? "text-white" : "text-[#71717A] dark:text-[#A1A1AA]"}
              />
            </button>

            {showIconSubmenu && (
              <div
                onMouseEnter={openSubmenu}
                onMouseLeave={closeSubmenuWithDelay}
                className={`absolute -top-1 flex w-[180px] max-h-[380px] overflow-y-auto no-scrollbar flex-col rounded-xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] p-1 text-[12.5px] text-[#18181B] dark:text-[#EDEDED] shadow-2xl shadow-black/15 z-[10001] animate-in fade-in zoom-in-95 duration-100 ${
                  openSubmenuToLeft
                    ? "right-[calc(100%-2px)] before:absolute before:inset-y-0 before:-right-3 before:w-4 before:content-['']"
                    : "left-[calc(100%-2px)] before:absolute before:inset-y-0 before:-left-3 before:w-4 before:content-['']"
                }`}
              >
                {PAGE_ICON_SECTIONS.map((section, sIdx) => (
                  <React.Fragment key={sIdx}>
                    {sIdx > 0 && (
                      <div className="my-1 border-t border-[#E4E4E7]/80 dark:border-[#2C2C2E]" />
                    )}
                    {section.map((item) => {
                      const isItemActive = currentIconKey === item.key;
                      const IconComp = item.Icon;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => {
                            onSelectIcon && onSelectIcon(page.id, item.key);
                            onClose();
                          }}
                          className="flex items-center justify-between w-full px-2 py-1 h-[27px] rounded-md text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#18181B] dark:text-[#EDEDED]"
                        >
                          <div className="flex items-center gap-2 overflow-hidden">
                            <IconComp
                              size={14}
                              className="text-[#71717A] dark:text-[#A1A1AA] shrink-0"
                              strokeWidth={1.5}
                            />
                            <span className="text-[12.5px] truncate">{item.label}</span>
                          </div>
                          {isItemActive && (
                            <Check
                              size={13}
                              className="text-[#18181B] dark:text-white shrink-0 ml-1.5"
                              strokeWidth={2}
                            />
                          )}
                        </button>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>

          <div className="my-1 border-t border-[#E4E4E7]/80 dark:border-[#2C2C2E]" />

          {/* 5. Delete page */}
          <button
            type="button"
            onClick={() => {
              onDeletePage && onDeletePage(page.id);
              onClose();
            }}
            className="flex w-full items-center justify-between px-2.5 py-1 h-[28px] rounded-md text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] text-[#18181B] dark:text-[#EDEDED] cursor-pointer"
          >
            <span>Delete page</span>
          </button>
        </>
      )}
    </div>,
    document.body
  );
}
