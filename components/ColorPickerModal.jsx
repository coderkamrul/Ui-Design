"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Pipette,
  X,
  Copy,
  Check,
  Menu,
  ChevronDown,
  ChevronsUpDown,
} from "lucide-react";
import {
  rgbToHex,
  hexToRgb,
  rgbToHsl,
  hslToRgb,
  rgbToOklch,
  oklchToRgb,
  colorToRgb,
} from "@/lib/color";

function hsvToRgb(h, s, v) {
  s = Math.max(0, Math.min(100, s)) / 100;
  v = Math.max(0, Math.min(100, v)) / 100;
  const i = Math.floor((h / 60) % 6);
  const f = h / 60 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0,
    g = 0,
    b = 0;
  switch (i) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
    default:
      break;
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  if (max !== min) {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
      default:
        break;
    }
    h *= 60;
  }
  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    v: Math.round(v * 100),
  };
}

/**
 * Pixel-accurate floating Color Picker modal matching Screenshot 1:
 * - Top header with sRGB / Display P3 switcher, Eyedropper, Menu, Close
 * - 2D Saturation / Value gradient area with draggable indicator ring
 * - Vertical Alpha / Opacity slider
 * - Vertical Hue rainbow slider
 * - Side-by-side Previous vs New color comparison
 * - Interactive LCH, HSL, and RGB numerical inputs with quick-copy buttons
 * - Bottom Hex / Opacity bar
 */
