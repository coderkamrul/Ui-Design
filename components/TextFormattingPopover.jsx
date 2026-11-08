"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  ChevronDown,
  Check,
  X,
} from "lucide-react";

export function TextFormattingPopover({
  anchorRef,
  isOpen,
  onClose,
  node,
  patchNodeText,
}) {
  const popoverRef = useRef(null);
  const [coords, setCoords] = useState({ x: 0, y: 0, ready: false });
  const [showWrapMenu, setShowWrapMenu] = useState(false);

  const t = node?.text ?? {};

  // Compute position to the left of the inspector / anchor button
  useLayoutEffect(() => {
    if (!isOpen || !anchorRef?.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const dialogWidth = 280;
    const dialogHeight = 360;
    const pad = 12;

    let x = rect.left - dialogWidth - 8;
    let y = Math.max(pad, Math.min(rect.top - 8, window.innerHeight - dialogHeight - pad));
    if (x < pad) {
      x = pad;
    }

    setCoords({ x, y, ready: true });
  }, [isOpen, anchorRef]);

  // Click outside and Escape key handling
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target) &&
        anchorRef?.current &&
        !anchorRef.current.contains(e.target)
      ) {
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
      window.addEventListener("keydown", handleKeyDown);
    }, 10);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose, anchorRef]);

  if (!isOpen || !node) return null;

  const currentAlign = t.align ?? "left";
  const currentCase = t.case ?? "none";
  const currentWrap = t.wrap ?? "normal";
  const keepWords = Boolean(t.keepWords);
  const truncation = Boolean(t.truncation);

  const wrapLabelMap = {
    normal: "Normal",
    "break-word": "Break word",
    none: "No wrap",
  };

  return createPortal(
    <div
      ref={popoverRef}
      onContextMenu={(e) => e.stopPropagation()}
      className="fixed z-[10001] w-[280px] rounded-2xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-[#F7F7F8] dark:bg-[#1C1C1E] p-3 text-xs text-[#18181B] dark:text-[#EDEDED] shadow-2xl shadow-black/15 select-none animate-in fade-in zoom-in-95 duration-100 flex flex-col font-sans"
      style={{
        left: `${coords.x}px`,
        top: `${coords.y}px`,
        opacity: coords.ready ? 1 : 0,
        pointerEvents: coords.ready ? "auto" : "none",
      }}
    >
      {/* Title Header matching Paper */}
      <div className="flex items-center justify-between mb-2 px-0.5">
        <span className="font-semibold text-[13px] text-[#18181B] dark:text-white">
          Formatting
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-5 w-5 items-center justify-center rounded text-[#71717A] hover:text-[#18181B] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
          title="Close formatting"
        >
          <X size={13} />
        </button>
      </div>

      {/* Preview Card matching Paper reference */}
      <div className="w-full h-28 rounded-xl bg-[#EBECEF] dark:bg-[#27272A] mb-3 flex items-center justify-center p-4 overflow-hidden select-none">
        <span
          style={{
            fontFamily: t.fontFamily || "sans-serif",
            fontWeight: t.fontWeight || 400,
            textAlign: currentAlign,
            textTransform: currentCase !== "none" ? currentCase : undefined,
            fontSize: "18px",
            color: "#9CA3AF",
            width: "100%",
            display: "block",
            whiteSpace: truncation ? "nowrap" : currentWrap === "none" ? "nowrap" : currentWrap === "normal" ? "normal" : "pre-wrap",
            overflow: truncation ? "hidden" : undefined,
            textOverflow: truncation ? "ellipsis" : undefined,
          }}
        >
          Lorem ipsum
        </span>
      </div>

      {/* Row 1: Alignment */}
      <div className="flex items-center justify-between mb-2.5 px-0.5">
        <span className="text-xs text-[#52525B] dark:text-[#A1A1AA]">Alignment</span>
        <div className="flex rounded-lg bg-[#E4E4E7]/70 dark:bg-zinc-800 p-0.5">
          {[
            ["left", <AlignLeft size={13} key="left" />],
            ["center", <AlignCenter size={13} key="center" />],
            ["right", <AlignRight size={13} key="right" />],
            ["justify", <AlignJustify size={13} key="justify" />],
          ].map(([align, icon]) => (
            <button
              key={align}
              type="button"
              onClick={() => patchNodeText(node.id, { align })}
              className={`flex h-6 w-7 items-center justify-center rounded-md transition-all cursor-pointer ${
                currentAlign === align
                  ? "bg-white dark:bg-[#2C2C2E] text-[#18181B] dark:text-white shadow-xs font-medium"
                  : "text-[#71717A] hover:text-[#18181B] dark:hover:text-white"
              }`}
              title={`Align ${align}`}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>

      {/* Row 2: Case */}
      <div className="flex items-center justify-between mb-2.5 px-0.5">
        <span className="text-xs text-[#52525B] dark:text-[#A1A1AA]">Case</span>
        <div className="flex rounded-lg bg-[#E4E4E7]/70 dark:bg-zinc-800 p-0.5">
          {[
            ["none", "/"],
            ["uppercase", "AA"],
            ["lowercase", "aa"],
            ["capitalize", "Aa"],
          ].map(([caseVal, label]) => {
            const isCurrent = currentCase === caseVal;
            return (
              <button
                key={caseVal}
                type="button"
                onClick={() => patchNodeText(node.id, { case: caseVal })}
                className={`flex h-6 px-2.5 items-center justify-center rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                  isCurrent
                    ? "bg-white dark:bg-[#2C2C2E] text-[#18181B] dark:text-white shadow-xs"
                    : "text-[#71717A] hover:text-[#18181B] dark:hover:text-white"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Row 3: Wrap */}
      <div className="relative flex items-center justify-between mb-2.5 px-0.5">
        <span className="text-xs text-[#52525B] dark:text-[#A1A1AA]">Wrap</span>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowWrapMenu(!showWrapMenu)}
            className="flex h-7 items-center gap-1.5 rounded-lg border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#27272A] px-2.5 text-xs text-[#18181B] dark:text-white shadow-2xs hover:border-[#A1A1AA] transition-colors cursor-pointer"
          >
            {/* Wrap Icon */}
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              className="text-[#71717A] dark:text-[#A1A1AA]"
            >
              <path d="M3 4h10a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H4" />
              <path d="M7 7L4 10l3 3" />
            </svg>
            <span>{wrapLabelMap[currentWrap] || "Normal"}</span>
            <ChevronDown
              size={11}
              className={`text-[#71717A] dark:text-[#A1A1AA] ml-1 transition-transform ${
                showWrapMenu ? "rotate-180" : ""
              }`}
            />
          </button>
          {showWrapMenu && (
            <div className="absolute right-0 top-full mt-1 w-32 rounded-xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] p-1 shadow-xl z-50 animate-in fade-in zoom-in-95 duration-100">
              {[
                { id: "normal", label: "Normal" },
                { id: "break-word", label: "Break word" },
                { id: "none", label: "No wrap" },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    patchNodeText(node.id, { wrap: opt.id });
                    setShowWrapMenu(false);
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-[#18181B] dark:text-[#EDEDED]"
                >
                  <span>{opt.label}</span>
                  {currentWrap === opt.id && (
                    <Check size={12} className="text-[#18181B] dark:text-white" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Row 4: Keep words */}
      <div className="flex items-center justify-between mb-2.5 px-0.5">
        <span className="text-xs text-[#52525B] dark:text-[#A1A1AA]">Keep words</span>
        <div className="flex rounded-lg bg-[#E4E4E7]/70 dark:bg-zinc-800 p-0.5">
          <button
            type="button"
            onClick={() => patchNodeText(node.id, { keepWords: false })}
            className={`flex h-6 px-2.5 items-center justify-center rounded-md text-[11px] font-medium transition-all cursor-pointer ${
              !keepWords
                ? "bg-white dark:bg-[#2C2C2E] text-[#18181B] dark:text-white shadow-xs"
                : "text-[#71717A] hover:text-[#18181B] dark:hover:text-white"
            }`}
          >
            Off
          </button>
          <button
            type="button"
            onClick={() => patchNodeText(node.id, { keepWords: true })}
            className={`flex h-6 px-2.5 items-center justify-center rounded-md text-[11px] font-medium transition-all cursor-pointer ${
              keepWords
                ? "bg-white dark:bg-[#2C2C2E] text-[#18181B] dark:text-white shadow-xs"
                : "text-[#71717A] hover:text-[#18181B] dark:hover:text-white"
            }`}
          >
            On
          </button>
        </div>
      </div>

      {/* Row 5: Truncation */}
      <div className="flex items-center justify-between px-0.5">
        <span className="text-xs text-[#52525B] dark:text-[#A1A1AA]">Truncation</span>
        <div className="flex rounded-lg bg-[#E4E4E7]/70 dark:bg-zinc-800 p-0.5">
          <button
            type="button"
            onClick={() => patchNodeText(node.id, { truncation: false })}
            className={`flex h-6 px-2.5 items-center justify-center rounded-md text-[11px] font-medium transition-all cursor-pointer ${
              !truncation
                ? "bg-white dark:bg-[#2C2C2E] text-[#18181B] dark:text-white shadow-xs"
                : "text-[#71717A] hover:text-[#18181B] dark:hover:text-white"
            }`}
          >
            Off
          </button>
          <button
            type="button"
            onClick={() => patchNodeText(node.id, { truncation: true })}
            className={`flex h-6 px-2.5 items-center justify-center rounded-md text-[11px] font-medium transition-all cursor-pointer ${
              truncation
                ? "bg-white dark:bg-[#2C2C2E] text-[#18181B] dark:text-white shadow-xs"
                : "text-[#71717A] hover:text-[#18181B] dark:hover:text-white"
            }`}
          >
            On
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
