"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import { useEditorStore } from "../lib/store";
import * as G from "../lib/geometry";

export function ContextMenu({
  position,
  onClose,
  hasCopiedStyles = false,
  onNextArtboard,
  onPrevArtboard,
  onOrganizeFrames,
  onZoomToFit,
  onCursorChat,
  onHideUi,
  onSelectLayer,
  onSelectParent,
  onSelectChildren,
  onCopyNode,
  onCopyLink,
  onCopyCode,
  onPaste,
  onPasteOnTop,
  onPasteToReplace,
  onDuplicate,
  onCopyStyles,
  onPasteStyles,
  onRename,
  onFrameSelection,
  onWrapInFlex,
  onRemoveFlex,
  onUngroup,
  onBringToFront,
  onSendToBack,
  onMoveUp,
  onMoveDown,
  onToggleVisibility,
  onToggleLock,
  onCollapseAll,
  onDelete,
}) {
  const uiMode = useEditorStore((s) => s.uiMode);
  const selection = useEditorStore((s) => s.selection ?? []);
  const doc = useEditorStore((s) => s.doc);
  const alignSelection = useEditorStore((s) => s.alignSelection);
  const distributeSelection = useEditorStore((s) => s.distributeSelection);
  const isMulti = selection.length > 1;
  const hasFrames = selection.some((id) => doc?.nodes?.[id]?.type === "frame");
  const isUiHidden = uiMode === "hidden" || uiMode === "collapsed";
  const menuRef = useRef(null);
  const [mounted, setMounted] = useState(() => typeof document !== "undefined");
  const [activeSubmenu, setActiveSubmenu] = useState(null);
  const [coords, setCoords] = useState(() => ({
    x: position?.x ?? 0,
    y: position?.y ?? 0,
    ready: true,
  }));
  const submenuTimerRef = useRef(null);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (submenuTimerRef.current) clearTimeout(submenuTimerRef.current);
    };
  }, []);

  const openSubmenu = (menuName) => {
    if (submenuTimerRef.current) {
      clearTimeout(submenuTimerRef.current);
      submenuTimerRef.current = null;
    }
    setActiveSubmenu(menuName);
  };

  const closeSubmenuWithDelay = () => {
    if (submenuTimerRef.current) clearTimeout(submenuTimerRef.current);
    submenuTimerRef.current = setTimeout(() => {
      setActiveSubmenu(null);
    }, 180);
  };

  // Compute position to ensure menu never overflows viewport
  useLayoutEffect(() => {
    if (!position) return;
    const pad = 8;
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

  // Click outside and Escape key to close
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

    // Defer listener to avoid closing from the opening right-click event
    const timer = setTimeout(() => {
      window.addEventListener("pointerdown", handlePointerDown, true);
      window.addEventListener("keydown", handleKeyDown);
    }, 10);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [position, onClose]);

  if (!mounted || !position) return null;

  const targetId = position.targetId;
  const targetNode = targetId ? doc?.nodes?.[targetId] : null;
  const isFlex = position.targetLayout === "flex" || targetNode?.layout?.mode === "flex";
  const hierarchy = position.hierarchy || [];
  const isCanvas = !targetId;
  const isSidebar = Boolean(position?.isSidebar);

  // A layer can only be ungrouped if it is a container with children
  const canUngroup = Boolean(
    targetNode &&
      (targetNode.type === "group" || targetNode.type === "frame") &&
      Array.isArray(targetNode.childIds) &&
      targetNode.childIds.length > 0
  );

  const canUngroupMulti =
    isMulti &&
    selection.some((id) => {
      const n = doc?.nodes?.[id];
      return Boolean(
        n &&
          (n.type === "group" || n.type === "frame") &&
          Array.isArray(n.childIds) &&
          n.childIds.length > 0
      );
    });

  // Check if flyout submenus should open to the left
  const openSubmenuToLeft = coords.x + 215 + 260 > (typeof window !== "undefined" ? window.innerWidth : 1200);

  const handleAction = (callback, e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    try {
      if (callback) callback();
    } catch (err) {
      console.error("Context menu action error:", err);
    }
    onClose();
  };

  const menuContent = (
    <div
      ref={menuRef}
      style={{
        top: coords.y,
        left: coords.x,
        opacity: coords.ready ? 1 : 0,
        pointerEvents: coords.ready ? "auto" : "none",
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className="fixed z-[9999] min-w-[225px] w-max select-none rounded-xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] p-[3px] text-[12px] text-[#222222] dark:text-[#EDEDED] shadow-2xl shadow-black/15 flex flex-col font-sans animate-in fade-in zoom-in-95 duration-100 overflow-visible"
    >
      {isCanvas ? (
        /* ---------------- Canvas Right-Click Menu (Screenshot 1) ---------------- */
        <>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onPaste && onPaste(), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Paste</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Ctrl + V
            </span>
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) =>
              handleAction(
                () =>
                  window.dispatchEvent(
                    new Event("canvastool:open-add-svg-modal")
                  ),
                e
              )
            }
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Add Custom SVG...</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              SVG
            </span>
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onOrganizeFrames && onOrganizeFrames(), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Organize frames</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Alt + Shift + O
            </span>
          </button>

          <div className="my-[3px] border-t border-[#E4E4E7]/80 dark:border-[#2E2E32]" />

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onNextArtboard && onNextArtboard(), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Next artboard</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              N
            </span>
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onPrevArtboard && onPrevArtboard(), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Previous artboard</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Shift + N
            </span>
          </button>

          <div className="my-[3px] border-t border-[#E4E4E7]/80 dark:border-[#2E2E32]" />

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onZoomToFit && onZoomToFit(), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Zoom to fit</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Shift + 1
            </span>
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onCursorChat && onCursorChat(), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Cursor chat</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              /
            </span>
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onHideUi && onHideUi(), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>{isUiHidden ? "Show UI" : "Hide UI"}</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              .
            </span>
          </button>
        </>
      ) : isMulti ? (
        /* ---------------- Multi-Selection Right-Click Menu (Exclusively Multi-Selection) ---------------- */
        <>
          <div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-medium text-[#8E8E93] dark:text-[#8E8E93] border-b border-[#E4E4E7]/80 dark:border-[#2E2E32] mb-0.5">
            <span>{selection.length} layers selected</span>
          </div>

          {/* Alignment Submenu */}
          <div
            className="relative"
            onMouseEnter={() => openSubmenu("align")}
            onMouseLeave={closeSubmenuWithDelay}
          >
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setActiveSubmenu(activeSubmenu === "align" ? null : "align")}
              className={`flex w-full items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors cursor-pointer ${
                activeSubmenu === "align"
                  ? "bg-[#0D99FF] text-white"
                  : "hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] text-[#222222] dark:text-[#EDEDED]"
              }`}
            >
              <span>Align</span>
              <ChevronRight
                size={12}
                className={activeSubmenu === "align" ? "text-white" : "text-[#8E8E93]"}
              />
            </button>
            {activeSubmenu === "align" && (
              <div
                onMouseEnter={() => openSubmenu("align")}
                onMouseLeave={closeSubmenuWithDelay}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className={`absolute -top-1 flex min-w-[230px] w-max flex-col rounded-xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] p-[3px] text-[12px] text-[#222222] dark:text-[#EDEDED] shadow-2xl z-[10000] animate-in fade-in zoom-in-95 duration-100 ${
                  openSubmenuToLeft
                    ? "right-[calc(100%-2px)] before:absolute before:inset-y-0 before:-right-3 before:w-4 before:content-['']"
                    : "left-[calc(100%-2px)] before:absolute before:inset-y-0 before:-left-3 before:w-4 before:content-['']"
                }`}
              >
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => handleAction(() => alignSelection && alignSelection("left"), e)}
                  className="flex items-center justify-between gap-4 px-2.5 py-1 min-h-[25px] rounded-[5px] text-left hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-[#222222] dark:text-[#EDEDED] whitespace-nowrap"
                >
                  <span className="whitespace-nowrap">Align left</span>
                  <span className="text-[11px] font-sans text-[#8E8E93] whitespace-nowrap shrink-0 ml-auto pl-3">Alt + A</span>
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => handleAction(() => alignSelection && alignSelection("center"), e)}
                  className="flex items-center justify-between gap-4 px-2.5 py-1 min-h-[25px] rounded-[5px] text-left hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-[#222222] dark:text-[#EDEDED] whitespace-nowrap"
                >
                  <span className="whitespace-nowrap">Align horizontal center</span>
                  <span className="text-[11px] font-sans text-[#8E8E93] whitespace-nowrap shrink-0 ml-auto pl-3">Alt + H</span>
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => handleAction(() => alignSelection && alignSelection("right"), e)}
                  className="flex items-center justify-between gap-4 px-2.5 py-1 min-h-[25px] rounded-[5px] text-left hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-[#222222] dark:text-[#EDEDED] whitespace-nowrap"
                >
                  <span className="whitespace-nowrap">Align right</span>
                  <span className="text-[11px] font-sans text-[#8E8E93] whitespace-nowrap shrink-0 ml-auto pl-3">Alt + D</span>
                </button>
                <div className="my-[3px] border-t border-[#E4E4E7]/80 dark:border-[#2E2E32]" />
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => handleAction(() => alignSelection && alignSelection("top"), e)}
                  className="flex items-center justify-between gap-4 px-2.5 py-1 min-h-[25px] rounded-[5px] text-left hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-[#222222] dark:text-[#EDEDED] whitespace-nowrap"
                >
                  <span className="whitespace-nowrap">Align top</span>
                  <span className="text-[11px] font-sans text-[#8E8E93] whitespace-nowrap shrink-0 ml-auto pl-3">Alt + W</span>
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => handleAction(() => alignSelection && alignSelection("middle"), e)}
                  className="flex items-center justify-between gap-4 px-2.5 py-1 min-h-[25px] rounded-[5px] text-left hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-[#222222] dark:text-[#EDEDED] whitespace-nowrap"
                >
                  <span className="whitespace-nowrap">Align vertical center</span>
                  <span className="text-[11px] font-sans text-[#8E8E93] whitespace-nowrap shrink-0 ml-auto pl-3">Alt + V</span>
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => handleAction(() => alignSelection && alignSelection("bottom"), e)}
                  className="flex items-center justify-between gap-4 px-2.5 py-1 min-h-[25px] rounded-[5px] text-left hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-[#222222] dark:text-[#EDEDED] whitespace-nowrap"
                >
                  <span className="whitespace-nowrap">Align bottom</span>
                  <span className="text-[11px] font-sans text-[#8E8E93] whitespace-nowrap shrink-0 ml-auto pl-3">Alt + S</span>
                </button>
              </div>
            )}
          </div>

          {/* Distribute Spacing Submenu */}
          <div
            className="relative"
            onMouseEnter={() => openSubmenu("distribute")}
            onMouseLeave={closeSubmenuWithDelay}
          >
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setActiveSubmenu(activeSubmenu === "distribute" ? null : "distribute")}
              className={`flex w-full items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors cursor-pointer ${
                activeSubmenu === "distribute"
                  ? "bg-[#0D99FF] text-white"
                  : "hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] text-[#222222] dark:text-[#EDEDED]"
              }`}
            >
              <span>Distribute spacing</span>
              <ChevronRight
                size={12}
                className={activeSubmenu === "distribute" ? "text-white" : "text-[#8E8E93]"}
              />
            </button>
            {activeSubmenu === "distribute" && (
              <div
                onMouseEnter={() => openSubmenu("distribute")}
                onMouseLeave={closeSubmenuWithDelay}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className={`absolute -top-1 flex min-w-[250px] w-max flex-col rounded-xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] p-[3px] text-[12px] text-[#222222] dark:text-[#EDEDED] shadow-2xl z-[10000] animate-in fade-in zoom-in-95 duration-100 ${
                  openSubmenuToLeft
                    ? "right-[calc(100%-2px)] before:absolute before:inset-y-0 before:-right-3 before:w-4 before:content-['']"
                    : "left-[calc(100%-2px)] before:absolute before:inset-y-0 before:-left-3 before:w-4 before:content-['']"
                }`}
              >
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) =>
                    handleAction(() => distributeSelection && distributeSelection("horizontal"), e)
                  }
                  className="flex items-center justify-between gap-4 px-2.5 py-1 min-h-[25px] rounded-[5px] text-left hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-[#222222] dark:text-[#EDEDED] whitespace-nowrap"
                >
                  <span className="whitespace-nowrap">Horizontal spacing</span>
                  <span className="text-[11px] font-sans text-[#8E8E93] whitespace-nowrap shrink-0 ml-auto pl-3">Alt + Shift + H</span>
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) =>
                    handleAction(() => distributeSelection && distributeSelection("vertical"), e)
                  }
                  className="flex items-center justify-between gap-4 px-2.5 py-1 min-h-[25px] rounded-[5px] text-left hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-[#222222] dark:text-[#EDEDED] whitespace-nowrap"
                >
                  <span className="whitespace-nowrap">Vertical spacing</span>
                  <span className="text-[11px] font-sans text-[#8E8E93] whitespace-nowrap shrink-0 ml-auto pl-3">Alt + Shift + V</span>
                </button>
              </div>
            )}
          </div>

          <div className="my-[3px] border-t border-[#E4E4E7]/80 dark:border-[#2E2E32]" />

          {/* Group / Frame Selection */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onFrameSelection && onFrameSelection(), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Group selection</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Ctrl + G
            </span>
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onFrameSelection && onFrameSelection(), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Frame selection</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Ctrl + Alt + G
            </span>
          </button>

          {canUngroupMulti && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) =>
                handleAction(() => {
                  selection.forEach((id) => {
                    const n = doc?.nodes?.[id];
                    if (n && (n.type === "group" || n.type === "frame") && n.childIds?.length > 0) {
                      onUngroup && onUngroup(id);
                    }
                  });
                }, e)
              }
              className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
            >
              <span>Ungroup</span>
              <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
                Ctrl + Shift + G
              </span>
            </button>
          )}

          {hasFrames && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => handleAction(() => onOrganizeFrames && onOrganizeFrames(), e)}
              className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
            >
              <span>Organize frames</span>
              <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
                Alt + Shift + O
              </span>
            </button>
          )}

          <div className="my-[3px] border-t border-[#E4E4E7]/80 dark:border-[#2E2E32]" />

          {/* Duplicate & Copy */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onDuplicate && onDuplicate(), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Duplicate</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Ctrl + D
            </span>
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onCopyNode && onCopyNode(), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Copy</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Ctrl + C
            </span>
          </button>

          <div className="my-[3px] border-t border-[#E4E4E7]/80 dark:border-[#2E2E32]" />

          {/* Lock / Unlock & Show / Hide */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) =>
              handleAction(() => {
                const st = useEditorStore.getState();
                const anyUnlocked = selection.some((id) => !st.doc.nodes[id]?.locked);
                for (const id of selection) {
                  st.patchNode(id, { locked: anyUnlocked });
                }
                st.showToast?.({
                  message: anyUnlocked
                    ? `Locked ${selection.length} layers`
                    : `Unlocked ${selection.length} layers`,
                });
              }, e)
            }
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Lock / unlock</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Ctrl + Shift + L
            </span>
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) =>
              handleAction(() => {
                const st = useEditorStore.getState();
                const anyVisible = selection.some((id) => !G.isNodeHidden(st.doc.nodes, id));
                const willHide = anyVisible;
                for (const id of selection) {
                  st.patchNode(id, {
                    hidden: willHide,
                    visible: !willHide,
                    style: { ...(st.doc.nodes[id]?.style ?? {}), opacity: willHide ? 0 : 1 },
                  });
                }
                if (willHide) {
                  st.setSelection([]);
                }
                st.showToast?.({
                  message: willHide
                    ? `Hidden ${selection.length} layers`
                    : `Shown ${selection.length} layers`,
                });
              }, e)
            }
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Show / hide</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Ctrl + Shift + H
            </span>
          </button>

          <div className="my-[3px] border-t border-[#E4E4E7]/80 dark:border-[#2E2E32]" />

          {/* Delete */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onDelete && onDelete(), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Delete</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Del
            </span>
          </button>
        </>
      ) : (
        /* ---------------- Layer Right-Click Menu (Matching Screenshots) ---------------- */
        <>
          {/* Section 1: Selection (hidden when right clicking in sidebar) */}
          {!isSidebar && (
            <>
              <div
                className="relative"
                onMouseEnter={() => openSubmenu("selectLayer")}
                onMouseLeave={closeSubmenuWithDelay}
              >
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    if (activeSubmenu === "selectLayer") {
                      setActiveSubmenu(null);
                    } else {
                      openSubmenu("selectLayer");
                    }
                  }}
                  className={`flex w-full items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors cursor-pointer ${
                    activeSubmenu === "selectLayer"
                      ? "bg-[#0D99FF] text-white"
                      : "hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] text-[#222222] dark:text-[#EDEDED]"
                  }`}
                >
                  <span>Select layer...</span>
                  <ChevronRight
                    size={12}
                    className={activeSubmenu === "selectLayer" ? "text-white" : "text-[#8E8E93]"}
                  />
                </button>
                {activeSubmenu === "selectLayer" && (
                  <div
                    onMouseEnter={() => openSubmenu("selectLayer")}
                    onMouseLeave={closeSubmenuWithDelay}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    className={`absolute -top-1 flex min-w-[220px] w-max max-h-[300px] overflow-y-auto flex-col rounded-xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] p-[3px] text-[12px] text-[#222222] dark:text-[#EDEDED] shadow-2xl z-[10000] animate-in fade-in zoom-in-95 duration-100 ${
                      openSubmenuToLeft
                        ? "right-[calc(100%-2px)] before:absolute before:inset-y-0 before:-right-3 before:w-4 before:content-['']"
                        : "left-[calc(100%-2px)] before:absolute before:inset-y-0 before:-left-3 before:w-4 before:content-['']"
                    }`}
                  >
                    {hierarchy.length > 0 ? (
                      hierarchy.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) =>
                            handleAction(() => onSelectLayer && onSelectLayer(item.id), e)
                          }
                          className="flex items-center justify-between gap-3 px-2.5 py-1 min-h-[25px] rounded-[5px] text-left hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-[#222222] dark:text-[#EDEDED] whitespace-nowrap"
                        >
                          <span className="truncate text-[12px]">{item.name}</span>
                          <span className="text-[10px] text-[#8E8E93] uppercase ml-auto shrink-0 pl-2">
                            {item.type}
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="px-2 py-1 text-[#8E8E93] text-[12px]">Current layer</div>
                    )}
                  </div>
                )}
              </div>

              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => handleAction(() => onSelectParent && onSelectParent(targetId), e)}
                className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
              >
                <span>Select parent</span>
                <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
                  Esc
                </span>
              </button>

              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) =>
                  handleAction(() => onSelectChildren && onSelectChildren(targetId), e)
                }
                className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
              >
                <span>Select children</span>
                <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
                  Enter
                </span>
              </button>

              <div className="my-[3px] border-t border-[#E4E4E7]/80 dark:border-[#2E2E32]" />
            </>
          )}

          {/* Section 2: Copying */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onCopyNode && onCopyNode(targetId), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Copy</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Ctrl + C
            </span>
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onCopyLink && onCopyLink(targetId), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Copy link</span>
          </button>

          <div
            className="relative"
            onMouseEnter={() => openSubmenu("copyAs")}
            onMouseLeave={closeSubmenuWithDelay}
          >
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                if (activeSubmenu === "copyAs") {
                  setActiveSubmenu(null);
                } else {
                  openSubmenu("copyAs");
                }
              }}
              className={`flex w-full items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors cursor-pointer ${
                activeSubmenu === "copyAs"
                  ? "bg-[#0D99FF] text-white"
                  : "hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] text-[#222222] dark:text-[#EDEDED]"
              }`}
            >
              <span>Copy as...</span>
              <ChevronRight
                size={12}
                className={activeSubmenu === "copyAs" ? "text-white" : "text-[#8E8E93]"}
              />
            </button>

            {activeSubmenu === "copyAs" && (
              <div
                onMouseEnter={() => openSubmenu("copyAs")}
                onMouseLeave={closeSubmenuWithDelay}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className={`absolute -top-1 flex min-w-[160px] w-max flex-col rounded-xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] p-[3px] text-[12px] text-[#222222] dark:text-[#EDEDED] shadow-2xl z-[10000] animate-in fade-in zoom-in-95 duration-100 ${
                  openSubmenuToLeft
                    ? "right-[calc(100%-2px)] before:absolute before:inset-y-0 before:-right-3 before:w-4 before:content-['']"
                    : "left-[calc(100%-2px)] before:absolute before:inset-y-0 before:-left-3 before:w-4 before:content-['']"
                }`}
              >
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) =>
                    handleAction(() => onCopyCode && onCopyCode(targetId, "svg"), e)
                  }
                  className="px-2.5 py-1 min-h-[25px] rounded-[5px] text-left hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-[#222222] dark:text-[#EDEDED] whitespace-nowrap"
                >
                  Copy SVG
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) =>
                    handleAction(() => onCopyCode && onCopyCode(targetId, "png"), e)
                  }
                  className="px-2.5 py-1 min-h-[25px] rounded-[5px] text-left hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-[#222222] dark:text-[#EDEDED] whitespace-nowrap"
                >
                  Copy PNG
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) =>
                    handleAction(() => onCopyCode && onCopyCode(targetId, "css"), e)
                  }
                  className="px-2.5 py-1 min-h-[25px] rounded-[5px] text-left hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-[#222222] dark:text-[#EDEDED] whitespace-nowrap"
                >
                  Copy CSS
                </button>
              </div>
            )}
          </div>

          <div className="my-[3px] border-t border-[#E4E4E7]/80 dark:border-[#2E2E32]" />

          {/* Section 3: Pasting & Duplicating */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onPaste && onPaste(targetId), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Paste</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Ctrl + V
            </span>
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onPasteOnTop && onPasteOnTop(targetId), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Paste on top</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Ctrl + Shift + V
            </span>
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) =>
              handleAction(() => onPasteToReplace && onPasteToReplace(targetId), e)
            }
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Paste to replace</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Ctrl + Shift + R
            </span>
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onDuplicate && onDuplicate(targetId), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Duplicate</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Ctrl + D
            </span>
          </button>

          <div className="my-[3px] border-t border-[#E4E4E7]/80 dark:border-[#2E2E32]" />

          {/* Section 4: Styles */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onCopyStyles && onCopyStyles(targetId), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Copy styles</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Ctrl + Alt + C
            </span>
          </button>

          <button
            type="button"
            disabled={!hasCopiedStyles}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              if (hasCopiedStyles) {
                handleAction(() => onPasteStyles && onPasteStyles(targetId), e);
              }
            }}
            className={`flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors ${
              hasCopiedStyles
                ? "hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
                : "opacity-35 cursor-default text-[#8E8E93]"
            }`}
          >
            <span>Paste styles</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Ctrl + Alt + V
            </span>
          </button>

          <div className="my-[3px] border-t border-[#E4E4E7]/80 dark:border-[#2E2E32]" />

          {/* Section 5: Structure & Layout */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onRename && onRename(targetId), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Rename</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Ctrl + R
            </span>
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) =>
              handleAction(() => onFrameSelection && onFrameSelection(targetId), e)
            }
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Frame selection</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Shift + F
            </span>
          </button>

          {isFlex ? (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => handleAction(() => onRemoveFlex && onRemoveFlex(targetId), e)}
              className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
            >
              <span>Remove flex</span>
              <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
                Shift + Alt + A
              </span>
            </button>
          ) : (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => handleAction(() => onWrapInFlex && onWrapInFlex(targetId), e)}
              className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
            >
              <span>Add flex</span>
              <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
                Shift + A
              </span>
            </button>
          )}

          {canUngroup && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => handleAction(() => onUngroup && onUngroup(targetId), e)}
              className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
            >
              <span>Ungroup</span>
              <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
                Ctrl + Shift + G
              </span>
            </button>
          )}

          <div className="my-[3px] border-t border-[#E4E4E7]/80 dark:border-[#2E2E32]" />

          {/* Section 6: Z-Index Ordering */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onBringToFront && onBringToFront(targetId), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Bring to front</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              ]
            </span>
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onSendToBack && onSendToBack(targetId), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Send to back</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              [
            </span>
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onMoveUp && onMoveUp(targetId), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Move forward</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Ctrl + ]
            </span>
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onMoveDown && onMoveDown(targetId), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Move backward</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Ctrl + [
            </span>
          </button>

          <div className="my-[3px] border-t border-[#E4E4E7]/80 dark:border-[#2E2E32]" />

          {/* Section 7: Visibility & Locking */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) =>
              handleAction(() => onToggleVisibility && onToggleVisibility(targetId), e)
            }
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Show / hide</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Ctrl + Shift + H
            </span>
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) =>
              handleAction(() => onToggleLock && onToggleLock(targetId), e)
            }
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Lock / unlock</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Ctrl + Shift + L
            </span>
          </button>

          <div className="my-[3px] border-t border-[#E4E4E7]/80 dark:border-[#2E2E32]" />

          {doc?.nodes?.[targetId]?.type === "frame" && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => handleAction(() => onOrganizeFrames && onOrganizeFrames(targetId), e)}
              className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
            >
              <span>Organize frames</span>
              <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
                Alt + Shift + O
              </span>
            </button>
          )}

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onZoomToFit && onZoomToFit(), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Zoom to fit</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Shift + 1
            </span>
          </button>

          {!isSidebar && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => handleAction(() => onHideUi && onHideUi(), e)}
              className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
            >
              <span>{isUiHidden ? "Show UI" : "Hide UI"}</span>
              <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
                .
              </span>
            </button>
          )}

          {isSidebar && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => handleAction(() => onCollapseAll && onCollapseAll(), e)}
              className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
            >
              <span>Collapse all</span>
            </button>
          )}

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => handleAction(() => onDelete && onDelete(targetId), e)}
            className="flex items-center justify-between px-2.5 py-0.5 h-[23px] rounded-[5px] text-left transition-colors hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] cursor-pointer text-[#222222] dark:text-[#EDEDED]"
          >
            <span>Delete</span>
            <span className="text-[11px] font-sans text-[#8E8E93] dark:text-[#8E8E93]">
              Del
            </span>
          </button>
        </>
      )}
    </div>
  );

  return createPortal(menuContent, document.body);
}