export default function ColorPickerModal({
  color = "#EA4133",
  alpha = 1,
  onChange,
  onClose,
  position = null,
  ignoreClickRef = null,
}) {
  const modalRef = useRef(null);
  const satValRef = useRef(null);
  const hueSliderRef = useRef(null);
  const alphaSliderRef = useRef(null);
  const menuRef = useRef(null);
  const formatMenuRef = useRef(null);

  // Preserve initial color for Previous / New comparison
  const [initialColor] = useState(color);
  const [initialAlpha] = useState(alpha);

  const [colorSpace, setColorSpace] = useState("sRGB"); // 'sRGB' | 'Display P3'
  const [copiedSection, setCopiedSection] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hueStrategy, setHueStrategy] = useState("closest"); // 'closest' | 'chroma' | 'lightness'
  const [selectedFormat, setSelectedFormat] = useState("Hex"); // 'Hex' | 'RGB' | 'HSL' | 'OKLCH'
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);

  const [isEditingBottomHex, setIsEditingBottomHex] = useState(false);
  const [bottomHexInput, setBottomHexInput] = useState("");
  const [isEditingBottomAlpha, setIsEditingBottomAlpha] = useState(false);
  const [bottomAlphaInput, setBottomAlphaInput] = useState("");

  // Derive initial HSV
  const initRgb = colorToRgb(color) || { r: 234, g: 65, b: 51 };
  const initHsv = rgbToHsv(initRgb.r, initRgb.g, initRgb.b);

  const [hue, setHue] = useState(initHsv.h);
  const [saturation, setSaturation] = useState(initHsv.s);
  const [value, setValue] = useState(initHsv.v);
  const [localAlpha, setLocalAlpha] = useState(alpha ?? 1);

  // Synchronize when incoming color changes externally
  useEffect(() => {
    const rgb = colorToRgb(color);
    if (!rgb) return;
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    setHue(hsv.h);
    setSaturation(hsv.s);
    setValue(hsv.v);
  }, [color]);

  useEffect(() => {
    if (alpha != null) setLocalAlpha(alpha);
  }, [alpha]);

  // Derived current color coordinates
  const currentRgb = hsvToRgb(hue, saturation, value);
  const currentHex = rgbToHex(currentRgb).toUpperCase();
  const currentHsl = rgbToHsl(currentRgb);
  const currentOklch = rgbToOklch(currentRgb);

  // Formatted values for display
  const lchDisplay = {
    l: (currentOklch.l * 100).toFixed(1),
    c: currentOklch.c.toFixed(3),
    h: ((currentOklch.h % 360) + 360 % 360).toFixed(1),
  };

  const hslDisplay = {
    h: (((currentHsl.h % 360) + 360) % 360).toFixed(1),
    s: (currentHsl.s * 100).toFixed(1),
    l: (currentHsl.l * 100).toFixed(1),
  };

  const rgbDisplay = {
    r: currentRgb.r,
    g: currentRgb.g,
    b: currentRgb.b,
  };

  const notifyChange = useCallback(
    (nextHex, nextAlpha) => {
      if (onChange) {
        onChange(nextHex, nextAlpha);
      }
    },
    [onChange],
  );

  // --- Drag handling for 2D Saturation / Value Box ---
  const handleSatValPointer = (e) => {
    if (!satValRef.current) return;
    const rect = satValRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

    const s = Math.round((x / rect.width) * 100);
    const v = Math.round((1 - y / rect.height) * 100);

    setSaturation(s);
    setValue(v);

    const rgb = hsvToRgb(hue, s, v);
    const hex = rgbToHex(rgb).toUpperCase();
    notifyChange(hex, localAlpha);
  };

  const onSatValMouseDown = (e) => {
    e.preventDefault();
    handleSatValPointer(e);
    const onMove = (ev) => handleSatValPointer(ev);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // --- Drag handling for Hue Rainbow Slider ---
  const handleHuePointer = (e) => {
    if (!hueSliderRef.current) return;
    const rect = hueSliderRef.current.getBoundingClientRect();
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    const h = Math.round((y / rect.height) * 360) % 360;

    setHue(h);
    let rgb = hsvToRgb(h, saturation, value);

    if (hueStrategy === "chroma" || hueStrategy === "lightness") {
      const origRgb = hsvToRgb(hue, saturation, value);
      const origOklch = rgbToOklch(origRgb);
      const newOklch = rgbToOklch(rgb);
      if (hueStrategy === "chroma") {
        newOklch.c = origOklch.c;
      } else if (hueStrategy === "lightness") {
        newOklch.l = origOklch.l;
      }
      const adjustedRgb = oklchToRgb(newOklch);
      if (adjustedRgb) {
        rgb = adjustedRgb;
        const newHsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
        setSaturation(newHsv.s);
        setValue(newHsv.v);
      }
    }

    const hex = rgbToHex(rgb).toUpperCase();
    notifyChange(hex, localAlpha);
  };

  const onHueMouseDown = (e) => {
    e.preventDefault();
    handleHuePointer(e);
    const onMove = (ev) => handleHuePointer(ev);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // --- Drag handling for Alpha Slider ---
  const handleAlphaPointer = (e) => {
    if (!alphaSliderRef.current) return;
    const rect = alphaSliderRef.current.getBoundingClientRect();
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    const a = Math.round((1 - y / rect.height) * 100) / 100;

    setLocalAlpha(a);
    notifyChange(currentHex, a);
  };

  const onAlphaMouseDown = (e) => {
    e.preventDefault();
    handleAlphaPointer(e);
    const onMove = (ev) => handleAlphaPointer(ev);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Native EyeDropper API
  const handleEyeDropper = async () => {
    if (typeof window !== "undefined" && "EyeDropper" in window) {
      try {
        const eyeDropper = new window.EyeDropper();
        const res = await eyeDropper.open();
        if (res?.sRGBHex) {
          const rgb = hexToRgb(res.sRGBHex);
          if (rgb) {
            const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
            setHue(hsv.h);
            setSaturation(hsv.s);
            setValue(hsv.v);
            notifyChange(res.sRGBHex.toUpperCase(), localAlpha);
          }
        }
      } catch {
        // User canceled eyedropper
      }
    } else {
      alert("EyeDropper is supported in Chromium browsers (Chrome, Edge, Opera).");
    }
  };

  // Copy helper
  const copyText = (text, section) => {
    navigator.clipboard?.writeText(text);
    setCopiedSection(section);
    setTimeout(() => setCopiedSection(null), 1200);
  };

  // Close on outside click
  useEffect(() => {
    const onMouseDown = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) {
        // Only close if not clicking an opener, token editor, or ignored element
        if (
          !e.target.closest("[data-color-opener]") &&
          !e.target.closest("[data-token-editor]") &&
          !e.target.closest("[data-token-row]") &&
          !(ignoreClickRef?.current && ignoreClickRef.current.contains(e.target))
        ) {
          onClose?.();
        }
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [onClose, ignoreClickRef]);

  // Close format dropdown menu on outside click
  useEffect(() => {
    if (!formatMenuOpen) return;
    const handleFormatMenuClickOutside = (e) => {
      if (formatMenuRef.current && !formatMenuRef.current.contains(e.target)) {
        setFormatMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleFormatMenuClickOutside);
    return () => window.removeEventListener("mousedown", handleFormatMenuClickOutside);
  }, [formatMenuOpen]);

  // Close hamburger menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handleMenuClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleMenuClickOutside);
    return () => window.removeEventListener("mousedown", handleMenuClickOutside);
  }, [menuOpen]);

  // Compute positioning: dynamically positions right next to the clicked opener element
  const modalW = 440;
  const modalH = 400;

  let computedStyle = {};
  if (position && typeof window !== "undefined") {
    if (position.exactLeft !== undefined && position.exactTop !== undefined) {
      computedStyle = {
        left: Math.max(10, Math.min(window.innerWidth - modalW - 10, position.exactLeft)),
        top: Math.max(10, Math.min(window.innerHeight - modalH - 10, position.exactTop)),
      };
    } else {
      const clickX = position.left ?? position.x ?? (window.innerWidth - 300);
      const isRightHalf = clickX > window.innerWidth / 2;

      // Anchor vertically to clicked item, clamped within the viewport
      const clickY = position.top ?? position.y ?? 180;
      const idealTop = clickY - (position.height ? 40 : 100);
      const top = Math.max(10, Math.min(window.innerHeight - modalH - 10, idealTop));

      if (isRightHalf) {
        // Place to the left of the clicked element / right sidebar
        const right = window.innerWidth - clickX + 8;
        computedStyle = { top, right: Math.max(10, right) };
      } else {
        // Place to the right of the clicked element / left sidebar
        const clickRight = position.right ?? (clickX + (position.width || 0));
        const left = clickRight + 8;
        computedStyle = { top, left: Math.min(window.innerWidth - modalW - 10, left) };
      }
    }
  } else {
    // Fallback: place near right sidebar
    computedStyle = { top: 120, right: 300 };
  }

  return (
    <div
      ref={modalRef}
      data-color-picker-modal="true"
      style={computedStyle}
      className="fixed z-50 flex w-[440px] flex-col rounded-xl border border-[#D4D4D8] dark:border-[#333333] bg-[#ECECEE] dark:bg-[#1E1E1E] p-3 text-[#18181B] dark:text-white shadow-2xl select-none font-sans animate-in fade-in zoom-in-95 duration-100"
    >
      {/* -------------------- Top Header -------------------- */}
      <div className="flex items-center justify-between pb-2.5">
        {/* Color space selector (sRGB / Display P3) */}
        <div className="flex items-center rounded-md bg-[#E4E4E7] dark:bg-[#2A2A2A] p-0.5 text-xs">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setColorSpace("sRGB");
            }}
            className={`rounded px-2.5 py-0.5 font-medium transition-colors cursor-pointer ${
              colorSpace === "sRGB"
                ? "bg-white dark:bg-[#3A3A3C] text-[#18181B] dark:text-white shadow-2xs"
                : "text-[#71717A] dark:text-zinc-400 hover:text-[#18181B] dark:hover:text-white"
            }`}
          >
            sRGB
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setColorSpace("Display P3");
            }}
            className={`rounded px-2.5 py-0.5 font-medium transition-colors cursor-pointer ${
              colorSpace === "Display P3"
                ? "bg-white dark:bg-[#3A3A3C] text-[#18181B] dark:text-white shadow-2xs"
                : "text-[#71717A] dark:text-zinc-400 hover:text-[#18181B] dark:hover:text-white"
            }`}
          >
            Display P3
          </button>
        </div>

        {/* Action icons on right */}
        <div className="flex items-center gap-1 text-[#71717A] dark:text-zinc-400">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleEyeDropper();
            }}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-[#E0E0E2] dark:hover:bg-[#2C2C2E] hover:text-[#18181B] dark:hover:text-white transition-colors cursor-pointer"
            title="Pick color from screen (EyeDropper)"
          >
            <Pipette size={13} />
          </button>

          {/* 3-line hamburger menu with options popover */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((prev) => !prev);
              }}
              className={`flex h-6 w-6 items-center justify-center rounded transition-colors cursor-pointer ${
                menuOpen
                  ? "bg-[#E0E0E2] dark:bg-[#2C2C2E] text-[#18181B] dark:text-white"
                  : "hover:bg-[#E0E0E2] dark:hover:bg-[#2C2C2E] hover:text-[#18181B] dark:hover:text-white"
              }`}
              title="Options"
            >
              <Menu size={13} />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-50 w-44 rounded-xl border border-[#D4D4D8] dark:border-[#333333] bg-[#F7F7F8] dark:bg-[#222222] p-1 shadow-xl text-xs text-[#18181B] dark:text-white font-sans animate-in fade-in duration-75">
                <div className="px-2.5 py-1 text-[11px] font-normal text-[#71717A] dark:text-zinc-400">
                  When changing hue...
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setHueStrategy("closest");
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-[#EAEAEA] dark:hover:bg-[#333333] transition-colors cursor-pointer"
                >
                  <span className="w-3 text-center text-xs font-semibold text-[#18181B] dark:text-white">
                    {hueStrategy === "closest" ? "✓" : ""}
                  </span>
                  <span className="text-[#18181B] dark:text-white">Find closest color</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHueStrategy("chroma");
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-[#EAEAEA] dark:hover:bg-[#333333] transition-colors cursor-pointer"
                >
                  <span className="w-3 text-center text-xs font-semibold text-[#18181B] dark:text-white">
                    {hueStrategy === "chroma" ? "✓" : ""}
                  </span>
                  <span className="text-[#18181B] dark:text-white">Maintain chroma</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHueStrategy("lightness");
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-[#EAEAEA] dark:hover:bg-[#333333] transition-colors cursor-pointer"
                >
                  <span className="w-3 text-center text-xs font-semibold text-[#18181B] dark:text-white">
                    {hueStrategy === "lightness" ? "✓" : ""}
                  </span>
                  <span className="text-[#18181B] dark:text-white">Maintain lightness</span>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose?.();
            }}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-[#E0E0E2] dark:hover:bg-[#2C2C2E] hover:text-[#18181B] dark:hover:text-white transition-colors cursor-pointer"
            title="Close color picker"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* -------------------- Main Body -------------------- */}
      <div className="flex gap-2.5 items-stretch">
        {/* 1. 2D Saturation / Value Gradient Box */}
        <div
          ref={satValRef}
          onMouseDown={onSatValMouseDown}
          className="relative h-[168px] w-[160px] shrink-0 cursor-crosshair rounded-md border border-black/10 dark:border-white/10 overflow-hidden"
          style={{
            background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hue}, 100%, 50%))`,
          }}
        >
          {/* Circular Indicator Ring */}
          <div
            className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_2px_1px_rgba(0,0,0,0.6)]"
            style={{
              left: `${saturation}%`,
              top: `${100 - value}%`,
            }}
          />
        </div>

        {/* 2. Vertical Alpha Slider */}
        <div
          ref={alphaSliderRef}
          onMouseDown={onAlphaMouseDown}
          className="relative h-[168px] w-[14px] shrink-0 cursor-ns-resize rounded-full border border-black/15 dark:border-white/10 overflow-hidden"
          style={{
            backgroundImage: `
              linear-gradient(45deg, #ccc 25%, transparent 25%),
              linear-gradient(-45deg, #ccc 25%, transparent 25%),
              linear-gradient(45deg, transparent 75%, #ccc 75%),
              linear-gradient(-45deg, transparent 75%, #ccc 75%)
            `,
            backgroundSize: "6px 6px",
            backgroundColor: "#fff",
          }}
          title="Alpha / Opacity slider"
        >
          {/* Gradient overlay */}
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to bottom, ${currentHex}, transparent)`,
            }}
          />
          {/* Thumb handle */}
          <div
            className="pointer-events-none absolute left-0 right-0 h-2 -translate-y-1/2 rounded-full border border-black/40 bg-white shadow-xs"
            style={{
              top: `${(1 - localAlpha) * 100}%`,
            }}
          />
        </div>

        {/* 3. Vertical Hue Rainbow Slider */}
        <div
          ref={hueSliderRef}
          onMouseDown={onHueMouseDown}
          className="relative h-[168px] w-[14px] shrink-0 cursor-ns-resize rounded-full border border-black/15 dark:border-white/10 overflow-hidden"
          style={{
            background:
              "linear-gradient(to bottom, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)",
          }}
          title="Hue slider"
        >
          {/* Thumb handle */}
          <div
            className="pointer-events-none absolute left-0 right-0 h-2 -translate-y-1/2 rounded-full border border-black/40 bg-white shadow-xs"
            style={{
              top: `${(hue / 360) * 100}%`,
            }}
          />
        </div>

        {/* 4. Right Coordinate Panels & Swatches */}
        <div className="flex flex-1 flex-col justify-between min-w-0 pl-1">
          {/* Previous vs New Swatches */}
          <div className="flex flex-col gap-0.5">
            <div className="flex h-9 w-full rounded-md border border-black/10 dark:border-white/10 overflow-hidden shadow-2xs">
              {/* Previous Color */}
              <div
                onClick={() => {
                  const rgb = colorToRgb(initialColor);
                  if (rgb) {
                    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
                    setHue(hsv.h);
                    setSaturation(hsv.s);
                    setValue(hsv.v);
                    setLocalAlpha(initialAlpha);
                    notifyChange(initialColor, initialAlpha);
                  }
                }}
                className="flex-1 cursor-pointer transition-opacity hover:opacity-85"
                style={{ backgroundColor: initialColor }}
                title="Click to restore previous color"
              />
              {/* New Color */}
              <div
                className="flex-1"
                style={{ backgroundColor: currentHex }}
                title="Current live color"
              />
            </div>
            <div className="flex justify-between px-1 text-[10px] text-[#71717A] dark:text-zinc-400 font-sans">
              <span>Previous</span>
              <span>New</span>
            </div>
          </div>

          {/* Coordinate Rows */}
          <div className="flex flex-col gap-1.5 pt-1">
            {/* L C H */}
            <div className="flex flex-col">
              <div className="flex items-center gap-1">
                <div className="grid grid-cols-3 gap-1 flex-1">
                  <div className="flex h-6 items-center justify-center rounded border border-[#E4E4E7] dark:border-transparent bg-white dark:bg-[#2A2A2A] text-center text-xs font-mono text-[#18181B] dark:text-zinc-200">
                    {lchDisplay.l}
                  </div>
                  <div className="flex h-6 items-center justify-center rounded border border-[#E4E4E7] dark:border-transparent bg-white dark:bg-[#2A2A2A] text-center text-xs font-mono text-[#18181B] dark:text-zinc-200">
                    {lchDisplay.c}
                  </div>
                  <div className="flex h-6 items-center justify-center rounded border border-[#E4E4E7] dark:border-transparent bg-white dark:bg-[#2A2A2A] text-center text-xs font-mono text-[#18181B] dark:text-zinc-200">
                    {lchDisplay.h}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      `oklch(${lchDisplay.l}% ${lchDisplay.c} ${lchDisplay.h})`,
                      "lch",
                    )
                  }
                  className="flex h-6 w-6 items-center justify-center rounded hover:bg-[#E0E0E2] dark:hover:bg-[#2C2C2E] text-[#71717A] dark:text-zinc-400 hover:text-[#18181B] dark:hover:text-white transition-colors cursor-pointer"
                  title="Copy OKLCH"
                >
                  {copiedSection === "lch" ? <Check size={11} /> : <Copy size={11} />}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1 px-1 pt-0.5 text-center text-[10px] font-sans text-[#71717A] dark:text-zinc-400">
                <span>L</span>
                <span>C</span>
                <span>H</span>
              </div>
            </div>

            {/* H S L */}
            <div className="flex flex-col">
              <div className="flex items-center gap-1">
                <div className="grid grid-cols-3 gap-1 flex-1">
                  <div className="flex h-6 items-center justify-center rounded border border-[#E4E4E7] dark:border-transparent bg-white dark:bg-[#2A2A2A] text-center text-xs font-mono text-[#18181B] dark:text-zinc-200">
                    {hslDisplay.h}
                  </div>
                  <div className="flex h-6 items-center justify-center rounded border border-[#E4E4E7] dark:border-transparent bg-white dark:bg-[#2A2A2A] text-center text-xs font-mono text-[#18181B] dark:text-zinc-200">
                    {hslDisplay.s}
                  </div>
                  <div className="flex h-6 items-center justify-center rounded border border-[#E4E4E7] dark:border-transparent bg-white dark:bg-[#2A2A2A] text-center text-xs font-mono text-[#18181B] dark:text-zinc-200">
                    {hslDisplay.l}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      `hsl(${hslDisplay.h}, ${hslDisplay.s}%, ${hslDisplay.l}%)`,
                      "hsl",
                    )
                  }
                  className="flex h-6 w-6 items-center justify-center rounded hover:bg-[#E0E0E2] dark:hover:bg-[#2C2C2E] text-[#71717A] dark:text-zinc-400 hover:text-[#18181B] dark:hover:text-white transition-colors cursor-pointer"
                  title="Copy HSL"
                >
                  {copiedSection === "hsl" ? <Check size={11} /> : <Copy size={11} />}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1 px-1 pt-0.5 text-center text-[10px] font-sans text-[#71717A] dark:text-zinc-400">
                <span>H</span>
                <span>S</span>
                <span>L</span>
              </div>
            </div>

            {/* R G B */}
            <div className="flex flex-col">
              <div className="flex items-center gap-1">
                <div className="grid grid-cols-3 gap-1 flex-1">
                  <div className="flex h-6 items-center justify-center rounded border border-[#E4E4E7] dark:border-transparent bg-white dark:bg-[#2A2A2A] text-center text-xs font-mono text-[#18181B] dark:text-zinc-200">
                    {rgbDisplay.r}
                  </div>
                  <div className="flex h-6 items-center justify-center rounded border border-[#E4E4E7] dark:border-transparent bg-white dark:bg-[#2A2A2A] text-center text-xs font-mono text-[#18181B] dark:text-zinc-200">
                    {rgbDisplay.g}
                  </div>
                  <div className="flex h-6 items-center justify-center rounded border border-[#E4E4E7] dark:border-transparent bg-white dark:bg-[#2A2A2A] text-center text-xs font-mono text-[#18181B] dark:text-zinc-200">
                    {rgbDisplay.b}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      `rgb(${rgbDisplay.r}, ${rgbDisplay.g}, ${rgbDisplay.b})`,
                      "rgb",
                    )
                  }
                  className="flex h-6 w-6 items-center justify-center rounded hover:bg-[#E0E0E2] dark:hover:bg-[#2C2C2E] text-[#71717A] dark:text-zinc-400 hover:text-[#18181B] dark:hover:text-white transition-colors cursor-pointer"
                  title="Copy RGB"
                >
                  {copiedSection === "rgb" ? <Check size={11} /> : <Copy size={11} />}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1 px-1 pt-0.5 text-center text-[10px] font-sans text-[#71717A] dark:text-zinc-400">
                <span>R</span>
                <span>G</span>
                <span>B</span>
              </div>
            </div>
          </div>

          {/* Bottom Color Code / Opacity Input with Format Selector */}
          <div className="relative mt-2" ref={formatMenuRef}>
            <div className="flex h-7 items-center justify-between rounded-md border border-[#E4E4E7] dark:border-transparent bg-white dark:bg-[#2A2A2A] px-2.5">
              <div className="flex items-center gap-1 font-mono text-xs font-semibold tracking-wider text-[#18181B] dark:text-zinc-100 flex-1 min-w-0">
                {selectedFormat === "Hex" ? (
                  <>
                    <input
                      type="text"
                      value={isEditingBottomHex ? bottomHexInput : currentHex.replace("#", "")}
                      onFocus={(e) => {
                        setIsEditingBottomHex(true);
                        setBottomHexInput(currentHex.replace("#", ""));
                        e.target.select();
                      }}
                      onChange={(e) => {
                        const val = e.target.value.toUpperCase();
                        setBottomHexInput(val);
                        let clean = val.replace("#", "").trim();
                        if (clean.length === 3) {
                          clean = clean.split("").map((c) => c + c).join("");
                        }
                        if (/^[0-9A-F]{6}$/i.test(clean)) {
                          const rgb = hexToRgb(`#${clean}`);
                          if (rgb) {
                            const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
                            setHue(hsv.h);
                            setSaturation(hsv.s);
                            setValue(hsv.v);
                            notifyChange(`#${clean}`, localAlpha);
                          }
                        }
                      }}
                      onBlur={() => {
                        setIsEditingBottomHex(false);
                        let clean = bottomHexInput.replace("#", "").trim();
                        if (clean.length === 3) {
                          clean = clean.split("").map((c) => c + c).join("");
                        }
                        if (/^[0-9A-F]{6}$/i.test(clean)) {
                          const nextHex = `#${clean.toUpperCase()}`;
                          const rgb = hexToRgb(nextHex);
                          if (rgb) {
                            const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
                            setHue(hsv.h);
                            setSaturation(hsv.s);
                            setValue(hsv.v);
                            notifyChange(nextHex, localAlpha);
                          }
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.target.blur();
                        if (e.key === "Escape") setIsEditingBottomHex(false);
                      }}
                      className="w-18 bg-transparent outline-none uppercase font-semibold text-[#18181B] dark:text-zinc-100 cursor-text select-all"
                      placeholder="HEX…"
                    />
                    <span className="text-[#71717A] select-none">/</span>
                    <input
                      type="text"
                      value={isEditingBottomAlpha ? bottomAlphaInput : `${Math.round(localAlpha * 100)}%`}
                      onFocus={(e) => {
                        setIsEditingBottomAlpha(true);
                        setBottomAlphaInput(String(Math.round(localAlpha * 100)));
                        e.target.select();
                      }}
                      onChange={(e) => {
                        const val = e.target.value.replace("%", "").trim();
                        setBottomAlphaInput(val);
                        const num = parseFloat(val);
                        if (!isNaN(num)) {
                          const clamped = Math.max(0, Math.min(100, num)) / 100;
                          setLocalAlpha(clamped);
                          notifyChange(currentHex, clamped);
                        }
                      }}
                      onBlur={() => {
                        setIsEditingBottomAlpha(false);
                        const num = parseFloat(bottomAlphaInput.replace("%", "").trim());
                        if (!isNaN(num)) {
                          const clamped = Math.max(0, Math.min(100, num)) / 100;
                          setLocalAlpha(clamped);
                          notifyChange(currentHex, clamped);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.target.blur();
                        if (e.key === "Escape") setIsEditingBottomAlpha(false);
                      }}
                      className="w-12 bg-transparent outline-none font-semibold text-[#18181B] dark:text-zinc-100 cursor-text select-all"
                      placeholder="100%"
                    />
                  </>
                ) : selectedFormat === "RGB" ? (
                  <span className="truncate text-xs font-mono">
                    {currentRgb.r}, {currentRgb.g}, {currentRgb.b} / {Math.round(localAlpha * 100)}%
                  </span>
                ) : selectedFormat === "HSL" ? (
                  <span className="truncate text-xs font-mono">
                    {Math.round(currentHsl.h)}, {Math.round(currentHsl.s * 100)}%, {Math.round(currentHsl.l * 100)}% / {Math.round(localAlpha * 100)}%
                  </span>
                ) : (
                  <span className="truncate text-xs font-mono">
                    {lchDisplay.l}%, {lchDisplay.c}, {lchDisplay.h} / {Math.round(localAlpha * 100)}%
                  </span>
                )}
              </div>

              {/* Selector arrows button matching Image 2 */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFormatMenuOpen((prev) => !prev);
                }}
                className={`flex h-5 w-5 items-center justify-center rounded transition-colors cursor-pointer ml-1 ${
                  formatMenuOpen
                    ? "text-[#0D99FF] bg-[var(--surface-hover)]"
                    : "text-[#71717A] dark:text-zinc-400 hover:text-[#18181B] dark:hover:text-white"
                }`}
                title="Select color format (Hex, RGB, HSL, OKLCH)"
              >
                <ChevronsUpDown size={12} />
              </button>
            </div>

            {/* Format Dropdown matching Image 2 */}
            {formatMenuOpen && (
              <div
                data-color-format-menu="true"
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 bottom-full mb-1.5 z-50 w-28 rounded-xl border border-[#D4D4D8] dark:border-[#333333] bg-[#F7F7F8] dark:bg-[#222222] p-1 shadow-2xl text-xs text-[#18181B] dark:text-white font-sans animate-in fade-in duration-75 select-none"
              >
                {["OKLCH", "HSL", "RGB", "Hex"].map((fmt) => {
                  const isSelected = selectedFormat === fmt;
                  return (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => {
                        setSelectedFormat(fmt);
                        setFormatMenuOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                        isSelected
                          ? "bg-[#0D99FF] text-white font-medium"
                          : "hover:bg-[#EAEAEA] dark:hover:bg-[#333333] text-[#18181B] dark:text-zinc-200"
                      }`}
                    >
                      <span>{fmt}</span>
                      {isSelected && <Check size={12} strokeWidth={2.5} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
