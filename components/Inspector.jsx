"use client";

/**
 * Right-sidebar inspector (M2) — working controls for the whole style
 * model, organised after the spec's per-layout sidebar map (Phase 1 v2.5):
 *
 *   Layout (X/Y, rotation, W/H sizing) [+ Flex panel / flex-child state]
 *   Appearance (opacity, blend mode, radius)
 *   Fill (solid / gradient / token-bound)
 *   Outline · Border (per-side)
 *   Shadow · Inner shadow (lists)
 *   Filters (layer + backdrop, 8 sliders each)
 *   Text (for text nodes)
 *
 * Everything commits straight to the Zustand store; the canvas re-renders
 * from the document, so token edits propagate live. X/Y show "–" for
 * multi-selects and are disabled for in-flow flex children (spec).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FILTER_DEFS,
  defaultFilters,
  defaultShadow,
  getToken,
  isTokenRef,
  resolveNumeric,
  resolvePaint,
  resolvePaintColor,
  resolveToken,
  sizePx,
  toHexInput,
} from "@/lib/model";
import {
  nodeToCss,
  nodeToHtmlDocument,
  nodeToReact,
  nodeToTailwind,
  nodeToReactJsx,
  nodeToReactTsx,
  nodeToAstro,
  slugify,
} from "@/lib/codegen";
import {
  colorToRgb,
  formatOklch,
  hslToRgb,
  oklchToHex,
  rgbToHex,
  rgbToHsl,
  rgbToOklch,
  normalizeCssColor,
} from "@/lib/color";
import { fileToAsset } from "@/lib/images";
import { isIgnoredOtherStyle } from "@/lib/snapshot-import";
import { subtreeIds } from "@/lib/geometry";
import {
  PARAM_DEFS as SHADER_PARAM_DEFS,
  PRESETS as SHADER_PRESETS,
  applyPreset as applyShaderPreset,
  defaultShader,
} from "@/lib/shader";
import { useEditorStore } from "@/lib/store";
import ColorPickerModal from "./ColorPickerModal";
import ThemeColorPopover from "./ThemeColorPopover";
import ThemeFontPopover from "./ThemeFontPopover";
import ConnectAgentModal from "./ConnectAgentModal";
import { FontPicker } from "./FontPicker";
import { TextFormattingPopover } from "./TextFormattingPopover";
import {
  Sliders,
  Plus,
  Minus,
  Eye,
  EyeOff,
  Grid,
  Pipette,
  ChevronDown,
  Check,
  X,
  Trash2,
  ArrowDown,
  ArrowRight,
  RotateCw,
  RotateCcw,
  FoldVertical,
  Maximize2,
  FlipHorizontal,
  FlipVertical,
  Type,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Image as ImageIcon,
  Droplet,
  Gauge,
  Copy,
} from "lucide-react";
import { ScrubbableNumberInput, startScrubbing } from "./ScrubbableNumberInput";
import { ColorOpacityInput } from "./ColorOpacityInput";
import LayoutSection from "./LayoutSection";

const BLEND_MODES = [
  "normal",
  "darken",
  "multiply",
  "color-burn",
  "lighten",
  "screen",
  "plus-lighter",
  "color-dodge",
  "overlay",
  "soft-light",
  "hard-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
];

// ---------------------------------------------------------------------------
// Small controls
// ---------------------------------------------------------------------------

const inputCls =
  "h-[var(--row-field-h)] w-full rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 text-[var(--text-1)] disabled:opacity-60";
const selectCls = inputCls;
const miniBtnCls =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] hover:bg-[var(--surface-hover)]";
const addBtnCls =
  "rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 py-1 hover:bg-[var(--surface-hover)]";

/** Number input that edits locally, supports horizontal drag scrubbing, and commits on Enter/blur. */
function NumInput({ value, onCommit, disabled = false, min, max, step = 1, precision = 1 }) {
  return (
    <ScrubbableNumberInput
      value={value}
      onCommit={onCommit}
      disabled={disabled}
      min={min}
      max={max}
      step={step}
      precision={precision}
      className={inputCls}
      inputClassName="w-full text-right text-xs text-[var(--text-1)]"
    />
  );
}

/** Labelled number field (X/Y/W/H style rows) with mouse scrubbing. */
function NumField({ label, value, onCommit, disabled = false, step = 1, min, max, precision = 1 }) {
  return (
    <ScrubbableNumberInput
      label={label}
      value={value}
      onCommit={onCommit}
      disabled={disabled}
      step={step}
      min={min}
      max={max}
      precision={precision}
      className="flex items-center justify-between w-full rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 py-0.5 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors"
      labelClassName="w-4 shrink-0 font-medium text-xs text-[var(--text-2)] hover:text-[var(--text-1)] select-none"
      inputClassName="w-full text-right text-xs text-[var(--text-1)]"
    />
  );
}

/** Text input with the same commit-on-blur pattern (hex fields, names). */
function CommitText({ value, onCommit, disabled = false, placeholder }) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value ?? "");
  }, [value, focused]);
  return (
    <input
      value={text}
      disabled={disabled || !onCommit}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (onCommit && text !== value) onCommit(text);
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setText(value ?? "");
          e.currentTarget.blur();
        }
        e.stopPropagation();
      }}
      className={inputCls}
    />
  );
}

function Section({ title, action, children }) {
  return (
    <div className="mb-4 border-b border-[var(--line)] pb-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[var(--type-label)] font-medium text-[var(--text-2)]">
          {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/**
 * Small labelled numeric field for the colour modes. Like NumInput
 * (local text, commit on Enter/blur) but with a configurable display
 * precision — OKLCH lightness/chroma need 3 decimals, NumInput's fixed
 * 2 would corrupt them on display.
 */
function ColorNum({ label, value, decimals = 0, min, max, onCommit }) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) {
      setText(
        value == null || Number.isNaN(value) ? "" : value.toFixed(decimals),
      );
    }
  }, [value, focused, decimals]);
  const commit = () => {
    const parsed = parseFloat(text);
    if (!Number.isFinite(parsed)) return;
    onCommit(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed)));
  };
  return (
    <label className="flex min-w-0 flex-1 items-center gap-1">
      <span className="shrink-0 text-[var(--text-2)]">{label}</span>
      <input
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") e.currentTarget.blur();
          e.stopPropagation();
        }}
        className={inputCls}
      />
    </label>
  );
}

const COLOR_MODES = [
  { id: "hex", label: "Hex" },
  { id: "rgb", label: "RGB" },
  { id: "hsl", label: "HSL" },
  { id: "oklch", label: "OKLCH" },
];

/**
 * Colour editor row (depth-gap batch): native picker + a Hex / RGB /
 * HSL / OKLCH mode switch + alpha %. The stored value stays a hex
 * string (+ the paint's separate alpha) in EVERY mode — lib/color.js
 * is only a conversion view over it. Committing a field in any mode
 * converts back to hex immediately.
 */
