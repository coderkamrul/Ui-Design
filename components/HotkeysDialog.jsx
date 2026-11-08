"use client";

import React, { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";

export default function HotkeysDialog({ isOpen, onClose }) {
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState({ x: 300, y: 80 });
  const [dragging, setDragging] = useState(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const onMouseDownHeader = (e) => {
    if (e.target.closest("button")) return;
    setDragging(true);
    dragOffsetRef.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
    };
  };

  useEffect(() => {
    if (!dragging) return;
    const onMouseMove = (e) => {
      setPos({
        x: Math.max(10, Math.min(window.innerWidth - 320, e.clientX - dragOffsetRef.current.x)),
        y: Math.max(10, Math.min(window.innerHeight - 300, e.clientY - dragOffsetRef.current.y)),
      });
    };
    const onMouseUp = () => setDragging(false);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragging]);

  if (!isOpen) return null;

  const HOTKEY_SECTIONS = [
    {
      title: "Tools",
      items: [
        { label: "Move", shortcut: "V" },
        { label: "Pan", shortcut: "Space" },
        { label: "Zoom", shortcut: "Z" },
        { label: "Frame", shortcut: "F" },
        { label: "Rectangle", shortcut: "R" },
        { label: "Pen", shortcut: "P" },
        { label: "Text", shortcut: "T" },
        { label: "Measure", shortcut: "Alt" },
        { label: "Comment", shortcut: "C" },
        { label: "Eye dropper", shortcut: "I" },
        { label: "Shaders", shortcut: "S" },
        { label: "Create image", shortcut: "Ctrl + Shift + I" },
        { label: "Add SVG", shortcut: "Alt + V" },
      ],
    },
    {
      title: "Navigation",
      items: [
        { label: "Go to dashboard", shortcut: "Ctrl + Shift + D" },
        { label: "Next page", shortcut: "Page Down" },
        { label: "Previous page", shortcut: "Page Up" },
        { label: "Zoom in", shortcut: "Ctrl + =" },
        { label: "Zoom out", shortcut: "Ctrl + -" },
        { label: "Zoom to 100%", shortcut: "Shift + 0" },
        { label: "Zoom to fit", shortcut: "Shift + 1" },
        { label: "Zoom to selection", shortcut: "Shift + 2" },
      ],
    },
    {
      title: "Canvas & Arrange",
      items: [
        { label: "Bring to front", shortcut: "] / Ctrl + Shift + ]" },
        { label: "Send to back", shortcut: "[ / Ctrl + Shift + [" },
        { label: "Bring forward", shortcut: "Ctrl + ]" },
        { label: "Send backward", shortcut: "Ctrl + [" },
        { label: "Undo", shortcut: "Ctrl + Z" },
        { label: "Redo", shortcut: "Ctrl + Shift + Z" },
        { label: "Duplicate", shortcut: "Ctrl + D" },
        { label: "Delete", shortcut: "Del" },
        { label: "Hide UI", shortcut: "." },
        { label: "Cursor chat", shortcut: "/" },
        { label: "Toggle guides", shortcut: "Shift + G" },
        { label: "Pixel grid", shortcut: "Shift + '" },
        { label: "Snap to pixel", shortcut: "Ctrl + Shift + '" },
        { label: "Export", shortcut: "Ctrl + Shift + E" },
        { label: "Copy as PNG", shortcut: "Ctrl + Shift + C" },
        { label: "Copy as Tailwind", shortcut: "Alt + T" },
        { label: "Copy as React CSS", shortcut: "Alt + R" },
      ],
    },
  ];

  const q = query.trim().toLowerCase();
  const filteredSections = HOTKEY_SECTIONS.map((sec) => ({
    ...sec,
    items: sec.items.filter(
      (item) =>
        !q ||
        item.label.toLowerCase().includes(q) ||
        item.shortcut.toLowerCase().includes(q)
    ),
  })).filter((sec) => sec.items.length > 0);

  return (
    <div
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-[100] flex flex-col drop-shadow-2xl select-none animate-in fade-in duration-150"
    >
      {/* Draggable Header Bar with Tab matching Screenshot 3 */}
      <div
        onMouseDown={onMouseDownHeader}
        className="flex items-end justify-between cursor-move"
      >
        {/* Tab pill */}
        <div className="rounded-t-lg bg-[var(--surface-content)] border-t border-x border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--text-1)] shadow-xs">
          Hotkeys
        </div>
        {/* Drag handle space + Close button */}
        <div className="flex-1 flex justify-end items-center pr-1 pb-1">
          <button
            type="button"
            onClick={onClose}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--surface-hover)] text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors cursor-pointer"
            title="Close"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Main Dialog Box */}
      <div className="w-72 sm:w-80 rounded-b-xl rounded-tr-xl border border-[var(--line)] bg-[var(--surface-content)] shadow-xl flex flex-col overflow-hidden text-xs">
        {/* Search bar matching Screenshot 3 */}
        <div className="p-2.5 border-b border-[var(--line)]">
          <div className="relative flex items-center">
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="absolute left-2.5 text-[var(--text-2)] pointer-events-none"
            >
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L14 14" strokeLinecap="round" />
            </svg>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search hotkeys"
              className="w-full pl-8 pr-2.5 py-1.5 rounded-[6px] border border-[var(--line)] bg-[var(--surface-panel)] text-xs text-[var(--text-1)] placeholder-[var(--text-2)] focus:border-[#0D99FF] focus:ring-1 focus:ring-[#0D99FF] outline-none transition-all"
            />
          </div>
        </div>

        {/* Scrollable Hotkeys list matching Screenshot 3 */}
        <div className="overflow-y-auto max-h-[360px] p-3 flex flex-col gap-3.5">
          {filteredSections.length > 0 ? (
            filteredSections.map((sec) => (
              <div key={sec.title} className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-[var(--text-2)] tracking-wide">
                  {sec.title}
                </span>
                <div className="flex flex-col gap-1">
                  {sec.items.map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between py-0.5 text-xs"
                    >
                      <span className="text-[var(--text-1)]">{item.label}</span>
                      <span className="px-2 py-0.5 rounded-[5px] border border-[var(--line)] bg-[var(--surface-panel)] text-[11px] font-sans text-[var(--text-2)] shadow-2xs">
                        {item.shortcut}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="py-6 text-center text-xs text-[var(--text-2)]">
              No hotkeys found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