function ColorRow({
  color,
  alpha = 1,
  onChange,
  showAlpha = true,
  tokens = [],
  onBindToken = null,
  tokenName = null,
  tokenId = null,
  unified = false,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [themePopoverOpen, setThemePopoverOpen] = useState(false);
  const [hexInput, setHexInput] = useState("");
  const [isEditingHex, setIsEditingHex] = useState(false);
  const [localTokenName, setLocalTokenName] = useState(null);
  const rowRef = useRef(null);

  const norm = normalizeCssColor(color);
  const cleanHex = (norm.hex || "#163300").replace("#", "").toUpperCase();
  const effectiveAlpha = (alpha != null && !isNaN(alpha)) ? alpha : (norm.alpha ?? 1);

  useEffect(() => {
    if (!isEditingHex) {
      setHexInput(cleanHex);
    }
  }, [cleanHex, isEditingHex]);

  useEffect(() => {
    setLocalTokenName(null);
  }, [color]);

  const displayTokenName =
    tokenName ||
    localTokenName ||
    (tokenId ? tokens?.find((t) => t.id === tokenId)?.name : null);

  const commitHex = (val) => {
    setIsEditingHex(false);
    setLocalTokenName(null);
    let h = val.trim().replace("#", "");
    if (/^[0-9A-Fa-f]{3}$/.test(h)) {
      h = h
        .split("")
        .map((c) => c + c)
        .join("");
    }
    if (/^[0-9A-Fa-f]{6}$/.test(h)) {
      onChange(`#${h.toUpperCase()}`, effectiveAlpha);
    } else {
      setHexInput(cleanHex);
    }
  };

  const handleEyeDropper = async (e) => {
    e.stopPropagation();
    setLocalTokenName(null);
    if (typeof window !== "undefined" && "EyeDropper" in window) {
      try {
        const eyeDropper = new window.EyeDropper();
        const res = await eyeDropper.open();
        if (res?.sRGBHex) {
          onChange(res.sRGBHex.toUpperCase(), alpha);
        }
      } catch {
        // user canceled
      }
    } else {
      alert(
        "EyeDropper is supported in Chromium browsers (Chrome, Edge, Opera).",
      );
    }
  };

  if (unified) {
    return (
      <div className="relative flex items-center w-full">
        {/* Unified Color Field Pill matching Guides Screenshot */}
        <div
          ref={rowRef}
          data-color-opener="true"
          onClick={() => setPickerOpen((prev) => !prev)}
          className={`w-full flex h-[var(--row-field-h)] items-center justify-between rounded-[var(--radius-md)] border bg-[var(--surface-content)] px-2 transition-all cursor-pointer shadow-2xs ${pickerOpen
            ? "border-[#0D99FF] ring-1 ring-[#0D99FF]"
            : "border-[var(--line)] hover:border-[var(--text-2)]"
            }`}
        >
          <div className="flex items-center min-w-0 flex-1">
            {/* Color Swatch Square */}
            <div
              className="relative w-4 h-4 rounded shrink-0 overflow-hidden border border-black/15 shadow-2xs mr-2 cursor-pointer"
              style={{
                backgroundImage: `
                  linear-gradient(45deg, #ddd 25%, transparent 25%),
                  linear-gradient(-45deg, #ddd 25%, transparent 25%),
                  linear-gradient(45deg, transparent 75%, #ddd 75%),
                  linear-gradient(-45deg, transparent 75%, #ddd 75%)
                `,
                backgroundSize: "6px 6px",
              }}
            >
              <div
                className="w-full h-full"
                style={{
                  backgroundColor: norm.hex || "#003880",
                  opacity: effectiveAlpha ?? 0.1,
                }}
              />
            </div>

            {/* Hex / Token Name Input */}
            <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
              {displayTokenName ? (
                <span
                  onClick={() => setThemePopoverOpen((prev) => !prev)}
                  className="text-xs font-medium text-[var(--text-1)] truncate block cursor-pointer select-none"
                  title={`Variable: ${displayTokenName}`}
                >
                  {displayTokenName}
                </span>
              ) : isEditingHex ? (
                <input
                  autoFocus
                  value={hexInput}
                  onChange={(e) => setHexInput(e.target.value)}
                  onBlur={() => commitHex(hexInput)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitHex(hexInput);
                    if (e.key === "Escape") {
                      setHexInput(cleanHex);
                      setIsEditingHex(false);
                    }
                  }}
                  className="w-20 bg-transparent font-mono text-xs font-semibold text-[var(--text-1)] uppercase outline-none"
                />
              ) : (
                <span
                  onClick={() => setIsEditingHex(true)}
                  className="font-mono text-xs font-semibold text-[var(--text-1)] uppercase select-none tracking-wide cursor-text block"
                >
                  {cleanHex}
                </span>
              )}
            </div>
          </div>

          {/* Right side icons embedded inside pill */}
          <div
            className="flex items-center gap-1 shrink-0 ml-1"
            onClick={(e) => e.stopPropagation()}
          >
            {showAlpha && (
              <ColorOpacityInput
                value={Math.round((effectiveAlpha ?? 1) * 100)}
                onChange={(v) => onChange(norm.hex, v / 100)}
                className="text-xs font-medium text-[var(--text-2)] hover:text-[var(--text-1)] text-right w-10 mr-1"
              />
            )}

            {/* Theme Variable Button (Selection colors 4-circle outline icon) */}
            <button
              type="button"
              data-token-popover-trigger="true"
              onClick={(e) => {
                e.stopPropagation();
                setThemePopoverOpen((prev) => !prev);
              }}
              className={`flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer ml-1 ${themePopoverOpen || Boolean(displayTokenName) ? "text-[var(--accent)]" : ""
                }`}
              title="Theme color variables"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                <circle cx="4" cy="4" r="1.8" />
                <circle cx="10" cy="4" r="1.8" />
                <circle cx="4" cy="10" r="1.8" />
                <circle cx="10" cy="10" r="1.8" />
              </svg>
            </button>

            {/* Eyedropper Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleEyeDropper(e);
              }}
              className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer ml-0.5"
              title="Sample color from screen (EyeDropper)"
            >
              <Pipette size={13} />
            </button>
          </div>
        </div>

        {/* Color Picker Modal */}
        {pickerOpen && (
          <ColorPickerModal
            color={norm.hex || "#003880"}
            alpha={effectiveAlpha ?? 1}
            position={rowRef.current?.getBoundingClientRect()}
            onChange={(newHex, newAlpha) => {
              setLocalTokenName(null);
              onChange(newHex, newAlpha);
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}

        {/* Theme Color Popover */}
        {themePopoverOpen && (
          <ThemeColorPopover
            tokens={tokens}
            currentColor={color || "#003880"}
            selectedId={tokenId}
            onSelectToken={(tok) => {
              setLocalTokenName(tok.name);
              if (onBindToken) {
                onBindToken(tok);
              } else {
                onChange(tok.value, alpha);
              }
            }}
            onClose={() => setThemePopoverOpen(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-1.5 w-full">
      {/* Main Color Field Pill matching Screenshot 1 & 2 */}
      <div
        ref={rowRef}
        data-color-opener="true"
        onClick={() => setPickerOpen((prev) => !prev)}
        className={`flex-1 flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border bg-[var(--surface-content)] px-1.5 transition-all cursor-pointer ${pickerOpen || themePopoverOpen
          ? "border-[#0D99FF] ring-1 ring-[#0D99FF]"
          : "border-[var(--line)] hover:border-[var(--text-2)]"
          }`}
      >
        {/* Color Swatch Square */}
        <div
          className="relative w-4 h-4 rounded shrink-0 overflow-hidden border border-black/15 shadow-2xs mr-2"
          style={{
            backgroundImage: `
              linear-gradient(45deg, #ddd 25%, transparent 25%),
              linear-gradient(-45deg, #ddd 25%, transparent 25%),
              linear-gradient(45deg, transparent 75%, #ddd 75%),
              linear-gradient(-45deg, transparent 75%, #ddd 75%)
            `,
            backgroundSize: "6px 6px",
          }}
        >
          <div
            className="w-full h-full"
            style={{
              backgroundColor: norm.hex || "#163300",
              opacity: effectiveAlpha ?? 1,
            }}
          />
        </div>

        {/* Hex / Token Name Input */}
        <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
          {displayTokenName ? (
            <span
              onClick={() => setThemePopoverOpen((prev) => !prev)}
              className="text-xs font-medium text-[var(--text-1)] truncate block cursor-pointer select-none"
              title={`Variable: ${displayTokenName}`}
            >
              {displayTokenName}
            </span>
          ) : isEditingHex ? (
            <input
              autoFocus
              value={hexInput}
              onChange={(e) => setHexInput(e.target.value)}
              onBlur={() => commitHex(hexInput)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitHex(hexInput);
                if (e.key === "Escape") {
                  setHexInput(cleanHex);
                  setIsEditingHex(false);
                }
              }}
              className="w-full bg-transparent font-mono text-xs font-semibold text-[var(--text-1)] uppercase outline-none"
            />
          ) : (
            <span
              onClick={() => setIsEditingHex(true)}
              className="font-mono text-xs font-semibold text-[var(--text-1)] uppercase select-none tracking-wide cursor-text block"
            >
              {cleanHex}
            </span>
          )}
        </div>

        {/* Opacity */}
        {showAlpha && (
          <div className="shrink-0 ml-1" onClick={(e) => e.stopPropagation()}>
            <ColorOpacityInput
              value={Math.round((effectiveAlpha ?? 1) * 100)}
              onChange={(v) => onChange(norm.hex, v / 100)}
              className="text-xs font-medium text-[var(--text-2)] hover:text-[var(--text-1)] text-right w-11"
            />
          </div>
        )}
      </div>

      {/* Theme Variable Button (Selection colors 4-circle outline icon) */}
      <button
        type="button"
        data-token-popover-trigger="true"
        onClick={() => setThemePopoverOpen((prev) => !prev)}
        className={`flex h-[var(--row-field-h)] w-7 items-center justify-center rounded-[var(--radius-md)] border transition-colors cursor-pointer shrink-0 ${themePopoverOpen || Boolean(displayTokenName)
          ? "border-[var(--accent)] bg-[var(--surface-hover)] text-[var(--accent)]"
          : "border-[var(--line)] bg-[var(--surface-content)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)]"
          }`}
        title="Theme color variables"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
          <circle cx="4" cy="4" r="1.8" />
          <circle cx="10" cy="4" r="1.8" />
          <circle cx="4" cy="10" r="1.8" />
          <circle cx="10" cy="10" r="1.8" />
        </svg>
      </button>

      {/* Eyedropper Button (Screenshot 1 & 2) */}
      <button
        type="button"
        onClick={handleEyeDropper}
        className="flex h-[var(--row-field-h)] w-7 items-center justify-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer shrink-0"
        title="Sample color from screen (EyeDropper)"
      >
        <Pipette size={13} />
      </button>

      {/* Color Picker Modal (Screenshot 1) */}
      {pickerOpen && (
        <ColorPickerModal
          color={norm.hex || "#EA4133"}
          alpha={effectiveAlpha ?? 1}
          position={rowRef.current?.getBoundingClientRect()}
          onChange={(newHex, newAlpha) => {
            setLocalTokenName(null);
            onChange(newHex, newAlpha);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {/* Theme Color Popover (Screenshot 2) */}
      {themePopoverOpen && (
        <ThemeColorPopover
          tokens={tokens}
          currentColor={color || "#EA4133"}
          selectedId={tokenId}
          onSelectToken={(tok) => {
            setLocalTokenName(tok.name);
            if (onBindToken) {
              onBindToken(tok);
            } else {
              onChange(tok.value, alpha);
            }
          }}
          onClose={() => setThemePopoverOpen(false)}
        />
      )}
    </div>
  );
}

/** Bound-token chip: swatch (colour tokens), name, detach button. */
function TokenChip({ token, tokens, onDetach }) {
  if (!token) return null;
  const resolved = resolveToken(tokens, token.id);
  return (
    <div className="flex items-center gap-2">
      {token.type === "color" && (
        <span
          className="h-6 w-6 shrink-0 rounded-[var(--radius-sm)] border border-[var(--line)]"
          style={{ background: resolved }}
        />
      )}
      <span className="min-w-0 flex-1 truncate">
        {token.name}
        {token.type !== "color" && (
          <span className="text-[var(--text-2)]"> · {String(resolved)}</span>
        )}
      </span>
      <button
        className={miniBtnCls}
        title="Detach token (restores the literal value)"
        onClick={onDetach}
      >
        ×
      </button>
    </div>
  );
}

/** Dropdown of tokens (filtered by type) for binding a property. */
function TokenBindSelect({ tokens, types, onBind, label = "Bind token…" }) {
  const options = tokens.filter((t) => types.includes(t.type));
  if (options.length === 0) return null;
  return (
    <select
      value=""
      onChange={(e) => {
        if (e.target.value) onBind(e.target.value);
      }}
      className={selectCls}
      title="Bind a token"
    >
      <option value="">{label}</option>
      {options.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name} ({String(resolveToken(tokens, t.id))})
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Sizing (W/H) rows
// ---------------------------------------------------------------------------

function SizingRow({ label, sizing, node, parentIsFlex, tokens, onChange }) {
  const allowFit = node.type === "text" || node.type === "frame" || node.layout?.mode === "flex";
  const showTokens = parentIsFlex || node.type === "frame" || node.layout?.mode === "flex";
  const bindable = tokens.filter(
    (t) => t.type === "spacing" || t.type === "container",
  );
  const selectValue =
    sizing.kind === "token" ? `token:${sizing.tokenId}` : sizing.kind;

  const handleSelect = (v) => {
    if (v.startsWith("token:")) {
      onChange({ kind: "token", tokenId: v.slice("token:".length) });
    } else if (v === "fixed") {
      onChange({ kind: "fixed", px: sizePx(sizing) ?? 100 });
    } else if (v === "relative") {
      onChange({ kind: "relative", pct: 100 });
    } else {
      onChange({ kind: v });
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="w-4 shrink-0 text-[var(--text-2)]">{label}</span>
      <select
        value={selectValue}
        onChange={(e) => handleSelect(e.target.value)}
        className={selectCls}
      >
        <option value="fixed">Fixed</option>
        {allowFit && (
          <>
            <option value="auto">Auto</option>
            <option value="fit">Fit</option>
          </>
        )}
        <option value="fill">Fill</option>
        <option value="relative">Relative</option>
        {showTokens &&
          bindable.map((t) => (
            <option key={t.id} value={`token:${t.id}`}>
              Token: {t.name}
            </option>
          ))}
      </select>
      {sizing.kind === "fixed" && (
        <div className="w-20 shrink-0">
          <NumInput
            value={sizing.px}
            onCommit={(v) => onChange({ kind: "fixed", px: Math.max(1, v) })}
          />
        </div>
      )}
      {sizing.kind === "relative" && (
        <div className="flex w-20 shrink-0 items-center gap-1">
          <NumInput
            value={sizing.pct}
            onCommit={(v) => onChange({ kind: "relative", pct: v })}
          />
          <span className="text-[var(--text-2)]">%</span>
        </div>
      )}
      {sizing.kind === "token" && (
        <span className="shrink-0 text-[var(--text-2)]">
          {String(resolveToken(tokens, sizing.tokenId) ?? "?")}px
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fill section
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Blend Mode Menu & Multi-layer Fill section (Screenshot 1, 3, 4, 5)
// ---------------------------------------------------------------------------

const BLEND_MODE_GROUPS = [
  [{ label: "Normal", value: "normal" }],
  [
    { label: "Darken", value: "darken" },
    { label: "Multiply", value: "multiply" },
    { label: "Color Burn", value: "color-burn" },
  ],
  [
    { label: "Lighten", value: "lighten" },
    { label: "Screen", value: "screen" },
    { label: "Plus Lighter", value: "plus-lighter" },
    { label: "Color Dodge", value: "color-dodge" },
  ],
  [
    { label: "Overlay", value: "overlay" },
    { label: "Soft Light", value: "soft-light" },
    { label: "Hard Light", value: "hard-light" },
  ],
  [
    { label: "Difference", value: "difference" },
    { label: "Exclusion", value: "exclusion" },
  ],
  [
    { label: "Hue", value: "hue" },
    { label: "Saturation", value: "saturation" },
    { label: "Color", value: "color" },
    { label: "Luminosity", value: "luminosity" },
  ],
];

function BlendModeMenu({ currentMode = "normal", onSelect, onClose }) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        if (!e.target.closest("[data-blend-trigger]")) {
          onClose();
        }
      }
    };
    window.addEventListener("mousedown", handleDown);
    return () => window.removeEventListener("mousedown", handleDown);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="absolute right-0 top-full z-50 mt-1.5 flex w-44 flex-col rounded-xl border border-[var(--line)] bg-[var(--surface-content)] py-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100 font-sans"
    >
      {BLEND_MODE_GROUPS.map((group, gIdx) => (
        <div key={gIdx}>
          {gIdx > 0 && <div className="my-1 border-t border-[var(--line)]" />}
          {group.map((item) => {
            const isSelected = (currentMode || "normal") === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => {
                  onSelect(item.value);
                  onClose();
                }}
                className="flex w-full items-center px-2 py-1 text-left text-xs text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
              >
                <span className="flex w-5 items-center justify-start text-[var(--text-1)]">
                  {isSelected && <Check size={13} className="shrink-0" />}
                </span>
                <span className={isSelected ? "font-medium" : ""}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function FillLayerItem({
  fill,
  index,
  totalFills,
  tokens,
  assets,
  addAsset,
  fallbackUrl,
  onUpdate,
  onRemove,
  onToggleVisible,
}) {
  const [blendMenuOpen, setBlendMenuOpen] = useState(false);
  const imgFileRef = useRef(null);
  const [imgError, setImgError] = useState(null);
  const [isUrlPromptOpen, setIsUrlPromptOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [imgDims, setImgDims] = useState(() => ({
    w: fill.width || null,
    h: fill.height || null,
  }));
  const [selectedStopIdx, setSelectedStopIdx] = useState(0);
  const [openStopTokenIdx, setOpenStopTokenIdx] = useState(null);
  const [openStopPickerIdx, setOpenStopPickerIdx] = useState(null);
  const [isGradientOptionsOpen, setIsGradientOptionsOpen] = useState(false);
  const [gradientInterpolation, setGradientInterpolation] = useState("Average color");
  const gradientBarRef = useRef(null);
  const stopRowRefs = useRef({});

  useEffect(() => {
    if (fill.width && fill.height) {
      setImgDims({ w: fill.width, h: fill.height });
      return;
    }
    const url = (fill.assetId && assets?.[fill.assetId]) || fill.url || fill.src || fallbackUrl;
    if (url) {
      const img = new Image();
      img.onload = () => {
        setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
      };
      img.src = url;
    }
  }, [fill.assetId, fill.url, fill.src, fallbackUrl, fill.width, fill.height, assets]);

  const onPickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const asset = await fileToAsset(file);
      addAsset(asset);
      setImgDims({ w: asset.width, h: asset.height });
      onUpdate({
        ...fill,
        kind: "image",
        assetId: asset.id,
        url: asset.dataUrl || asset.url,
        fit: fill.fit ?? "cover",
        fileName: file.name,
        width: asset.width,
        height: asset.height,
      });
      setImgError(null);
    } catch (err) {
      setImgError(err.message);
    }
  };

  const handleUrlSubmit = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    const fileName = trimmed.split("/").pop().split("?")[0] || "image";
    onUpdate({
      ...fill,
      kind: "image",
      assetId: undefined,
      url: trimmed,
      fit: fill.fit ?? "cover",
      fileName,
    });
    setUrlInput("");
    setIsUrlPromptOpen(false);
  };

  const gradientStops =
    fill.kind === "gradient" && fill.stops && fill.stops.length >= 2
      ? fill.stops
      : [
        { color: fill.color || "#163300", alpha: 1, at: 0 },
        { color: "#335120", alpha: 1, at: 100 },
      ];

  const handleInvertStops = () => {
    const inverted = gradientStops
      .map((s) => ({ ...s, at: 100 - s.at }))
      .reverse();
    onUpdate({ ...fill, stops: inverted });
  };

  const handleAddStop = (pos = 50) => {
    const newStop = { color: "#335120", alpha: 1, at: Math.max(0, Math.min(100, pos)) };
    const newStops = [...gradientStops, newStop].sort((a, b) => a.at - b.at);
    onUpdate({ ...fill, stops: newStops });
    setSelectedStopIdx(newStops.findIndex((s) => s === newStop));
  };

  const handleRemoveStop = (idx) => {
    if (gradientStops.length <= 2) return;
    const newStops = gradientStops.filter((_, i) => i !== idx);
    onUpdate({ ...fill, stops: newStops });
    if (selectedStopIdx >= newStops.length) {
      setSelectedStopIdx(Math.max(0, newStops.length - 1));
    }
  };

  const handleDistributeStops = () => {
    const count = gradientStops.length;
    if (count <= 1) return;
    const step = 100 / (count - 1);
    const distributed = gradientStops.map((s, i) => ({
      ...s,
      at: Math.round(i * step),
    }));
    onUpdate({ ...fill, stops: distributed });
  };

  const handleBarClick = (e) => {
    if (!gradientBarRef.current) return;
    const rect = gradientBarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = Math.round((clickX / rect.width) * 100);
    handleAddStop(pct);
  };

  const handleDragStop = (e, stopIndex) => {
    e.preventDefault();
    e.stopPropagation();
    if (!gradientBarRef.current) return;
    const rect = gradientBarRef.current.getBoundingClientRect();

    const onPointerMove = (ev) => {
      const x = ev.clientX - rect.left;
      const at = Math.max(0, Math.min(100, Math.round((x / rect.width) * 100)));
      const updated = gradientStops.map((s, i) => (i === stopIndex ? { ...s, at } : s));
      onUpdate({ ...fill, stops: updated });
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const handleDragMidpoint = (e, index, minAt, maxAt) => {
    e.preventDefault();
    e.stopPropagation();
    if (!gradientBarRef.current) return;
    const rect = gradientBarRef.current.getBoundingClientRect();

    const updatePos = (clientX) => {
      const x = clientX - rect.left;
      const rawPct = Math.round((x / rect.width) * 100);
      const clampedPct = Math.max(minAt, Math.min(maxAt, rawPct));
      const updated = gradientStops.map((s, i) =>
        i === index ? { ...s, midpoint: clampedPct } : s
      );
      onUpdate({ ...fill, stops: updated });
    };

    const onPointerMove = (ev) => {
      updatePos(ev.clientX);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("mouseup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", onPointerUp);
  };

  const isBlendModeActive = fill.blendMode && fill.blendMode !== "normal";

  return (
    <div className="group/layer flex flex-col gap-2">
      <input
        ref={imgFileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPickImage}
      />

      {/* Row 1: Segmented buttons on left, Droplet + Eye + Minus on right */}
      <div className="flex items-center justify-between">
        <div className="flex items-center rounded-[var(--radius-md)] bg-[var(--surface-hover)] p-0.5">
          <button
            type="button"
            onClick={() =>
              onUpdate({
                ...fill,
                kind: "solid",
                color: fill.color || "#163300",
                alpha: fill.alpha ?? 1,
              })
            }
            className={`flex h-6 w-7 items-center justify-center rounded-[var(--radius-sm)] transition-colors cursor-pointer ${fill.kind === "solid" || fill.kind === "token" || !fill.kind
              ? "bg-[var(--surface-content)] text-[var(--text-1)] shadow-2xs font-semibold"
              : "text-[var(--text-2)] hover:text-[var(--text-1)]"
              }`}
            title="Solid fill"
          >
            <div className="h-3 w-3.5 rounded-xs border border-current" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (fill.kind !== "gradient") {
                onUpdate({
                  ...fill,
                  kind: "gradient",
                  gradientType: "linear",
                  angle: 180,
                  stops: [
                    { color: fill.color || "#163300", alpha: 1, at: 0 },
                    { color: "#335120", alpha: 1, at: 100 },
                  ],
                });
              }
            }}
            className={`flex h-6 w-7 items-center justify-center rounded-[var(--radius-sm)] transition-colors cursor-pointer ${fill.kind === "gradient"
              ? "bg-[var(--surface-content)] text-[var(--text-1)] shadow-2xs font-semibold"
              : "text-[var(--text-2)] hover:text-[var(--text-1)]"
              }`}
            title="Gradient fill"
          >
            <div className="h-3 w-3.5 rounded-xs bg-gradient-to-r from-emerald-600 to-lime-500 border border-current/30" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (fill.kind !== "image") {
                const existingUrl = (fill.assetId && assets?.[fill.assetId]) || fill.url || fill.src;
                if (existingUrl) {
                  onUpdate({ ...fill, kind: "image", fit: fill.fit ?? "cover" });
                } else {
                  onUpdate({ ...fill, kind: "image", fit: fill.fit ?? "cover" });
                  imgFileRef.current?.click();
                }
              }
            }}
            className={`flex h-6 w-7 items-center justify-center rounded-[var(--radius-sm)] transition-colors cursor-pointer ${fill.kind === "image"
              ? "bg-[var(--surface-content)] text-[var(--text-1)] shadow-2xs font-semibold"
              : "text-[var(--text-2)] hover:text-[var(--text-1)]"
              }`}
            title="Image fill"
          >
            <ImageIcon size={12} />
          </button>
        </div>

        {/* Action icons: Invert (gradient only), Droplet, Eye, Minus */}
        <div className="flex items-center gap-1 text-[var(--text-2)]">
          {fill.kind === "gradient" && (
            <button
              type="button"
              onClick={handleInvertStops}
              className="rounded p-1 hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] transition-colors cursor-pointer"
              title="Invert gradient stops"
            >
              <RotateCcw size={12} />
            </button>
          )}

          {/* Droplet button for Blend Mode */}
          <div className="relative">
            <button
              type="button"
              data-blend-trigger="true"
              onClick={() => setBlendMenuOpen((prev) => !prev)}
              className={`rounded p-1 transition-all cursor-pointer ${blendMenuOpen || isBlendModeActive
                ? "bg-[var(--surface-hover)] text-[var(--text-1)] opacity-100"
                : "opacity-0 group-hover/layer:opacity-100 hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)]"
                }`}
              title={`Blend mode: ${fill.blendMode || "normal"}`}
            >
              <Droplet size={12} />
            </button>

            {blendMenuOpen && (
              <BlendModeMenu
                currentMode={fill.blendMode || "normal"}
                onSelect={(mode) => onUpdate({ ...fill, blendMode: mode })}
                onClose={() => setBlendMenuOpen(false)}
              />
            )}
          </div>

          <button
            type="button"
            onClick={onToggleVisible}
            className="rounded p-1 hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] transition-colors cursor-pointer"
            title="Toggle visibility"
          >
            {fill.visible !== false ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>

          <button
            type="button"
            onClick={onRemove}
            className="rounded p-1 hover:bg-red-50 hover:text-red-500 transition-colors cursor-pointer"
            title="Remove fill"
          >
            <Minus size={12} />
          </button>
        </div>
      </div>

      {/* Row 2: Solid / Token / Gradient / Image (Unified Pill matching reference) */}
      {(fill.kind === "solid" || fill.kind === "token" || !fill.kind) && (
        <ColorRow
          color={fill.color || "#FFFFFF"}
          alpha={fill.alpha ?? 1}
          unified={true}
          tokenName={fill.tokenName || (fill.tokenId ? tokens?.find((t) => t.id === fill.tokenId)?.name : null)}
          tokenId={fill.tokenId}
          onChange={(color, alpha) =>
            onUpdate({ ...fill, kind: "solid", color, alpha, tokenName: undefined, tokenId: undefined })
          }
          tokens={tokens}
          onBindToken={(tok) =>
            onUpdate({
              ...fill,
              kind: "solid",
              color: tok.value,
              tokenName: tok.name,
              tokenId: tok.id,
            })
          }
        />
      )}

      {/* Gradient Fill controls */}
      {fill.kind === "gradient" && (
        <div className="flex flex-col gap-2.5">
          <div className="relative pt-2 pb-3.5 px-0.5">
            {/* Movable Midpoint Diamonds */}
            {gradientStops.slice(0, -1).map((s1, i) => {
              const s2 = gradientStops[i + 1];
              if (!s2) return null;
              const minAt = Math.min(s1.at, s2.at);
              const maxAt = Math.max(s1.at, s2.at);
              if (maxAt - minAt <= 1) return null;

              let midPos =
                typeof s1.midpoint === "number"
                  ? s1.midpoint
                  : Math.round((minAt + maxAt) / 2);
              midPos = Math.max(minAt + 1, Math.min(maxAt - 1, midPos));

              return (
                <div
                  key={`mid-${i}`}
                  onMouseDown={(e) =>
                    handleDragMidpoint(e, i, minAt + 1, maxAt - 1)
                  }
                  style={{ left: `${midPos}%` }}
                  className="group/mid absolute -top-1.5 z-20 flex -translate-x-1/2 cursor-ew-resize flex-col items-center"
                  title={`Midpoint: ${midPos}% (drag to customize transition)`}
                >
                  <div className="h-2.5 w-2.5 rotate-45 border border-black/40 bg-[var(--text-2)] group-hover/mid:bg-[var(--accent)] group-hover/mid:border-[var(--accent)] group-hover/mid:scale-125 transition-all shadow-xs cursor-ew-resize" />
                </div>
              );
            })}
            <div
              ref={gradientBarRef}
              onClick={handleBarClick}
              style={{
                background: `linear-gradient(90deg, ${gradientStops
                  .map((s, i, arr) => {
                    const base = `${s.color} ${s.at}%`;
                    const next = arr[i + 1];
                    if (typeof s.midpoint === "number" && next) {
                      return `${base}, ${s.midpoint}%`;
                    }
                    return base;
                  })
                  .join(", ")})`,
              }}
              className="relative h-4 w-full cursor-crosshair rounded-sm border border-[var(--line)] shadow-inner"
              title="Click anywhere on the bar to add a color stop"
            />
            {gradientStops.map((stop, i) => {
              const isSelected = selectedStopIdx === i;
              return (
                <div
                  key={i}
                  onMouseDown={(e) => {
                    setSelectedStopIdx(i);
                    handleDragStop(e, i);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedStopIdx(i);
                  }}
                  style={{ left: `${stop.at}%` }}
                  className="group/stop absolute bottom-0 z-20 flex -translate-x-1/2 cursor-ew-resize flex-col items-center"
                  title={`${stop.color} (${stop.at}%)`}
                >
                  <div
                    style={{ borderBottomColor: stop.color }}
                    className="h-0 w-0 border-x-3.5 border-x-transparent border-b-3.5"
                  />
                  <div
                    style={{ backgroundColor: stop.color }}
                    className={`h-3.5 w-3.5 rounded-xs border shadow-xs transition-transform ${isSelected
                      ? "border-white ring-1 ring-[var(--accent)] scale-110"
                      : "border-black/40"
                      }`}
                  />
                </div>
              );
            })}
          </div>

          <div className="relative flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 py-1">
            <div className="relative flex flex-1 items-center gap-2">
              <div
                style={{
                  background: `linear-gradient(135deg, ${gradientStops
                    .map((s) => `${s.color} ${s.at}%`)
                    .join(", ")})`,
                }}
                className="h-4 w-4 shrink-0 rounded border border-[var(--line)] shadow-2xs"
              />
              <select
                value={fill.gradientType ?? "linear"}
                onChange={(e) =>
                  onUpdate({ ...fill, gradientType: e.target.value })
                }
                className="bg-transparent text-xs font-medium text-[var(--text-1)] capitalize outline-none cursor-pointer"
              >
                <option value="linear">Linear</option>
                <option value="radial">Radial</option>
                <option value="conic">Conic</option>
              </select>
            </div>

            <div className="flex items-center gap-2 text-[var(--text-2)]">
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setIsGradientOptionsOpen(!isGradientOptionsOpen)
                  }
                  className={`rounded p-0.5 hover:text-[var(--text-1)] transition-colors ${isGradientOptionsOpen ? "text-[var(--accent)]" : ""
                    }`}
                  title="Gradient options"
                >
                  <Sliders size={12} />
                </button>

                {isGradientOptionsOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1.5 flex w-56 flex-col gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface-content)] p-3 text-xs shadow-xl animate-in fade-in zoom-in-95 duration-100">
                    <div className="flex items-center justify-between border-b border-[var(--line)] pb-1.5">
                      <span className="font-semibold text-[var(--text-1)]">
                        Gradient options
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsGradientOptionsOpen(false)}
                        className="rounded p-0.5 text-[var(--text-2)] hover:text-[var(--text-1)]"
                      >
                        <X size={12} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[var(--text-2)]">Angle</span>
                      <div className="w-24">
                        <ScrubbableNumberInput
                          value={fill.angle ?? 180}
                          min={0}
                          max={360}
                          suffix="°"
                          onCommit={(v) => onUpdate({ ...fill, angle: v })}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[var(--text-2)]">
                        Interpolation
                      </span>
                      <select
                        value={gradientInterpolation}
                        onChange={(e) =>
                          setGradientInterpolation(e.target.value)
                        }
                        className="rounded border border-[var(--line)] bg-[var(--surface-content)] px-1.5 py-0.5 text-xs text-[var(--text-1)] outline-none"
                      >
                        <option value="Average color">Average color</option>
                        <option value="Linear">Linear</option>
                        <option value="Perceptual">Perceptual</option>
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={handleDistributeStops}
                      className="w-full rounded border border-[var(--line)] bg-[var(--surface-hover)] py-1 text-xs font-medium text-[var(--text-1)] hover:bg-[var(--line)] transition-colors"
                    >
                      Distribute colors
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => handleAddStop()}
                className="p-0.5 hover:text-[var(--text-1)] transition-colors cursor-pointer"
                title="Add color stop"
              >
                <Plus size={12} />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            {gradientStops.map((stop, i) => {
              const isSelected = selectedStopIdx === i;
              const isTokenOpen = openStopTokenIdx === i;
              const stopCleanHex = (stop.color || "#163300").replace("#", "").toUpperCase();
              const stopTokenName =
                stop.tokenName ||
                (stop.tokenId ? tokens?.find((t) => t.id === stop.tokenId)?.name : null);

              return (
                <div
                  key={i}
                  ref={(el) => {
                    if (el) stopRowRefs.current[i] = el;
                  }}
                  onClick={() => setSelectedStopIdx(i)}
                  className={`flex items-center justify-between rounded-[var(--radius-md)] border bg-[var(--surface-content)] px-2 py-1 transition-all ${
                    selectedStopIdx === i
                      ? "border-[var(--accent)]"
                      : "border-[var(--line)]"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {/* Built-in color picker trigger button */}
                    <button
                      type="button"
                      style={{ backgroundColor: stop.color }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenStopPickerIdx(openStopPickerIdx === i ? null : i);
                        setOpenStopTokenIdx(null);
                      }}
                      className="relative h-4 w-4 shrink-0 overflow-hidden rounded border border-[var(--line)] shadow-2xs cursor-pointer hover:scale-110 transition-transform"
                      title="Open built-in color picker"
                    />

                    {/* Built-in Color Picker Modal */}
                    {openStopPickerIdx === i && (
                      <ColorPickerModal
                        color={stop.color || "#163300"}
                        alpha={stop.alpha ?? 1}
                        position={stopRowRefs.current[i]?.getBoundingClientRect()}
                        onChange={(newHex, newAlpha) => {
                          const stops = gradientStops.map((s, j) =>
                            j === i
                              ? {
                                  ...s,
                                  color: newHex,
                                  alpha: newAlpha !== undefined ? newAlpha : (s.alpha ?? 1),
                                  tokenName: undefined,
                                  tokenId: undefined,
                                }
                              : s
                          );
                          onUpdate({ ...fill, stops });
                        }}
                        onClose={() => setOpenStopPickerIdx(null)}
                      />
                    )}

                    {stopTokenName ? (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenStopTokenIdx(isTokenOpen ? null : i);
                          setOpenStopPickerIdx(null);
                        }}
                        className="text-xs font-medium text-[var(--text-1)] truncate block cursor-pointer select-none"
                        title={`Variable: ${stopTokenName}`}
                      >
                        {stopTokenName}
                      </span>
                    ) : (
                      <input
                        type="text"
                        value={stopCleanHex}
                        onChange={(e) => {
                          const val = `#${e.target.value.replace("#", "")}`;
                          const stops = gradientStops.map((s, j) =>
                            j === i
                              ? { ...s, color: val, tokenName: undefined, tokenId: undefined }
                              : s
                          );
                          onUpdate({ ...fill, stops });
                        }}
                        className="w-16 bg-transparent font-mono text-xs font-semibold uppercase text-[var(--text-1)] outline-none"
                      />
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 text-[var(--text-2)] shrink-0 ml-1">
                    <ColorOpacityInput
                      value={Math.round((stop.alpha ?? 1) * 100)}
                      onChange={(op) => {
                        const stops = gradientStops.map((s, j) =>
                          j === i ? { ...s, alpha: op / 100 } : s
                        );
                        onUpdate({ ...fill, stops });
                      }}
                    />

                    {/* Variable select button for gradient stop (Selection colors 4-circle outline icon) */}
                    <div className="relative">
                      <button
                        type="button"
                        data-token-popover-trigger="true"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenStopTokenIdx(isTokenOpen ? null : i);
                        }}
                        className={`flex h-5 w-5 items-center justify-center rounded transition-colors cursor-pointer ${
                          isTokenOpen || stopTokenName
                            ? "text-[var(--accent)] bg-[var(--surface-hover)]"
                            : "text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)]"
                        }`}
                        title="Theme color variables"
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                          <circle cx="4" cy="4" r="1.8" />
                          <circle cx="10" cy="4" r="1.8" />
                          <circle cx="4" cy="10" r="1.8" />
                          <circle cx="10" cy="10" r="1.8" />
                        </svg>
                      </button>

                      {isTokenOpen && (
                        <ThemeColorPopover
                          tokens={tokens}
                          currentColor={stop.color}
                          selectedId={stop.tokenId}
                          onSelectToken={(tok) => {
                            const updatedStops = gradientStops.map((s, j) =>
                              j === i
                                ? {
                                    ...s,
                                    color: tok.value,
                                    tokenName: tok.name,
                                    tokenId: tok.id,
                                  }
                                : s
                            );
                            onUpdate({ ...fill, stops: updatedStops });
                            setOpenStopTokenIdx(null);
                          }}
                          onClose={() => setOpenStopTokenIdx(null)}
                        />
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={gradientStops.length <= 2}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveStop(i);
                      }}
                      className="rounded p-0.5 hover:text-red-500 disabled:opacity-30 disabled:hover:text-[var(--text-2)] transition-colors cursor-pointer"
                      title="Remove stop"
                    >
                      <Minus size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Image Fill controls */}
      {fill.kind === "image" && (() => {
        const imageUrl = (fill.assetId && assets?.[fill.assetId]) || fill.url || fill.src || fallbackUrl;
        return (
          <div className="flex flex-col gap-1.5 mt-1">
            {isUrlPromptOpen && (
              <div className="flex items-center gap-1 mb-1">
                <input
                  type="text"
                  placeholder="https://example.com/image.png"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleUrlSubmit();
                    if (e.key === "Escape") setIsUrlPromptOpen(false);
                  }}
                  className="flex-1 h-6 rounded border border-[var(--line)] bg-[var(--surface-content)] px-1.5 text-xs text-[var(--text-1)] placeholder-[var(--text-2)] focus:outline-none focus:border-[var(--accent)]"
                />
                <button
                  type="button"
                  onClick={handleUrlSubmit}
                  className="h-6 px-1.5 rounded bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer"
                >
                  Apply
                </button>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center min-w-0 flex-1">
                {/* Thumbnail with hover edit overlay */}
                <div
                  onClick={() => imgFileRef.current?.click()}
                  className="relative w-9 h-9 rounded-[var(--radius-sm)] border border-[var(--line)] overflow-hidden shrink-0 group/thumb cursor-pointer bg-[var(--surface-hover)] shadow-2xs"
                  title="Click to replace image"
                >
                  {imageUrl ? (
                    <div
                      className="w-full h-full bg-cover bg-center"
                      style={{
                        backgroundImage: `url(${imageUrl})`,
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[var(--text-2)]">
                      <ImageIcon size={14} />
                    </div>
                  )}
                  {/* Hover Edit overlay */}
                  <div className="absolute inset-0 bg-black/45 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity">
                    <span className="text-[11px] font-medium text-white tracking-wide">Edit</span>
                  </div>
                </div>

                {/* Filename & Dimensions */}
                <div
                  className="flex-1 min-w-0 flex flex-col justify-center ml-2.5 cursor-pointer"
                  onClick={() => imgFileRef.current?.click()}
                  title="Click to replace image"
                >
                  <span className="text-xs font-normal text-[var(--text-1)] truncate leading-tight hover:text-[var(--accent)] transition-colors">
                    {fill.fileName || fill.name || (imageUrl ? imageUrl.split("/").pop().split("?")[0] : "Choose image…")}
                  </span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[11px] font-normal text-[#4f80ff] leading-tight">
                      {imgDims.w && imgDims.h
                        ? `${imgDims.w}×${imgDims.h}`
                        : imageUrl
                        ? "Image loaded"
                        : "Upload image"}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsUrlPromptOpen((v) => !v);
                      }}
                      className="text-[10px] text-[var(--text-2)] hover:text-[var(--text-1)] underline decoration-dotted transition-colors"
                      title="Set by URL"
                    >
                      URL
                    </button>
                  </div>
                </div>
              </div>

              {/* Right side: Dropdown for cover / contain / fill / tile */}
              <div className="relative shrink-0">
                <select
                  value={fill.fit ?? "cover"}
                  onChange={(e) => onUpdate({ ...fill, fit: e.target.value })}
                  className="h-[var(--row-field-h)] appearance-none rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] pl-2 pr-6 text-xs font-medium text-[var(--text-1)] hover:border-[var(--text-2)] focus:border-[var(--accent)] focus:outline-none cursor-pointer transition-colors"
                >
                  <option value="cover">Cover</option>
                  <option value="contain">Contain</option>
                  <option value="fill">Fill</option>
                  <option value="tile">Tile</option>
                </select>
                <svg
                  width="8"
                  height="6"
                  viewBox="0 0 8 6"
                  fill="none"
                  stroke="currentColor"
                  className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-2)]"
                >
                  <path d="M0.75 1.5L4 4.75L7.25 1.5" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function ImageSection({ node, tokens, assets, addAsset, patchNode, patchStyle }) {
  const imgFileRef = useRef(null);
  const [imgDims, setImgDims] = useState(() => ({
    w: node.image?.width || null,
    h: node.image?.height || null,
  }));
  const [isUrlPromptOpen, setIsUrlPromptOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");

  const currentUrl = (node.image?.assetId && assets?.[node.image.assetId]) || node.image?.url || node.src || undefined;
  const currentFit = node.image?.fit || node.style?.fill?.fit || "cover";

  useEffect(() => {
    if (currentUrl) {
      const img = new Image();
      img.onload = () => {
        setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
      };
      img.src = currentUrl;
    }
  }, [currentUrl]);

  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.id === node.id) {
        imgFileRef.current?.click();
      }
    };
    window.addEventListener("inspector:replace-image", handler);
    return () => window.removeEventListener("inspector:replace-image", handler);
  }, [node.id]);

  const onPickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const asset = await fileToAsset(file);
      addAsset(asset);
      setImgDims({ w: asset.width, h: asset.height });
      const nextImage = {
        assetId: asset.id,
        url: asset.dataUrl || asset.url,
        fit: currentFit,
        width: asset.width,
        height: asset.height,
        fileName: file.name,
      };
      patchNode({
        src: asset.dataUrl || asset.url,
        image: nextImage,
      });
      const fills = Array.isArray(node.style?.fills) ? [...node.style.fills] : [];
      const imgFillIdx = fills.findIndex((f) => f && f.kind === "image");
      const updatedFill = {
        kind: "image",
        assetId: asset.id,
        url: asset.dataUrl || asset.url,
        fit: currentFit,
        fileName: file.name,
        width: asset.width,
        height: asset.height,
        visible: true,
      };
      if (imgFillIdx >= 0) {
        fills[imgFillIdx] = updatedFill;
      } else {
        fills.unshift(updatedFill);
      }
      patchStyle({ fills, fill: fills[0] });
    } catch (err) {
      console.error("Failed to load image asset:", err);
    }
  };

  const handleFitChange = (newFit) => {
    patchNode({
      image: {
        ...(node.image || {}),
        fit: newFit,
      },
    });
    const fills = Array.isArray(node.style?.fills) ? [...node.style.fills] : [];
    const imgFillIdx = fills.findIndex((f) => f && f.kind === "image");
    if (imgFillIdx >= 0) {
      fills[imgFillIdx] = { ...fills[imgFillIdx], fit: newFit };
      patchStyle({ fills, fill: fills[0] });
    }
  };

  const handleUrlSubmit = () => {
    if (!urlInput.trim()) return;
    const cleanUrl = urlInput.trim();
    patchNode({
      src: cleanUrl,
      image: {
        ...(node.image || {}),
        url: cleanUrl,
        assetId: undefined,
        fit: currentFit,
      },
    });
    const fills = Array.isArray(node.style?.fills) ? [...node.style.fills] : [];
    const imgFillIdx = fills.findIndex((f) => f && f.kind === "image");
    const updatedFill = {
      kind: "image",
      url: cleanUrl,
      fit: currentFit,
      fileName: cleanUrl.split("/").pop().split("?")[0] || "image",
      visible: true,
    };
    if (imgFillIdx >= 0) {
      fills[imgFillIdx] = updatedFill;
    } else {
      fills.unshift(updatedFill);
    }
    patchStyle({ fills, fill: fills[0] });
    setUrlInput("");
    setIsUrlPromptOpen(false);
  };

  return (
    <div className="border-b border-[var(--line)] pb-3 select-none">
      <input
        ref={imgFileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPickImage}
      />
      <div className="flex h-9 items-center justify-between text-xs">
        <span className="font-medium text-[var(--text-1)]">Image</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsUrlPromptOpen((v) => !v)}
            className="rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
            title="Paste image URL"
          >
            URL
          </button>
          <button
            type="button"
            onClick={() => imgFileRef.current?.click()}
            className="rounded px-2 py-0.5 text-[11px] font-medium text-[var(--accent)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
            title="Choose file to replace image"
          >
            Replace
          </button>
        </div>
      </div>

      {isUrlPromptOpen && (
        <div className="mb-2 flex items-center gap-1">
          <input
            type="text"
            placeholder="https://example.com/image.png"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleUrlSubmit();
              if (e.key === "Escape") setIsUrlPromptOpen(false);
            }}
            className="flex-1 h-7 rounded border border-[var(--line)] bg-[var(--surface-content)] px-2 text-xs text-[var(--text-1)] placeholder-[var(--text-2)] focus:outline-none focus:border-[var(--accent)]"
          />
          <button
            type="button"
            onClick={handleUrlSubmit}
            className="h-7 px-2 rounded bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer"
          >
            Apply
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mt-1">
        <div className="flex items-center min-w-0 flex-1">
          <div
            onClick={() => imgFileRef.current?.click()}
            className="relative w-10 h-10 rounded-[var(--radius-sm)] border border-[var(--line)] overflow-hidden shrink-0 group/thumb cursor-pointer bg-[var(--surface-hover)] shadow-2xs"
            title="Click to replace image"
          >
            {currentUrl ? (
              <div
                className="w-full h-full bg-cover bg-center"
                style={{ backgroundImage: `url(${currentUrl})` }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[var(--text-2)]">
                <ImageIcon size={16} />
              </div>
            )}
            <div className="absolute inset-0 bg-black/45 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity">
              <span className="text-[10px] font-medium text-white tracking-wide">Change</span>
            </div>
          </div>

          <div
            className="flex-1 min-w-0 flex flex-col justify-center ml-2.5 cursor-pointer"
            onClick={() => imgFileRef.current?.click()}
            title="Click to replace image"
          >
            <span className="text-xs font-normal text-[var(--text-1)] truncate leading-tight hover:text-[var(--accent)] transition-colors">
              {node.name && node.name !== "Image"
                ? node.name
                : (currentUrl ? currentUrl.split("/").pop().split("?")[0] : "Choose image…")}
            </span>
            <span className="text-[11px] font-normal text-[#4f80ff] leading-tight mt-0.5">
              {imgDims.w && imgDims.h
                ? `${imgDims.w}×${imgDims.h}`
                : currentUrl
                ? "Image loaded"
                : "Upload image"}
            </span>
          </div>
        </div>

        {/* Fit mode selector */}
        <div className="relative shrink-0">
          <select
            value={currentFit}
            onChange={(e) => handleFitChange(e.target.value)}
            className="h-[var(--row-field-h)] appearance-none rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] pl-2.5 pr-6 text-xs font-medium text-[var(--text-1)] hover:border-[var(--text-2)] focus:border-[var(--accent)] focus:outline-none cursor-pointer transition-colors"
          >
            <option value="cover">Cover</option>
            <option value="contain">Contain</option>
            <option value="fill">Fill</option>
          </select>
          <svg
            width="8"
            height="6"
            viewBox="0 0 8 6"
            fill="none"
            stroke="currentColor"
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-2)]"
          >
            <path d="M0.75 1.5L4 4.75L7.25 1.5" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}

function FillSection({ node, tokens, patchStyle, patchNode }) {
  const assets = useEditorStore((s) => s.doc.assets ?? {});
  const addAsset = useEditorStore((s) => s.addAsset);

  const isImageNode = node.type === "image";
  const nodeImgUrl = (node.image?.assetId && assets?.[node.image.assetId]) || node.image?.url || node.src || undefined;
  const nodeImgAssetId = node.image?.assetId;
  const nodeImgFit = node.image?.fit || "cover";

  // Normalize fills list: node.style.fills or fallback to single node.style.fill
  const rawFills = Array.isArray(node.style?.fills) && node.style.fills.length > 0
    ? node.style.fills
    : node.style?.fill
      ? [node.style.fill]
      : [];

  let fills = [...rawFills];
  // Auto-add image fill for image layer if none exists
  if (isImageNode && (nodeImgUrl || nodeImgAssetId) && !fills.some((f) => f && f.kind === "image")) {
    const defaultImgFill = {
      kind: "image",
      assetId: nodeImgAssetId || undefined,
      url: nodeImgUrl || "",
      fit: nodeImgFit,
      fileName: node.name && node.name !== "Image" ? node.name : (nodeImgUrl ? nodeImgUrl.split("/").pop().split("?")[0] : "image"),
      visible: true,
      blendMode: "normal",
    };
    fills = [defaultImgFill, ...fills];
  } else if (isImageNode && (nodeImgUrl || nodeImgAssetId)) {
    // If an existing image fill lacks a url/assetId, backfill it from the image node
    fills = fills.map((f) => {
      if (f && f.kind === "image" && !f.url && !f.assetId) {
        return {
          ...f,
          url: nodeImgUrl || "",
          assetId: nodeImgAssetId || undefined,
          fileName: f.fileName || (node.name && node.name !== "Image" ? node.name : (nodeImgUrl ? nodeImgUrl.split("/").pop().split("?")[0] : "image")),
        };
      }
      return f;
    });
  }

  const handleAddFill = () => {
    let newFill;
    if (isImageNode && !fills.some((f) => f && f.kind === "image")) {
      newFill = {
        kind: "image",
        assetId: nodeImgAssetId || undefined,
        url: nodeImgUrl || "",
        fit: nodeImgFit,
        fileName: node.name && node.name !== "Image" ? node.name : (nodeImgUrl ? nodeImgUrl.split("/").pop().split("?")[0] : "image"),
        visible: true,
        blendMode: "normal",
      };
    } else {
      newFill = {
        kind: "solid",
        color: fills.length > 0 ? (fills[0].color || "#DDDDDD") : "#F2F2F2",
        alpha: 1,
        visible: true,
        blendMode: "normal",
      };
    }
    const nextFills = [newFill, ...fills];
    patchStyle({
      fills: nextFills,
      fill: nextFills[0],
    });
  };

  const handleUpdateFill = (index, updated) => {
    const nextFills = fills.map((f, i) => (i === index ? updated : f));
    patchStyle({
      fills: nextFills,
      fill: nextFills[0],
    });
    if (isImageNode && updated.kind === "image" && patchNode) {
      const patch = {
        image: {
          ...(node.image || {}),
          assetId: updated.assetId,
          url: updated.url,
          fit: updated.fit || node.image?.fit || "cover",
        },
      };
      if (updated.url) patch.src = updated.url;
      else if (updated.assetId && assets?.[updated.assetId]) patch.src = assets[updated.assetId];
      patchNode(patch);
    }
  };

  const handleRemoveFill = (index) => {
    const nextFills = fills.filter((_, i) => i !== index);
    patchStyle({
      fills: nextFills.length > 0 ? nextFills : undefined,
      fill: nextFills[0] || undefined,
    });
  };

  const handleToggleVisible = (index) => {
    const nextFills = fills.map((f, i) =>
      i === index ? { ...f, visible: f.visible === false ? true : false } : f
    );
    patchStyle({
      fills: nextFills,
      fill: nextFills[0],
    });
  };

  if (!fills.length) {
    return (
      <div
        onClick={handleAddFill}
        className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--line)] text-xs font-normal text-[var(--text-2)] hover:text-black dark:hover:text-white cursor-pointer transition-colors group select-none"
      >
        <span className="font-normal group-hover:text-black dark:group-hover:text-white">Fill</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleAddFill();
          }}
          className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] group-hover:text-black dark:group-hover:text-white transition-colors cursor-pointer"
          title="Add fill"
        >
          <Plus size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-[var(--line)] pb-3 select-none">
      <div className="flex h-9 items-center justify-between text-xs">
        <span className="font-medium text-[var(--text-1)]">Fill</span>
        <button
          type="button"
          onClick={handleAddFill}
          className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] hover:text-black dark:hover:text-white transition-colors cursor-pointer"
          title="Add fill"
        >
          <Plus size={13} />
        </button>
      </div>
      <div className="flex flex-col gap-2.5">
        {fills.map((fillItem, idx) => (
          <div key={idx} className="flex flex-col gap-2.5">
            {idx > 0 && <div className="border-t border-[var(--line)] pt-2" />}
            <FillLayerItem
              fill={fillItem}
              index={idx}
              totalFills={fills.length}
              tokens={tokens}
              assets={assets}
              addAsset={addAsset}
              fallbackUrl={isImageNode ? nodeImgUrl : undefined}
              onUpdate={(updated) => handleUpdateFill(idx, updated)}
              onRemove={() => handleRemoveFill(idx)}
              onToggleVisible={() => handleToggleVisible(idx)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stroke colour (outline / border paints: solid or token)
// ---------------------------------------------------------------------------

function StrokePaintRow({ paint, tokens, onChange, unified = true }) {
  const isToken = paint?.kind === "token" || Boolean(paint?.tokenId) || Boolean(paint?.tokenName);
  const token = isToken
    ? (getToken(tokens, paint.tokenId) || (paint?.tokenName ? { name: paint.tokenName, value: paint.color } : null))
    : null;
  const tokenColor = isToken ? (resolveToken(tokens, paint.tokenId) ?? paint?.color ?? "#000000") : null;

  if (isToken && !unified) {
    return (
      <TokenChip
        token={token}
        tokens={tokens}
        onDetach={() =>
          onChange({
            kind: "solid",
            color: tokenColor,
            alpha: 1,
          })
        }
      />
    );
  }
  const solid = isToken
    ? { color: tokenColor, alpha: 1 }
    : (paint?.kind === "solid" ? paint : { color: "#000000", alpha: 1 });

  return (
    <ColorRow
      color={solid.color}
      alpha={solid.alpha ?? 1}
      tokenName={token?.name || paint?.tokenName}
      tokenId={paint?.tokenId}
      onChange={(color, alpha) => onChange({ kind: "solid", color, alpha, tokenName: undefined, tokenId: undefined })}
      tokens={tokens}
      unified={unified}
      onBindToken={(tok) => onChange({ kind: "token", tokenId: tok.id || tok.name, tokenName: tok.name, color: tok.value, alpha: solid.alpha ?? 1 })}
    />
  );
}

function OutlineSection({ node, tokens, patchStyle }) {
  const style = node.style ?? {};
  const outline = style.outline;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef(null);

  useEffect(() => {
    if (!settingsOpen) return;
    const handleOutside = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setSettingsOpen(false);
      }
    };
    window.addEventListener("mousedown", handleOutside);
    return () => window.removeEventListener("mousedown", handleOutside);
  }, [settingsOpen]);

  const handleAddOutline = () => {
    patchStyle({
      outline: {
        width: 1,
        offset: 0,
        style: "solid",
        paint: { kind: "solid", color: "#000000", alpha: 1 },
        hidden: false,
      },
    });
  };

  const handleRemoveOutline = () => {
    patchStyle({ outline: undefined });
  };

  const handleToggleVisibility = () => {
    if (!outline) return;
    patchStyle({
      outline: {
        ...outline,
        hidden: !outline.hidden,
      },
    });
  };

  const currentStyle = outline?.style || "solid";

  if (!outline) {
    return (
      <div
        onClick={handleAddOutline}
        className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--line)] text-xs font-normal text-[var(--text-2)] hover:text-black dark:hover:text-white cursor-pointer transition-colors group select-none"
      >
        <span className="font-normal group-hover:text-black dark:group-hover:text-white">Outline</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleAddOutline();
          }}
          className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] group-hover:text-black dark:group-hover:text-white transition-colors cursor-pointer"
          title="Add outline"
        >
          <Plus size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-[var(--line)] pb-3 select-none">
      {/* Header Row: "Outline" and Settings Icon Button [ ⊶ ] */}
      <div className="flex h-9 items-center justify-between text-xs">
        <span className="font-medium text-[var(--text-1)]">Outline</span>
        <div className="relative" ref={settingsRef}>
          <button
            type="button"
            onClick={() => setSettingsOpen((prev) => !prev)}
            className={`flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer ${
              settingsOpen ? "text-[var(--text-1)] bg-[var(--surface-hover)]" : ""
            }`}
            title="Outline style"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M3 9.5H2V12H3V9.5Z"></path>
              <path d="M10 6.5H9V12H10V6.5Z"></path>
              <path d="M10 0H9V2.5H10V0Z"></path>
              <path d="M3 0H2V5.5H3V0Z"></path>
              <path
                fill="none"
                stroke="currentColor"
                d="M2.4998 9.5001C3.60427 9.5001 4.49961 8.60475 4.49961 7.50029C4.49961 6.39583 3.60427 5.50049 2.4998 5.50049C1.39534 5.50049 0.5 6.39583 0.5 7.50029C0.5 8.60475 1.39534 9.5001 2.4998 9.5001Z"
              ></path>
              <path
                fill="none"
                stroke="currentColor"
                d="M9.49971 6.4999C10.6041 6.4999 11.4994 5.6046 11.4994 4.5002C11.4994 3.39579 10.6041 2.50049 9.49971 2.50049C8.3953 2.50049 7.5 3.39579 7.5 4.5002C7.5 5.6046 8.3953 6.4999 9.49971 6.4999Z"
              ></path>
            </svg>
          </button>

          {/* Popover dropdown matching screenshot: Solid, Dashed, Dotted with auto-flip to top */}
          {settingsOpen && (() => {
            const r = settingsRef.current?.getBoundingClientRect();
            const openUp = typeof window !== "undefined" && r && (window.innerHeight - r.bottom < 150) && (r.top > 150);
            return (
              <div className={`absolute right-0 z-50 w-32 rounded-xl border border-[var(--line)] bg-[var(--surface-content)] shadow-lg p-1 text-xs animate-in fade-in duration-100 select-none ${
                openUp ? "bottom-full mb-1.5" : "top-full mt-1.5"
              }`}>
                {[
                  { label: "Solid", value: "solid" },
                  { label: "Dashed", value: "dashed" },
                  { label: "Dotted", value: "dotted" },
                ].map((opt) => {
                  const isSelected = currentStyle === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        patchStyle({
                          outline: {
                            ...outline,
                            style: opt.value,
                          },
                        });
                        setSettingsOpen(false);
                      }}
                      className="w-full text-left px-2 py-1.5 hover:bg-[var(--surface-hover)] rounded-md flex items-center gap-2 text-[var(--text-1)] cursor-pointer text-xs"
                    >
                      <div className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                        {isSelected && <Check className="w-3.5 h-3.5 text-[var(--text-1)]" />}
                      </div>
                      <span className="font-medium">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
          {/* Row 1: Width Pill, Offset Pill, Visibility Toggle, Remove Button */}
          <div className="flex items-center gap-1.5">
            {/* Width Pill [ 𝌆 1 ] */}
            <div className="flex-1 flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
              <span
                className="cursor-ew-resize text-[var(--text-2)] hover:text-[var(--text-1)] shrink-0 mr-1.5 flex items-center select-none"
                title="Click and drag horizontally to scrub width"
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  startScrubbing(
                    e,
                    outline.width ?? 1,
                    (newVal) =>
                      patchStyle({
                        outline: { ...outline, width: Math.max(0, newVal) },
                      }),
                    { min: 0, step: 1 }
                  );
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor">
                  <line x1="1" y1="2.5" x2="11" y2="2.5" strokeWidth="1.5" strokeLinecap="round" />
                  <line x1="1" y1="6" x2="11" y2="6" strokeWidth="1.5" strokeLinecap="round" />
                  <line x1="1" y1="9.5" x2="11" y2="9.5" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </span>
              <ScrubbableNumberInput
                value={outline.width ?? 1}
                min={0}
                onCommit={(v) =>
                  patchStyle({
                    outline: { ...outline, width: Math.max(0, v) },
                  })
                }
                inputClassName="w-full text-left text-xs font-medium text-[var(--text-1)] bg-transparent outline-none cursor-text"
              />
            </div>

            {/* Offset Pill [ ⊡ 0 ] */}
            <div className="flex-1 flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
              <span
                className="cursor-ew-resize text-[var(--text-2)] hover:text-[var(--text-1)] shrink-0 mr-1.5 flex items-center select-none"
                title="Click and drag horizontally to scrub offset"
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  startScrubbing(
                    e,
                    outline.offset ?? 0,
                    (newVal) =>
                      patchStyle({
                        outline: { ...outline, offset: newVal },
                      }),
                    { step: 1 }
                  );
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor">
                  <rect x="0.75" y="0.75" width="10.5" height="10.5" rx="1.5" strokeWidth="1.2" />
                  <rect x="3.5" y="3.5" width="5" height="5" rx="0.75" strokeWidth="1.2" />
                </svg>
              </span>
              <ScrubbableNumberInput
                value={outline.offset ?? 0}
                onCommit={(v) =>
                  patchStyle({
                    outline: { ...outline, offset: v },
                  })
                }
                inputClassName="w-full text-left text-xs font-medium text-[var(--text-1)] bg-transparent outline-none cursor-text"
              />
            </div>

            {/* Visibility Toggle Eye Button */}
            <button
              type="button"
              onClick={handleToggleVisibility}
              className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer shrink-0"
              title={outline.hidden ? "Show outline" : "Hide outline"}
            >
              {outline.hidden ? (
                <EyeOff size={14} className="opacity-50" />
              ) : (
                <Eye size={14} />
              )}
            </button>

            {/* Remove Outline Button [ — ] */}
            <button
              type="button"
              onClick={handleRemoveOutline}
              className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer shrink-0"
              title="Remove outline"
            >
              <Minus size={13} />
            </button>
          </div>

          {/* Row 2: Unified Color Pill */}
          <StrokePaintRow
            paint={outline.paint}
            tokens={tokens}
            unified={true}
            onChange={(paint) =>
              patchStyle({ outline: { ...outline, paint } })
            }
          />
        </div>
      </div>
    );
  }

function SideIcon({ side, className = "text-[var(--text-2)]" }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" className={className}>
      <rect x="1" y="1" width="10" height="10" rx="1" strokeWidth="1" opacity={side === "all" ? "1" : "0.35"} />
      {side === "top" && <line x1="1" y1="1.5" x2="11" y2="1.5" strokeWidth="2" strokeLinecap="round" />}
      {side === "bottom" && <line x1="1" y1="10.5" x2="11" y2="10.5" strokeWidth="2" strokeLinecap="round" />}
      {side === "left" && <line x1="1.5" y1="1.5" x2="1.5" y2="11" strokeWidth="2" strokeLinecap="round" />}
      {side === "right" && <line x1="10.5" y1="1.5" x2="10.5" y2="11" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}

function BorderSection({ node, tokens, patchStyle }) {
  const style = node.style ?? {};
  const rawBorders = style.borders ?? (style.border ? [style.border] : []);
  const borders = rawBorders.map((b, i) => ({
    id: b.id || `border_${i}`,
    width: b.width ?? 1,
    side: b.side || "top",
    style: b.style || style.borderStyle || "solid",
    paint: b.paint || { kind: "solid", color: "#000000", alpha: 1 },
    hidden: Boolean(b.hidden),
  }));

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openSideMenuId, setOpenSideMenuId] = useState(null);
  const settingsRef = useRef(null);

  const globalStyle = borders[0]?.style || style.borderStyle || "solid";

  useEffect(() => {
    if (!settingsOpen && !openSideMenuId) return;
    const handleOutside = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setSettingsOpen(false);
      }
      if (!e.target.closest("[data-border-side-menu]")) {
        setOpenSideMenuId(null);
      }
    };
    window.addEventListener("mousedown", handleOutside);
    return () => window.removeEventListener("mousedown", handleOutside);
  }, [settingsOpen, openSideMenuId]);

  const patchBorders = (next) => {
    patchStyle({
      borders: next,
      border: next.length > 0 ? next[0] : undefined,
    });
  };

  const handleAddBorder = () => {
    const existingSides = borders.map((b) => b.side);
    const preferredSides = ["top", "bottom", "left", "right", "all"];
    const nextSide = preferredSides.find((s) => !existingSides.includes(s)) || "all";
    const newBorder = {
      id: `border_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      width: 1,
      side: nextSide,
      style: globalStyle,
      paint: { kind: "solid", color: "#000000", alpha: 1 },
      hidden: false,
    };
    patchBorders([...borders, newBorder]);
  };

  const handleRemoveBorder = (index) => {
    const next = borders.filter((_, i) => i !== index);
    patchBorders(next);
  };

  const updateBorder = (index, patch) => {
    const next = borders.map((b, i) => (i === index ? { ...b, ...patch } : b));
    patchBorders(next);
  };

  const SIDES = [
    { label: "All", value: "all" },
    { label: "Top", value: "top" },
    { label: "Bottom", value: "bottom" },
    { label: "Left", value: "left" },
    { label: "Right", value: "right" },
  ];

  if (!borders.length) {
    return (
      <div
        onClick={handleAddBorder}
        className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--line)] text-xs font-normal text-[var(--text-2)] hover:text-black dark:hover:text-white cursor-pointer transition-colors group select-none"
      >
        <span className="font-normal group-hover:text-black dark:group-hover:text-white">Border</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleAddBorder();
          }}
          className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] group-hover:text-black dark:group-hover:text-white transition-colors cursor-pointer"
          title="Add border"
        >
          <Plus size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-[var(--line)] pb-3 select-none">
      {/* Header Row: "Border" and Action Buttons [ ⊶ ] [ + ] */}
      <div className="flex h-9 items-center justify-between text-xs">
        <span className="font-medium text-[var(--text-1)]">Border</span>
        <div className="flex items-center gap-1">
          {/* Settings button with Solid/Dashed/Dotted dropdown matching Image 2 */}
          <div className="relative" ref={settingsRef}>
            <button
              type="button"
              onClick={() => setSettingsOpen((prev) => !prev)}
              className={`flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer ${
                settingsOpen ? "text-[var(--text-1)] bg-[var(--surface-hover)]" : ""
              }`}
              title="Border style"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <path d="M3 9.5H2V12H3V9.5Z"></path>
                <path d="M10 6.5H9V12H10V6.5Z"></path>
                <path d="M10 0H9V2.5H10V0Z"></path>
                <path d="M3 0H2V5.5H3V0Z"></path>
                <path
                  fill="none"
                  stroke="currentColor"
                  d="M2.4998 9.5001C3.60427 9.5001 4.49961 8.60475 4.49961 7.50029C4.49961 6.39583 3.60427 5.50049 2.4998 5.50049C1.39534 5.50049 0.5 6.39583 0.5 7.50029C0.5 8.60475 1.39534 9.5001 2.4998 9.5001Z"
                ></path>
                <path
                  fill="none"
                  stroke="currentColor"
                  d="M9.49971 6.4999C10.6041 6.4999 11.4994 5.6046 11.4994 4.5002C11.4994 3.39579 10.6041 2.50049 9.49971 2.50049C8.3953 2.50049 7.5 3.39579 7.5 4.5002C7.5 5.6046 8.3953 6.4999 9.49971 6.4999Z"
                ></path>
              </svg>
            </button>

            {/* Popover dropdown matching Image 2 with auto-flip to top */}
            {settingsOpen && (() => {
              const r = settingsRef.current?.getBoundingClientRect();
              const openUp = typeof window !== "undefined" && r && (window.innerHeight - r.bottom < 150) && (r.top > 150);
              return (
                <div className={`absolute right-0 z-50 w-32 rounded-xl border border-[var(--line)] bg-[var(--surface-content)] shadow-lg p-1 text-xs animate-in fade-in duration-100 select-none ${
                  openUp ? "bottom-full mb-1.5" : "top-full mt-1.5"
                }`}>
                  {[
                    { label: "Solid", value: "solid" },
                    { label: "Dashed", value: "dashed" },
                    { label: "Dotted", value: "dotted" },
                  ].map((opt) => {
                    const isSelected = globalStyle === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          patchStyle({ borderStyle: opt.value });
                          if (borders.length > 0) {
                            patchBorders(borders.map((b) => ({ ...b, style: opt.value })));
                          }
                          setSettingsOpen(false);
                        }}
                        className="w-full text-left px-2 py-1.5 hover:bg-[var(--surface-hover)] rounded-md flex items-center gap-2 text-[var(--text-1)] cursor-pointer text-xs"
                      >
                        <div className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                          {isSelected && <Check className="w-3.5 h-3.5 text-[var(--text-1)]" />}
                        </div>
                        <span className="font-medium">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* Plus Add Border Button */}
          <button
            type="button"
            className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--surface-hover)] text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors cursor-pointer"
            onClick={handleAddBorder}
            title="Add border"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        {borders.map((b, index) => {
            const sideInfo = SIDES.find((s) => s.value === b.side) || SIDES[1];
            const isSideOpen = openSideMenuId === b.id;

            return (
              <div key={b.id} className="flex flex-col gap-1.5">
                {/* Row 1: Width Pill, Side Dropdown Pill, Visibility, Remove */}
                <div className="flex items-center gap-1.5">
                  {/* Width Pill [ 𝌆 1 ] */}
                  <div className="flex-1 flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
                    <span
                      className="cursor-ew-resize text-[var(--text-2)] hover:text-[var(--text-1)] shrink-0 mr-1.5 flex items-center select-none"
                      title="Click and drag horizontally to scrub width"
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        startScrubbing(
                          e,
                          b.width ?? 1,
                          (newVal) => updateBorder(index, { width: Math.max(0, newVal) }),
                          { min: 0, step: 1 }
                        );
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor">
                        <line x1="1" y1="2.5" x2="11" y2="2.5" strokeWidth="1.5" strokeLinecap="round" />
                        <line x1="1" y1="6" x2="11" y2="6" strokeWidth="1.5" strokeLinecap="round" />
                        <line x1="1" y1="9.5" x2="11" y2="9.5" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </span>
                    <ScrubbableNumberInput
                      value={b.width ?? 1}
                      min={0}
                      onCommit={(v) => updateBorder(index, { width: Math.max(0, v) })}
                      inputClassName="w-full text-left text-xs font-medium text-[var(--text-1)] bg-transparent outline-none cursor-text"
                    />
                  </div>

                  {/* Side Dropdown Pill [ 🔲 Top ˅ ] */}
                  <div className="flex-1 relative" data-border-side-menu>
                    <button
                      type="button"
                      onClick={() => setOpenSideMenuId(isSideOpen ? null : b.id)}
                      className="w-full flex h-[var(--row-field-h)] items-center justify-between rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] transition-colors text-xs font-medium text-[var(--text-1)] cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <SideIcon side={b.side} />
                        <span className="truncate">{sideInfo.label}</span>
                      </div>
                      <ChevronDown size={11} className="text-[var(--text-2)] shrink-0 ml-1" />
                    </button>

                    {/* Side Dropdown Menu matching Image 3 */}
                    {isSideOpen && (
                      <div className="absolute left-0 top-full mt-1.5 w-32 rounded-xl border border-[var(--line)] bg-[var(--surface-content)] shadow-lg p-1 z-50 text-xs animate-in fade-in duration-100 select-none">
                        {SIDES.map((s) => {
                          const isSelected = b.side === s.value;
                          return (
                            <button
                              key={s.value}
                              type="button"
                              onClick={() => {
                                updateBorder(index, { side: s.value });
                                setOpenSideMenuId(null);
                              }}
                              className="w-full text-left px-2 py-1.5 hover:bg-[var(--surface-hover)] rounded-md flex items-center gap-2 text-[var(--text-1)] cursor-pointer text-xs"
                            >
                              <div className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                                {isSelected && <Check className="w-3.5 h-3.5 text-[var(--text-1)]" />}
                              </div>
                              <span className="font-medium">{s.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Visibility Toggle Eye Button */}
                  <button
                    type="button"
                    onClick={() => updateBorder(index, { hidden: !b.hidden })}
                    className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer shrink-0"
                    title={b.hidden ? "Show border" : "Hide border"}
                  >
                    {b.hidden ? (
                      <EyeOff size={14} className="opacity-50" />
                    ) : (
                      <Eye size={14} />
                    )}
                  </button>

                  {/* Remove Border Button [ — ] */}
                  <button
                    type="button"
                    onClick={() => handleRemoveBorder(index)}
                    className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer shrink-0"
                    title="Remove border"
                  >
                    <Minus size={13} />
                  </button>
                </div>

                {/* Row 2: Unified Color Pill */}
                <StrokePaintRow
                  paint={b.paint}
                  tokens={tokens}
                  unified={true}
                  onChange={(paint) => updateBorder(index, { paint })}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

function ShadowList({
  title,
  shadows,
  shadowType = "box",
  onShadowTypeChange,
  tokens = [],
  onChange,
}) {
  const list = shadows ?? [];
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const settingsRef = useRef(null);

  useEffect(() => {
    if (!isSettingsOpen) return;
    const handleOutside = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setIsSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [isSettingsOpen]);

  const patch = (i, p) =>
    onChange(list.map((s, j) => (j === i ? { ...s, ...p } : s)));

  const renderSettingsMenu = () => (
    <div
      className="absolute right-0 top-full mt-1.5 w-36 rounded-lg bg-[var(--surface-content)] border border-[var(--line)] shadow-xl p-1 z-50 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => {
          onShadowTypeChange?.("box");
          setIsSettingsOpen(false);
        }}
        className={`flex items-center gap-2 w-full px-2 py-1.5 text-xs text-left rounded-md transition-colors cursor-pointer ${
          shadowType !== "drop"
            ? "bg-[var(--surface-hover)] font-medium text-[var(--text-1)]"
            : "text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)]"
        }`}
      >
        <div className="w-3.5 flex items-center justify-center shrink-0">
          {shadowType !== "drop" && <Check size={12} className="stroke-[2.5]" />}
        </div>
        <span>Box shadow</span>
      </button>

      <button
        type="button"
        onClick={() => {
          onShadowTypeChange?.("drop");
          setIsSettingsOpen(false);
        }}
        className={`flex items-center gap-2 w-full px-2 py-1.5 text-xs text-left rounded-md transition-colors cursor-pointer ${
          shadowType === "drop"
            ? "bg-[var(--surface-hover)] font-medium text-[var(--text-1)]"
            : "text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)]"
        }`}
      >
        <div className="w-3.5 flex items-center justify-center shrink-0">
          {shadowType === "drop" && <Check size={12} className="stroke-[2.5]" />}
        </div>
        <span>Drop shadow</span>
      </button>
    </div>
  );

  if (list.length === 0) {
    return (
      <div
        className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--line)] text-xs font-normal text-[var(--text-2)] select-none"
      >
        <span
          onClick={() => onChange([...list, defaultShadow()])}
          className="font-normal hover:text-black dark:hover:text-white cursor-pointer group-hover:text-black dark:group-hover:text-white"
        >
          {title}
        </span>
        <div className="flex items-center gap-1">
          {title === "Shadow" && onShadowTypeChange && (
            <div className="relative" ref={settingsRef}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsSettingsOpen((v) => !v);
                }}
                className={`flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer ${
                  isSettingsOpen ? "bg-[var(--surface-active)] text-[var(--text-1)]" : ""
                }`}
                title="Shadow settings"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M3 9.5H2V12H3V9.5Z" />
                  <path d="M10 6.5H9V12H10V6.5Z" />
                  <path d="M10 0H9V2.5H10V0Z" />
                  <path d="M3 0H2V5.5H3V0Z" />
                  <path fill="none" stroke="currentColor" d="M2.5 9.5C3.6 9.5 4.5 8.6 4.5 7.5C4.5 6.4 3.6 5.5 2.5 5.5C1.4 5.5 0.5 6.4 0.5 7.5C0.5 8.6 1.4 9.5 2.5 9.5Z" />
                  <path fill="none" stroke="currentColor" d="M9.5 6.5C10.6 6.5 11.5 5.6 11.5 4.5C11.5 3.4 10.6 2.5 9.5 2.5C8.4 2.5 7.5 3.4 7.5 4.5C7.5 5.6 8.4 6.5 9.5 6.5Z" />
                </svg>
              </button>
              {isSettingsOpen && renderSettingsMenu()}
            </div>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange([...list, defaultShadow()]);
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] hover:text-black dark:hover:text-white transition-colors cursor-pointer"
            title={`Add ${title.toLowerCase()}`}
          >
            <Plus size={13} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-[var(--line)] pb-3 select-none">
      <div className="flex h-9 items-center justify-between text-xs">
        <span className="font-medium text-[var(--text-1)]">{title}</span>
        <div className="flex items-center gap-1">
          {title === "Shadow" && onShadowTypeChange && (
            <div className="relative" ref={settingsRef}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsSettingsOpen((v) => !v);
                }}
                className={`flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer ${
                  isSettingsOpen ? "bg-[var(--surface-active)] text-[var(--text-1)]" : ""
                }`}
                title="Shadow settings"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M3 9.5H2V12H3V9.5Z" />
                  <path d="M10 6.5H9V12H10V6.5Z" />
                  <path d="M10 0H9V2.5H10V0Z" />
                  <path d="M3 0H2V5.5H3V0Z" />
                  <path fill="none" stroke="currentColor" d="M2.5 9.5C3.6 9.5 4.5 8.6 4.5 7.5C4.5 6.4 3.6 5.5 2.5 5.5C1.4 5.5 0.5 6.4 0.5 7.5C0.5 8.6 1.4 9.5 2.5 9.5Z" />
                  <path fill="none" stroke="currentColor" d="M9.5 6.5C10.6 6.5 11.5 5.6 11.5 4.5C11.5 3.4 10.6 2.5 9.5 2.5C8.4 2.5 7.5 3.4 7.5 4.5C7.5 5.6 8.4 6.5 9.5 6.5Z" />
                </svg>
              </button>
              {isSettingsOpen && renderSettingsMenu()}
            </div>
          )}
          <button
            type="button"
            onClick={() => onChange([...list, defaultShadow()])}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--surface-hover)] text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors cursor-pointer"
            title={`Add ${title.toLowerCase()}`}
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        {list.map((s, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            {/* Row 1: Segmented Input [ X | Y | Blur | (optional Spread) ] + Eye + Remove */}
            <div className="flex items-center gap-1.5">
              <div className="flex-1 flex h-[var(--row-field-h)] items-center bg-[var(--surface-content)] border border-[var(--line)] rounded-[var(--radius-md)] divide-x divide-[var(--line)] shadow-2xs">
                {/* Segment X */}
                <ScrubbableNumberInput
                  label="X"
                  value={s.x ?? 0}
                  onCommit={(v) => patch(i, { x: v })}
                  className="flex-1 px-1.5 justify-between"
                  labelClassName="text-[var(--text-2)] font-mono text-[10px] mr-1"
                  inputClassName="w-full text-right text-xs text-[var(--text-1)] font-medium"
                />
                {/* Segment Y */}
                <ScrubbableNumberInput
                  label="Y"
                  value={s.y ?? 2}
                  onCommit={(v) => patch(i, { y: v })}
                  className="flex-1 px-1.5 justify-between"
                  labelClassName="text-[var(--text-2)] font-mono text-[10px] mr-1"
                  inputClassName="w-full text-right text-xs text-[var(--text-1)] font-medium"
                />
                {/* Segment Blur (░ dot matrix) */}
                <ScrubbableNumberInput
                  label={
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="text-[var(--text-2)]">
                      <circle cx="4" cy="4" r="1.5" />
                      <circle cx="8" cy="4" r="1.5" />
                      <circle cx="12" cy="4" r="1.5" />
                      <circle cx="4" cy="8" r="1.5" />
                      <circle cx="8" cy="8" r="1.5" />
                      <circle cx="12" cy="8" r="1.5" />
                      <circle cx="4" cy="12" r="1.5" />
                      <circle cx="8" cy="12" r="1.5" />
                      <circle cx="12" cy="12" r="1.5" />
                    </svg>
                  }
                  value={s.blur ?? 3}
                  min={0}
                  onCommit={(v) => patch(i, { blur: Math.max(0, v) })}
                  className="flex-1 px-1.5 justify-between"
                  labelClassName="mr-1 flex items-center"
                  inputClassName="w-full text-right text-xs text-[var(--text-1)] font-medium"
                />
                {/* Segment Spread (⧈ concentric squares) - only for Box shadow */}
                {shadowType !== "drop" && (
                  <ScrubbableNumberInput
                    label={
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--text-2)]">
                        <rect x="2" y="2" width="12" height="12" rx="1.5" />
                        <rect x="5.5" y="5.5" width="5" height="5" rx="0.5" />
                      </svg>
                    }
                    value={s.spread ?? 0}
                    onCommit={(v) => patch(i, { spread: v })}
                    className="flex-1 px-1.5 justify-between"
                    labelClassName="mr-1 flex items-center"
                    inputClassName="w-full text-right text-xs text-[var(--text-1)] font-medium"
                  />
                )}
              </div>

              {/* Eye Button */}
              <button
                type="button"
                onClick={() => patch(i, { hidden: !s.hidden })}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                title={s.hidden ? "Show shadow" : "Hide shadow"}
              >
                {s.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>

              {/* Remove Button */}
              <button
                type="button"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                title="Remove shadow"
                onClick={() => onChange(list.filter((_, j) => j !== i))}
              >
                <Minus size={13} />
              </button>
            </div>

            {/* Row 2: Unified Color Pill */}
            <ColorRow
              color={s.color ?? "#000000"}
              alpha={s.alpha ?? 0.2}
              unified={true}
              tokenName={s.tokenName || (s.tokenId ? tokens.find((t) => t.id === s.tokenId)?.name : null)}
              tokenId={s.tokenId}
              onChange={(color, alpha) => patch(i, { color, alpha, tokenName: undefined, tokenId: undefined })}
              tokens={tokens}
              onBindToken={(tok) => patch(i, { color: tok.value, tokenId: tok.id, tokenName: tok.name })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function FiltersSection({ node, patchStyle }) {
  const style = node.style ?? {};
  const currentFilters = style.filters;
  const isEnabled = Boolean(
    currentFilters &&
    Object.keys(currentFilters).some((k) => currentFilters[k] !== defaultFilters()[k])
  );

  const [activeKey, setActiveKey] = useState("blur");
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [filterHidden, setFilterHidden] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (!filterMenuOpen) return;
    const handleOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setFilterMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleOutside);
    return () => window.removeEventListener("mousedown", handleOutside);
  }, [filterMenuOpen]);

  const handleAddFilter = () => {
    const base = { ...defaultFilters(), ...(currentFilters || {}) };
    base.blur = base.blur || 4;
    patchStyle({ filters: base });
    setActiveKey("blur");
    setFilterHidden(false);
  };

  const handleRemoveFilter = () => {
    patchStyle({ filters: undefined });
  };

  if (!isEnabled && !style.filters) {
    return (
      <div
        onClick={handleAddFilter}
        className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--line)] text-xs font-normal text-[var(--text-2)] hover:text-black dark:hover:text-white cursor-pointer transition-colors group select-none"
      >
        <span className="font-normal group-hover:text-black dark:group-hover:text-white">Filters</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleAddFilter();
          }}
          className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] group-hover:text-black dark:group-hover:text-white transition-colors cursor-pointer"
          title="Add filter"
        >
          <Plus size={13} />
        </button>
      </div>
    );
  }

  const selectedDef = FILTER_DEFS.find((d) => d.key === activeKey) || FILTER_DEFS[0];
  const currentVal = currentFilters?.[activeKey] ?? selectedDef.def ?? 4;

  return (
    <div className="border-b border-[var(--line)] pb-3 select-none">
      <div className="flex h-9 items-center justify-between text-xs">
        <span className="font-medium text-[var(--text-1)]">Filters</span>
        <button
          type="button"
          onClick={handleAddFilter}
          className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] hover:text-black dark:hover:text-white transition-colors cursor-pointer"
          title="Add filter"
        >
          <Plus size={13} />
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        {/* Type dropdown [ ░ Blur ∨ ] */}
        <div className="relative flex-1" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setFilterMenuOpen((v) => !v)}
            className="w-full flex h-[var(--row-field-h)] items-center justify-between rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] transition-colors text-xs text-[var(--text-1)] cursor-pointer shadow-2xs"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="text-[var(--text-2)] shrink-0">
                <circle cx="4" cy="4" r="1.5" />
                <circle cx="8" cy="4" r="1.5" />
                <circle cx="12" cy="4" r="1.5" />
                <circle cx="4" cy="8" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="12" cy="8" r="1.5" />
                <circle cx="4" cy="12" r="1.5" />
                <circle cx="8" cy="12" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
              </svg>
              <span className="font-medium truncate">{selectedDef.label}</span>
            </div>
            <ChevronDown size={12} className="text-[var(--text-2)] shrink-0 ml-1" />
          </button>

          {filterMenuOpen && (() => {
            const r = dropdownRef.current?.getBoundingClientRect();
            const openUp = typeof window !== "undefined" && r && (window.innerHeight - r.bottom < 180) && (r.top > 180);
            return (
              <div className={`absolute left-0 z-50 w-36 rounded-xl border border-[var(--line)] bg-[var(--surface-content)] shadow-xl p-1 text-xs animate-in fade-in duration-100 select-none ${
                openUp ? "bottom-full mb-1.5" : "top-full mt-1.5"
              }`}>
                {FILTER_DEFS.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => {
                    setActiveKey(d.key);
                    setFilterMenuOpen(false);
                    const base = { ...defaultFilters(), ...(currentFilters || {}) };
                    if (base[d.key] === d.def) {
                      base[d.key] = d.key === "blur" ? 4 : d.def;
                    }
                    patchStyle({ filters: base });
                  }}
                  className={`w-full text-left px-2 py-1.5 hover:bg-[var(--surface-hover)] rounded-md flex items-center justify-between text-[var(--text-1)] cursor-pointer text-xs ${
                    activeKey === d.key ? "font-semibold bg-[var(--surface-hover)]" : ""
                  }`}
                >
                  <span>{d.label}</span>
                  {activeKey === d.key && <Check size={12} className="text-[var(--text-1)]" />}
                </button>
              ))}
            </div>
          );
        })()}
        </div>

        {/* Amount input [ ⏱ 4 ] */}
        <div className="w-24 flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] transition-colors shadow-2xs">
          <span className="text-[var(--text-2)] mr-1 flex items-center shrink-0">
            <Gauge size={12} />
          </span>
          <ScrubbableNumberInput
            value={currentVal}
            min={selectedDef.min}
            max={selectedDef.max}
            onCommit={(val) => {
              const base = { ...defaultFilters(), ...(currentFilters || {}) };
              base[activeKey] = val;
              patchStyle({ filters: base });
            }}
            inputClassName="w-full text-right text-xs font-medium text-[var(--text-1)] bg-transparent outline-none cursor-text"
          />
        </div>

        {/* Eye Button */}
        <button
          type="button"
          onClick={() => {
            const nextHidden = !filterHidden;
            setFilterHidden(nextHidden);
            if (nextHidden) {
              patchStyle({ filters: undefined });
            } else {
              const base = { ...defaultFilters() };
              base[activeKey] = currentVal || 4;
              patchStyle({ filters: base });
            }
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
          title="Toggle filter visibility"
        >
          {filterHidden ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>

        {/* Minus Button */}
        <button
          type="button"
          onClick={handleRemoveFilter}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-2)] hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
          title="Remove filter"
        >
          <Minus size={13} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Radius
// ---------------------------------------------------------------------------

const CORNERS = [
  ["tl", "TL"],
  ["tr", "TR"],
  ["br", "BR"],
  ["bl", "BL"],
];

function FourCornersIcon({ className = "w-3.5 h-3.5" }) {
  return (
    <svg className={className} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M1.5 4.5V2.5A1 1 0 0 1 2.5 1.5H4.5" />
      <path d="M9.5 1.5H11.5A1 1 0 0 1 12.5 2.5V4.5" />
      <path d="M12.5 9.5V11.5A1 1 0 0 1 11.5 12.5H9.5" />
      <path d="M4.5 12.5H2.5A1 1 0 0 1 1.5 11.5V9.5" />
    </svg>
  );
}

function CornerIcon({ corner = "tl", className = "w-3.5 h-3.5 shrink-0" }) {
  return (
    <svg className={className} viewBox="0 0 12 12" fill="none">
      <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      {corner === "tl" && (
        <path d="M1.5 5.5V3A1.5 1.5 0 0 1 3 1.5H5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      )}
      {corner === "tr" && (
        <path d="M6.5 1.5H9A1.5 1.5 0 0 1 10.5 3V5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      )}
      {corner === "bl" && (
        <path d="M1.5 6.5V9A1.5 1.5 0 0 0 3 10.5H5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      )}
      {corner === "br" && (
        <path d="M6.5 10.5H9A1.5 1.5 0 0 0 10.5 9V6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      )}
    </svg>
  );
}

function RadiusSection({ node, tokens, patchStyle }) {
  const radius = node.style?.radius;
  const isObject = radius != null && typeof radius === "object" && !isTokenRef(radius);
  const [perCorner, setPerCorner] = useState(isObject);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingVal, setEditingVal] = useState(false);

  const single = isTokenRef(radius)
    ? (resolveNumeric(radius, tokens) ?? 0)
    : typeof radius === "number"
    ? radius
    : typeof radius?.tl === "number"
    ? radius.tl
    : 0;

  const [tempVal, setTempVal] = useState(String(single));

  const corners =
    radius != null && typeof radius === "object" && !isTokenRef(radius)
      ? radius
      : { tl: single, tr: single, br: single, bl: single };

  const menuPillRef = useRef(null);

  useEffect(() => {
    if (!editingVal) {
      setTempVal(String(single));
    }
  }, [single, editingVal]);

  useEffect(() => {
    const handleOutside = (e) => {
      if (menuPillRef.current && !menuPillRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleOutside);
    return () => window.removeEventListener("mousedown", handleOutside);
  }, []);

  const setRadius = (r) => patchStyle({ radius: r });

  // Theme radius tokens
  const themeRadiusTokens = (tokens || [])
    .filter((t) => t.type === "radius")
    .map((t) => ({
      name: (t.name || "").replace(/^radius[-\/\s]?/i, "") || t.name,
      value: typeof t.value === "number" ? t.value : parseInt(t.value, 10) || 0,
      tokenId: t.id,
    }));

  const radiusOptions =
    themeRadiusTokens.length > 0
      ? themeRadiusTokens
      : [
          { name: "sm", value: 4 },
          { name: "md", value: 6 },
          { name: "lg", value: 8 },
          { name: "xl", value: 12 },
          { name: "2xl", value: 16 },
          { name: "3xl", value: 24 },
          { name: "full", value: 9999 },
        ];

  return (
    <Section
      title="Radius"
      action={
        <button
          type="button"
          onClick={() => {
            if (!perCorner) {
              setRadius({ ...corners });
            } else {
              setRadius(corners.tl);
            }
            setPerCorner((p) => !p);
          }}
          title="Toggle per-corner radius"
          className={`p-1 rounded transition-colors cursor-pointer ${
            perCorner
              ? "text-[var(--accent)] bg-[var(--surface-hover)]"
              : "text-[var(--text-3)] hover:text-[var(--text-1)]"
          }`}
        >
          <FourCornersIcon className="w-3.5 h-3.5" />
        </button>
      }
    >
      {!perCorner ? (
        /* Uniform Radius: Slider + Value Pill with Dropdown (Images 1 & 3) */
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 flex items-center">
            <input
              type="range"
              min={0}
              max={100}
              value={Math.min(100, Math.max(0, single))}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="w-full min-w-0 h-2.5 bg-neutral-200 dark:bg-neutral-700 rounded-full appearance-none cursor-pointer accent-white dark:accent-neutral-200 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-neutral-300 dark:[&::-webkit-slider-thumb]:border-neutral-600 cursor-pointer"
            />
          </div>

          <div
            ref={menuPillRef}
            className={`relative flex w-[62px] shrink-0 items-center justify-between h-[30px] px-2 rounded-lg border bg-[var(--surface-content)] text-xs text-[var(--text-1)] transition-all cursor-pointer ${
              menuOpen
                ? "border-blue-500 ring-2 ring-blue-500/20"
                : "border-[var(--line)] hover:border-[var(--line-strong)]"
            }`}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            <input
              type="text"
              value={editingVal ? tempVal : String(single)}
              onFocus={(e) => {
                setEditingVal(true);
                setTempVal(String(single));
                e.target.select();
              }}
              onChange={(e) => setTempVal(e.target.value.replace(/[^0-9]/g, ""))}
              onBlur={() => {
                setEditingVal(false);
                const parsed = parseInt(tempVal, 10);
                if (!isNaN(parsed)) setRadius(Math.max(0, parsed));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.target.blur();
                else if (e.key === "Escape") setEditingVal(false);
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full min-w-0 bg-transparent text-left font-medium outline-none text-xs text-[var(--text-1)] select-all"
            />
            <ChevronDown size={12} className="shrink-0 text-[var(--text-3)] ml-1" />

            {/* Dropdown Menu (Image 3) with auto-flip to top */}
            {menuOpen && (() => {
              const r = menuPillRef.current?.getBoundingClientRect();
              const openUp = typeof window !== "undefined" && r && (window.innerHeight - r.bottom < 200) && (r.top > 200);
              return (
                <div
                  className={`absolute right-0 z-50 w-44 rounded-xl border border-[var(--line)] bg-[var(--surface-content)] py-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100 font-sans ${
                    openUp ? "bottom-full mb-1.5" : "top-full mt-1.5"
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setRadius(9999);
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center px-3 py-1.5 text-xs text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                  >
                    <span className="font-normal">Full</span>
                  </button>
                  <div className="my-1 border-t border-[var(--line)]" />
                  {radiusOptions.map((item) => (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => {
                        setRadius(item.value);
                        setMenuOpen(false);
                      }}
                      className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                    >
                      <span className="font-normal">{item.name}</span>
                      <span className="text-[var(--text-2)]">{item.value}</span>
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      ) : (
        /* Per-Corner: 4 Segmented Cells (Image 2) */
        <div className="flex items-center w-full h-[32px] rounded-lg border border-[var(--line)] bg-[var(--surface-content)] divide-x divide-[var(--line)] overflow-hidden text-xs text-[var(--text-1)]">
          {[
            { key: "tl", label: "Top Left" },
            { key: "tr", label: "Top Right" },
            { key: "bl", label: "Bottom Left" },
            { key: "br", label: "Bottom Right" },
          ].map(({ key, label }) => (
            <div
              key={key}
              className="flex-1 flex items-center gap-1 px-2 h-full min-w-0"
              title={label}
            >
              <CornerIcon corner={key} className="w-3.5 h-3.5 shrink-0 text-[var(--text-3)]" />
              <input
                type="text"
                defaultValue={corners[key] ?? 0}
                key={`${key}-${corners[key]}`}
                onBlur={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) {
                    setRadius({ ...corners, [key]: Math.max(0, val) });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.target.blur();
                }}
                className="w-full bg-transparent text-left outline-none text-xs font-medium min-w-0 text-[var(--text-1)]"
              />
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Opacity Mesh Icon & Blending Section
// ---------------------------------------------------------------------------

function OpacityMeshIcon({ className = "w-3.5 h-3.5 shrink-0 text-[var(--text-2)]" }) {
  return (
    <svg className={className} viewBox="0 0 14 14" fill="currentColor">
      <rect x="1" y="1" width="2" height="2" rx="0.3" />
      <rect x="5" y="1" width="2" height="2" rx="0.3" />
      <rect x="9" y="1" width="2" height="2" rx="0.3" />
      <rect x="3" y="3.5" width="2" height="2" rx="0.3" />
      <rect x="7" y="3.5" width="2" height="2" rx="0.3" />
      <rect x="11" y="3.5" width="2" height="2" rx="0.3" />
      <rect x="1" y="6" width="2" height="2" rx="0.3" />
      <rect x="5" y="6" width="2" height="2" rx="0.3" />
      <rect x="9" y="6" width="2" height="2" rx="0.3" />
      <rect x="3" y="8.5" width="2" height="2" rx="0.3" />
      <rect x="7" y="8.5" width="2" height="2" rx="0.3" />
      <rect x="11" y="8.5" width="2" height="2" rx="0.3" />
      <rect x="1" y="11" width="2" height="2" rx="0.3" />
      <rect x="5" y="11" width="2" height="2" rx="0.3" />
      <rect x="9" y="11" width="2" height="2" rx="0.3" />
    </svg>
  );
}

function BlendingSection({ node, tokens, patchStyle }) {
  const patchNode = useEditorStore((s) => s.patchNode);
  const selection = useEditorStore((s) => s.selection);
  const setSelection = useEditorStore((s) => s.setSelection);

  const style = node.style ?? {};
  const currentOpacity = typeof style.opacity === "number" ? style.opacity : 1;
  const currentOpacityPct = Math.round(currentOpacity * 100);
  const currentMode = style.blendMode || "normal";
  const currentModeLabel =
    currentMode.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const isHidden = !!(node.hidden || node.visible === false || node.style?.opacity === 0);

  const [opacityOpen, setOpacityOpen] = useState(false);
  const [blendOpen, setBlendOpen] = useState(false);
  const [opacityEditing, setOpacityEditing] = useState(false);
  const [tempOpacity, setTempOpacity] = useState(String(currentOpacityPct));
  const lastNonZeroOpacityRef = useRef(currentOpacity > 0 ? currentOpacity : 1);

  useEffect(() => {
    if (!opacityEditing) {
      setTempOpacity(String(currentOpacityPct));
    }
    if (currentOpacity > 0) {
      lastNonZeroOpacityRef.current = currentOpacity;
    }
  }, [currentOpacity, currentOpacityPct, opacityEditing]);

  const opacityPillRef = useRef(null);
  const blendPillRef = useRef(null);

  useEffect(() => {
    const handleOutside = (e) => {
      if (opacityPillRef.current && !opacityPillRef.current.contains(e.target)) {
        setOpacityOpen(false);
      }
      if (blendPillRef.current && !blendPillRef.current.contains(e.target)) {
        setBlendOpen(false);
      }
    };
    window.addEventListener("mousedown", handleOutside);
    return () => window.removeEventListener("mousedown", handleOutside);
  }, []);

  const handleToggleEye = (e) => {
    e.stopPropagation();
    if (!isHidden) {
      lastNonZeroOpacityRef.current = currentOpacity > 0 ? currentOpacity : 1;
      patchNode(node.id, {
        hidden: true,
        visible: false,
        style: { ...(node.style ?? {}), opacity: 0, display: "none" },
      });
      const nextSelection = selection.filter((id) => id !== node.id);
      if (nextSelection.length !== selection.length) {
        setSelection(nextSelection);
      }
    } else {
      patchNode(node.id, {
        hidden: false,
        visible: true,
        style: { ...(node.style ?? {}), opacity: lastNonZeroOpacityRef.current || 1, display: undefined },
      });
    }
  };

  const docOpacityTokens = (tokens || [])
    .filter((t) => t.type === "opacity")
    .map((t) => ({
      name: (t.name || "").replace(/^opacity[-\/]?/i, "") || t.name,
      value:
        typeof t.value === "number"
          ? Math.round(t.value <= 1 ? t.value * 100 : t.value)
          : parseInt(t.value, 10) || 100,
      id: t.id,
    }));

  const opacityTokens =
    docOpacityTokens.length > 0
      ? docOpacityTokens
      : [
          { name: "subtle", value: 20 },
          { name: "muted", value: 50 },
          { name: "solid", value: 100 },
        ];

  return (
    <Section
      title="Blending"
      action={
        <button
          type="button"
          onClick={handleToggleEye}
          title={!isHidden ? "Hide layer (display: none)" : "Show layer"}
          className="text-[var(--text-2)] hover:text-[var(--text-1)] p-0.5 rounded transition-colors cursor-pointer"
        >
          {!isHidden ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          {/* Left Pill: Opacity */}
          <div
            ref={opacityPillRef}
            className={`relative flex-1 flex items-center justify-between h-[30px] px-2.5 rounded-lg border bg-[var(--surface-content)] text-xs text-[var(--text-1)] transition-all ${
              opacityOpen
                ? "border-blue-500 ring-2 ring-blue-500/20"
                : "border-[var(--line)] hover:border-[var(--line-strong)]"
            }`}
          >
            <div
              className="flex items-center gap-1.5 min-w-0 flex-1 cursor-text"
              onClick={() => {
                setOpacityOpen(true);
                setBlendOpen(false);
              }}
            >
              <OpacityMeshIcon className="w-3.5 h-3.5 shrink-0 text-[var(--text-2)]" />
              <input
                type="text"
                value={opacityEditing ? tempOpacity : `${currentOpacityPct}%`}
                onFocus={(e) => {
                  setOpacityEditing(true);
                  setTempOpacity(String(currentOpacityPct));
                  e.target.select();
                }}
                onChange={(e) => {
                  setTempOpacity(e.target.value.replace(/[^0-9]/g, ""));
                }}
                onBlur={() => {
                  setOpacityEditing(false);
                  const parsed = parseInt(tempOpacity, 10);
                  if (!isNaN(parsed)) {
                    patchStyle({
                      opacity: Math.max(0, Math.min(100, parsed)) / 100,
                    });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.target.blur();
                  } else if (e.key === "Escape") {
                    setOpacityEditing(false);
                  }
                }}
                className="w-full min-w-0 bg-transparent text-left font-medium outline-none text-xs text-[var(--text-1)] select-all"
              />
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpacityOpen((prev) => !prev);
                setBlendOpen(false);
              }}
              className="ml-1 p-0.5 text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer"
            >
              <ChevronDown size={12} />
            </button>

            {/* Opacity Presets Dropdown */}
            {opacityOpen && (
              <div className="absolute left-0 top-full z-50 mt-1.5 w-[140px] rounded-xl border border-[var(--line)] bg-[var(--surface-content)] p-1.5 shadow-xl animate-in fade-in zoom-in-95 duration-100 font-sans">
                {opacityTokens.map((t) => (
                  <button
                    key={t.name || t.id}
                    type="button"
                    onClick={() => {
                      patchStyle({ opacity: t.value / 100 });
                      setOpacityOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                  >
                    <span className="font-normal">{t.name}</span>
                    <span className="text-[var(--text-2)]">{t.value}%</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right Pill: Blend Mode */}
          <div
            ref={blendPillRef}
            data-blend-trigger="true"
            className={`relative flex-1 flex items-center justify-between h-[30px] px-2.5 rounded-lg border bg-[var(--surface-content)] text-xs text-[var(--text-1)] transition-all cursor-pointer ${
              blendOpen
                ? "border-blue-500 ring-2 ring-blue-500/20"
                : "border-[var(--line)] hover:border-[var(--line-strong)]"
            }`}
            onClick={() => {
              setBlendOpen((prev) => !prev);
              setOpacityOpen(false);
            }}
          >
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <Droplet
                size={13}
                className="shrink-0 text-[var(--text-2)]"
                strokeWidth={1.75}
              />
              <span className="truncate font-medium text-xs">
                {currentModeLabel}
              </span>
            </div>
            <span className="ml-1 text-[var(--text-3)]">
              <ChevronDown size={12} />
            </span>

            {/* Blend Mode Dropdown Menu */}
            {blendOpen && (
              <BlendModeMenu
                currentMode={currentMode}
                onSelect={(mode) => patchStyle({ blendMode: mode })}
                onClose={() => setBlendOpen(false)}
              />
            )}
          </div>
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Export + Copy-as (M3)
// ---------------------------------------------------------------------------

/** Rasterise a node's rendered DOM element via html-to-image's toCanvas. */
async function rasteriseNode(node, scale, doc) {
  const el = document.querySelector(`[data-node-id="${node.id}"]`);
  if (!el) throw new Error("Node is not rendered");
  const { toCanvas } = await import("html-to-image");

  // Determine exact geometry
  const targetW = (node.size?.w?.kind === "fixed" && node.size.w.px) || el.offsetWidth || Math.round(el.getBoundingClientRect().width);
  const targetH = (node.size?.h?.kind === "fixed" && node.size.h.px) || el.offsetHeight || Math.round(el.getBoundingClientRect().height);

  // Await web fonts ready
  if (typeof document !== "undefined" && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch (_) {}
  }

  // Ensure all <img> elements inside are loaded before capture
  if (typeof document !== "undefined") {
    const imgEls = Array.from(el.querySelectorAll("img"));
    if (imgEls.length > 0) {
      await Promise.all(
        imgEls.map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((res) => {
            img.onload = () => res();
            img.onerror = () => res();
            setTimeout(res, 250);
          });
        })
      );
    }
  }

  // Resolve background color if node or frame has one
  let bg = undefined;
  const fills = node.style?.fills?.length ? node.style.fills : (node.style?.fill ? [node.style.fill] : []);
  const visibleFills = fills.filter((f) => f && f.visible !== false && !f.hidden);
  const solidFill = visibleFills.find((f) => f.kind === "solid" || (!f.kind && f.color) || f.kind === "token");
  if (solidFill) {
    bg = resolvePaintColor(solidFill, doc?.tokens) || solidFill.color;
  } else if (node.type === "frame" && visibleFills.length === 0) {
    bg = "#FFFFFF";
  }

  const captureOpts = {
    pixelRatio: scale || 1,
    width: targetW,
    height: targetH,
    skipFonts: true,
    fontEmbedCSS: "",
    cacheBust: false,
    backgroundColor: bg || undefined,
    filter: (domNode) => {
      if (domNode.classList?.contains("guide-overlay") || domNode.dataset?.guide) {
        return false;
      }
      return true;
    },
    style: {
      transform: "none",
      position: "relative",
      left: "0px",
      top: "0px",
      margin: "0",
      width: `${targetW}px`,
      height: `${targetH}px`,
      maxWidth: "none",
      maxHeight: "none",
    },
  };

  // Chromium SVG <foreignObject> async rasterization fix:
  // First warmup pass compiles and caches SVG foreignObject & images
  try {
    await toCanvas(el, captureOpts);
  } catch (_) {}
  await new Promise((r) => setTimeout(r, 60));

  // Second pass: final high-fidelity render
  let canvas = await toCanvas(el, captureOpts);

  // Fallback check: sample middle of canvas to ensure content rendered
  const ctx = canvas.getContext("2d");
  if (ctx && canvas.width > 0 && canvas.height > 0) {
    const cx = Math.max(0, Math.floor(canvas.width / 2) - 16);
    const cy = Math.max(0, Math.floor(canvas.height / 2) - 16);
    const sample = ctx.getImageData(cx, cy, Math.min(canvas.width, 32), Math.min(canvas.height, 32)).data;
    let hasVisiblePixels = false;
    for (let i = 3; i < sample.length; i += 4) {
      if (sample[i] > 0) {
        hasVisiblePixels = true;
        break;
      }
    }
    if (!hasVisiblePixels) {
      await new Promise((r) => setTimeout(r, 120));
      canvas = await toCanvas(el, captureOpts);
    }
  }

  return canvas;
}

/** Render a node's rendered DOM element to SVG via html-to-image's toSvg. */
async function rasteriseSvg(node, doc) {
  const el = document.querySelector(`[data-node-id="${node.id}"]`);
  if (!el) throw new Error("Node is not rendered");

  // If the node itself is an SVG node, export clean native SVG directly
  if (node.type === "svg") {
    const svgEl = el.tagName?.toLowerCase() === "svg" ? el : el.querySelector("svg");
    if (svgEl) {
      const clone = svgEl.cloneNode(true);
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const serializer = new XMLSerializer();
      const str = serializer.serializeToString(clone);
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(str)}`;
    }
  }

  const { toSvg } = await import("html-to-image");
  const targetW = (node.size?.w?.kind === "fixed" && node.size.w.px) || el.offsetWidth || Math.round(el.getBoundingClientRect().width);
  const targetH = (node.size?.h?.kind === "fixed" && node.size.h.px) || el.offsetHeight || Math.round(el.getBoundingClientRect().height);

  let fontEmbedCSS = "";
  if (typeof document !== "undefined") {
    const fontLinks = Array.from(document.querySelectorAll("link[href*='fonts.googleapis.com'], link[id^='gfont-']"));
    if (fontLinks.length > 0) {
      fontEmbedCSS = fontLinks.map((l) => `@import url('${l.href}');`).join("\n");
    }
  }

  return toSvg(el, {
    skipFonts: true,
    fontEmbedCSS: fontEmbedCSS || "",
    cacheBust: false,
    width: targetW,
    height: targetH,
    style: {
      transform: "none",
      position: "relative",
      left: "0px",
      top: "0px",
      margin: "0",
      width: `${targetW}px`,
      height: `${targetH}px`,
      maxWidth: "none",
      maxHeight: "none",
    },
  });
}

function downloadUrl(urlOrBlob, filename) {
  const a = document.createElement("a");
  if (urlOrBlob instanceof Blob) {
    const url = URL.createObjectURL(urlOrBlob);
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else if (typeof urlOrBlob === "string") {
    if (urlOrBlob.startsWith("data:image/svg+xml")) {
      let svgText = "";
      if (urlOrBlob.startsWith("data:image/svg+xml;charset=utf-8,")) {
        svgText = decodeURIComponent(urlOrBlob.slice("data:image/svg+xml;charset=utf-8,".length));
      } else if (urlOrBlob.startsWith("data:image/svg+xml;base64,")) {
        svgText = atob(urlOrBlob.slice("data:image/svg+xml;base64,".length));
      } else {
        const commaIdx = urlOrBlob.indexOf(",");
        svgText = decodeURIComponent(urlOrBlob.slice(commaIdx + 1));
      }
      const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    a.href = urlOrBlob;
    a.download = filename;
    a.click();
  }
}

/** Generates a standard PDF 1.4 document blob containing the rasterised canvas. */
function canvasToPdfBlob(canvas) {
  // Composite canvas onto white to prevent black background
  const compositeCanvas = document.createElement("canvas");
  compositeCanvas.width = canvas.width;
  compositeCanvas.height = canvas.height;
  const ctx = compositeCanvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, compositeCanvas.width, compositeCanvas.height);
  ctx.drawImage(canvas, 0, 0);

  const dataUrl = compositeCanvas.toDataURL("image/jpeg", 0.95);
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const len = binary.length;
  const jpegBytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    jpegBytes[i] = binary.charCodeAt(i);
  }

  // 72 DPI standard PDF points (approx 0.75 pt per screen px)
  const widthPt = Math.max(1, Math.round(canvas.width * 0.75));
  const heightPt = Math.max(1, Math.round(canvas.height * 0.75));

  const header = "%PDF-1.4\n";
  const obj1 = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  const obj2 = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`;
  const obj4Header = `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${len} >>\nstream\n`;
  const obj4Footer = `\nendstream\nendobj\n`;
  const contentStream = `q ${widthPt} 0 0 ${heightPt} 0 0 cm /Im0 Do Q`;
  const obj5 = `5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`;

  const enc = new TextEncoder();
  const partHeader = enc.encode(header);
  const part1 = enc.encode(obj1);
  const part2 = enc.encode(obj2);
  const part3 = enc.encode(obj3);
  const part4H = enc.encode(obj4Header);
  const part4F = enc.encode(obj4Footer);
  const part5 = enc.encode(obj5);

  const offset1 = partHeader.length;
  const offset2 = offset1 + part1.length;
  const offset3 = offset2 + part2.length;
  const offset4 = offset3 + part3.length;
  const offset5 = offset4 + part4H.length + jpegBytes.length + part4F.length;
  const xrefOffset = offset5 + part5.length;

  const xref = `xref\n0 6\n0000000000 65535 f \n` +
    String(offset1).padStart(10, "0") + " 00000 n \n" +
    String(offset2).padStart(10, "0") + " 00000 n \n" +
    String(offset3).padStart(10, "0") + " 00000 n \n" +
    String(offset4).padStart(10, "0") + " 00000 n \n" +
    String(offset5).padStart(10, "0") + " 00000 n \n";
  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  const partXref = enc.encode(xref + trailer);

  return new Blob([partHeader, part1, part2, part3, part4H, jpegBytes, part4F, part5, partXref], {
    type: "application/pdf",
  });
}

function computeScaleRatio(scaleOption, node) {
  if (typeof scaleOption === "number") return scaleOption;
  if (!node) return 1;
  const nodeW = Math.max(1, node.width || 100);
  const nodeH = Math.max(1, node.height || 100);

  if (scaleOption.endsWith("x")) {
    const val = parseFloat(scaleOption);
    return isNaN(val) ? 1 : val;
  }
  if (scaleOption.endsWith("p")) {
    const targetH = parseInt(scaleOption, 10);
    return isNaN(targetH) ? 1 : targetH / nodeH;
  }
  if (scaleOption.endsWith("w")) {
    const targetW = parseInt(scaleOption, 10);
    return isNaN(targetW) ? 1 : targetW / nodeW;
  }
  if (scaleOption.endsWith("h")) {
    const targetH = parseInt(scaleOption, 10);
    return isNaN(targetH) ? 1 : targetH / nodeH;
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Other Styles Section — shows custom CSS name with value + active checkbox + add row
// Matches Reference Screenshot media_1793923212535_88a7f8ef.png
// ---------------------------------------------------------------------------
const IGNORED_OTHER_STYLE_PROPS = new Set([
  "display", "position", "top", "right", "bottom", "left", "inset",
  "inset-block", "inset-block-start", "inset-block-end",
  "inset-inline", "inset-inline-start", "inset-inline-end",
  "width", "height", "inline-size", "block-size", "box-sizing",
  "background-color", "background-image", "background",
  "border", "border-top", "border-right", "border-bottom", "border-left",
  "border-block", "border-block-start", "border-block-end",
  "border-inline", "border-inline-start", "border-inline-end",
  "border-width", "border-style", "border-color",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "border-block-width", "border-block-start-width", "border-block-end-width",
  "border-block-style", "border-block-start-style", "border-block-end-style",
  "border-block-color", "border-block-start-color", "border-block-end-color",
  "border-inline-width", "border-inline-start-width", "border-inline-end-width",
  "border-inline-style", "border-inline-start-style", "border-inline-end-style",
  "border-inline-color", "border-inline-start-color", "border-inline-end-color",
  "border-radius",
  "box-shadow", "opacity", "mix-blend-mode", "overflow",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "margin-block", "margin-block-start", "margin-block-end",
  "margin-inline", "margin-inline-start", "margin-inline-end",
  "flex", "flex-grow", "flex-shrink", "flex-basis",
  "flex-direction", "flex-wrap", "flex-flow",
  "gap", "row-gap", "column-gap", "justify-content", "align-items", "align-content",
  "justify-items", "place-content", "place-items",
  "grid", "grid-area", "grid-auto-columns", "grid-auto-flow", "grid-auto-rows",
  "grid-column", "grid-column-end", "grid-column-gap", "grid-column-start",
  "grid-gap", "grid-row", "grid-row-end", "grid-row-gap", "grid-row-start",
  "grid-template", "grid-template-areas", "grid-template-columns", "grid-template-rows",
  "justify-self", "align-self", "place-self",
  "font-family", "font-size", "font-weight", "font-style", "line-height",
  "color", "text-align", "z-index",
  "unicode-bidi", "appearance", "-webkit-appearance", "-moz-appearance",
  "scrollbar-width", "scrollbar-color",
  "outline", "outline-color", "outline-style", "outline-width", "outline-offset",
  "caret-color",
  "column-rule", "column-rule-color", "column-rule-style", "column-rule-width",
  "row-rule", "row-rule-color", "row-rule-style", "row-rule-width",
  "-webkit-text-fill-color", "-webkit-text-stroke-color",
]);

function OtherStylesSection({ node, patchStyle }) {
  const style = node?.style ?? {};
  // Merge style.customCss with any existing node.rawStyle entries so only genuine unhandled styles are shown
  const rawCustom = useMemo(() => {
    const out = {};
    if (node?.rawStyle && typeof node.rawStyle === "object") {
      for (const [k, v] of Object.entries(node.rawStyle)) {
        if (!isIgnoredOtherStyle(k, v)) {
          out[k] = { value: String(v), enabled: true };
        }
      }
    }
    if (style.customCss && typeof style.customCss === "object") {
      for (const [k, raw] of Object.entries(style.customCss)) {
        const val = typeof raw === "object" && raw !== null ? raw.value : raw;
        if (!isIgnoredOtherStyle(k, val)) {
          out[k] = raw;
        }
      }
    }
    return out;
  }, [style.customCss, node?.rawStyle]);

  const [addingRow, setAddingRow] = useState(false);
  const [newProp, setNewProp] = useState("");
  const [newVal, setNewVal] = useState("");
  const propInputRef = useRef(null);

  useEffect(() => {
    if (addingRow && propInputRef.current) propInputRef.current.focus();
  }, [addingRow]);

  const commitAdd = () => {
    const p = newProp.trim();
    const v = newVal.trim();
    if (!p || !v) {
      setAddingRow(false);
      setNewProp("");
      setNewVal("");
      return;
    }
    patchStyle({
      customCss: {
        ...rawCustom,
        [p]: { value: v, enabled: true },
      },
    });
    setNewProp("");
    setNewVal("");
    setAddingRow(false);
  };

  const toggleEntry = (key) => {
    const curr = rawCustom[key];
    const val = typeof curr === "object" && curr !== null ? curr.value : curr;
    const isEnabled = typeof curr === "object" && curr !== null ? curr.enabled !== false : true;
    patchStyle({
      customCss: {
        ...rawCustom,
        [key]: { value: val, enabled: !isEnabled },
      },
    });
  };

  const removeEntry = (key) => {
    const next = { ...rawCustom };
    delete next[key];
    patchStyle({ customCss: Object.keys(next).length ? next : undefined });
  };

  const entries = Object.entries(rawCustom);

  return (
    <div className="border-b border-[var(--line)] pb-3 mb-3 select-none">
      {/* Header matching Screenshot media_1793923212535_88a7f8ef.png */}
      <div className="flex h-9 items-center justify-between">
        <span className="text-xs font-semibold text-[var(--text-1)]">Other styles</span>
        <button
          type="button"
          title="Add style property"
          onClick={() => setAddingRow(true)}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-md)] border border-transparent text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] hover:border-[var(--line)] transition-colors cursor-pointer"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Existing entries with Checkboxes (matching screenshot) */}
      {entries.length > 0 && (
        <div className="flex flex-col gap-1.5 pt-1">
          {entries.map(([key, raw]) => {
            const val = typeof raw === "object" && raw !== null ? raw.value : raw;
            const isEnabled = typeof raw === "object" && raw !== null ? raw.enabled !== false : true;

            return (
              <div
                key={key}
                className="group flex items-center justify-between gap-2 px-1 py-0.5 rounded-md hover:bg-[var(--surface-hover)] transition-colors"
              >
                <div
                  onClick={() => toggleEntry(key)}
                  className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
                >
                  {/* Rounded square checkbox with checkmark matching screenshot */}
                  <div
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                      isEnabled
                        ? "border-[#A1A1AA] dark:border-[#52525B] bg-white dark:bg-[#2C2C2E] text-[#18181B] dark:text-white"
                        : "border-[#D4D4D8] dark:border-[#3F3F46] bg-transparent"
                    }`}
                  >
                    {isEnabled && <Check size={11} strokeWidth={2.5} />}
                  </div>

                  <span
                    className={`font-mono text-xs truncate ${
                      isEnabled
                        ? "text-[#18181B] dark:text-[#EDEDED]"
                        : "text-[#A1A1AA] line-through opacity-60"
                    }`}
                  >
                    <span>{key}</span>
                    <span className="text-[#71717A]">: </span>
                    <span>{val}</span>
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => removeEntry(key)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity flex h-4 w-4 items-center justify-center rounded text-[var(--text-3)] hover:text-red-400 cursor-pointer shrink-0"
                  title={`Remove ${key}`}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add row with 2 inputs: property name and value */}
      {addingRow && (
        <div className="flex items-center gap-1.5 mt-2">
          <input
            ref={propInputRef}
            type="text"
            value={newProp}
            onChange={(e) => setNewProp(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitAdd();
              if (e.key === "Escape") {
                setAddingRow(false);
                setNewProp("");
                setNewVal("");
              }
            }}
            placeholder="margin-left"
            className="flex-1 h-7 min-w-0 rounded-md border border-[var(--line)] bg-[var(--surface-content)] px-2 text-xs font-mono text-[var(--text-1)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-2)]"
          />
          <input
            type="text"
            value={newVal}
            onChange={(e) => setNewVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitAdd();
              if (e.key === "Escape") {
                setAddingRow(false);
                setNewProp("");
                setNewVal("");
              }
            }}
            placeholder="auto"
            className="flex-1 h-7 min-w-0 rounded-md border border-[var(--line)] bg-[var(--surface-content)] px-2 text-xs font-mono text-[var(--text-1)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--text-2)]"
          />
          <button
            type="button"
            onClick={commitAdd}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--surface-hover)] text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors cursor-pointer"
            title="Add"
          >
            <Check size={12} />
          </button>
          <button
            type="button"
            onClick={() => {
              setAddingRow(false);
              setNewProp("");
              setNewVal("");
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors cursor-pointer"
            title="Cancel"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Empty state hint */}
      {entries.length === 0 && !addingRow && (
        <p className="text-[11px] text-[var(--text-3)] pt-1 px-1">
          No other styles. Click + to add custom CSS.
        </p>
      )}
    </div>
  );
}

function ExportSection({ node, doc }) {
  const showToast = useEditorStore((s) => s.showToast);
  const containerRef = useRef(null);

  // States
  const [scaleOption, setScaleOption] = useState("2x");
  const [format, setFormat] = useState("PNG");
  const [suffix, setSuffix] = useState("@2x");
  const [colorSpace, setColorSpace] = useState("sRGB");
  const [componentUseClient, setComponentUseClient] = useState(true);
  const [busy, setBusy] = useState(false);

  // Menu open states
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const [scaleMenuOpen, setScaleMenuOpen] = useState(false);
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Trigger button refs (for getBoundingClientRect)
  const scaleTriggerRef = useRef(null);
  const formatTriggerRef = useRef(null);
  const copyTriggerRef = useRef(null);
  const settingsTriggerRef = useRef(null);

  // Fixed-position coords for each floating panel
  const [scaleCoords, setScaleCoords] = useState(null);
  const [formatCoords, setFormatCoords] = useState(null);
  const [copyCoords, setCopyCoords] = useState(null);
  const [settingsCoords, setSettingsCoords] = useState(null);

  // Compute coords when a menu opens — place above button if not enough room below
  useLayoutEffect(() => {
    if (scaleMenuOpen && scaleTriggerRef.current) {
      const r = scaleTriggerRef.current.getBoundingClientRect();
      const menuH = 280;
      const y = (r.top - menuH - 4) > 12 ? r.top - menuH - 4 : r.bottom + 4;
      setScaleCoords({ x: r.left, y, width: Math.max(r.width, 112) });
    }
  }, [scaleMenuOpen]);

  useLayoutEffect(() => {
    if (formatMenuOpen && formatTriggerRef.current) {
      const r = formatTriggerRef.current.getBoundingClientRect();
      const menuH = 340;
      const y = (r.top - menuH - 4) > 12 ? r.top - menuH - 4 : r.bottom + 4;
      setFormatCoords({ x: r.left, y, width: Math.max(r.width, 180) });
    }
  }, [formatMenuOpen]);

  useLayoutEffect(() => {
    if (copyMenuOpen && copyTriggerRef.current) {
      const r = copyTriggerRef.current.getBoundingClientRect();
      const menuH = 240;
      let y = r.bottom + 4;
      if (y + menuH > window.innerHeight - 12) y = Math.max(12, r.top - menuH - 4);
      // right-align the menu
      setCopyCoords({ right: window.innerWidth - r.right, y });
    }
  }, [copyMenuOpen]);

  useLayoutEffect(() => {
    if (settingsOpen && settingsTriggerRef.current) {
      const r = settingsTriggerRef.current.getBoundingClientRect();
      const menuH = 240;
      const menuW = 270;
      let y = r.bottom + 4;
      if (y + menuH > window.innerHeight - 12) y = Math.max(12, r.top - menuH - 4);
      setSettingsCoords({ right: window.innerWidth - r.right, y, width: menuW });
    }
  }, [settingsOpen]);

  // Close menus on click outside
  useEffect(() => {
    if (!copyMenuOpen && !scaleMenuOpen && !formatMenuOpen && !settingsOpen) return;
    const handleClickOutside = (e) => {
      // Allow clicks inside portal menus (they're outside containerRef in the DOM)
      if (e.target.closest("[data-export-menu]")) return;
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setCopyMenuOpen(false);
        setScaleMenuOpen(false);
        setFormatMenuOpen(false);
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [copyMenuOpen, scaleMenuOpen, formatMenuOpen, settingsOpen]);

  const exportImage = async (overrideFormat) => {
    if (!node) return;
    setBusy(true);
    const activeFmt = (overrideFormat || format).toUpperCase();
    const effectiveSuffix = suffix ?? "";
    try {
      if (activeFmt === "JSX") {
        const code = nodeToReactJsx(node, doc, { useClient: componentUseClient });
        const blob = new Blob([code], { type: "text/javascript;charset=utf-8" });
        const name = `${slugify(node.name || "frame")}${effectiveSuffix}.jsx`;
        downloadUrl(blob, name);
        showToast({ message: `Exported ${name}` });
        return;
      }

      if (activeFmt === "TSX") {
        const code = nodeToReactTsx(node, doc, { useClient: componentUseClient });
        const blob = new Blob([code], { type: "text/typescript;charset=utf-8" });
        const name = `${slugify(node.name || "frame")}${effectiveSuffix}.tsx`;
        downloadUrl(blob, name);
        showToast({ message: `Exported ${name}` });
        return;
      }

      if (activeFmt === "ASTRO") {
        const code = nodeToAstro(node, doc);
        const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
        const name = `${slugify(node.name || "frame")}${effectiveSuffix}.astro`;
        downloadUrl(blob, name);
        showToast({ message: `Exported ${name}` });
        return;
      }

      if (activeFmt === "HTML") {
        const htmlDoc = nodeToHtmlDocument(node, doc);
        const blob = new Blob([htmlDoc], { type: "text/html;charset=utf-8" });
        const name = `${slugify(node.name || "frame")}${effectiveSuffix}.html`;
        downloadUrl(blob, name);
        showToast({ message: `Exported ${name}` });
        return;
      }

      if (activeFmt === "SVG") {
        const svgData = await rasteriseSvg(node, doc);
        const name = `${slugify(node.name || "frame")}${effectiveSuffix}.svg`;
        downloadUrl(svgData, name);
        showToast({ message: `Exported ${name}` });
        return;
      }

      // Resolve background color if node or frame has one
      let bg = undefined;
      const fills = node.style?.fills?.length ? node.style.fills : (node.style?.fill ? [node.style.fill] : []);
      const visibleFills = fills.filter((f) => f && f.visible !== false && !f.hidden);
      const solidFill = visibleFills.find((f) => f.kind === "solid" || (!f.kind && f.color) || f.kind === "token");
      if (solidFill) {
        bg = resolvePaintColor(solidFill, doc?.tokens) || solidFill.color;
      } else if (node.type === "frame" && visibleFills.length === 0) {
        bg = "#FFFFFF";
      }

      const scaleRatio = computeScaleRatio(scaleOption, node);
      const canvas = await rasteriseNode(node, scaleRatio, doc);
      let out = canvas;

      if (activeFmt === "JPG" || activeFmt === "JPEG") {
        out = document.createElement("canvas");
        out.width = canvas.width;
        out.height = canvas.height;
        const ctx = out.getContext("2d", colorSpace === "Display P3" ? { colorSpace: "display-p3" } : undefined);
        ctx.fillStyle = bg || "#FFFFFF";
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(canvas, 0, 0);
        const name = `${slugify(node.name || "frame")}${effectiveSuffix}.jpg`;
        downloadUrl(out.toDataURL("image/jpeg", 0.95), name);
        showToast({ message: `Exported ${name}` });
      } else if (activeFmt === "AVIF") {
        const name = `${slugify(node.name || "frame")}${effectiveSuffix}.avif`;
        const avifUrl = canvas.toDataURL("image/avif", 0.95);
        if (avifUrl.startsWith("data:image/avif")) {
          downloadUrl(avifUrl, name);
        } else {
          downloadUrl(canvas.toDataURL("image/webp", 0.95), `${slugify(node.name || "frame")}${effectiveSuffix}.webp`);
        }
        showToast({ message: `Exported ${name}` });
      } else if (activeFmt === "WEBP") {
        const name = `${slugify(node.name || "frame")}${effectiveSuffix}.webp`;
        downloadUrl(canvas.toDataURL("image/webp", 0.95), name);
        showToast({ message: `Exported ${name}` });
      } else if (activeFmt === "PDF") {
        const name = `${slugify(node.name || "frame")}${effectiveSuffix}.pdf`;
        const pdfBlob = canvasToPdfBlob(canvas);
        downloadUrl(pdfBlob, name);
        showToast({ message: `Exported ${name}` });
      } else {
        const name = `${slugify(node.name || "frame")}${effectiveSuffix}.png`;
        let outCanvas = canvas;
        if (node.type === "frame" && bg) {
          outCanvas = document.createElement("canvas");
          outCanvas.width = canvas.width;
          outCanvas.height = canvas.height;
          const octx = outCanvas.getContext("2d");
          octx.fillStyle = bg;
          octx.fillRect(0, 0, outCanvas.width, outCanvas.height);
          octx.drawImage(canvas, 0, 0);
        }
        downloadUrl(outCanvas.toDataURL("image/png"), name);
        showToast({ message: `Exported ${name}` });
      }
    } catch (err) {
      showToast({ message: `Export failed: ${err.message}` });
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async (kind, generate, label) => {
    try {
      await navigator.clipboard.writeText(generate(node, doc));
      showToast({ message: `${label} copied to clipboard` });
    } catch {
      showToast({
        message: "Clipboard access denied. Allow clipboard permissions and try again.",
      });
    }
  };

  const copyPng = async () => {
    setBusy(true);
    try {
      const canvas = await rasteriseNode(node, 1, doc);
      const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error("rasterise failed");
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        showToast({ message: "PNG copied to clipboard" });
      } catch {
        const name = `${slugify(node.name || "frame")}@1x.png`;
        downloadUrl(canvas.toDataURL("image/png"), name);
        showToast({
          message: `Clipboard blocked — ${name} downloaded instead`,
        });
      }
    } catch (err) {
      showToast({ message: `Copy PNG failed: ${err.message}` });
    } finally {
      setBusy(false);
    }
  };

  // Keyboard shortcut listener
  useEffect(() => {
    if (!node) return;
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "e" || e.key === "E")) {
        e.preventDefault();
        exportImage();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        copyPng();
      } else if (e.altKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        copyCode("tailwind", nodeToTailwind, "Tailwind");
      } else if (e.altKey && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        copyCode("react", nodeToReact, "React CSS");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [node, doc, scaleOption, format, suffix, colorSpace]);

  if (!node) {
    return (
      <Section title="Export">
        <p className="text-[var(--type-micro)] text-[var(--text-2)]">
          Select a frame or element to export it, or copy it as CSS /
          Tailwind / React.
        </p>
      </Section>
    );
  }

  const handleSelectScale = (val) => {
    setScaleOption(val);
    setSuffix(`@${val}`);
    setScaleMenuOpen(false);
  };

  const handleSelectFormat = (fmt) => {
    setFormat(fmt);
    setFormatMenuOpen(false);
  };

  return (
    <div ref={containerRef} className="relative border-b border-[var(--line)] pb-3 select-none">
      {/* Header */}
      <div className="flex h-9 items-center justify-between text-xs">
        <span className="font-medium text-[var(--text-1)]">Export</span>
        <div className="relative flex items-center gap-1">
          {/* Copy Dropdown Button */}
          <button
            type="button"
            ref={copyTriggerRef}
            onClick={() => setCopyMenuOpen(!copyMenuOpen)}
            className="flex h-6 items-center gap-0.5 rounded-[var(--radius-md)] border border-transparent px-1.5 text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] hover:border-[var(--line)] transition-colors cursor-pointer"
            title="Copy options"
          >
            <Copy size={12} />
            <ChevronDown size={11} />
          </button>

          {/* Plus Button */}
          <button
            type="button"
            onClick={() => exportImage()}
            className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-md)] border border-transparent text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] hover:border-[var(--line)] transition-colors cursor-pointer"
            title="Export"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Row 1: Controls */}
      <div className="flex flex-col gap-2">
        <div className="relative flex items-center gap-1.5">
          {/* Scale Dropdown */}
          <div className="relative flex-1">
            <button
              type="button"
              ref={scaleTriggerRef}
              onClick={() => { setScaleMenuOpen(!scaleMenuOpen); setFormatMenuOpen(false); }}
              className="w-full flex h-[var(--row-field-h)] items-center justify-between rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 text-xs text-[var(--text-1)] hover:border-[var(--text-2)] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" className="text-[var(--text-2)] shrink-0">
                  <path d="M10 2h4v4M14 2L9 7M6 14H2v-4M2 14l5-5" />
                </svg>
                <span className="font-medium">{scaleOption}</span>
              </div>
              <ChevronDown size={11} className="text-[var(--text-2)] shrink-0" />
            </button>
          </div>

          {/* Format Dropdown */}
          <div className="relative flex-1">
            <button
              type="button"
              ref={formatTriggerRef}
              onClick={() => { setFormatMenuOpen(!formatMenuOpen); setScaleMenuOpen(false); }}
              className="w-full flex h-[var(--row-field-h)] items-center justify-between rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2.5 text-xs text-[var(--text-1)] hover:border-[var(--text-2)] transition-colors cursor-pointer"
            >
              <span className="font-medium uppercase">{format}</span>
              <ChevronDown size={11} className="text-[var(--text-2)] shrink-0" />
            </button>
          </div>

          {/* Settings icon */}
          <button
            type="button"
            ref={settingsTriggerRef}
            onClick={() => setSettingsOpen(!settingsOpen)}
            className={`flex h-6 w-6 items-center justify-center rounded-[var(--radius-md)] border transition-colors cursor-pointer shrink-0 ${
              settingsOpen
                ? "border-[var(--line)] bg-[var(--surface-hover)] text-[var(--text-1)]"
                : "border-transparent text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] hover:border-[var(--line)]"
            }`}
            title="Export settings"
          >
            <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor">
              <path d="M3 9.5H2V12H3V9.5Z" />
              <path d="M10 6.5H9V12H10V6.5Z" />
              <path d="M10 0H9V2.5H10V0Z" />
              <path d="M3 0H2V5.5H3V0Z" />
              <path fill="none" stroke="currentColor" d="M2.5 9.5C3.6 9.5 4.5 8.6 4.5 7.5C4.5 6.4 3.6 5.5 2.5 5.5C1.4 5.5 0.5 6.4 0.5 7.5C0.5 8.6 1.4 9.5 2.5 9.5Z" />
              <path fill="none" stroke="currentColor" d="M9.5 6.5C10.6 6.5 11.5 5.6 11.5 4.5C11.5 3.4 10.6 2.5 9.5 2.5C8.4 2.5 7.5 3.4 7.5 4.5C7.5 5.6 8.4 6.5 9.5 6.5Z" />
            </svg>
          </button>

          {/* Minus / reset */}
          <button
            type="button"
            onClick={() => { setScaleOption("1x"); setFormat("PNG"); setSuffix("@1x"); showToast({ message: "Export settings reset" }); }}
            className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-md)] border border-transparent text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] hover:border-[var(--line)] transition-colors cursor-pointer shrink-0"
            title="Reset export settings"
          >
            <Minus size={13} />
          </button>
        </div>

        {/* Full width Export button */}
        <button
          type="button"
          onClick={() => exportImage()}
          disabled={busy}
          className="w-full flex h-[var(--row-field-h)] items-center justify-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] text-xs font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors shadow-2xs cursor-pointer gap-2 disabled:opacity-50"
        >
          <span>{busy ? "Exporting..." : "Export"}</span>
          <span className="text-[11px] text-[var(--text-2)] font-normal">Ctrl + Shift + E</span>
        </button>
      </div>

      {/* ── Portals: all floating menus rendered at document.body to escape overflow:hidden ── */}
      {typeof window !== "undefined" && (
        <>
          {/* Scale menu */}
          {scaleMenuOpen && scaleCoords && createPortal(
            <div
              data-export-menu="true"
              style={{ position: "fixed", top: scaleCoords.y, left: scaleCoords.x, width: scaleCoords.width, zIndex: 10010 }}
              className="rounded-xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] text-[#18181B] dark:text-[#EDEDED] p-1 shadow-2xl max-h-72 overflow-y-auto animate-in fade-in zoom-in-95 duration-100 select-none"
            >
              {["0.5x", "1x", "2x", "3x", "4x"].map((val) => (
                <button key={val} type="button" onClick={() => handleSelectScale(val)}
                  className="flex w-full items-center px-2 py-1 text-xs text-[#18181B] dark:text-[#EDEDED] hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] rounded-md cursor-pointer transition-colors text-left font-medium">
                  <span className="w-4 flex items-center justify-center shrink-0 mr-1.5">{scaleOption === val && <Check size={12} className="text-[#0D99FF]" />}</span>
                  <span>{val}</span>
                </button>
              ))}
              <div className="my-1 border-t border-[#E4E4E7] dark:border-[#2E2E32]" />
              {["720p", "1080p", "1440p", "2160p"].map((val) => (
                <button key={val} type="button" onClick={() => handleSelectScale(val)}
                  className="flex w-full items-center px-2 py-1 text-xs text-[#18181B] dark:text-[#EDEDED] hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] rounded-md cursor-pointer transition-colors text-left font-medium">
                  <span className="w-4 flex items-center justify-center shrink-0 mr-1.5">{scaleOption === val && <Check size={12} className="text-[#0D99FF]" />}</span>
                  <span>{val}</span>
                </button>
              ))}
              <div className="my-1 border-t border-[#E4E4E7] dark:border-[#2E2E32]" />
              {["512w", "512h"].map((val) => (
                <button key={val} type="button" onClick={() => handleSelectScale(val)}
                  className="flex w-full items-center px-2 py-1 text-xs text-[#18181B] dark:text-[#EDEDED] hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] rounded-md cursor-pointer transition-colors text-left font-medium">
                  <span className="w-4 flex items-center justify-center shrink-0 mr-1.5">{scaleOption === val && <Check size={12} className="text-[#0D99FF]" />}</span>
                  <span>{val}</span>
                </button>
              ))}
            </div>,
            document.body
          )}

          {/* Format menu */}
          {formatMenuOpen && formatCoords && createPortal(
            <div
              data-export-menu="true"
              style={{ position: "fixed", top: formatCoords.y, left: formatCoords.x, width: Math.max(formatCoords.width, 180), zIndex: 10010 }}
              className="rounded-xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] text-[#18181B] dark:text-[#EDEDED] p-1 shadow-2xl animate-in fade-in zoom-in-95 duration-100 select-none max-h-80 overflow-y-auto"
            >
              <div className="px-2 py-1 text-[10px] font-semibold text-[#71717A] dark:text-[#A1A1AA] uppercase tracking-wider">Raster Images</div>
              {["PNG", "JPG", "AVIF", "WebP"].map((fmt) => (
                <button key={fmt} type="button" onClick={() => handleSelectFormat(fmt)}
                  className="flex w-full items-center px-2.5 py-1.5 text-xs text-[#18181B] dark:text-[#EDEDED] hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] rounded-md cursor-pointer transition-colors text-left font-medium">
                  <span className="w-4 flex items-center justify-center shrink-0 mr-1.5">{format === fmt && <Check size={12} className="text-[#0D99FF]" />}</span>
                  <span>{fmt}</span>
                </button>
              ))}
              <div className="my-1 border-t border-[#E4E4E7] dark:border-[#2E2E32]" />
              <div className="px-2 py-1 text-[10px] font-semibold text-[#71717A] dark:text-[#A1A1AA] uppercase tracking-wider">Vectors & Documents</div>
              {["SVG", "PDF", "HTML"].map((fmt) => (
                <button key={fmt} type="button" onClick={() => handleSelectFormat(fmt)}
                  className="flex w-full items-center px-2.5 py-1.5 text-xs text-[#18181B] dark:text-[#EDEDED] hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] rounded-md cursor-pointer transition-colors text-left font-medium">
                  <span className="w-4 flex items-center justify-center shrink-0 mr-1.5">{format === fmt && <Check size={12} className="text-[#0D99FF]" />}</span>
                  <span>{fmt}</span>
                </button>
              ))}
              <div className="my-1 border-t border-[#E4E4E7] dark:border-[#2E2E32]" />
              <div className="px-2 py-1 text-[10px] font-semibold text-[#71717A] dark:text-[#A1A1AA] uppercase tracking-wider">Components</div>
              {[
                { id: "JSX", label: "React / Next.js (JSX)", ext: ".jsx" },
                { id: "TSX", label: "React / Next.js (TSX)", ext: ".tsx" },
                { id: "ASTRO", label: "Astro (.astro)", ext: ".astro" },
              ].map(({ id, label }) => (
                <button key={id} type="button" onClick={() => handleSelectFormat(id)}
                  className="flex w-full items-center px-2.5 py-1.5 text-xs text-[#18181B] dark:text-[#EDEDED] hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] rounded-md cursor-pointer transition-colors text-left font-medium">
                  <span className="w-4 flex items-center justify-center shrink-0 mr-1.5">{format === id && <Check size={12} className="text-[#0D99FF]" />}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>,
            document.body
          )}

          {/* Copy menu */}
          {copyMenuOpen && copyCoords && createPortal(
            <div
              data-export-menu="true"
              style={{ position: "fixed", top: copyCoords.y, right: copyCoords.right, zIndex: 10010 }}
              className="w-56 rounded-xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] text-[#18181B] dark:text-[#EDEDED] p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100 select-none"
            >
              <button type="button" onClick={() => { setCopyMenuOpen(false); copyPng(); }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-[#18181B] dark:text-[#EDEDED] hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-left">
                <span className="font-medium">Copy as PNG</span>
                <span className="text-[10px] text-[#71717A] dark:text-[#A1A1AA] font-mono">Ctrl + Shift + C</span>
              </button>
              <div className="my-1 border-t border-[#E4E4E7] dark:border-[#2E2E32]" />
              <div className="px-2 py-0.5 text-[10px] font-semibold text-[#71717A] dark:text-[#A1A1AA] uppercase tracking-wider">Components</div>
              <button type="button" onClick={() => { setCopyMenuOpen(false); copyCode("jsx", (n, d) => nodeToReactJsx(n, d, { useClient: componentUseClient }), "React / Next.js JSX"); }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-[#18181B] dark:text-[#EDEDED] hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-left">
                <span className="font-medium">Copy as Next.js JSX</span>
                <span className="text-[10px] text-[#71717A] dark:text-[#A1A1AA] font-mono">.jsx</span>
              </button>
              <button type="button" onClick={() => { setCopyMenuOpen(false); copyCode("tsx", (n, d) => nodeToReactTsx(n, d, { useClient: componentUseClient }), "React / Next.js TSX"); }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-[#18181B] dark:text-[#EDEDED] hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-left">
                <span className="font-medium">Copy as Next.js TSX</span>
                <span className="text-[10px] text-[#71717A] dark:text-[#A1A1AA] font-mono">.tsx</span>
              </button>
              <button type="button" onClick={() => { setCopyMenuOpen(false); copyCode("astro", nodeToAstro, "Astro Component"); }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-[#18181B] dark:text-[#EDEDED] hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-left">
                <span className="font-medium">Copy as Astro</span>
                <span className="text-[10px] text-[#71717A] dark:text-[#A1A1AA] font-mono">.astro</span>
              </button>
              <div className="my-1 border-t border-[#E4E4E7] dark:border-[#2E2E32]" />
              <div className="px-2 py-0.5 text-[10px] font-semibold text-[#71717A] dark:text-[#A1A1AA] uppercase tracking-wider">Snippets</div>
              <button type="button" onClick={() => { setCopyMenuOpen(false); copyCode("tailwind", nodeToTailwind, "Tailwind"); }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-[#18181B] dark:text-[#EDEDED] hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-left">
                <span className="font-medium">Copy as Tailwind</span>
                <span className="text-[10px] text-[#71717A] dark:text-[#A1A1AA] font-mono">Alt + T</span>
              </button>
              <button type="button" onClick={() => { setCopyMenuOpen(false); copyCode("react", nodeToReact, "React CSS"); }}
                className="flex w-full items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-[#18181B] dark:text-[#EDEDED] hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-left">
                <span className="font-medium">Copy as React CSS</span>
                <span className="text-[10px] text-[#71717A] dark:text-[#A1A1AA] font-mono">Alt + R</span>
              </button>
            </div>,
            document.body
          )}

          {/* Settings popover */}
          {settingsOpen && settingsCoords && createPortal(
            <div
              data-export-menu="true"
              style={{ position: "fixed", top: settingsCoords.y, right: settingsCoords.right, width: settingsCoords.width, zIndex: 10010 }}
              className="rounded-xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] text-[#18181B] dark:text-[#EDEDED] p-3 shadow-2xl animate-in fade-in zoom-in-95 duration-100 select-none"
            >
              <div className="flex items-center justify-between pb-2 border-b border-[#E4E4E7] dark:border-[#2E2E32]">
                <span className="text-xs font-semibold text-[#18181B] dark:text-white">Export Settings</span>
                <button type="button" onClick={() => setSettingsOpen(false)}
                  className="flex h-5 w-5 items-center justify-center rounded text-[#71717A] hover:text-[#18181B] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer">
                  <X size={13} />
                </button>
              </div>
              <div className="flex flex-col gap-2.5 pt-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[#71717A] dark:text-[#A1A1AA]">File suffix</span>
                  <input type="text" value={suffix} onChange={(e) => setSuffix(e.target.value)} placeholder="@2x"
                    className="h-7 w-28 rounded-md border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#141414] px-2 text-xs text-[#18181B] dark:text-[#EDEDED] focus:outline-none focus:border-[#0D99FF] font-mono" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#71717A] dark:text-[#A1A1AA]">Color space</span>
                  <div className="relative">
                    <select value={colorSpace} onChange={(e) => setColorSpace(e.target.value)}
                      className="h-7 w-28 rounded-md border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#141414] pl-2 pr-6 text-xs text-[#18181B] dark:text-[#EDEDED] focus:outline-none focus:border-[#0D99FF] cursor-pointer appearance-none">
                      <option value="sRGB">sRGB</option>
                      <option value="Display P3">Display P3</option>
                    </select>
                    <ChevronDown size={11} className="absolute right-2 top-2 text-[#71717A] pointer-events-none" />
                  </div>
                </div>

                <div className="my-0.5 border-t border-[#E4E4E7] dark:border-[#2E2E32]" />
                <div className="text-[10px] font-semibold text-[#71717A] dark:text-[#A1A1AA] uppercase tracking-wider">Component Options</div>

                <div className="flex items-center justify-between">
                  <span className="text-[#71717A] dark:text-[#A1A1AA]">Component</span>
                  <div className="flex items-center gap-1 bg-[#F4F4F5] dark:bg-[#141414] p-0.5 rounded-lg border border-[#E4E4E7] dark:border-[#2E2E32]">
                    {[
                      { id: "JSX", label: "JSX" },
                      { id: "TSX", label: "TSX" },
                      { id: "ASTRO", label: "Astro" },
                    ].map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => { setFormat(id); }}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                          format === id
                            ? "bg-[#0D99FF] text-white shadow-2xs"
                            : "text-[#71717A] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-white"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer select-none pt-0.5">
                  <input
                    type="checkbox"
                    checked={componentUseClient}
                    onChange={(e) => setComponentUseClient(e.target.checked)}
                    className="rounded border-[#E4E4E7] text-[#0D99FF] focus:ring-0 cursor-pointer"
                  />
                  <span className="text-[11px] text-[#18181B] dark:text-[#EDEDED]">
                    Include <code className="font-mono text-[#0D99FF]">&quot;use client&quot;</code> directive
                  </span>
                </label>
              </div>
            </div>,
            document.body
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flex panel (frame with flex layout selected)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Path section (M4): the bézier stroke + open/closed state. The Fill
// section above covers the fill (only visible when the path is closed).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Stroke Position Dropdown (Above fill / Below fill matching exact design)
// ---------------------------------------------------------------------------

function StrokePositionDropdown({ value = "above", onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onMouseDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) {
      window.addEventListener("mousedown", onMouseDown);
      return () => window.removeEventListener("mousedown", onMouseDown);
    }
  }, [open]);

  const isAbove = value === "above";

  return (
    <div className="relative flex-1" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-[var(--row-field-h)] w-full items-center justify-between rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 text-xs font-normal text-[var(--text-1)] hover:border-[var(--text-2)] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[var(--text-2)] shrink-0 flex items-center">
            {/* 2 stacked diamond layers icon matching Image 1 & 2 */}
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M8 2L14 5.5L8 9L2 5.5L8 2Z" />
              <path d="M2 9.5L8 13L14 9.5" />
            </svg>
          </span>
          <span className="truncate text-xs">{isAbove ? "Above fill" : "Below fill"}</span>
        </div>
        <ChevronDown size={11} className="text-[var(--text-2)] shrink-0 ml-1" />
      </button>

      {open && (() => {
        const r = ref.current?.getBoundingClientRect();
        const openUp = typeof window !== "undefined" && r && (window.innerHeight - r.bottom < 120) && (r.top > 120);
        return (
          <div className={`absolute left-0 z-50 flex w-36 flex-col rounded-xl border border-[#E4E4E7] dark:border-[var(--line)] bg-white dark:bg-[#1E1E1E] p-1 text-xs shadow-xl animate-in fade-in zoom-in-95 duration-100 ${
            openUp ? "bottom-full mb-1" : "top-full mt-1"
          }`}>
            <button
              type="button"
              onClick={() => {
                onChange("above");
                setOpen(false);
              }}
              className={`flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-left transition-colors cursor-pointer ${
                isAbove
                  ? "bg-[#388BFD] font-medium text-white"
                  : "text-[#1F1F1F] dark:text-zinc-200 hover:bg-[#F4F4F5] dark:hover:bg-zinc-800"
              }`}
            >
              {isAbove ? <Check size={12} strokeWidth={2.5} className="shrink-0 text-white" /> : <span className="w-3 shrink-0" />}
              <span>Above fill</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onChange("below");
                setOpen(false);
              }}
              className={`flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-left transition-colors cursor-pointer ${
                !isAbove
                  ? "bg-[#388BFD] font-medium text-white"
                  : "text-[#1F1F1F] dark:text-zinc-200 hover:bg-[#F4F4F5] dark:hover:bg-zinc-800"
              }`}
            >
              {!isAbove ? <Check size={12} strokeWidth={2.5} className="shrink-0 text-white" /> : <span className="w-3 shrink-0" />}
              <span>Below fill</span>
            </button>
          </div>
        );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Path section (M4): Stroke (Width + Above/Below fill + Eye + Minus + Paint)
// ---------------------------------------------------------------------------

function PathSection({ node, tokens, patchStyle, patchNode }) {
  const stroke = node.style?.stroke;
  const closed = !!node.path?.closed;

  const handleAddStroke = () => {
    patchStyle({
      stroke: {
        width: 1.2,
        position: "above",
        paint: { kind: "solid", color: "#3F3F47", alpha: 1 },
        hidden: false,
      },
    });
  };

  const handleRemoveStroke = () => {
    patchStyle({ stroke: undefined });
  };

  const patchStroke = (p) => {
    const updated = { ...(stroke || {}), ...p };
    patchStyle({ stroke: updated });
  };

  return (
    <div className="border-b border-[var(--line)] pb-3 select-none">
      {!stroke ? (
        <div
          onClick={handleAddStroke}
          className="flex h-9 shrink-0 items-center justify-between text-xs font-normal text-[var(--text-2)] hover:text-black dark:hover:text-white cursor-pointer transition-colors group select-none"
        >
          <span className="font-normal group-hover:text-black dark:group-hover:text-white">Stroke</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleAddStroke();
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] group-hover:text-black dark:group-hover:text-white transition-colors cursor-pointer"
            title="Add stroke"
          >
            <Plus size={13} />
          </button>
        </div>
      ) : (
        <>
          <div className="flex h-9 items-center justify-between text-xs">
            <span className="font-medium text-[var(--text-1)]">Stroke</span>
          </div>

          <div className="flex flex-col gap-1.5">
            {/* Row 1: Width scrubbable + Position dropdown + Eye + Minus */}
            <div className="flex items-center gap-1.5">
              {/* Width scrubbable input */}
              <div className="w-24 flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
                <span
                  className="cursor-ew-resize text-[var(--text-2)] hover:text-[var(--text-1)] shrink-0 mr-1.5 flex items-center select-none"
                  title="Scrub width"
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    startScrubbing(
                      e,
                      stroke.width ?? 1.2,
                      (v) => patchStroke({ width: Math.max(0, Math.round(v * 10) / 10) }),
                      { min: 0, step: 0.1 }
                    );
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor">
                    <line x1="1" y1="2.5" x2="11" y2="2.5" strokeWidth="1.5" strokeLinecap="round" />
                    <line x1="1" y1="6" x2="11" y2="6" strokeWidth="1.5" strokeLinecap="round" />
                    <line x1="1" y1="9.5" x2="11" y2="9.5" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </span>
                <input
                  type="text"
                  value={stroke.width ?? 1.2}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    patchStroke({ width: isNaN(val) ? 0 : val });
                  }}
                  className="w-full text-left text-xs font-medium text-[var(--text-1)] bg-transparent outline-none cursor-text font-mono"
                />
              </div>

              {/* Position dropdown: Above fill / Below fill */}
              <StrokePositionDropdown
                value={stroke.position ?? "above"}
                onChange={(position) => patchStroke({ position })}
              />

              {/* Eye visibility */}
              <button
                type="button"
                onClick={() => patchStroke({ hidden: !stroke.hidden })}
                className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer shrink-0"
                title={stroke.hidden ? "Show stroke" : "Hide stroke"}
              >
                {stroke.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>

              {/* Minus remove */}
              <button
                type="button"
                onClick={handleRemoveStroke}
                className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer shrink-0"
                title="Remove stroke"
              >
                <Minus size={13} />
              </button>
            </div>

            {/* Row 2: StrokePaintRow */}
            <StrokePaintRow
              paint={stroke.paint ?? { kind: "solid", color: "#3F3F47", alpha: 1 }}
              tokens={tokens}
              unified={true}
              onChange={(paint) => patchStroke({ paint })}
            />
          </div>
        </>
      )}

      {/* Path open/close toggle */}
      <div className="pt-2 flex items-center justify-between text-xs text-[var(--text-2)]">
        <button
          type="button"
          onClick={() => patchNode(node.id, { path: { ...node.path, closed: !closed } })}
          className="hover:text-[var(--text-1)] transition-colors cursor-pointer text-[11px]"
        >
          {closed ? "Open path" : "Close path"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shader section (M5): our WebGL mesh gradient — preset, four colours,
// five parameters. Picking a preset replaces colours + params wholesale;
// ANY manual edit after that flips the preset name to "custom" (spec
// pattern). Everything commits through patchNode, so a slider drag is
// one coalesced history entry like every other Inspector control.
// ---------------------------------------------------------------------------

function ShaderParamRow({ def, value, onCommit }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[52px] shrink-0 text-[var(--text-2)]">
        {def.label}
      </span>
      <input
        type="range"
        min={def.min}
        max={def.max}
        step={def.step}
        value={value}
        onChange={(e) => onCommit(Number(e.target.value))}
        className="min-w-0 flex-1"
      />
      <div className="w-[62px] shrink-0">
        <NumInput
          value={value}
          min={def.min}
          max={def.max}
          onCommit={onCommit}
        />
      </div>
    </div>
  );
}

function ShaderSection({ node, tokens = [], patchNode }) {
  const shader = node.shader ?? defaultShader();
  const params = { ...defaultShader().params, ...(shader.params ?? {}) };
  const colors = [0, 1, 2, 3].map((i) => shader.colors?.[i] ?? "#000000");
  const setShader = (next) => patchNode(node.id, { shader: next });
  const setParam = (key, value) =>
    setShader({
      ...shader,
      colors,
      preset: "custom",
      params: { ...params, [key]: value },
    });
  const setColor = (i, color) => {
    const next = [...colors];
    next[i] = color;
    setShader({ ...shader, preset: "custom", colors: next, params });
  };

  return (
    <Section title="Shader">
      <div className="flex flex-col gap-2">
        <select
          value={shader.preset ?? "custom"}
          onChange={(e) => {
            if (e.target.value !== "custom") {
              setShader(applyShaderPreset(e.target.value));
            }
          }}
          className={selectCls}
          title="Preset"
        >
          {SHADER_PRESETS.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
        {colors.map((color, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-[52px] shrink-0 text-[var(--text-2)]">
              Colour {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <ColorRow
                color={color}
                alpha={1}
                showAlpha={false}
                onChange={(c) => setColor(i, c)}
                tokens={tokens}
                onBindToken={(tok) => setColor(i, tok.value)}
              />
            </div>
          </div>
        ))}
        {SHADER_PARAM_DEFS.map((def) => (
          <ShaderParamRow
            key={def.key}
            def={def}
            value={params[def.key]}
            onCommit={(v) => setParam(def.key, v)}
          />
        ))}
        <p className="text-[var(--type-micro)] text-[var(--text-2)]">
          Rendered with WebGL — a static mesh gradient (no animation).
          Copy-as and image export approximate it with CSS gradients.
        </p>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Guides section (M4, frames only): grid guides + vertical/horizontal
// lines, edited by field here — line guides can ALSO be dragged on
// the canvas and double-click-deleted there (depth-gap batch, see
// components/Viewport.jsx); both paths commit through patchNode.
// ---------------------------------------------------------------------------

const DEFAULT_GUIDE_COLOR = "#003880";

function GuideItem({ g, node, update, remove, tokens }) {
  const [kindMenuOpen, setKindMenuOpen] = useState(false);
  const [alignMenuOpen, setAlignMenuOpen] = useState(false);

  const kind = g.kind || "grid";
  const isGrid = kind === "grid";
  const isColumn = kind === "column";
  const isRow = kind === "row";
  const isVert = kind === "v";
  const isHoriz = kind === "h";
  const isHidden = !!g.hidden;

  const kindLabel = isColumn
    ? "Column"
    : isRow
    ? "Row"
    : isVert
    ? "Vertical"
    : isHoriz
    ? "Horizontal"
    : "Grid";

  const align = g.align || "stretch";
  const alignLabel =
    align === "stretch"
      ? "Stretch"
      : align === "start"
      ? "Start"
      : align === "center"
      ? "Center"
      : align === "end"
      ? "End"
      : "Stretch";

  return (
    <div className={`flex flex-col gap-1.5 ${isHidden ? "opacity-50" : ""}`}>
      {/* Row 1: Dropdown(s) + Eye + Minus */}
      <div className="flex items-center gap-1.5 w-full">
        {/* Type Dropdown [ G Grid ∨ ] / [ G Column ∨ ] / [ G Row ∨ ] */}
        <div className="relative flex-1 min-w-0">
          <button
            type="button"
            onClick={() => {
              setKindMenuOpen((prev) => !prev);
              setAlignMenuOpen(false);
            }}
            className="flex h-[var(--row-field-h)] w-full items-center justify-between rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 py-1 shadow-2xs hover:border-[var(--text-2)] transition-colors cursor-pointer select-none"
          >
            <div className="flex items-center gap-1.5 min-w-0 truncate">
              <span className="text-[var(--text-2)] text-xs font-semibold shrink-0">
                G
              </span>
              <span className="text-xs font-medium text-[var(--text-1)] truncate">
                {kindLabel}
              </span>
            </div>
            <ChevronDown size={11} className="text-[var(--text-2)] ml-1 shrink-0" />
          </button>

          {/* Type Dropdown Popover */}
          {kindMenuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setKindMenuOpen(false)} />
              <div className="absolute left-0 top-full z-40 mt-1 w-32 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface-content)] p-1 shadow-xl">
                {[
                  { key: "grid", label: "Grid" },
                  { key: "column", label: "Column" },
                  { key: "row", label: "Row" },
                ].map((item) => {
                  const isSelected = kind === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        if (item.key === "column") {
                          update(g.id, {
                            kind: "column",
                            align: g.align || "stretch",
                            size: g.size || 40,
                            count: g.count || 12,
                            margin: g.margin ?? 0,
                            gutter: g.gutter ?? 8,
                          });
                        } else if (item.key === "row") {
                          update(g.id, {
                            kind: "row",
                            align: g.align || "stretch",
                            size: g.size || 40,
                            count: g.count || 12,
                            margin: g.margin ?? 0,
                            gutter: g.gutter ?? 8,
                          });
                        } else {
                          update(g.id, {
                            kind: "grid",
                            size: g.size || 8,
                            count: g.count || 8,
                          });
                        }
                        setKindMenuOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-xs text-left transition-colors cursor-pointer ${
                        isSelected
                          ? "bg-[#3B82F6] text-white font-medium"
                          : "text-[var(--text-1)] hover:bg-[var(--surface-hover)]"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {isSelected && <Check size={12} className="stroke-[2.5]" />}
                        <span className={!isSelected ? "pl-5" : ""}>{item.label}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Second Field in Row 1 */}
        {isGrid ? (
          /* For Grid: Size Input [ □ 8 ] */
          <div className="flex-1 relative flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 shadow-2xs hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
            <ScrubbableNumberInput
              label={
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-[var(--text-2)]">
                  <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
                </svg>
              }
              labelClassName="shrink-0 mr-1.5 flex items-center"
              value={g.size ?? g.count ?? 8}
              min={1}
              max={128}
              onCommit={(v) => {
                const rounded = Math.max(1, Math.round(v));
                update(g.id, { size: rounded, count: rounded });
              }}
              className="w-full flex items-center"
              inputClassName="w-full text-xs font-medium text-[var(--text-1)] bg-transparent outline-none"
            />
          </div>
        ) : isColumn || isRow ? (
          /* For Column / Row: Alignment Dropdown [ A Stretch ∨ ] */
          <div className="relative flex-1 min-w-0">
            <button
              type="button"
              onClick={() => {
                setAlignMenuOpen((prev) => !prev);
                setKindMenuOpen(false);
              }}
              className="flex h-[var(--row-field-h)] w-full items-center justify-between rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 py-1 shadow-2xs hover:border-[var(--text-2)] transition-colors cursor-pointer select-none"
            >
              <div className="flex items-center gap-1.5 min-w-0 truncate">
                <span className="text-[var(--text-2)] text-xs font-semibold shrink-0">
                  A
                </span>
                <span className="text-xs font-medium text-[var(--text-1)] truncate">
                  {alignLabel}
                </span>
              </div>
              <ChevronDown size={11} className="text-[var(--text-2)] ml-1 shrink-0" />
            </button>

            {/* Alignment Dropdown Popover */}
            {alignMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setAlignMenuOpen(false)} />
                <div className="absolute left-0 top-full z-40 mt-1 w-32 rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface-content)] p-1 shadow-xl">
                  {[
                    { key: "stretch", label: "Stretch" },
                    { key: "start", label: "Start" },
                    { key: "center", label: "Center" },
                    { key: "end", label: "End" },
                  ].map((item) => {
                    const isSelected = align === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          update(g.id, { align: item.key });
                          setAlignMenuOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-xs text-left transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-[#3B82F6] text-white font-medium"
                            : "text-[var(--text-1)] hover:bg-[var(--surface-hover)]"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {isSelected && <Check size={12} className="stroke-[2.5]" />}
                          <span className={!isSelected ? "pl-5" : ""}>{item.label}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        ) : (
          /* For legacy v/h: Position input */
          <div className="flex-1 relative flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 shadow-2xs hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
            <ScrubbableNumberInput
              label={<span className="text-[11px] font-mono text-[var(--text-2)] font-medium select-none">pos</span>}
              labelClassName="shrink-0 mr-1.5 flex items-center"
              value={g.pos ?? 0}
              min={0}
              onCommit={(v) => update(g.id, { pos: Math.round(v) })}
              className="w-full flex items-center"
              inputClassName="w-full text-xs font-medium text-[var(--text-1)] bg-transparent outline-none"
            />
          </div>
        )}

        {/* Eye Button */}
        <button
          type="button"
          onClick={() => update(g.id, { hidden: !g.hidden })}
          className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer shrink-0"
          title={isHidden ? "Show guide" : "Hide guide"}
        >
          {isHidden ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
        </button>

        {/* Minus Button */}
        <button
          type="button"
          onClick={() => remove(g.id)}
          className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-2)] hover:text-red-500 hover:bg-[var(--surface-hover)] transition-colors cursor-pointer shrink-0"
          title="Remove guide"
        >
          <Minus size={14} strokeWidth={1.75} />
        </button>
      </div>

      {/* Rows 2 & 3: For Column / Row */}
      {(isColumn || isRow) && (
        <>
          {/* Row 2: [ sz 40 ]   [ # 12 ] */}
          <div className="flex items-center gap-1.5 w-full">
            {/* Size Input [ sz 40 ] */}
            <div className="flex-1 relative flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 shadow-2xs hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
              <ScrubbableNumberInput
                label={<span className="text-[11px] font-mono text-[var(--text-2)] font-medium select-none">sz</span>}
                labelClassName="shrink-0 mr-1.5 flex items-center"
                value={g.size ?? 40}
                min={1}
                onCommit={(v) => update(g.id, { size: Math.max(1, Math.round(v)) })}
                className="w-full flex items-center"
                inputClassName="w-full text-xs font-medium text-[var(--text-1)] bg-transparent outline-none"
              />
            </div>

            {/* Count Input [ # 12 ] */}
            <div className="flex-1 relative flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 shadow-2xs hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
              <ScrubbableNumberInput
                label={<span className="text-[11px] font-mono text-[var(--text-2)] font-medium select-none">#</span>}
                labelClassName="shrink-0 mr-1.5 flex items-center"
                value={g.count ?? 12}
                min={1}
                max={64}
                onCommit={(v) => update(g.id, { count: Math.max(1, Math.round(v)) })}
                className="w-full flex items-center"
                inputClassName="w-full text-xs font-medium text-[var(--text-1)] bg-transparent outline-none"
              />
            </div>
          </div>

          {/* Row 3: [ ⫿ 0 ]   [ ⫿⫿ 8 ] */}
          <div className="flex items-center gap-1.5 w-full">
            {/* Margin Input */}
            <div className="flex-1 relative flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 shadow-2xs hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
              <ScrubbableNumberInput
                label={
                  isRow ? (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--text-2)]">
                      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" strokeOpacity="0.4" />
                      <line x1="2.5" y1="5.5" x2="13.5" y2="5.5" />
                      <line x1="2.5" y1="10.5" x2="13.5" y2="10.5" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--text-2)]">
                      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" strokeOpacity="0.4" />
                      <line x1="5.5" y1="2.5" x2="5.5" y2="13.5" />
                      <line x1="10.5" y1="2.5" x2="10.5" y2="13.5" />
                    </svg>
                  )
                }
                labelClassName="shrink-0 mr-1.5 flex items-center"
                value={g.margin ?? 0}
                min={0}
                onCommit={(v) => update(g.id, { margin: Math.max(0, Math.round(v)) })}
                className="w-full flex items-center"
                inputClassName="w-full text-xs font-medium text-[var(--text-1)] bg-transparent outline-none"
              />
            </div>

            {/* Gutter Input [ ⫿⫿ 8 ] */}
            <div className="flex-1 relative flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 shadow-2xs hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
              <ScrubbableNumberInput
                label={
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--text-2)]">
                    <line x1="6" y1="2.5" x2="6" y2="13.5" />
                    <line x1="10" y1="2.5" x2="10" y2="13.5" />
                  </svg>
                }
                labelClassName="shrink-0 mr-1.5 flex items-center"
                value={g.gutter ?? 8}
                min={0}
                onCommit={(v) => update(g.id, { gutter: Math.max(0, Math.round(v)) })}
                className="w-full flex items-center"
                inputClassName="w-full text-xs font-medium text-[var(--text-1)] bg-transparent outline-none"
              />
            </div>
          </div>
        </>
      )}

      {/* Color Row: Unified Color Row Pill */}
      <ColorRow
        color={g.color || DEFAULT_GUIDE_COLOR}
        alpha={g.opacity ?? 0.1}
        tokenName={g.tokenName || (g.tokenId ? tokens.find((t) => t.id === g.tokenId)?.name : null)}
        tokenId={g.tokenId}
        onChange={(color, alpha) => update(g.id, { color, opacity: alpha, tokenName: undefined, tokenId: undefined })}
        tokens={tokens}
        onBindToken={(tok) => update(g.id, { color: tok.value, opacity: g.opacity ?? 0.1, tokenName: tok.name, tokenId: tok.id })}
        unified={true}
      />
    </div>
  );
}

function GuidesSection({ node, patchNode, tokens = [] }) {
  const guides = node.guides ?? [];
  const setGuides = (next) => patchNode(node.id, { guides: next });
  const update = (id, patch) =>
    setGuides(guides.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  const remove = (id) => setGuides(guides.filter((g) => g.id !== id));
  const add = (guide) =>
    setGuides([
      ...guides,
      { id: `guide-${Math.random().toString(36).slice(2, 9)}`, ...guide },
    ]);

  const handleAddGuide = () => {
    add({
      kind: "grid",
      size: 8,
      count: 8,
      color: DEFAULT_GUIDE_COLOR,
      opacity: 0.1,
      hidden: false,
    });
  };

  if (!guides.length) {
    return (
      <div
        onClick={handleAddGuide}
        className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--line)] text-xs font-normal text-[var(--text-2)] hover:text-black dark:hover:text-white cursor-pointer transition-colors group select-none"
      >
        <span className="font-normal group-hover:text-black dark:group-hover:text-white">Guides</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleAddGuide();
          }}
          className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] group-hover:text-black dark:group-hover:text-white transition-colors cursor-pointer"
          title="Add guide"
        >
          <Plus size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-[var(--line)] pb-3 select-none">
      {/* Header Row: "Guides" and [+] button */}
      <div className="flex h-9 items-center justify-between text-xs">
        <span className="font-medium text-[var(--text-1)]">Guides</span>
        <button
          type="button"
          onClick={handleAddGuide}
          className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] hover:text-black dark:hover:text-white transition-colors cursor-pointer"
          title="Add guide"
        >
          <Plus size={13} />
        </button>
      </div>
      <div className="flex flex-col gap-3">
        {guides.map((g) => (
          <GuideItem
            key={g.id}
            g={g}
            node={node}
            update={update}
            remove={remove}
            tokens={tokens}
          />
        ))}
      </div>
    </div>
  );
}

function FlexPanel({ node, tokens, patchLayout }) {
  const layout = node.layout;
  const gapBound = isTokenRef(layout.gap);
  const gridMain = ["start", "center", "end"];
  const gridCross = ["start", "center", "end"];

  const padField = (axis, label) => {
    const v = layout.padding?.[axis] ?? 0;
    const bound = isTokenRef(v);
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          {bound ? (
            <div className="flex flex-1 items-center justify-between rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 py-0.5 text-xs">
              <span className="text-[var(--text-2)]">{label}</span>
              <span className="text-[var(--text-1)]">
                {resolveNumeric(v, tokens)}px (token)
              </span>
            </div>
          ) : (
            <ScrubbableNumberInput
              label={label}
              value={typeof v === "number" ? v : 0}
              min={0}
              onCommit={(n) =>
                patchLayout({ padding: { ...layout.padding, [axis]: Math.round(n) } })
              }
              className="flex-1"
            />
          )}
          {bound && (
            <button
              className={miniBtnCls}
              title="Detach token"
              onClick={() =>
                patchLayout({
                  padding: {
                    ...layout.padding,
                    [axis]: resolveNumeric(v, tokens),
                  },
                })
              }
            >
              <X size={12} />
            </button>
          )}
        </div>
        {!bound && (
          <TokenBindSelect
            tokens={tokens}
            types={["spacing"]}
            label="Bind spacing…"
            onBind={(tokenId) =>
              patchLayout({
                padding: { ...layout.padding, [axis]: { tokenId } },
              })
            }
          />
        )}
      </div>
    );
  };

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--line)] p-2">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 rounded-[var(--radius-md)] bg-[var(--surface-hover)] p-0.5">
          {[
            ["column", <><ArrowDown size={12} className="inline mr-1" /> Column</>],
            ["row", <><ArrowRight size={12} className="inline mr-1" /> Row</>],
          ].map(([dir, label]) => (
            <button
              key={dir}
              onClick={() => patchLayout({ direction: dir })}
              className="flex-1 flex items-center justify-center rounded-[var(--radius-sm)] py-0.5 text-xs transition-colors"
              style={
                layout.direction === dir
                  ? { background: "var(--surface-content)", fontWeight: 600, color: "var(--text-1)" }
                  : { color: "var(--text-2)" }
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => patchLayout({ reverse: !layout.reverse })}
          className="flex items-center gap-1.5 text-xs text-[var(--text-1)] cursor-pointer select-none"
        >
          <div
            className={`flex h-3.5 w-3.5 items-center justify-center rounded border transition-colors ${layout.reverse
              ? "bg-[var(--accent)] border-[var(--accent)] text-white"
              : "border-[var(--line)] bg-[var(--surface-content)]"
              }`}
          >
            {layout.reverse && <Check size={10} strokeWidth={3} />}
          </div>
          <span>Reverse</span>
        </button>
        <button
          type="button"
          onClick={() => patchLayout({ wrap: !layout.wrap })}
          className="flex items-center gap-1.5 text-xs text-[var(--text-1)] cursor-pointer select-none"
        >
          <div
            className={`flex h-3.5 w-3.5 items-center justify-center rounded border transition-colors ${layout.wrap
              ? "bg-[var(--accent)] border-[var(--accent)] text-white"
              : "border-[var(--line)] bg-[var(--surface-content)]"
              }`}
          >
            {layout.wrap && <Check size={10} strokeWidth={3} />}
          </div>
          <span>Wrap</span>
        </button>
      </div>

      {/* Gap — ONE field, optionally token-bound (spec) */}
      <div className="flex items-center gap-2">
        {gapBound ? (
          <>
            <div className="flex flex-1 items-center justify-between rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 py-0.5 text-xs">
              <span className="text-[var(--text-2)]">Gap</span>
              <span className="text-[var(--text-1)]">
                {resolveNumeric(layout.gap, tokens)}px (token)
              </span>
            </div>
            <button
              className={miniBtnCls}
              title="Detach token"
              onClick={() =>
                patchLayout({ gap: resolveNumeric(layout.gap, tokens) })
              }
            >
              <X size={12} />
            </button>
          </>
        ) : (
          <ScrubbableNumberInput
            label="Gap"
            value={typeof layout.gap === "number" ? layout.gap : 0}
            min={0}
            onCommit={(v) => patchLayout({ gap: v })}
            className="flex-1"
          />
        )}
      </div>
      {!gapBound && (
        <TokenBindSelect
          tokens={tokens}
          types={["spacing"]}
          label="Bind gap to spacing token…"
          onBind={(tokenId) => patchLayout({ gap: { tokenId } })}
        />
      )}

      <div className="grid grid-cols-2 gap-2">
        {padField("h", "H")}
        {padField("v", "V")}
      </div>

      {/* 3×3 alignment grid: columns = main axis, rows = cross axis */}
      <div>
        <div className="mb-1 text-[var(--type-micro)] text-[var(--text-2)]">
          Alignment
        </div>
        <div className="grid w-[84px] grid-cols-3 gap-1">
          {gridCross.map((cross) =>
            gridMain.map((main) => {
              const active =
                layout.alignMain === main && layout.alignCross === cross;
              return (
                <button
                  key={`${cross}-${main}`}
                  title={`Main ${main} · Cross ${cross}`}
                  onClick={() =>
                    patchLayout({ alignMain: main, alignCross: cross })
                  }
                  className="flex h-6 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--line)]"
                  style={
                    active
                      ? { background: "var(--accent)", color: "#fff" }
                      : { background: "var(--surface-content)" }
                  }
                >
                  ●
                </button>
              );
            }),
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[var(--type-micro)] text-[var(--text-2)]">
            Cross
          </span>
          <select
            value={layout.alignCross}
            onChange={(e) => patchLayout({ alignCross: e.target.value })}
            className={selectCls}
          >
            <option value="start">Start</option>
            <option value="center">Center</option>
            <option value="end">End</option>
            <option value="stretch">Stretch</option>
          </select>
          <span className="text-[var(--type-micro)] text-[var(--text-2)]">
            Main
          </span>
          <select
            value={layout.alignMain}
            onChange={(e) => patchLayout({ alignMain: e.target.value })}
            className={selectCls}
          >
            <option value="start">Start</option>
            <option value="center">Center</option>
            <option value="end">End</option>
            <option value="space-between">Space between</option>
          </select>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main inspector
// ---------------------------------------------------------------------------

function formatLineHeightDisplay(lh) {
  if (lh == null) return "100%";
  if (typeof lh === "number") {
    return `${Math.round(lh * 100)}%`;
  }
  const str = String(lh).trim();
  if (str.toLowerCase() === "auto") return "125%";
  if (str.endsWith("%")) return str;
  const parsed = parseFloat(str);
  if (!isNaN(parsed)) {
    return parsed > 5 ? `${Math.round(parsed)}%` : `${Math.round(parsed * 100)}%`;
  }
  return str;
}

function formatLetterSpacingDisplay(ls) {
  if (ls == null || ls === 0 || ls === "0" || ls === "0%") return "0%";
  const str = String(ls).trim();
  if (str.endsWith("%")) return str;
  if (str.endsWith("px")) return str;
  const parsed = parseFloat(str);
  if (!isNaN(parsed)) return `${parsed}%`;
  return str;
}

function TextSection({ node, tokens = [], patchNodeText }) {
  const [showFormatting, setShowFormatting] = useState(false);
  const settingsBtnRef = useRef(null);

  const [showThemeFont, setShowThemeFont] = useState(false);
  const themeFontHeaderBtnRef = useRef(null);
  const themeFontRowBtnRef = useRef(null);
  const [activeFontTriggerRef, setActiveFontTriggerRef] = useState(null);

  const docTokens = useEditorStore((s) => s.doc.tokens ?? []);
  const allTokens = tokens && tokens.length > 0 ? tokens : docTokens;

  const [showFontWeightMenu, setShowFontWeightMenu] = useState(false);
  const fontWeightTriggerRef = useRef(null);
  const fontWeightMenuRef = useRef(null);
  const [fontWeightCoords, setFontWeightCoords] = useState({ x: 0, y: 0, width: 180 });

  const [showFontSizeMenu, setShowFontSizeMenu] = useState(false);
  const fontSizeBoxRef = useRef(null);
  const fontSizeMenuRef = useRef(null);
  const [fontSizeCoords, setFontSizeCoords] = useState({ x: 0, y: 0 });

  const [showLineHeightMenu, setShowLineHeightMenu] = useState(false);
  const lineHeightBoxRef = useRef(null);
  const lineHeightMenuRef = useRef(null);
  const [lineHeightCoords, setLineHeightCoords] = useState({ x: 0, y: 0 });

  const [showLetterSpacingMenu, setShowLetterSpacingMenu] = useState(false);
  const letterSpacingBoxRef = useRef(null);
  const letterSpacingMenuRef = useRef(null);
  const [letterSpacingCoords, setLetterSpacingCoords] = useState({ x: 0, y: 0 });

  const t = node.text ?? {};

  const [sizeText, setSizeText] = useState(String(t.fontSize ?? 16));
  const [lineHeightText, setLineHeightText] = useState(formatLineHeightDisplay(t.lineHeight));
  const [letterSpacingText, setLetterSpacingText] = useState(formatLetterSpacingDisplay(t.letterSpacing));

  useEffect(() => {
    setSizeText(String(t.fontSize ?? 16));
  }, [t.fontSize]);

  useEffect(() => {
    setLineHeightText(formatLineHeightDisplay(t.lineHeight));
  }, [t.lineHeight]);

  useEffect(() => {
    setLetterSpacingText(formatLetterSpacingDisplay(t.letterSpacing));
  }, [t.letterSpacing]);

  const FONT_WEIGHTS = [
    { value: 100, label: "Thin (100)", name: "Thin" },
    { value: 200, label: "Extra Light (200)", name: "Extra Light" },
    { value: 300, label: "Light (300)", name: "Light" },
    { value: 400, label: "Regular (400)", name: "Regular" },
    { value: 500, label: "Medium (500)", name: "Medium" },
    { value: 600, label: "Semibold (600)", name: "Semibold" },
    { value: 700, label: "Bold (700)", name: "Bold" },
    { value: 800, label: "Extra Bold (800)", name: "Extra Bold" },
    { value: 900, label: "Black (900)", name: "Black" },
  ];

  const currentWeightObj = FONT_WEIGHTS.find((w) => w.value === (t.fontWeight ?? 400)) || {
    value: 400,
    label: "Regular (400)",
    name: "Regular",
  };

  // Compute position for dropdown popovers
  useLayoutEffect(() => {
    if (showFontWeightMenu && fontWeightTriggerRef.current) {
      const rect = fontWeightTriggerRef.current.getBoundingClientRect();
      const popoverHeight = 280;
      let y = rect.bottom + 4;
      if (y + popoverHeight > window.innerHeight - 12) {
        y = Math.max(12, rect.top - popoverHeight - 4);
      }
      setFontWeightCoords({ x: rect.left, y, width: rect.width });
    }
  }, [showFontWeightMenu]);

  useLayoutEffect(() => {
    if (showFontSizeMenu && fontSizeBoxRef.current) {
      const rect = fontSizeBoxRef.current.getBoundingClientRect();
      const popoverHeight = 220;
      let y = rect.bottom + 4;
      if (y + popoverHeight > window.innerHeight - 12) {
        y = Math.max(12, rect.top - popoverHeight - 4);
      }
      setFontSizeCoords({ x: rect.left, y });
    }
  }, [showFontSizeMenu]);

  useLayoutEffect(() => {
    if (showLineHeightMenu && lineHeightBoxRef.current) {
      const rect = lineHeightBoxRef.current.getBoundingClientRect();
      const popoverHeight = 200;
      let y = rect.bottom + 4;
      if (y + popoverHeight > window.innerHeight - 12) {
        y = Math.max(12, rect.top - popoverHeight - 4);
      }
      setLineHeightCoords({ x: rect.left, y });
    }
  }, [showLineHeightMenu]);

  useLayoutEffect(() => {
    if (showLetterSpacingMenu && letterSpacingBoxRef.current) {
      const rect = letterSpacingBoxRef.current.getBoundingClientRect();
      const popoverHeight = 200;
      let y = rect.bottom + 4;
      if (y + popoverHeight > window.innerHeight - 12) {
        y = Math.max(12, rect.top - popoverHeight - 4);
      }
      setLetterSpacingCoords({ x: Math.max(12, rect.right - 120), y });
    }
  }, [showLetterSpacingMenu]);

  // Click outside to close any open dropdown menu
  useEffect(() => {
    if (!showFontWeightMenu && !showFontSizeMenu && !showLineHeightMenu && !showLetterSpacingMenu) return;

    const handlePointerDown = (e) => {
      if (
        showFontWeightMenu &&
        fontWeightMenuRef.current &&
        !fontWeightMenuRef.current.contains(e.target) &&
        !fontWeightTriggerRef.current?.contains(e.target)
      ) {
        setShowFontWeightMenu(false);
      }
      if (
        showFontSizeMenu &&
        fontSizeMenuRef.current &&
        !fontSizeMenuRef.current.contains(e.target) &&
        !fontSizeBoxRef.current?.contains(e.target)
      ) {
        setShowFontSizeMenu(false);
      }
      if (
        showLineHeightMenu &&
        lineHeightMenuRef.current &&
        !lineHeightMenuRef.current.contains(e.target) &&
        !lineHeightBoxRef.current?.contains(e.target)
      ) {
        setShowLineHeightMenu(false);
      }
      if (
        showLetterSpacingMenu &&
        letterSpacingMenuRef.current &&
        !letterSpacingMenuRef.current.contains(e.target) &&
        !letterSpacingBoxRef.current?.contains(e.target)
      ) {
        setShowLetterSpacingMenu(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setShowFontWeightMenu(false);
        setShowFontSizeMenu(false);
        setShowLineHeightMenu(false);
        setShowLetterSpacingMenu(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showFontWeightMenu, showFontSizeMenu, showLineHeightMenu, showLetterSpacingMenu]);

  return (
    <div className="border-b border-[var(--line)] pb-3 select-none">
      {/* Header: Text with Settings Sliders icon */}
      <div className="flex h-9 items-center justify-between text-xs">
        <span className="font-medium text-[var(--text-1)]">Text</span>
        <div className="flex items-center gap-1">
          <button
            ref={settingsBtnRef}
            type="button"
            onClick={() => setShowFormatting(!showFormatting)}
            className={`flex h-6 w-6 items-center justify-center rounded text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer ${
              showFormatting ? "bg-[var(--surface-hover)] text-[var(--text-1)]" : ""
            }`}
            title="Text formatting"
          >
            {/* Vertical sliders icon matching Paper */}
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M4 2v3M4 9v5M2 5h4M12 2v6M12 12v2M10 8h4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Theme Font Popover */}
      {showThemeFont && (
        <ThemeFontPopover
          triggerRef={activeFontTriggerRef || themeFontRowBtnRef || themeFontHeaderBtnRef}
          tokens={allTokens}
          currentFont={t.fontFamily ?? "Manrope"}
          selectedTokenId={t.fontTokenId}
          selectedTokenName={t.fontTokenName}
          onSelectToken={(token) => {
            patchNodeText(node.id, {
              fontFamily: token.value,
              fontTokenId: token.id,
              fontTokenName: token.name,
            });
          }}
          onDetachToken={() => {
            patchNodeText(node.id, {
              fontTokenId: undefined,
              fontTokenName: undefined,
            });
          }}
          onClose={() => setShowThemeFont(false)}
        />
      )}

      {/* Formatting Popover */}
      {showFormatting && (
        <TextFormattingPopover
          anchorRef={settingsBtnRef}
          isOpen={showFormatting}
          onClose={() => setShowFormatting(false)}
          node={node}
          patchNodeText={patchNodeText}
        />
      )}

      <div className="flex flex-col gap-2">
        {/* Row 1: Google Font Family Picker */}
        <FontPicker
          value={t.fontFamily ?? "Manrope"}
          tokenName={t.fontTokenName}
          isThemeActive={showThemeFont || Boolean(t.fontTokenName || t.fontTokenId)}
          themeButtonRef={themeFontRowBtnRef}
          onOpenTheme={() => {
            setActiveFontTriggerRef(themeFontRowBtnRef);
            setShowThemeFont((prev) => !prev);
          }}
          onChange={(font) =>
            patchNodeText(node.id, {
              fontFamily: font,
              fontTokenId: undefined,
              fontTokenName: undefined,
            })
          }
        />

        {/* Row 2: Custom Font Weight Dropdown (Paper Style) */}
        <div
          ref={fontWeightTriggerRef}
          onClick={() => {
            setShowFontWeightMenu(!showFontWeightMenu);
            setShowFontSizeMenu(false);
            setShowLineHeightMenu(false);
            setShowLetterSpacingMenu(false);
          }}
          className="relative flex h-[var(--row-field-h)] items-center justify-between rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] transition-colors cursor-pointer select-none"
        >
          <div className="flex items-center gap-2 min-w-0">
            {/* Paper Font Weight Icon: A with horizontal double arrow */}
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-[var(--text-2)] shrink-0"
            >
              <path d="M5 10.5L8 3.5L11 10.5M6 8.5h4" />
              <path d="M2.5 13.5h11M4 12l-1.5 1.5 1.5 1.5M12 12l1.5 1.5-1.5 1.5" />
            </svg>
            <span className="truncate text-xs font-medium text-[var(--text-1)]">
              {currentWeightObj.name}
            </span>
          </div>
          <ChevronDown
            size={11}
            className={`text-[var(--text-2)] shrink-0 transition-transform duration-150 ${
              showFontWeightMenu ? "rotate-180" : ""
            }`}
          />
        </div>

        {/* Font Weight Popover Portal */}
        {showFontWeightMenu &&
          createPortal(
            <div
              ref={fontWeightMenuRef}
              className="fixed z-[10002] flex flex-col rounded-xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] p-1 text-xs text-[#18181B] dark:text-[#EDEDED] shadow-2xl animate-in fade-in zoom-in-95 duration-100 overflow-y-auto max-h-[280px]"
              style={{
                left: `${fontWeightCoords.x}px`,
                top: `${fontWeightCoords.y}px`,
                width: `${fontWeightCoords.width}px`,
              }}
            >
              {FONT_WEIGHTS.map((w) => {
                const isActive = (t.fontWeight ?? 400) === w.value;
                return (
                  <button
                    key={w.value}
                    type="button"
                    onClick={() => {
                      patchNodeText(node.id, { fontWeight: w.value });
                      setShowFontWeightMenu(false);
                    }}
                    className={`flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                      isActive
                        ? "bg-[#0D99FF]/10 text-[#0D99FF] dark:text-[#38BDF8] font-medium"
                        : "hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] text-[var(--text-1)]"
                    }`}
                  >
                    <span>{w.label}</span>
                    {isActive && (
                      <Check size={12} strokeWidth={2.5} className="shrink-0 ml-1.5" />
                    )}
                  </button>
                );
              })}
            </div>,
            document.body
          )}

        {/* Row 3: 3 Single-Border Inputs (Size, Line Height, Letter Spacing) matching Paper */}
        <div className="grid grid-cols-3 gap-1.5">
          {/* Size */}
          <div
            ref={fontSizeBoxRef}
            className="relative flex h-[var(--row-field-h)] items-center justify-between rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-1.5 hover:border-[var(--text-2)] focus-within:border-[var(--accent)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors"
          >
            <span
              onMouseDown={(e) =>
                startScrubbing(
                  e,
                  t.fontSize ?? 16,
                  (val) => patchNodeText(node.id, { fontSize: Math.round(val) }),
                  { step: 1, min: 1, max: 200 }
                )
              }
              className="text-[11px] font-mono text-[var(--text-2)] select-none shrink-0 cursor-ew-resize hover:text-[var(--text-1)] mr-0.5"
              title="Drag horizontally to adjust size"
            >
              ↕A
            </span>
            <input
              type="text"
              value={sizeText}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setSizeText(e.target.value)}
              onBlur={() => {
                const val = parseFloat(sizeText);
                if (!isNaN(val) && val > 0) {
                  patchNodeText(node.id, { fontSize: Math.round(val) });
                } else {
                  setSizeText(String(t.fontSize ?? 16));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  const next = (t.fontSize ?? 16) + (e.shiftKey ? 10 : 1);
                  patchNodeText(node.id, { fontSize: next });
                  setSizeText(String(next));
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  const next = Math.max(1, (t.fontSize ?? 16) - (e.shiftKey ? 10 : 1));
                  patchNodeText(node.id, { fontSize: next });
                  setSizeText(String(next));
                }
              }}
              className="w-full min-w-0 bg-transparent text-center text-xs font-normal text-[var(--text-1)] outline-none"
            />
            <button
              type="button"
              onClick={() => {
                setShowFontSizeMenu(!showFontSizeMenu);
                setShowLineHeightMenu(false);
                setShowLetterSpacingMenu(false);
                setShowFontWeightMenu(false);
              }}
              className="text-[var(--text-2)] hover:text-[var(--text-1)] cursor-pointer shrink-0 ml-0.5"
            >
              <ChevronDown
                size={11}
                className={`transition-transform duration-150 ${
                  showFontSizeMenu ? "rotate-180" : ""
                }`}
              />
            </button>
          </div>

          {/* Line Height */}
          <div
            ref={lineHeightBoxRef}
            className="relative flex h-[var(--row-field-h)] items-center justify-between rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-1.5 hover:border-[var(--text-2)] focus-within:border-[var(--accent)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors"
          >
            <span
              onMouseDown={(e) => {
                const curMultiplier = typeof t.lineHeight === "number" ? t.lineHeight : 1.25;
                startScrubbing(
                  e,
                  curMultiplier * 100,
                  (val) => {
                    const next = Math.max(20, Math.min(500, Math.round(val)));
                    patchNodeText(node.id, { lineHeight: next / 100 });
                  },
                  { step: 5, min: 20, max: 500 }
                );
              }}
              className="text-[11px] font-mono text-[var(--text-2)] select-none shrink-0 cursor-ew-resize hover:text-[var(--text-1)] mr-0.5"
              title="Drag horizontally to adjust line height"
            >
              ¯A
            </span>
            <input
              type="text"
              value={lineHeightText}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setLineHeightText(e.target.value)}
              onBlur={() => {
                const trimmed = lineHeightText.trim().toLowerCase();
                if (trimmed === "auto") {
                  patchNodeText(node.id, { lineHeight: 1.25 });
                  setLineHeightText("125%");
                } else {
                  const num = parseFloat(trimmed);
                  if (!isNaN(num) && num > 0) {
                    const mult = num > 5 ? num / 100 : num;
                    patchNodeText(node.id, { lineHeight: mult });
                    setLineHeightText(`${Math.round(mult * 100)}%`);
                  } else {
                    setLineHeightText(formatLineHeightDisplay(t.lineHeight));
                  }
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  const cur = typeof t.lineHeight === "number" ? t.lineHeight : 1.25;
                  const next = Math.round((cur + 0.05) * 100) / 100;
                  patchNodeText(node.id, { lineHeight: next });
                  setLineHeightText(`${Math.round(next * 100)}%`);
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  const cur = typeof t.lineHeight === "number" ? t.lineHeight : 1.25;
                  const next = Math.max(0.5, Math.round((cur - 0.05) * 100) / 100);
                  patchNodeText(node.id, { lineHeight: next });
                  setLineHeightText(`${Math.round(next * 100)}%`);
                }
              }}
              className="w-full min-w-0 bg-transparent text-center text-xs font-normal text-[var(--text-1)] outline-none"
            />
            <button
              type="button"
              onClick={() => {
                setShowLineHeightMenu(!showLineHeightMenu);
                setShowFontSizeMenu(false);
                setShowLetterSpacingMenu(false);
                setShowFontWeightMenu(false);
              }}
              className="text-[var(--text-2)] hover:text-[var(--text-1)] cursor-pointer shrink-0 ml-0.5"
            >
              <ChevronDown
                size={11}
                className={`transition-transform duration-150 ${
                  showLineHeightMenu ? "rotate-180" : ""
                }`}
              />
            </button>
          </div>

          {/* Letter Spacing */}
          <div
            ref={letterSpacingBoxRef}
            className="relative flex h-[var(--row-field-h)] items-center justify-between rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-1.5 hover:border-[var(--text-2)] focus-within:border-[var(--accent)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors"
          >
            <span
              onMouseDown={(e) => {
                const cur =
                  typeof t.letterSpacing === "number"
                    ? t.letterSpacing
                    : parseFloat(t.letterSpacing) || 0;
                startScrubbing(
                  e,
                  cur,
                  (val) => {
                    const next = Math.round(val * 10) / 10;
                    patchNodeText(node.id, { letterSpacing: next });
                  },
                  { step: 0.5, min: -20, max: 100 }
                );
              }}
              className="text-[11px] font-mono text-[var(--text-2)] select-none shrink-0 cursor-ew-resize hover:text-[var(--text-1)] mr-0.5"
              title="Drag horizontally to adjust letter spacing"
            >
              |A|
            </span>
            <input
              type="text"
              value={letterSpacingText}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setLetterSpacingText(e.target.value)}
              onBlur={() => {
                const trimmed = letterSpacingText.trim();
                if (trimmed.endsWith("px")) {
                  const num = parseFloat(trimmed);
                  if (!isNaN(num)) {
                    patchNodeText(node.id, { letterSpacing: `${num}px` });
                    setLetterSpacingText(`${num}px`);
                  } else {
                    setLetterSpacingText(formatLetterSpacingDisplay(t.letterSpacing));
                  }
                } else {
                  const num = parseFloat(trimmed);
                  if (!isNaN(num)) {
                    patchNodeText(node.id, { letterSpacing: num });
                    setLetterSpacingText(`${num}%`);
                  } else {
                    setLetterSpacingText(formatLetterSpacingDisplay(t.letterSpacing));
                  }
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  const cur =
                    typeof t.letterSpacing === "number"
                      ? t.letterSpacing
                      : parseFloat(t.letterSpacing) || 0;
                  const next = Math.round((cur + 1) * 10) / 10;
                  patchNodeText(node.id, { letterSpacing: next });
                  setLetterSpacingText(`${next}%`);
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  const cur =
                    typeof t.letterSpacing === "number"
                      ? t.letterSpacing
                      : parseFloat(t.letterSpacing) || 0;
                  const next = Math.max(-50, Math.round((cur - 1) * 10) / 10);
                  patchNodeText(node.id, { letterSpacing: next });
                  setLetterSpacingText(`${next}%`);
                }
              }}
              className="w-full min-w-0 bg-transparent text-center text-xs font-normal text-[var(--text-1)] outline-none"
            />
            <button
              type="button"
              onClick={() => {
                setShowLetterSpacingMenu(!showLetterSpacingMenu);
                setShowFontSizeMenu(false);
                setShowLineHeightMenu(false);
                setShowFontWeightMenu(false);
              }}
              className="text-[var(--text-2)] hover:text-[var(--text-1)] cursor-pointer shrink-0 ml-0.5"
            >
              <ChevronDown
                size={11}
                className={`transition-transform duration-150 ${
                  showLetterSpacingMenu ? "rotate-180" : ""
                }`}
              />
            </button>
          </div>
        </div>

        {/* Font Size Presets Popover */}
        {showFontSizeMenu &&
          createPortal(
            <div
              ref={fontSizeMenuRef}
              className="fixed z-[10002] w-28 max-h-56 overflow-y-auto rounded-xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] p-1 shadow-2xl animate-in fade-in zoom-in-95 duration-100 text-xs"
              style={{
                left: `${fontSizeCoords.x}px`,
                top: `${fontSizeCoords.y}px`,
              }}
            >
              {[10, 11, 12, 14, 16, 18, 20, 24, 32, 40, 48, 64].map((sz) => {
                const isActive = (t.fontSize ?? 16) === sz;
                return (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => {
                      patchNodeText(node.id, { fontSize: sz });
                      setSizeText(String(sz));
                      setShowFontSizeMenu(false);
                    }}
                    className={`flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                      isActive
                        ? "bg-[#0D99FF]/10 text-[#0D99FF] dark:text-[#38BDF8] font-medium"
                        : "hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] text-[var(--text-1)]"
                    }`}
                  >
                    <span>{sz}</span>
                    {isActive && (
                      <Check size={11} strokeWidth={2.5} className="shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>,
            document.body
          )}

        {/* Line Height Presets Popover */}
        {showLineHeightMenu &&
          createPortal(
            <div
              ref={lineHeightMenuRef}
              className="fixed z-[10002] w-32 max-h-56 overflow-y-auto rounded-xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] p-1 shadow-2xl animate-in fade-in zoom-in-95 duration-100 text-xs"
              style={{
                left: `${lineHeightCoords.x}px`,
                top: `${lineHeightCoords.y}px`,
              }}
            >
              {[
                { label: "Auto", val: 1.25, display: "Auto" },
                { label: "100%", val: 1.0, display: "100%" },
                { label: "115%", val: 1.15, display: "115%" },
                { label: "120%", val: 1.2, display: "120%" },
                { label: "130%", val: 1.3, display: "130%" },
                { label: "140%", val: 1.4, display: "140%" },
                { label: "150%", val: 1.5, display: "150%" },
                { label: "160%", val: 1.6, display: "160%" },
                { label: "200%", val: 2.0, display: "200%" },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    patchNodeText(node.id, { lineHeight: item.val });
                    setLineHeightText(item.display);
                    setShowLineHeightMenu(false);
                  }}
                  className="flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-left hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-[var(--text-1)]"
                >
                  <span>{item.label}</span>
                </button>
              ))}
            </div>,
            document.body
          )}

        {/* Letter Spacing Presets Popover */}
        {showLetterSpacingMenu &&
          createPortal(
            <div
              ref={letterSpacingMenuRef}
              className="fixed z-[10002] w-32 max-h-56 overflow-y-auto rounded-xl border border-[#E4E4E7] dark:border-[#2E2E32] bg-white dark:bg-[#1E1E1E] p-1 shadow-2xl animate-in fade-in zoom-in-95 duration-100 text-xs"
              style={{
                left: `${letterSpacingCoords.x}px`,
                top: `${letterSpacingCoords.y}px`,
              }}
            >
              {[
                { label: "-5%", val: -5 },
                { label: "-2.5%", val: -2.5 },
                { label: "-1%", val: -1 },
                { label: "0%", val: 0 },
                { label: "1%", val: 1 },
                { label: "2.5%", val: 2.5 },
                { label: "5%", val: 5 },
                { label: "10%", val: 10 },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    patchNodeText(node.id, { letterSpacing: item.val });
                    setLetterSpacingText(item.label);
                    setShowLetterSpacingMenu(false);
                  }}
                  className="flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-left hover:bg-[#F4F4F5] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer text-[var(--text-1)]"
                >
                  <span>{item.label}</span>
                </button>
              ))}
            </div>,
            document.body
          )}

        {/* Row 4: Horizontal & Vertical Alignment (6 buttons) matching Paper reference */}
        <div className="flex items-center gap-1.5">
          {/* Horizontal Alignments */}
          <div className="flex-1 flex rounded-[var(--radius-md)] bg-[var(--surface-hover)] p-0.5">
            {[
              ["left", <AlignLeft size={13} key="left" />],
              ["center", <AlignCenter size={13} key="center" />],
              ["right", <AlignRight size={13} key="right" />],
            ].map(([align, icon]) => (
              <button
                key={align}
                type="button"
                onClick={() => patchNodeText(node.id, { align })}
                className={`flex-1 flex items-center justify-center py-1 rounded-[var(--radius-sm)] transition-colors ${
                  (t.align ?? "left") === align
                    ? "bg-[var(--surface-content)] text-[var(--text-1)] font-semibold shadow-2xs"
                    : "text-[var(--text-2)] hover:text-[var(--text-1)]"
                }`}
                title={`Align ${align}`}
              >
                {icon}
              </button>
            ))}
          </div>

          {/* Vertical Alignments */}
          <div className="flex-1 flex rounded-[var(--radius-md)] bg-[var(--surface-hover)] p-0.5">
            {[
              [
                "top",
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  key="top"
                >
                  <line x1="2" y1="2" x2="14" y2="2" />
                  <path d="M8 14V6M5 9l3-3 3 3" />
                </svg>,
              ],
              [
                "middle",
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  key="middle"
                >
                  <line x1="2" y1="8" x2="14" y2="8" strokeDasharray="2 2" />
                  <path d="M8 2v3M8 11v3M5 4l3-2 3 2M5 12l3 2 3-2" />
                </svg>,
              ],
              [
                "bottom",
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  key="bottom"
                >
                  <line x1="2" y1="14" x2="14" y2="14" />
                  <path d="M8 2v8M5 7l3 3 3-3" />
                </svg>,
              ],
            ].map(([valign, icon]) => (
              <button
                key={valign}
                type="button"
                onClick={() => patchNodeText(node.id, { verticalAlign: valign })}
                className={`flex-1 flex items-center justify-center py-1 rounded-[var(--radius-sm)] transition-colors ${
                  (t.verticalAlign ?? "top") === valign
                    ? "bg-[var(--surface-content)] text-[var(--text-1)] font-semibold shadow-2xs"
                    : "text-[var(--text-2)] hover:text-[var(--text-1)]"
                }`}
                title={`Vertical align ${valign}`}
              >
                {icon}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function UnderlineSection({ node, tokens, patchStyle, patchNodeText }) {
  const style = node.style ?? {};
  const t = node.text ?? {};
  const underline = style.underline ?? (t.underline ? { width: 1, offset: "Auto", paint: { kind: "solid", color: "#000000", alpha: 1 }, hidden: false } : null);

  const handleAddUnderline = () => {
    const next = {
      width: 1,
      offset: "Auto",
      paint: { kind: "solid", color: "#000000", alpha: 1 },
      hidden: false,
    };
    patchStyle({ underline: next });
    patchNodeText(node.id, { underline: true });
  };

  const handleRemoveUnderline = () => {
    patchStyle({ underline: undefined });
    patchNodeText(node.id, { underline: false });
  };

  const patchUnderline = (p) => {
    const updated = { ...(underline || {}), ...p };
    patchStyle({ underline: updated });
    patchNodeText(node.id, { underline: !updated.hidden });
  };

  if (!underline) {
    return (
      <div
        onClick={handleAddUnderline}
        className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--line)] text-xs font-normal text-[var(--text-2)] hover:text-black dark:hover:text-white cursor-pointer transition-colors group select-none"
      >
        <span className="font-normal group-hover:text-black dark:group-hover:text-white">Underline</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleAddUnderline();
          }}
          className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] group-hover:text-black dark:group-hover:text-white transition-colors cursor-pointer"
          title="Add underline"
        >
          <Plus size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-[var(--line)] pb-3 select-none">
      <div className="flex h-9 items-center justify-between text-xs">
        <span className="font-medium text-[var(--text-1)]">Underline</span>
        <button
          type="button"
          className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
          title="Underline settings"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M3 9.5H2V12H3V9.5Z" />
            <path d="M10 6.5H9V12H10V6.5Z" />
            <path d="M10 0H9V2.5H10V0Z" />
            <path d="M3 0H2V5.5H3V0Z" />
            <path fill="none" stroke="currentColor" d="M2.5 9.5C3.6 9.5 4.5 8.6 4.5 7.5C4.5 6.4 3.6 5.5 2.5 5.5C1.4 5.5 0.5 6.4 0.5 7.5C0.5 8.6 1.4 9.5 2.5 9.5Z" />
            <path fill="none" stroke="currentColor" d="M9.5 6.5C10.6 6.5 11.5 5.6 11.5 4.5C11.5 3.4 10.6 2.5 9.5 2.5C8.4 2.5 7.5 3.4 7.5 4.5C7.5 5.6 8.4 6.5 9.5 6.5Z" />
          </svg>
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          {/* Thickness scrubbable */}
          <div className="flex-1 flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
            <span
              className="cursor-ew-resize text-[var(--text-2)] hover:text-[var(--text-1)] shrink-0 mr-1.5 flex items-center select-none"
              title="Scrub thickness"
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                startScrubbing(
                  e,
                  underline.width ?? 1,
                  (v) => patchUnderline({ width: Math.max(1, v) }),
                  { min: 1, step: 1 }
                );
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor">
                <line x1="1" y1="2.5" x2="11" y2="2.5" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="1" y1="6" x2="11" y2="6" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="1" y1="9.5" x2="11" y2="9.5" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </span>
            <ScrubbableNumberInput
              value={underline.width ?? 1}
              min={1}
              onCommit={(v) => patchUnderline({ width: Math.max(1, v) })}
              inputClassName="w-full text-left text-xs font-medium text-[var(--text-1)] bg-transparent outline-none cursor-text"
            />
          </div>

          {/* Offset Auto input */}
          <div className="flex-1 flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
            <span className="text-[var(--text-2)] shrink-0 mr-1.5 flex items-center select-none">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M6 2v7M3.5 6.5L6 9l2.5-2.5M2 10.5h8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <input
              type="text"
              value={underline.offset ?? "Auto"}
              onChange={(e) => patchUnderline({ offset: e.target.value })}
              className="w-full text-left text-xs font-medium text-[var(--text-1)] bg-transparent outline-none cursor-text"
            />
          </div>

          {/* Eye visibility */}
          <button
            type="button"
            onClick={() => patchUnderline({ hidden: !underline.hidden })}
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer shrink-0"
            title={underline.hidden ? "Show underline" : "Hide underline"}
          >
            {underline.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>

          {/* Minus remove */}
          <button
            type="button"
            onClick={handleRemoveUnderline}
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer shrink-0"
            title="Remove underline"
          >
            <Minus size={13} />
          </button>
        </div>

        {/* Row 2: StrokePaintRow */}
        <StrokePaintRow
          paint={underline.paint ?? { kind: "solid", color: "#000000", alpha: 1 }}
          tokens={tokens}
          unified={true}
          onChange={(paint) => patchUnderline({ paint })}
        />
      </div>
    </div>
  );
}

function TextStrokeSection({ node, tokens, patchStyle, patchNodeText }) {
  const style = node.style ?? {};
  const t = node.text ?? {};
  const stroke = style.textStroke ?? style.stroke ?? (t.stroke ? { width: t.strokeWidth ?? 1, position: t.strokePosition ?? "below", paint: { kind: "solid", color: t.strokeColor ?? "#000000", alpha: 1 }, hidden: false } : null);

  const handleAddStroke = () => {
    const next = {
      width: 1,
      position: "below",
      paint: { kind: "solid", color: "#000000", alpha: 1 },
      hidden: false,
    };
    patchStyle({ textStroke: next, stroke: next });
    patchNodeText(node.id, { stroke: true, strokeWidth: 1, strokeColor: "#000000", strokePosition: "below" });
  };

  const handleRemoveStroke = () => {
    patchStyle({ textStroke: undefined, stroke: undefined });
    patchNodeText(node.id, { stroke: false, strokeWidth: 0, strokeColor: undefined });
  };

  const patchStroke = (p) => {
    const updated = { ...(stroke || {}), ...p };
    patchStyle({ textStroke: updated, stroke: updated });
    patchNodeText(node.id, {
      stroke: !updated.hidden,
      strokeWidth: updated.width ?? 1,
      strokeColor: resolvePaintColor(updated.paint, tokens) || "#000000",
      strokePosition: updated.position ?? "below",
    });
  };

  if (!stroke) {
    return (
      <div
        onClick={handleAddStroke}
        className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--line)] text-xs font-normal text-[var(--text-2)] hover:text-black dark:hover:text-white cursor-pointer transition-colors group select-none"
      >
        <span className="font-normal group-hover:text-black dark:group-hover:text-white">Stroke</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleAddStroke();
          }}
          className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] group-hover:text-black dark:group-hover:text-white transition-colors cursor-pointer"
          title="Add stroke"
        >
          <Plus size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-[var(--line)] pb-3 select-none">
      <div className="flex h-9 items-center justify-between text-xs">
        <span className="font-medium text-[var(--text-1)]">Stroke</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          {/* Width scrubbable */}
          <div className="flex-1 flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
            <span
              className="cursor-ew-resize text-[var(--text-2)] hover:text-[var(--text-1)] shrink-0 mr-1.5 flex items-center select-none"
              title="Scrub width"
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                startScrubbing(
                  e,
                  stroke.width ?? 1,
                  (v) => patchStroke({ width: Math.max(1, v) }),
                  { min: 1, step: 1 }
                );
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor">
                <line x1="1" y1="2.5" x2="11" y2="2.5" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="1" y1="6" x2="11" y2="6" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="1" y1="9.5" x2="11" y2="9.5" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </span>
            <ScrubbableNumberInput
              value={stroke.width ?? 1}
              min={1}
              onCommit={(v) => patchStroke({ width: Math.max(1, v) })}
              inputClassName="w-full text-left text-xs font-medium text-[var(--text-1)] bg-transparent outline-none cursor-text"
            />
          </div>

          {/* Position dropdown: Above fill / Below fill */}
          <StrokePositionDropdown
            value={stroke.position ?? "below"}
            onChange={(position) => patchStroke({ position })}
          />

          {/* Eye visibility */}
          <button
            type="button"
            onClick={() => patchStroke({ hidden: !stroke.hidden })}
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer shrink-0"
            title={stroke.hidden ? "Show stroke" : "Hide stroke"}
          >
            {stroke.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>

          {/* Minus remove */}
          <button
            type="button"
            onClick={handleRemoveStroke}
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer shrink-0"
            title="Remove stroke"
          >
            <Minus size={13} />
          </button>
        </div>

        {/* Row 2: StrokePaintRow */}
        <StrokePaintRow
          paint={stroke.paint ?? { kind: "solid", color: "#000000", alpha: 1 }}
          tokens={tokens}
          unified={true}
          onChange={(paint) => patchStroke({ paint })}
        />
      </div>
    </div>
  );
}

function McpConnectModal({ onClose }) {
  return <ConnectAgentModal onClose={onClose} />;
}

// ---------------------------------------------------------------------------
// Selection Colors Section (Figma-style: selection + child layers)
// ---------------------------------------------------------------------------

function toCleanHex(colorStr) {
  if (!colorStr || typeof colorStr !== "string") return null;
  const norm = normalizeCssColor(colorStr);
  return norm?.hex ? norm.hex.replace("#", "").toUpperCase() : null;
}

function extractColorsFromNode(node, tokens) {
  const colors = [];
  if (!node) return colors;

  // 1. Single fill
  const fill = node.style?.fill;
  if (fill) {
    if (fill.kind === "solid" && fill.color) {
      colors.push({
        hex: fill.color,
        alpha:
          typeof fill.alpha === "number"
            ? fill.alpha
            : typeof fill.opacity === "number"
            ? fill.opacity
            : 1,
        tokenName: fill.tokenName,
        tokenId: fill.tokenId,
      });
    } else if (fill.kind === "gradient" && Array.isArray(fill.stops)) {
      fill.stops.forEach((stop) => {
        if (stop.color) {
          colors.push({
            hex: stop.color,
            alpha: typeof stop.alpha === "number" ? stop.alpha : 1,
            tokenName: stop.tokenName,
            tokenId: stop.tokenId,
          });
        }
      });
    } else if (fill.tokenId) {
      const resolved = resolvePaintColor(fill, tokens);
      if (resolved) {
        colors.push({
          hex: resolved,
          alpha: 1,
          tokenName: fill.tokenName || tokens?.find((t) => t.id === fill.tokenId)?.name,
          tokenId: fill.tokenId,
        });
      }
    }
  }

  // 2. Multiple fills
  if (Array.isArray(node.style?.fills)) {
    node.style.fills.forEach((f) => {
      if (f.kind === "solid" && f.color) {
        colors.push({
          hex: f.color,
          alpha: typeof f.alpha === "number" ? f.alpha : 1,
          tokenName: f.tokenName,
          tokenId: f.tokenId,
        });
      } else if (f.kind === "gradient" && Array.isArray(f.stops)) {
        f.stops.forEach((stop) => {
          if (stop.color) {
            colors.push({
              hex: stop.color,
              alpha: typeof stop.alpha === "number" ? stop.alpha : 1,
              tokenName: stop.tokenName,
              tokenId: stop.tokenId,
            });
          }
        });
      } else if (f.tokenId) {
        const resolved = resolvePaintColor(f, tokens);
        if (resolved) {
          colors.push({
            hex: resolved,
            alpha: 1,
            tokenName: f.tokenName || tokens?.find((t) => t.id === f.tokenId)?.name,
            tokenId: f.tokenId,
          });
        }
      }
    });
  }

  // 3. Stroke
  const stroke = node.style?.stroke;
  if (stroke) {
    const strokeColor = stroke.paint?.color || stroke.color;
    if (strokeColor) {
      colors.push({
        hex: strokeColor,
        alpha: typeof stroke.paint?.alpha === "number" ? stroke.paint.alpha : 1,
        tokenName: stroke.paint?.tokenName || stroke.tokenName,
        tokenId: stroke.paint?.tokenId || stroke.tokenId,
      });
    }
  }

  // 4. Borders
  const borders = node.style?.borders;
  if (borders) {
    ["t", "r", "b", "l"].forEach((side) => {
      if (borders[side]?.color) {
        colors.push({
          hex: borders[side].color,
          alpha: 1,
          tokenName: borders[side].tokenName,
          tokenId: borders[side].tokenId,
        });
      }
    });
  }

  // 5. Shadows
  [node.style?.shadow, node.style?.innerShadow].forEach((shadows) => {
    if (Array.isArray(shadows)) {
      shadows.forEach((sh) => {
        if (sh.color && sh.color !== "none") {
          colors.push({
            hex: sh.color,
            alpha: 1,
            tokenName: sh.tokenName,
            tokenId: sh.tokenId,
          });
        }
      });
    }
  });

  // 6. Text
  if (node.type === "text" && node.text?.strokeColor) {
    colors.push({
      hex: node.text.strokeColor,
      alpha: 1,
      tokenName: node.text.tokenName,
      tokenId: node.text.tokenId,
    });
  }

  return colors;
}

function SelectionColorsSection({ selection, doc, tokens }) {
  const setSelection = useEditorStore((s) => s.setSelection);
  const patchNodes = useEditorStore((s) => s.patchNodes);
  const [activePickerHex, setActivePickerHex] = useState(null);
  const [activeThemeHex, setActiveThemeHex] = useState(null);
  const [boundTokensMap, setBoundTokensMap] = useState({});

  if (!selection || selection.length === 0) return null;

  const allSubtreeNodeIds = Array.from(
    new Set(selection.flatMap((id) => subtreeIds(doc.nodes, id)))
  );

  const colorMap = new Map();

  for (const id of allSubtreeNodeIds) {
    const n = doc.nodes[id];
    if (!n) continue;
    const items = extractColorsFromNode(n, tokens);
    for (const item of items) {
      const cleanHex = toCleanHex(item.hex);
      if (!cleanHex || cleanHex.length < 6) continue;
      if (!colorMap.has(cleanHex)) {
        colorMap.set(cleanHex, {
          hex: cleanHex,
          alpha: item.alpha ?? 1,
          tokenName: item.tokenName || null,
          tokenId: item.tokenId || null,
          nodeIds: new Set(),
        });
      } else {
        const entry = colorMap.get(cleanHex);
        if (!entry.tokenName && item.tokenName) {
          entry.tokenName = item.tokenName;
        }
        if (!entry.tokenId && item.tokenId) {
          entry.tokenId = item.tokenId;
        }
      }
      const entry = colorMap.get(cleanHex);
      entry.nodeIds.add(id);
    }
  }

  const colorEntries = Array.from(colorMap.values());
  if (colorEntries.length === 0) return null;

  const replaceColor = (oldCleanHex, newHex, newAlpha) => {
    const updates = {};
    const oldHexClean = oldCleanHex.toUpperCase();
    const nextHex = newHex.startsWith("#") ? newHex : `#${newHex}`;

    for (const id of allSubtreeNodeIds) {
      const node = doc.nodes[id];
      if (!node) continue;
      let nodeChanged = false;
      const styleCopy = structuredClone(node.style || {});

      // Single fill
      if (styleCopy.fill?.color && toCleanHex(styleCopy.fill.color) === oldHexClean) {
        styleCopy.fill.color = nextHex;
        if (typeof newAlpha === "number") styleCopy.fill.alpha = newAlpha;
        nodeChanged = true;
      }
      if (styleCopy.fill?.kind === "gradient" && Array.isArray(styleCopy.fill.stops)) {
        styleCopy.fill.stops.forEach((s) => {
          if (s.color && toCleanHex(s.color) === oldHexClean) {
            s.color = nextHex;
            if (typeof newAlpha === "number") s.alpha = newAlpha;
            nodeChanged = true;
          }
        });
      }

      // Multiple fills
      if (Array.isArray(styleCopy.fills)) {
        styleCopy.fills.forEach((f) => {
          if (f.color && toCleanHex(f.color) === oldHexClean) {
            f.color = nextHex;
            if (typeof newAlpha === "number") f.alpha = newAlpha;
            nodeChanged = true;
          }
          if (f.kind === "gradient" && Array.isArray(f.stops)) {
            f.stops.forEach((s) => {
              if (s.color && toCleanHex(s.color) === oldHexClean) {
                s.color = nextHex;
                if (typeof newAlpha === "number") s.alpha = newAlpha;
                nodeChanged = true;
              }
            });
          }
        });
      }

      // Stroke
      if (styleCopy.stroke?.paint?.color && toCleanHex(styleCopy.stroke.paint.color) === oldHexClean) {
        styleCopy.stroke.paint.color = nextHex;
        nodeChanged = true;
      }
      if (styleCopy.stroke?.color && toCleanHex(styleCopy.stroke.color) === oldHexClean) {
        styleCopy.stroke.color = nextHex;
        nodeChanged = true;
      }

      // Borders
      if (styleCopy.borders) {
        ["t", "r", "b", "l"].forEach((side) => {
          if (styleCopy.borders[side]?.color && toCleanHex(styleCopy.borders[side].color) === oldHexClean) {
            styleCopy.borders[side].color = nextHex;
            nodeChanged = true;
          }
        });
      }

      // Shadows
      [styleCopy.shadow, styleCopy.innerShadow].forEach((shadows) => {
        if (Array.isArray(shadows)) {
          shadows.forEach((sh) => {
            if (sh.color && toCleanHex(sh.color) === oldHexClean) {
              sh.color = nextHex;
              nodeChanged = true;
            }
          });
        }
      });

      // Text
      let textCopy = null;
      if (node.type === "text" && node.text?.strokeColor && toCleanHex(node.text.strokeColor) === oldHexClean) {
        textCopy = { ...node.text, strokeColor: nextHex };
      }

      if (nodeChanged || textCopy) {
        updates[id] = {
          style: styleCopy,
          ...(textCopy ? { text: textCopy } : {}),
        };
      }
    }

    if (Object.keys(updates).length > 0) {
      patchNodes(updates);
    }
  };

  const bindToken = (oldCleanHex, token) => {
    const updates = {};
    const oldHexClean = oldCleanHex.toUpperCase();
    setBoundTokensMap((prev) => ({ ...prev, [oldHexClean]: token.name }));

    for (const id of allSubtreeNodeIds) {
      const node = doc.nodes[id];
      if (!node) continue;
      let nodeChanged = false;
      const styleCopy = structuredClone(node.style || {});

      // Single fill
      if (styleCopy.fill?.color && toCleanHex(styleCopy.fill.color) === oldHexClean) {
        styleCopy.fill = {
          ...styleCopy.fill,
          kind: "solid",
          color: token.value,
          tokenId: token.id,
          tokenName: token.name,
        };
        nodeChanged = true;
      }
      // Multiple fills
      if (Array.isArray(styleCopy.fills)) {
        styleCopy.fills.forEach((f, idx) => {
          if (f.color && toCleanHex(f.color) === oldHexClean) {
            styleCopy.fills[idx] = {
              ...f,
              kind: "solid",
              color: token.value,
              tokenId: token.id,
              tokenName: token.name,
            };
            nodeChanged = true;
          }
        });
      }

      // Stroke
      if (styleCopy.stroke?.paint?.color && toCleanHex(styleCopy.stroke.paint.color) === oldHexClean) {
        styleCopy.stroke.paint = {
          ...styleCopy.stroke.paint,
          kind: "token",
          color: token.value,
          tokenId: token.id,
          tokenName: token.name,
        };
        nodeChanged = true;
      }
      if (styleCopy.stroke?.color && toCleanHex(styleCopy.stroke.color) === oldHexClean) {
        styleCopy.stroke.color = token.value;
        styleCopy.stroke.tokenId = token.id;
        styleCopy.stroke.tokenName = token.name;
        nodeChanged = true;
      }

      // Borders
      if (styleCopy.borders) {
        ["t", "r", "b", "l"].forEach((side) => {
          if (styleCopy.borders[side]?.color && toCleanHex(styleCopy.borders[side].color) === oldHexClean) {
            styleCopy.borders[side].color = token.value;
            styleCopy.borders[side].tokenId = token.id;
            styleCopy.borders[side].tokenName = token.name;
            nodeChanged = true;
          }
        });
      }

      // Shadows
      [styleCopy.shadow, styleCopy.innerShadow].forEach((shadows) => {
        if (Array.isArray(shadows)) {
          shadows.forEach((sh) => {
            if (sh.color && toCleanHex(sh.color) === oldHexClean) {
              sh.color = token.value;
              sh.tokenId = token.id;
              sh.tokenName = token.name;
              nodeChanged = true;
            }
          });
        }
      });

      // Text
      let textCopy = null;
      if (node.type === "text" && node.text?.strokeColor && toCleanHex(node.text.strokeColor) === oldHexClean) {
        textCopy = { ...node.text, strokeColor: token.value, tokenId: token.id, tokenName: token.name };
      }

      if (nodeChanged || textCopy) {
        updates[id] = {
          style: styleCopy,
          ...(textCopy ? { text: textCopy } : {}),
        };
      }
    }

    if (Object.keys(updates).length > 0) {
      patchNodes(updates);
    }
  };

  return (
    <Section title="Selection colors">
      <div className="flex flex-col gap-2">
        {colorEntries.map(({ hex, alpha, tokenName, tokenId, nodeIds }) => {
          const isPickerOpen = activePickerHex === hex;
          const isThemeOpen = activeThemeHex === hex;
          const count = (nodeIds instanceof Set ? nodeIds.size : Array.isArray(nodeIds) ? nodeIds.length : (nodeIds?.size ?? 1)) || 1;
          const displayTokenName =
            boundTokensMap[hex] ||
            tokenName ||
            (tokenId ? tokens?.find((t) => t.id === tokenId)?.name : null);

          return (
            <div key={hex} className="flex items-center gap-2 w-full">
              {/* Main Pill: Swatch + Hex/TokenName + Opacity */}
              <div
                className={`relative flex items-center justify-between flex-1 h-[32px] px-2.5 rounded-lg border bg-[var(--surface-content)] text-xs text-[var(--text-1)] hover:border-[var(--line-strong)] transition-all cursor-pointer ${
                  isPickerOpen
                    ? "border-blue-500 ring-2 ring-blue-500/20"
                    : "border-[var(--line)]"
                }`}
                onClick={() => {
                  setActivePickerHex(isPickerOpen ? null : hex);
                  setActiveThemeHex(null);
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-4 h-4 rounded-[3px] shrink-0 border border-black/10 dark:border-white/10 shadow-2xs"
                    style={{ backgroundColor: `#${hex}` }}
                  />
                  {displayTokenName ? (
                    <span
                      className="font-medium text-xs tracking-normal truncate text-[var(--text-1)] select-all"
                      title={`Variable: ${displayTokenName}`}
                    >
                      {displayTokenName}
                    </span>
                  ) : (
                    <span className="font-medium text-xs tracking-wider uppercase select-all">
                      {hex}
                    </span>
                  )}
                </div>
                <span className="text-[var(--text-2)] text-xs font-normal shrink-0">
                  {Math.round(alpha * 100)}%
                </span>

                {/* Color Picker Dialog */}
                {isPickerOpen && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <ColorPickerModal
                      color={`#${hex}`}
                      alpha={alpha}
                      onChange={(newHex, newAlpha) => {
                        replaceColor(hex, newHex, newAlpha);
                      }}
                      onClose={() => setActivePickerHex(null)}
                    />
                  </div>
                )}
              </div>

              {/* Theme Variable Button (Selection colors 4-circle outline icon) */}
              <div className="relative">
                <button
                  type="button"
                  title="Theme color variables"
                  onClick={() => {
                    setActiveThemeHex(isThemeOpen ? null : hex);
                    setActivePickerHex(null);
                  }}
                  className={`p-1 rounded transition-colors cursor-pointer ${
                    isThemeOpen || Boolean(displayTokenName)
                      ? "text-[var(--accent)] bg-[var(--surface-hover)]"
                      : "text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)]"
                  }`}
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

                {isThemeOpen && (
                  <ThemeColorPopover
                    tokens={tokens}
                    onSelectToken={(token) => {
                      bindToken(hex, token);
                      setActiveThemeHex(null);
                    }}
                    onClose={() => setActiveThemeHex(null)}
                  />
                )}
              </div>

              {/* Target / Select Layer Button with Count */}
              <button
                type="button"
                title={`Select ${count} layer${count > 1 ? "s" : ""} with this color`}
                onClick={() => {
                  if (nodeIds && (nodeIds instanceof Set || Array.isArray(nodeIds))) {
                    setSelection(Array.from(nodeIds));
                  }
                }}
                className="flex items-center gap-1 p-1 rounded text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                >
                  <circle cx="7" cy="7" r="5" />
                  <circle cx="7" cy="7" r="1.5" fill="currentColor" />
                </svg>
                <span className="text-xs font-normal text-[var(--text-2)]">
                  {count}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function EmptyInspector({ doc, tokens }) {
  const activePageId = useEditorStore((s) => s.activePageId);
  const setPageBackground = useEditorStore((s) => s.setPageBackground);
  const [mcpModalOpen, setMcpModalOpen] = useState(false);

  const activePage =
    doc.pages?.find((p) => p.id === activePageId) || doc.pages?.[0] || {};
  const currentBg = activePage.background || "#FFFFFF";

  return (
    <div className="flex flex-col gap-5 p-3.5 text-[var(--text-1)] select-none">
      {/* Page Section */}
      <div className="flex flex-col gap-2">
        <div className="text-[12px] font-medium text-[var(--text-1)] tracking-tight">
          Page
        </div>
        <ColorRow
          color={currentBg}
          alpha={1}
          unified={true}
          tokenName={activePage?.bgTokenName || (activePage?.bgTokenId ? tokens.find((t) => t.id === activePage.bgTokenId)?.name : null)}
          tokenId={activePage?.bgTokenId}
          onChange={(newColor) => {
            if (activePage?.id) {
              setPageBackground(activePage.id, newColor);
            }
          }}
          showAlpha={true}
          tokens={tokens}
          onBindToken={(tok) => {
            const val = tok.value || tok.color;
            if (val && activePage?.id) {
              setPageBackground(activePage.id, val, { bgTokenId: tok.id, bgTokenName: tok.name });
            }
          }}
        />
      </div>

      {/* MCP Section */}
      <div className="flex flex-col gap-2">
        <div className="text-[12px] font-medium text-[var(--text-1)] tracking-tight">
          MCP
        </div>
        <button
          type="button"
          onClick={() => setMcpModalOpen(true)}
          className="w-full h-8 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] text-xs font-medium text-[var(--text-1)] hover:bg-[var(--surface-hover)] hover:border-[var(--text-2)] transition-colors shadow-2xs flex items-center justify-center cursor-pointer"
        >
          Connect your agent
        </button>
      </div>

      {/* MCP Connect Dialog */}
      {mcpModalOpen && (
        <McpConnectModal onClose={() => setMcpModalOpen(false)} />
      )}
    </div>
  );
}

export default function Inspector() {
  const doc = useEditorStore((s) => s.doc);
  const selection = useEditorStore((s) => s.selection);
  const setNodePosition = useEditorStore((s) => s.setNodePosition);
  const setNodeSizing = useEditorStore((s) => s.setNodeSizing);
  const setNodeRotation = useEditorStore((s) => s.setNodeRotation);
  const patchNodeStyle = useEditorStore((s) => s.patchNodeStyle);
  const patchNodeLayout = useEditorStore((s) => s.patchNodeLayout);
  const patchNodeText = useEditorStore((s) => s.patchNodeText);
  const patchNode = useEditorStore((s) => s.patchNode);
  const addFlex = useEditorStore((s) => s.addFlex);
  const removeFlex = useEditorStore((s) => s.removeFlex);
  const addGrid = useEditorStore((s) => s.addGrid);
  const removeGrid = useEditorStore((s) => s.removeGrid);
  const alignNodes = useEditorStore((s) => s.alignNodes);
  const distributeNodes = useEditorStore((s) => s.distributeNodes);

  const tokens = doc.tokens;
  const selectedNodes = selection.map((id) => doc.nodes[id]).filter(Boolean);
  const node = selectedNodes.length === 1 ? selectedNodes[0] : null;

  if (selectedNodes.length === 0) {
    return <EmptyInspector doc={doc} tokens={tokens} />;
  }

  if (!node) {
    return (
      <div className="p-4" data-inspector="true">
        <div className="mb-4 flex items-center gap-2">
          <span className="rounded-[var(--radius-sm)] bg-[var(--surface-hover)] px-1.5 py-0.5 text-[var(--type-micro)] uppercase">
            {selectedNodes.length} elements
          </span>
        </div>
        <Section title="Position">
          <div className="grid grid-cols-2 gap-2">
            <NumField label="X" value={null} />
            <NumField label="Y" value={null} />
          </div>
        </Section>
        <Section title="Size">
          <div className="grid grid-cols-2 gap-2">
            <NumField label="W" value={null} />
            <NumField label="H" value={null} />
          </div>
        </Section>
        <Section title="Align">
          <div className="flex flex-wrap gap-1">
            {[
              ["left", <AlignLeft size={12} />, "Align left"],
              ["center", <AlignCenter size={12} />, "Align center"],
              ["right", <AlignRight size={12} />, "Align right"],
            ].map(([align, icon, title]) => (
              <button
                key={align}
                type="button"
                onClick={() => alignNodes(align)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] hover:bg-[var(--surface-hover)] text-[var(--text-1)] transition-colors cursor-pointer"
                title={title}
              >
                {icon}
              </button>
            ))}
            {[
              ["top", <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="2" y1="2" x2="14" y2="2" /><path d="M8 14V6M5 9l3-3 3 3" /></svg>, "Align top"],
              ["middle", <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="2" y1="8" x2="14" y2="8" strokeDasharray="2 2" /><path d="M8 2v3M8 11v3M5 4l3-2 3 2M5 12l3 2 3-2" /></svg>, "Align middle"],
              ["bottom", <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="2" y1="14" x2="14" y2="14" /><path d="M8 2v8M5 7l3 3 3-3" /></svg>, "Align bottom"],
            ].map(([align, icon, title]) => (
              <button
                key={align}
                type="button"
                onClick={() => alignNodes(align)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] hover:bg-[var(--surface-hover)] text-[var(--text-1)] transition-colors cursor-pointer"
                title={title}
              >
                {icon}
              </button>
            ))}
          </div>
        </Section>
        <Section title="Distribute">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => distributeNodes("horizontal")}
              className="flex h-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] hover:bg-[var(--surface-hover)] text-[var(--text-1)] px-2 transition-colors cursor-pointer"
              title="Distribute horizontally"
            >
              <span className="text-[10px] font-mono">↔</span>
            </button>
            <button
              type="button"
              onClick={() => distributeNodes("vertical")}
              className="flex h-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] hover:bg-[var(--surface-hover)] text-[var(--text-1)] px-2 transition-colors cursor-pointer"
              title="Distribute vertically"
            >
              <span className="text-[10px] font-mono">↕</span>
            </button>
          </div>
        </Section>
        <SelectionColorsSection
          selection={selection}
          doc={doc}
          tokens={tokens}
        />
        <p className="text-[var(--type-micro)] text-[var(--text-2)]">
          Style editing applies to a single selection in M2.
        </p>
      </div>
    );
  }

  const parent = node.parentId ? doc.nodes[node.parentId] : null;
  const parentIsFlex = parent?.layout?.mode === "flex";
  const inFlowFlexChild = parentIsFlex && !node?.position?.absolute;
  const style = node.style ?? {};
  const patchStyle = (p) => patchNodeStyle(node.id, p);

  return (
    <div className="p-4" data-inspector="true">
      {/* ------------------------------------------------ Layout & Flex */}
      <LayoutSection
        node={node}
        tokens={tokens}
        doc={doc}
        setNodePosition={setNodePosition}
        setNodeRotation={setNodeRotation}
        setNodeSizing={setNodeSizing}
        patchNode={patchNode}
        patchNodeLayout={patchNodeLayout}
        patchStyle={patchStyle}
        addFlex={addFlex}
        removeFlex={removeFlex}
        addGrid={addGrid}
        removeGrid={removeGrid}
      />

      {/* ------------------------------------------------ Text (M2) */}
      {node.type === "text" && node.text && (
        <TextSection node={node} tokens={tokens} patchNodeText={patchNodeText} />
      )}

      {/* ------------------------------------------------ Underline (for Text) */}
      {node.type === "text" && (
        <UnderlineSection
          node={node}
          tokens={tokens}
          patchStyle={patchStyle}
          patchNodeText={patchNodeText}
        />
      )}

      {/* ------------------------------------------------ Stroke (for Text) */}
      {node.type === "text" && (
        <TextStrokeSection
          node={node}
          tokens={tokens}
          patchStyle={patchStyle}
          patchNodeText={patchNodeText}
        />
      )}

      {/* ------------------------------------------------ Radius */}
      {node.type !== "text" && node.type !== "path" && (
        <RadiusSection node={node} tokens={tokens} patchStyle={patchStyle} />
      )}

      {/* ------------------------------------------------ Blending */}
      {node.type !== "text" && (
        <BlendingSection
          node={node}
          tokens={tokens}
          patchStyle={patchStyle}
        />
      )}

      {/* ------------------------------------------------ Image */}
      {node.type === "image" && (
        <ImageSection
          node={node}
          tokens={tokens}
          assets={doc.assets ?? {}}
          addAsset={useEditorStore.getState().addAsset}
          patchNode={patchNode}
          patchStyle={patchStyle}
        />
      )}

      {/* ------------------------------------------------ Fill */}
      {/* Shader nodes paint themselves (M5) — a CSS fill would be
          invisible underneath the WebGL canvas, so the section hides. */}
      {node.type !== "shader" && (
        <FillSection node={node} tokens={tokens} patchStyle={patchStyle} patchNode={patchNode} />
      )}

      {/* ------------------------------------------------ Path (M4) */}
      {node.type === "path" && (
        <PathSection
          node={node}
          tokens={tokens}
          patchStyle={patchStyle}
          patchNode={patchNode}
        />
      )}

      {/* ------------------------------------------------ Shader (M5) */}
      {node.type === "shader" && (
        <ShaderSection node={node} tokens={tokens} patchNode={patchNode} />
      )}

      {/* ------------------------------------------------ Outline */}
      {node.type !== "text" && node.type !== "path" && (
        <OutlineSection
          node={node}
          tokens={tokens}
          patchStyle={patchStyle}
        />
      )}

      {/* ------------------------------------------------ Border */}
      {node.type !== "text" && node.type !== "path" && (
        <BorderSection
          node={node}
          tokens={tokens}
          patchStyle={patchStyle}
        />
      )}

      {/* ------------------------------------------------ Shadows */}
      <ShadowList
        title="Shadow"
        shadows={style.shadow}
        shadowType={style.shadowType ?? "box"}
        onShadowTypeChange={(shadowType) => patchStyle({ shadowType })}
        tokens={tokens}
        onChange={(shadow) => patchStyle({ shadow })}
      />
      {node.type !== "text" && (
        <ShadowList
          title="Inner shadow"
          shadows={style.innerShadow}
          tokens={tokens}
          onChange={(innerShadow) => patchStyle({ innerShadow })}
        />
      )}

      {/* ------------------------------------------------ Filters */}
      <FiltersSection node={node} patchStyle={patchStyle} />

      {/* ------------------------------------------------ Guides (M4) */}
      {(node.type === "frame" || node.type === "artboard") && (
        <GuidesSection node={node} patchNode={patchNode} tokens={tokens} />
      )}

      {/* ------------------------------------------------ Other styles */}
      <OtherStylesSection node={node} patchStyle={patchStyle} />

      {/* ------------------------------------------------ Selection colors */}
      <SelectionColorsSection
        selection={selection}
        doc={doc}
        tokens={tokens}
      />

      {/* ------------------------------------------------ Export */}
      <ExportSection node={node} doc={doc} />
    </div>
  );
}
