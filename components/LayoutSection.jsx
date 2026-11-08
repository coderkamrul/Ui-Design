"use client";

import { useState, useEffect } from "react";
import { Check } from "lucide-react";
import { ScrubbableNumberInput, startScrubbing } from "./ScrubbableNumberInput";
import { resolveNumeric, sizePx, resolveToken } from "@/lib/model";
import { parseGridTracks, serializeGridTracks, defaultGrid } from "@/lib/grid";
import { useEditorStore } from "@/lib/store";

function FlexibleSizeInput({ sizing, onChange, tokens, inputClassName }) {
  const getInitialStr = () => {
    if (!sizing) return "100";
    if (sizing.kind === "auto") return "Auto";
    if (sizing.kind === "fit") return "Fit";
    if (sizing.kind === "fill") return "Fill";
    if (sizing.kind === "relative") return `${sizing.pct ?? 100}%`;
    if (sizing.kind === "token") {
      const tok = tokens?.find((t) => t.id === sizing.tokenId);
      return tok ? tok.name : "Token";
    }
    return String(sizing.px ?? 100);
  };

  const [text, setText] = useState(getInitialStr);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setText(getInitialStr());
    }
  }, [sizing, isFocused]);

  const commitText = (str) => {
    const raw = (str ?? "").trim();
    const lower = raw.toLowerCase();

    if (lower === "auto") {
      onChange({ kind: "auto" });
      return;
    }
    if (lower === "fit" || lower === "hug") {
      onChange({ kind: "fit" });
      return;
    }
    if (lower === "fill") {
      onChange({ kind: "fill" });
      return;
    }

    if (lower.endsWith("%")) {
      const num = parseFloat(lower);
      if (!isNaN(num)) {
        onChange({ kind: "relative", pct: Math.max(1, Math.min(100, Math.round(num))) });
        return;
      }
    }

    const num = parseFloat(raw);
    if (!isNaN(num)) {
      if (sizing?.kind === "relative") {
        onChange({ kind: "relative", pct: Math.max(1, Math.min(100, Math.round(num))) });
      } else {
        onChange({ kind: "fixed", px: Math.max(1, Math.round(num)) });
      }
      return;
    }

    // fallback: revert
    setText(getInitialStr());
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      setText(getInitialStr());
      e.currentTarget.blur();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const step = (e.shiftKey ? 10 : 1) * (e.key === "ArrowDown" ? -1 : 1);
      const num = parseFloat(text);
      if (!isNaN(num)) {
        e.preventDefault();
        if (sizing?.kind === "relative" || text.endsWith("%")) {
          const next = Math.max(1, Math.min(100, Math.round(num + step)));
          setText(`${next}%`);
          onChange({ kind: "relative", pct: next });
        } else {
          const next = Math.max(1, Math.round(num + step));
          setText(String(next));
          onChange({ kind: "fixed", px: next });
        }
      }
    }
  };

  return (
    <input
      type="text"
      value={text}
      onFocus={(e) => {
        setIsFocused(true);
        e.target.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => {
        setIsFocused(false);
        commitText(e.target.value);
      }}
      onKeyDown={handleKeyDown}
      onClick={(e) => e.stopPropagation()}
      className={inputClassName}
    />
  );
}

const HORIZONTAL_CONSTRAINTS = [
  { value: "start", label: "Left" },
  { value: "center", label: "Center" },
  { value: "end", label: "Right" },
  { value: "stretch", label: "Left & Right" },
  { value: "scale", label: "Scale" },
];

const VERTICAL_CONSTRAINTS = [
  { value: "start", label: "Top" },
  { value: "center", label: "Center" },
  { value: "end", label: "Bottom" },
  { value: "stretch", label: "Top & Bottom" },
  { value: "scale", label: "Scale" },
];

/**
 * Pixel-accurate Light Theme Layout & Flex inspector with exact Base-UI / Figma icons,
 * precise spacing, and anchored label scrubbing (pointer-lock fixed cursor).
 */
function GridContainerControls({ node, tokens, patchNodeLayout, removeGrid }) {
  const layout = node?.layout ?? {};
  const [colTracks, setColTracks] = useState(() => parseGridTracks(layout.columns || "repeat(2, 1fr)"));
  const [rowTracks, setRowTracks] = useState(() => parseGridTracks(layout.rows || "auto"));

  useEffect(() => {
    setColTracks(parseGridTracks(layout.columns || "repeat(2, 1fr)"));
  }, [layout.columns]);

  useEffect(() => {
    setRowTracks(parseGridTracks(layout.rows || "auto"));
  }, [layout.rows]);

  const updateColTracks = (next) => {
    setColTracks(next);
    patchNodeLayout?.(node.id, { columns: serializeGridTracks(next) });
  };

  const updateRowTracks = (next) => {
    setRowTracks(next);
    patchNodeLayout?.(node.id, { rows: serializeGridTracks(next) });
  };

  const addColumnTrack = () => {
    const next = [...colTracks, { id: `t${colTracks.length + 1}`, size: 1, unit: "fr", raw: "1fr" }];
    updateColTracks(next);
  };

  const removeColumnTrack = (idx) => {
    if (colTracks.length <= 1) return;
    const next = colTracks.filter((_, i) => i !== idx);
    updateColTracks(next);
  };

  const addRowTrack = () => {
    const next = [...rowTracks, { id: `r${rowTracks.length + 1}`, size: "auto", unit: "auto", raw: "auto" }];
    updateRowTracks(next);
  };

  const removeRowTrack = (idx) => {
    if (rowTracks.length <= 1) return;
    const next = rowTracks.filter((_, i) => i !== idx);
    updateRowTracks(next);
  };

  const colGap = Math.round(resolveNumeric(layout.columnGap ?? layout.gap ?? 16, tokens) || 0);
  const rGap = Math.round(resolveNumeric(layout.rowGap ?? layout.gap ?? 16, tokens) || 0);

  return (
    <div className="flex flex-col gap-2 mt-1">
      {/* Grid Section Header with minus button */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--text-1)]">Grid</span>
        <button
          type="button"
          onClick={() => removeGrid?.(node.id)}
          className="flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--surface-hover)] text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors cursor-pointer"
          title="Remove grid"
        >
          <svg width="10" height="2" viewBox="0 0 10 2" fill="none" stroke="currentColor">
            <path d="M10 1H0" strokeWidth="1.5" vectorEffect="non-scaling-stroke"></path>
          </svg>
        </button>
      </div>

      {/* Display & Auto-flow row */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[var(--text-2)] font-medium">Display</label>
          <select
            value={layout.display || "grid"}
            onChange={(e) => patchNodeLayout?.(node.id, { display: e.target.value })}
            className="h-[var(--row-field-h)] px-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] text-xs text-[var(--text-1)] outline-none hover:border-[var(--text-2)] transition-colors cursor-pointer"
          >
            <option value="grid">grid</option>
            <option value="inline-grid">inline-grid</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[var(--text-2)] font-medium">Auto-flow</label>
          <select
            value={layout.autoFlow || "row"}
            onChange={(e) => patchNodeLayout?.(node.id, { autoFlow: e.target.value })}
            className="h-[var(--row-field-h)] px-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] text-xs text-[var(--text-1)] outline-none hover:border-[var(--text-2)] transition-colors cursor-pointer"
          >
            <option value="row">row</option>
            <option value="column">column</option>
            <option value="row dense">row dense</option>
            <option value="column dense">column dense</option>
          </select>
        </div>
      </div>

      {/* Columns Tracks Manager */}
      <div className="flex flex-col gap-1 p-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)]">
        <div className="flex items-center justify-between text-[11px] font-medium text-[var(--text-2)]">
          <span className="flex items-center gap-1.5 text-[var(--text-1)]">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0">
              <rect x="2" y="2" width="5" height="12" rx="1" />
              <rect x="9" y="2" width="5" height="12" rx="1" />
            </svg>
            Columns ({colTracks.length})
          </span>
          <button
            type="button"
            onClick={addColumnTrack}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--surface-hover)] text-[var(--text-2)] hover:text-[var(--text-1)] shrink-0 transition-colors cursor-pointer"
            title="Add column"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0">
              <path d="M6 2v8M2 6h8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {colTracks.map((tr, idx) => (
            <div
              key={tr.id || idx}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--line)] text-xs text-[var(--text-1)]"
            >
              <input
                type="text"
                value={tr.unit === "fr" ? `${tr.size}fr` : tr.unit === "px" ? `${tr.size}px` : tr.unit === "%" ? `${tr.size}%` : tr.size}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  const next = [...colTracks];
                  if (val.endsWith("fr")) {
                    next[idx] = { ...tr, size: parseFloat(val) || 1, unit: "fr" };
                  } else if (val.endsWith("px")) {
                    next[idx] = { ...tr, size: parseFloat(val) || 100, unit: "px" };
                  } else if (val.endsWith("%")) {
                    next[idx] = { ...tr, size: parseFloat(val) || 50, unit: "%" };
                  } else if (val === "auto") {
                    next[idx] = { ...tr, size: "auto", unit: "auto" };
                  } else {
                    const num = parseFloat(val);
                    if (!isNaN(num)) next[idx] = { ...tr, size: num, unit: "fr" };
                    else next[idx] = { ...tr, size: val, unit: "custom", raw: val };
                  }
                  updateColTracks(next);
                }}
                className="w-12 bg-transparent text-center font-mono outline-none text-[11px]"
              />
              {colTracks.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeColumnTrack(idx)}
                  className="flex h-3.5 w-3.5 items-center justify-center rounded text-[var(--text-3)] hover:text-red-500 shrink-0 cursor-pointer"
                  title="Remove column"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0">
                    <path d="M2 2l6 6M8 2l-6 6" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Rows Tracks Manager */}
      <div className="flex flex-col gap-1 p-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)]">
        <div className="flex items-center justify-between text-[11px] font-medium text-[var(--text-2)]">
          <span className="flex items-center gap-1.5 text-[var(--text-1)]">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0">
              <rect x="2" y="2" width="12" height="5" rx="1" />
              <rect x="2" y="9" width="12" height="5" rx="1" />
            </svg>
            Rows ({rowTracks.length})
          </span>
          <button
            type="button"
            onClick={addRowTrack}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--surface-hover)] text-[var(--text-2)] hover:text-[var(--text-1)] shrink-0 transition-colors cursor-pointer"
            title="Add row"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0">
              <path d="M6 2v8M2 6h8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {rowTracks.map((tr, idx) => (
            <div
              key={tr.id || idx}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--line)] text-xs text-[var(--text-1)]"
            >
              <input
                type="text"
                value={tr.unit === "fr" ? `${tr.size}fr` : tr.unit === "px" ? `${tr.size}px` : tr.unit === "%" ? `${tr.size}%` : tr.size}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  const next = [...rowTracks];
                  if (val.endsWith("fr")) {
                    next[idx] = { ...tr, size: parseFloat(val) || 1, unit: "fr" };
                  } else if (val.endsWith("px")) {
                    next[idx] = { ...tr, size: parseFloat(val) || 100, unit: "px" };
                  } else if (val.endsWith("%")) {
                    next[idx] = { ...tr, size: parseFloat(val) || 50, unit: "%" };
                  } else if (val === "auto") {
                    next[idx] = { ...tr, size: "auto", unit: "auto" };
                  } else {
                    const num = parseFloat(val);
                    if (!isNaN(num)) next[idx] = { ...tr, size: num, unit: "fr" };
                    else next[idx] = { ...tr, size: val, unit: "custom", raw: val };
                  }
                  updateRowTracks(next);
                }}
                className="w-12 bg-transparent text-center font-mono outline-none text-[11px]"
              />
              {rowTracks.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRowTrack(idx)}
                  className="flex h-3.5 w-3.5 items-center justify-center rounded text-[var(--text-3)] hover:text-red-500 shrink-0 cursor-pointer"
                  title="Remove row"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0">
                    <path d="M2 2l6 6M8 2l-6 6" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Gaps: Column Gap & Row Gap */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
          <ScrubbableNumberInput
            label="Col gap"
            value={colGap}
            min={0}
            onCommit={(v) => patchNodeLayout?.(node.id, { columnGap: v, gap: v })}
            labelClassName="mr-1.5 text-[var(--text-2)] select-none font-mono text-[10px] font-medium cursor-ew-resize hover:text-[var(--text-1)] shrink-0"
            inputClassName="w-full text-right text-xs font-medium text-[var(--text-1)] bg-transparent outline-none"
          />
        </div>
        <div className="flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
          <ScrubbableNumberInput
            label="Row gap"
            value={rGap}
            min={0}
            onCommit={(v) => patchNodeLayout?.(node.id, { rowGap: v, gap: v })}
            labelClassName="mr-1.5 text-[var(--text-2)] select-none font-mono text-[10px] font-medium cursor-ew-resize hover:text-[var(--text-1)] shrink-0"
            inputClassName="w-full text-right text-xs font-medium text-[var(--text-1)] bg-transparent outline-none"
          />
        </div>
      </div>

      {/* Align Items & Justify Items */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[var(--text-2)] font-medium">Align items</label>
          <select
            value={layout.alignItems || "stretch"}
            onChange={(e) => patchNodeLayout?.(node.id, { alignItems: e.target.value })}
            className="h-[var(--row-field-h)] px-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] text-xs text-[var(--text-1)] outline-none hover:border-[var(--text-2)] transition-colors cursor-pointer"
          >
            <option value="stretch">stretch</option>
            <option value="start">start</option>
            <option value="center">center</option>
            <option value="end">end</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[var(--text-2)] font-medium">Justify items</label>
          <select
            value={layout.justifyItems || "stretch"}
            onChange={(e) => patchNodeLayout?.(node.id, { justifyItems: e.target.value })}
            className="h-[var(--row-field-h)] px-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] text-xs text-[var(--text-1)] outline-none hover:border-[var(--text-2)] transition-colors cursor-pointer"
          >
            <option value="stretch">stretch</option>
            <option value="start">start</option>
            <option value="center">center</option>
            <option value="end">end</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function GridItemControls({ node, patchNode }) {
  const gl = node.gridLayout || {};

  const patchGl = (patch) => {
    patchNode?.(node.id, {
      gridLayout: { ...(node.gridLayout || {}), ...patch },
    });
  };

  return (
    <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-[var(--line)]/60">
      <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-1)]">
        <span>Grid Item Placement</span>
      </div>

      {/* Column Start / End */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
          <span className="mr-1.5 text-[var(--text-2)] select-none font-mono text-[10px] font-medium shrink-0">Col start</span>
          <input
            type="text"
            value={gl.gridColumnStart || ""}
            placeholder="auto"
            onChange={(e) => patchGl({ gridColumnStart: e.target.value.trim() || undefined })}
            className="w-full text-right text-xs font-medium text-[var(--text-1)] bg-transparent outline-none font-mono"
          />
        </div>
        <div className="flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
          <span className="mr-1.5 text-[var(--text-2)] select-none font-mono text-[10px] font-medium shrink-0">Col end</span>
          <input
            type="text"
            value={gl.gridColumnEnd || ""}
            placeholder="span 1"
            onChange={(e) => patchGl({ gridColumnEnd: e.target.value.trim() || undefined })}
            className="w-full text-right text-xs font-medium text-[var(--text-1)] bg-transparent outline-none font-mono"
          />
        </div>
      </div>

      {/* Row Start / End */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
          <span className="mr-1.5 text-[var(--text-2)] select-none font-mono text-[10px] font-medium shrink-0">Row start</span>
          <input
            type="text"
            value={gl.gridRowStart || ""}
            placeholder="auto"
            onChange={(e) => patchGl({ gridRowStart: e.target.value.trim() || undefined })}
            className="w-full text-right text-xs font-medium text-[var(--text-1)] bg-transparent outline-none font-mono"
          />
        </div>
        <div className="flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
          <span className="mr-1.5 text-[var(--text-2)] select-none font-mono text-[10px] font-medium shrink-0">Row end</span>
          <input
            type="text"
            value={gl.gridRowEnd || ""}
            placeholder="span 1"
            onChange={(e) => patchGl({ gridRowEnd: e.target.value.trim() || undefined })}
            className="w-full text-right text-xs font-medium text-[var(--text-1)] bg-transparent outline-none font-mono"
          />
        </div>
      </div>

      {/* Self Alignment */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[var(--text-2)] font-medium">Align self</label>
          <select
            value={gl.alignSelf || "auto"}
            onChange={(e) => patchGl({ alignSelf: e.target.value === "auto" ? undefined : e.target.value })}
            className="h-[var(--row-field-h)] px-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] text-xs text-[var(--text-1)] outline-none hover:border-[var(--text-2)] transition-colors cursor-pointer"
          >
            <option value="auto">auto</option>
            <option value="start">start</option>
            <option value="center">center</option>
            <option value="end">end</option>
            <option value="stretch">stretch</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[var(--text-2)] font-medium">Justify self</label>
          <select
            value={gl.justifySelf || "auto"}
            onChange={(e) => patchGl({ justifySelf: e.target.value === "auto" ? undefined : e.target.value })}
            className="h-[var(--row-field-h)] px-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] text-xs text-[var(--text-1)] outline-none hover:border-[var(--text-2)] transition-colors cursor-pointer"
          >
            <option value="auto">auto</option>
            <option value="start">start</option>
            <option value="center">center</option>
            <option value="end">end</option>
            <option value="stretch">stretch</option>
          </select>
        </div>
      </div>
    </div>
  );
}

export default function LayoutSection({
  node,
  tokens = [],
  doc,
  setNodePosition,
  setNodeRotation,
  setNodeSizing,
  patchNode,
  patchNodeLayout,
  patchStyle,
  addFlex,
  removeFlex,
  addGrid,
  removeGrid,
}) {
  const [layoutOpen, setLayoutOpen] = useState(true);
  const [showFlexAdvanced, setShowFlexAdvanced] = useState(false);
  const [individualPadding, setIndividualPadding] = useState(false);
  const [wMenuOpen, setWMenuOpen] = useState(false);
  const [hMenuOpen, setHMenuOpen] = useState(false);
  const [gapMenuOpen, setGapMenuOpen] = useState(false);
  const [crossGapMenuOpen, setCrossGapMenuOpen] = useState(false);
  const [paddingMenuOpen, setPaddingMenuOpen] = useState(null); // null | "h" | "v" | "l" | "t" | "r" | "b"
  const [paddingSearch, setPaddingSearch] = useState("");
  const [individualMargin, setIndividualMargin] = useState(false);
  const [marginMenuOpen, setMarginMenuOpen] = useState(null); // null | "h" | "v" | "l" | "t" | "r" | "b"
  const [marginSearch, setMarginSearch] = useState("");
  const [hConstraintMenuOpen, setHConstraintMenuOpen] = useState(false);
  const [vConstraintMenuOpen, setVConstraintMenuOpen] = useState(false);

  useEffect(() => {
    if (!gapMenuOpen && !crossGapMenuOpen && !showFlexAdvanced && !paddingMenuOpen && !marginMenuOpen) return;
    const handleClickOutside = (e) => {
      if (
        !e.target.closest("[data-gap-menu]") &&
        !e.target.closest("[data-flex-advanced]") &&
        !e.target.closest("[data-padding-menu]") &&
        !e.target.closest("[data-margin-menu]")
      ) {
        setGapMenuOpen(false);
        setCrossGapMenuOpen(false);
        setShowFlexAdvanced(false);
        setPaddingMenuOpen(null);
        setMarginMenuOpen(null);
        setPaddingSearch("");
        setMarginSearch("");
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [gapMenuOpen, crossGapMenuOpen, showFlexAdvanced, paddingMenuOpen, marginMenuOpen]);

  const parent = node?.parentId ? doc?.nodes?.[node.parentId] : null;
  const parentIsFlex = parent?.layout?.mode === "flex";
  const inFlowFlexChild = parentIsFlex && !node?.position?.absolute;
  const parentIsGrid = parent?.layout?.mode === "grid";
  const inFlowGridChild = parentIsGrid && !node?.position?.absolute;
  const isFrame = node?.type === "frame";
  const isFlex = node?.layout?.mode === "flex";
  const isGrid = node?.layout?.mode === "grid";
  const canAddLayout = Boolean(node) && !isFlex && !isGrid;
  const layout = node?.layout ?? {};
  const style = node?.style ?? {};

  const spacingTokens = (tokens || []).filter(
    (t) => t.type === "spacing" || t.name?.toLowerCase().includes("spacing")
  );

  // Keyboard shortcuts: Shift + A (Add flex) & Alt + C (Clip content)
  useEffect(() => {
    const onKeyDown = (e) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target?.isContentEditable
      ) {
        return;
      }

      // Shift + A to Add flex
      if (
        e.shiftKey &&
        (e.key === "a" || e.key === "A") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        if (canAddFlex && addFlex) {
          e.preventDefault();
          addFlex(node.id);
        }
      }

      // Alt + C to toggle Clip content
      if (
        e.altKey &&
        (e.key === "c" || e.key === "C") &&
        !e.ctrlKey &&
        !e.metaKey
      ) {
        if (isFrame || isFlex || isGrid || (node?.childIds && node.childIds.length > 0)) {
          e.preventDefault();
          const nextClip = !(node.clipContent || node.style?.overflow === "hidden");
          patchNode?.(node.id, { clipContent: nextClip });
          patchStyle?.({ overflow: nextClip ? "hidden" : undefined });
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [node?.id, isFrame, isFlex, node?.clipContent, node?.style?.overflow, addFlex, patchNode, patchStyle]);

  // Padding values (supports l, t, r, b with fallback to h, v) - resolved with theme tokens
  const padLeft = Math.round(resolveNumeric(layout.padding?.l ?? layout.padding?.h ?? 0, tokens) || 0);
  const padTop = Math.round(resolveNumeric(layout.padding?.t ?? layout.padding?.v ?? 0, tokens) || 0);
  const padRight = Math.round(resolveNumeric(layout.padding?.r ?? layout.padding?.h ?? 0, tokens) || 0);
  const padBottom = Math.round(resolveNumeric(layout.padding?.b ?? layout.padding?.v ?? 0, tokens) || 0);

  // Custom on one side: if any side differs from its counterpart, automatically activate individual padding
  const isCustomPadding =
    padLeft !== padRight ||
    padTop !== padBottom ||
    (layout.padding?.l !== undefined && layout.padding?.r !== undefined && layout.padding.l !== layout.padding.r) ||
    (layout.padding?.t !== undefined && layout.padding?.b !== undefined && layout.padding.t !== layout.padding.b);

  useEffect(() => {
    if (isCustomPadding) {
      setIndividualPadding(true);
    }
  }, [isCustomPadding, node?.id]);

  const toggleIndividualPadding = () => {
    if (individualPadding) {
      // Switch back to uniform: harmonize horizontal to padLeft and vertical to padTop
      patchNodeLayout(node.id, {
        padding: {
          h: padLeft,
          v: padTop,
          l: padLeft,
          r: padLeft,
          t: padTop,
          b: padTop,
        },
      });
      setIndividualPadding(false);
    } else {
      setIndividualPadding(true);
    }
  };

  const patchPadding = (side, val) => {
    let resolved = val;
    if (typeof val === "number") {
      resolved = Math.max(0, Math.round(val));
    } else if (typeof val === "string" && !isNaN(Number(val))) {
      resolved = Math.max(0, Math.round(Number(val)));
    }
    if (!individualPadding) {
      if (side === "h" || side === "l" || side === "r") {
        patchNodeLayout(node.id, {
          padding: { ...layout.padding, h: resolved, l: resolved, r: resolved },
        });
      } else {
        patchNodeLayout(node.id, {
          padding: { ...layout.padding, v: resolved, t: resolved, b: resolved },
        });
      }
      return;
    }
    const current = {
      l: layout.padding?.l ?? layout.padding?.h ?? 0,
      t: layout.padding?.t ?? layout.padding?.v ?? 0,
      r: layout.padding?.r ?? layout.padding?.h ?? 0,
      b: layout.padding?.b ?? layout.padding?.v ?? 0,
      [side]: resolved,
    };
    patchNodeLayout(node.id, { padding: current });
  };

  const renderPaddingDropdown = (side, title, currentVal) => {
    if (paddingMenuOpen !== side) return null;
    const numVal = Number(currentVal);
    const isAlignRight = side === "v" || side === "b" || side === "t";
    const query = paddingSearch.trim().toLowerCase();

    // Standard scale
    const standardScale = [0, 4, 8, 12, 16, 24, 32, 48, 64];

    // Filter tokens and scale based on typed search query if user started typing
    const matchingTokens = query
      ? spacingTokens.filter(
          (t) =>
            t.name.toLowerCase().includes(query) ||
            String(t.value).toLowerCase().includes(query)
        )
      : spacingTokens;

    const matchingScale = query
      ? standardScale.filter((v) => String(v).includes(query))
      : standardScale;

    // "if any match with the input value show them as search, if not match show all of them"
    const hasAnyMatch = matchingTokens.length > 0 || matchingScale.length > 0;
    const tokensToShow = query
      ? hasAnyMatch
        ? matchingTokens
        : spacingTokens
      : spacingTokens;
    const scaleToShow = query
      ? hasAnyMatch
        ? matchingScale
        : standardScale
      : standardScale;

    const handleSelectPadding = (val) => {
      patchPadding(side, val);
      setPaddingMenuOpen(null);
      setPaddingSearch("");
      if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    };

    return (
      <div
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        className={`absolute ${
          isAlignRight ? "right-0" : "left-0"
        } top-full mt-1.5 w-44 rounded-lg border border-[var(--line)] bg-[var(--surface-content)] shadow-lg py-1 z-50 text-xs animate-in fade-in duration-100 select-none max-h-56 overflow-y-auto`}
      >
        <div className="px-3 py-1 text-[10px] font-semibold text-[var(--text-2)] uppercase tracking-wider flex items-center justify-between">
          <span>{title}</span>
          {query && (
            <span className={`text-[9px] font-mono ${hasAnyMatch ? "text-[var(--accent)] font-semibold" : "text-[var(--text-2)]"}`}>
              {hasAnyMatch ? "Matching" : "All (no match)"}
            </span>
          )}
        </div>
        {tokensToShow.length > 0 && (
          <>
            <div className="px-3 py-0.5 text-[9px] font-bold text-[var(--text-2)] uppercase tracking-wider opacity-60">
              Theme Spacing
            </div>
            {tokensToShow.map((tok) => {
              const tokVal = Number(tok.value) || 0;
              const isSelected = numVal === tokVal || currentVal === tok.name;
              return (
                <button
                  key={tok.id || tok.name}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSelectPadding(tok.value ?? tok.name);
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSelectPadding(tok.value ?? tok.name);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-hover)] text-[var(--text-1)] flex items-center justify-between cursor-pointer"
                >
                  <span className="font-mono text-xs">{tok.name}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-[var(--text-2)]">{tok.value}px</span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-[var(--accent)]" />}
                  </div>
                </button>
              );
            })}
            <div className="my-1 border-t border-[var(--line)]" />
          </>
        )}
        {scaleToShow.length > 0 && (
          <>
            <div className="px-3 py-0.5 text-[9px] font-bold text-[var(--text-2)] uppercase tracking-wider opacity-60">
              Scale
            </div>
            {scaleToShow.map((v) => {
              const isSelected = numVal === v;
              return (
                <button
                  key={v}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSelectPadding(v);
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSelectPadding(v);
                  }}
                  className="w-full text-left px-3 py-1 hover:bg-[var(--surface-hover)] text-[var(--text-1)] flex items-center justify-between cursor-pointer"
                >
                  <span>{v}px</span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-[var(--accent)]" />}
                </button>
              );
            })}
          </>
        )}
      </div>
    );
  };

  // Margin values (supports l, t, r, b with fallback to h, v) - resolved with theme tokens
  const nodeMar = layout.margin || node.margin || (node.rawStyle ? parseBoxEdges(node.rawStyle, "margin") : null);
  const marLeft = Math.round(resolveNumeric(nodeMar?.l ?? nodeMar?.left ?? nodeMar?.h ?? 0, tokens) || 0);
  const marTop = Math.round(resolveNumeric(nodeMar?.t ?? nodeMar?.top ?? nodeMar?.v ?? 0, tokens) || 0);
  const marRight = Math.round(resolveNumeric(nodeMar?.r ?? nodeMar?.right ?? nodeMar?.h ?? 0, tokens) || 0);
  const marBottom = Math.round(resolveNumeric(nodeMar?.b ?? nodeMar?.bottom ?? nodeMar?.v ?? 0, tokens) || 0);

  // Custom on one side: if any side differs from its counterpart, automatically activate individual margin
  const isCustomMargin =
    marLeft !== marRight ||
    marTop !== marBottom ||
    (nodeMar?.l !== undefined && nodeMar?.r !== undefined && nodeMar.l !== nodeMar.r) ||
    (nodeMar?.t !== undefined && nodeMar?.b !== undefined && nodeMar.t !== nodeMar.b);

  useEffect(() => {
    if (isCustomMargin) {
      setIndividualMargin(true);
    }
  }, [isCustomMargin, node?.id]);

  const toggleIndividualMargin = () => {
    if (individualMargin) {
      const uniformMar = {
        h: marLeft,
        v: marTop,
        l: marLeft,
        r: marLeft,
        t: marTop,
        b: marTop,
      };
      patchNodeLayout(node.id, { margin: uniformMar });
      patchNode(node.id, { margin: uniformMar });
      setIndividualMargin(false);
    } else {
      setIndividualMargin(true);
    }
  };

  const patchMargin = (side, val) => {
    let resolved = val;
    if (typeof val === "number") {
      resolved = Math.max(0, Math.round(val));
    } else if (typeof val === "string" && !isNaN(Number(val))) {
      resolved = Math.max(0, Math.round(Number(val)));
    }
    let nextMar;
    if (!individualMargin) {
      if (side === "h" || side === "l" || side === "r") {
        nextMar = { ...(layout.margin || nodeMar || {}), h: resolved, l: resolved, r: resolved };
      } else {
        nextMar = { ...(layout.margin || nodeMar || {}), v: resolved, t: resolved, b: resolved };
      }
    } else {
      nextMar = {
        l: nodeMar?.l ?? nodeMar?.left ?? nodeMar?.h ?? 0,
        t: nodeMar?.t ?? nodeMar?.top ?? nodeMar?.v ?? 0,
        r: nodeMar?.r ?? nodeMar?.right ?? nodeMar?.h ?? 0,
        b: nodeMar?.b ?? nodeMar?.bottom ?? nodeMar?.v ?? 0,
        [side]: resolved,
      };
    }
    patchNodeLayout(node.id, { margin: nextMar });
    const cleanRaw = { ...(node.rawStyle || {}) };
    delete cleanRaw.margin;
    delete cleanRaw["margin-top"];
    delete cleanRaw["margin-right"];
    delete cleanRaw["margin-bottom"];
    delete cleanRaw["margin-left"];
    delete cleanRaw["margin-block"];
    delete cleanRaw["margin-inline"];
    patchNode(node.id, { margin: nextMar, rawStyle: cleanRaw });
  };

  const handleMarginIconScrub = (e, side) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startVal =
      side === "l"
        ? marLeft
        : side === "t"
        ? marTop
        : side === "r"
        ? marRight
        : side === "b"
        ? marBottom
        : side === "h"
        ? marLeft
        : marTop;
    const onMove = (ev) => {
      const delta = Math.round((ev.clientX - startX) / 2);
      const nextVal = Math.max(0, startVal + delta);
      patchMargin(side, nextVal);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const renderMarginDropdown = (side, title, currentVal) => {
    if (marginMenuOpen !== side) return null;
    const numVal = Number(currentVal);
    const isAlignRight = side === "v" || side === "b" || side === "t";
    const query = marginSearch.trim().toLowerCase();

    const standardScale = [0, 4, 8, 12, 16, 24, 32, 48, 64];

    const matchingTokens = query
      ? spacingTokens.filter(
          (t) =>
            t.name.toLowerCase().includes(query) ||
            String(t.value).toLowerCase().includes(query)
        )
      : spacingTokens;

    const matchingScale = query
      ? standardScale.filter((v) => String(v).includes(query))
      : standardScale;

    const hasAnyMatch = matchingTokens.length > 0 || matchingScale.length > 0;
    const tokensToShow = query
      ? hasAnyMatch
        ? matchingTokens
        : spacingTokens
      : spacingTokens;
    const scaleToShow = query
      ? hasAnyMatch
        ? matchingScale
        : standardScale
      : standardScale;

    const handleSelectMargin = (val) => {
      patchMargin(side, val);
      setMarginMenuOpen(null);
      setMarginSearch("");
      if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    };

    return (
      <div
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        className={`absolute ${
          isAlignRight ? "right-0" : "left-0"
        } top-full mt-1.5 w-44 rounded-lg border border-[var(--line)] bg-[var(--surface-content)] shadow-lg py-1 z-50 text-xs animate-in fade-in duration-100 select-none max-h-56 overflow-y-auto`}
      >
        <div className="px-3 py-1 text-[10px] font-semibold text-[var(--text-2)] uppercase tracking-wider flex items-center justify-between">
          <span className="text-[#F97316] font-medium">{title}</span>
          {query && (
            <span className={`text-[9px] font-mono ${hasAnyMatch ? "text-[#F97316] font-semibold" : "text-[var(--text-2)]"}`}>
              {hasAnyMatch ? "Matching" : "All (no match)"}
            </span>
          )}
        </div>
        {tokensToShow.length > 0 && (
          <>
            <div className="px-3 py-0.5 text-[9px] font-bold text-[var(--text-2)] uppercase tracking-wider opacity-60">
              Theme Spacing
            </div>
            {tokensToShow.map((tok) => {
              const tokVal = Number(tok.value) || 0;
              const isSelected = numVal === tokVal || currentVal === tok.name;
              return (
                <button
                  key={tok.id || tok.name}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSelectMargin(tok.value ?? tok.name);
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSelectMargin(tok.value ?? tok.name);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-hover)] text-[var(--text-1)] flex items-center justify-between cursor-pointer"
                >
                  <span className="font-mono text-xs">{tok.name}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-[var(--text-2)]">{tok.value}px</span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-[#F97316]" />}
                  </div>
                </button>
              );
            })}
            <div className="my-1 border-t border-[var(--line)]" />
          </>
        )}
        {scaleToShow.length > 0 && (
          <>
            <div className="px-3 py-0.5 text-[9px] font-bold text-[var(--text-2)] uppercase tracking-wider opacity-60">
              Scale
            </div>
            {scaleToShow.map((v) => {
              const isSelected = numVal === v;
              return (
                <button
                  key={v}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSelectMargin(v);
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSelectMargin(v);
                  }}
                  className="w-full text-left px-3 py-1 hover:bg-[var(--surface-hover)] text-[var(--text-1)] flex items-center justify-between cursor-pointer"
                >
                  <span>{v}px</span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-[#F97316]" />}
                </button>
              );
            })}
          </>
        )}
      </div>
    );
  };

  // 3x3 alignment dots mapping
  const isColumn = layout.direction === "column";
  const posNames = ["start", "center", "end"];

  const handleToggleAbsolute = () => {
    const isNowAbsolute = !node?.position?.absolute;
    if (isNowAbsolute) {
      let currentX = node?.position?.x ?? 0;
      let currentY = node?.position?.y ?? 0;
      let currentW = null;
      let currentH = null;
      if (typeof document !== "undefined" && node?.parentId) {
        const el = document.querySelector(`[data-node-id="${node.id}"]`);
        const parentEl = document.querySelector(`[data-node-id="${node.parentId}"]`);
        if (el && parentEl) {
          const childRect = el.getBoundingClientRect();
          const parentRect = parentEl.getBoundingClientRect();
          const zoom = useEditorStore?.getState?.()?.viewport?.zoom || 1;
          currentX = Math.round((childRect.left - parentRect.left) / zoom);
          currentY = Math.round((childRect.top - parentRect.top) / zoom);
          currentW = Math.round(childRect.width / zoom);
          currentH = Math.round(childRect.height / zoom);
        }
      }
      patchNode(node.id, {
        position: {
          ...(node.position ?? {}),
          x: currentX,
          y: currentY,
          absolute: true,
        },
        constraints: node?.constraints ?? {
          horizontal: "start",
          vertical: "start",
        },
        ...(currentW && currentH ? {
          size: {
            w: { kind: "fixed", px: currentW },
            h: { kind: "fixed", px: currentH },
          }
        } : {})
      });
    } else {
      patchNode(node.id, {
        position: {
          ...(node.position ?? {}),
          absolute: false,
        },
      });
    }
  };

  const [hoveredCrossIndex, setHoveredCrossIndex] = useState(null);

  const handleDotClick = (row, col) => {
    const targetX = posNames[col];
    const targetY = posNames[row];
    const targetCross = isColumn ? targetX : targetY;

    if (layout.alignMain === "space-between") {
      // In space-between mode, clicking any cell adjusts the cross-axis alignment
      // (top / center / bottom for horizontal flex, left / center / right for vertical flex)
      // while preserving the space-between state!
      patchNodeLayout(node.id, { alignMain: "space-between", alignCross: targetCross });
      return;
    }

    // Single click in packed mode sets packed alignment to that cell
    const targetMain = isColumn ? targetY : targetX;
    patchNodeLayout(node.id, { alignMain: targetMain, alignCross: targetCross });
  };

  const handleDotDoubleClick = (row, col) => {
    const targetX = posNames[col];
    const targetY = posNames[row];
    const targetCross = isColumn ? targetX : targetY;

    if (layout.alignMain === "space-between") {
      // Double click toggles back to packed alignment
      const targetMain = isColumn ? targetY : targetX;
      patchNodeLayout(node.id, { alignMain: targetMain, alignCross: targetCross });
    } else {
      // Double click toggles into space-between with this dot's cross alignment
      patchNodeLayout(node.id, { alignMain: "space-between", alignCross: targetCross });
    }
  };

  const isDotActive = (row, col) => {
    const targetX = posNames[col];
    const targetY = posNames[row];
    const currentX = isColumn ? (layout.alignCross ?? "start") : (layout.alignMain ?? "start");
    const currentY = isColumn ? (layout.alignMain ?? "start") : (layout.alignCross ?? "start");
    return currentX === targetX && currentY === targetY;
  };

  // Rotate layer 90 degrees clockwise
  const handleRotate = () => {
    const currentRotation = Number(node?.rotation) || 0;
    const nextRotation = (currentRotation + 90) % 360;
    setNodeRotation(node.id, nextRotation);
  };

  // Flip horizontal (toggle scaleX(-1))
  const handleFlipH = () => {
    const current = style.transform ?? "";
    const hasFlipH = current.includes("scaleX(-1)");
    let next = current;
    if (hasFlipH) {
      next = next.replace("scaleX(-1)", "").trim();
    } else {
      next = `${next} scaleX(-1)`.trim();
    }
    patchStyle({ transform: next || undefined });
  };

  // Flip vertical (toggle scaleY(-1))
  const handleFlipV = () => {
    const current = style.transform ?? "";
    const hasFlipV = current.includes("scaleY(-1)");
    let next = current;
    if (hasFlipV) {
      next = next.replace("scaleY(-1)", "").trim();
    } else {
      next = `${next} scaleY(-1)`.trim();
    }
    patchStyle({ transform: next || undefined });
  };

  // Helper for scrubbing icon on angle input
  const handleAngleIconScrub = (e) => {
    if (e.button !== 0) return;
    startScrubbing(
      e,
      node?.rotation ?? 0,
      (newVal) => setNodeRotation(node.id, newVal),
      { step: 1 }
    );
  };

  // Helper for scrubbing icon on gap / crossGap input
  const handleGapIconScrub = (e, prop = "gap") => {
    if (e.button !== 0) return;
    const currentVal =
      typeof layout[prop] === "number"
        ? layout[prop]
        : (resolveNumeric(layout[prop], tokens) || (prop === "crossGap" ? (resolveNumeric(layout.gap, tokens) || 0) : 0));
    startScrubbing(
      e,
      currentVal,
      (newVal) => patchNodeLayout(node.id, { [prop]: newVal }),
      { min: 0, step: 1 }
    );
  };

  // Helper for scrubbing icon on padding input
  const handlePaddingIconScrub = (e, side) => {
    if (e.button !== 0) return;
    let currentVal = 0;
    if (!individualPadding) {
      currentVal = side === "h" ? (layout.padding?.h ?? 0) : (layout.padding?.v ?? 0);
    } else {
      if (side === "l") currentVal = padLeft;
      else if (side === "t") currentVal = padTop;
      else if (side === "r") currentVal = padRight;
      else if (side === "b") currentVal = padBottom;
    }
    startScrubbing(
      e,
      currentVal,
      (newVal) => patchPadding(side, newVal),
      { min: 0, step: 1 }
    );
  };

  const getCurrentFitPx = (axis) => {
    if (typeof window !== "undefined") {
      const el = document.querySelector(`[data-node-id="${node.id}"]`);
      if (el) {
        const zoom = useEditorStore.getState().viewport?.zoom || 1;
        const rect = el.getBoundingClientRect();
        let measured = Math.round(axis === "w" ? rect.width / zoom : rect.height / zoom);
        if (node.type === "text" && axis === "w" && el.scrollWidth) {
          const sw = Math.round(el.scrollWidth / zoom);
          if (sw > measured) measured = sw;
        }
        if (node.type === "text" && axis === "h" && el.scrollHeight) {
          const sh = Math.round(el.scrollHeight / zoom);
          if (sh > measured) measured = sh;
        }
        if (measured > 0) return measured;
      }
    }
    if (node.size?.[axis]?.px && node.size[axis].px > 0) {
      return node.size[axis].px;
    }
    if (node.layout?.prevSize?.[axis]?.px && node.layout.prevSize[axis].px > 0) {
      return node.layout.prevSize[axis].px;
    }
    return axis === "w" ? 300 : 200;
  };

  // Sizing field helper (W & H)
  const renderSizingField = (axis, label, menuOpen, setMenuOpen) => {
    const sizing = node?.size?.[axis] ?? { kind: "fixed", px: 100 };
    const allowFit = node?.type === "text" || isFlex || isFrame;
    const bindableTokens = tokens.filter(
      (t) => t.type === "spacing" || t.type === "container",
    );

    let displayVal = "100";
    if (sizing.kind === "fill") displayVal = "Fill";
    else if (sizing.kind === "auto") displayVal = "Auto";
    else if (sizing.kind === "fit") displayVal = "Fit";
    else if (sizing.kind === "relative") displayVal = `${sizing.pct ?? 100}%`;
    else if (sizing.kind === "token") {
      const tok = tokens.find((t) => t.id === sizing.tokenId);
      displayVal = tok ? tok.name : "Token";
    } else {
      displayVal = String(sizing.px ?? 100);
    }

    return (
      <div className="relative flex-1 min-w-0">
        <div
          className="flex h-[var(--row-field-h)] w-full items-center justify-between rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors group cursor-pointer"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <span
            onMouseDown={(e) => {
              e.stopPropagation();
              const currentVal = sizing.kind === "fixed" ? (sizing.px ?? 100) : getCurrentFitPx(axis);
              startScrubbing(
                e,
                currentVal,
                (v) => setNodeSizing(node.id, axis, { kind: "fixed", px: Math.max(1, v) }),
                { min: 1, step: 1 }
              );
            }}
            className="text-[11px] font-mono font-medium text-[var(--text-2)] select-none shrink-0 mr-1 cursor-ew-resize hover:text-[var(--text-1)]"
            title="Click and drag horizontally to scrub value"
          >
            {label}
          </span>
          <div
            className="flex-1 text-center truncate text-xs font-medium text-[var(--text-1)] select-none px-0.5"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <FlexibleSizeInput
              sizing={sizing}
              tokens={tokens}
              onChange={(newSizing) => setNodeSizing(node.id, axis, newSizing)}
              inputClassName="w-full text-center text-xs font-medium text-[var(--text-1)] bg-transparent outline-none cursor-text select-all"
            />
          </div>
          {/* Proper caret icon from Base-UI */}
          <button
            type="button"
            className="p-0.5 text-[var(--text-2)] group-hover:text-[var(--text-1)] shrink-0 ml-0.5"
            tabIndex={-1}
            aria-label={`${label} settings`}
          >
            <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="currentColor">
              <path d="M0.75 1.5L4 4.75L7.25 1.5" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"></path>
            </svg>
          </button>
        </div>

        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute left-0 top-full mt-1 z-50 w-36 rounded-xl border border-[var(--line)] bg-[var(--surface-content)] p-1 shadow-xl animate-in fade-in zoom-in-95 duration-100 text-xs text-[var(--text-1)]">
              <button
                type="button"
                onClick={() => {
                  const currentPx = sizing.kind === "fixed" ? (sizePx(sizing) ?? 100) : getCurrentFitPx(axis);
                  setNodeSizing(node.id, axis, {
                    kind: "fixed",
                    px: currentPx,
                  });
                  setMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                  sizing.kind === "fixed"
                    ? "bg-[var(--surface-hover)] font-semibold text-[var(--text-1)]"
                    : "text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)]"
                }`}
              >
                <span>Fixed (px)</span>
                {sizing.kind === "fixed" && <Check size={12} />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setNodeSizing(node.id, axis, { kind: "auto" });
                  setMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                  sizing.kind === "auto"
                    ? "bg-[var(--surface-hover)] font-semibold text-[var(--text-1)]"
                    : "text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)]"
                }`}
              >
                <span>Auto</span>
                {sizing.kind === "auto" && <Check size={12} />}
              </button>
              {allowFit && (
                <button
                  type="button"
                  onClick={() => {
                    setNodeSizing(node.id, axis, { kind: "fit" });
                    setMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                    sizing.kind === "fit"
                      ? "bg-[var(--surface-hover)] font-semibold text-[var(--text-1)]"
                      : "text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)]"
                  }`}
                >
                  <span>Fit</span>
                  {sizing.kind === "fit" && <Check size={12} />}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setNodeSizing(node.id, axis, { kind: "fill" });
                  setMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                  sizing.kind === "fill"
                    ? "bg-[var(--surface-hover)] font-semibold text-[var(--text-1)]"
                    : "text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)]"
                }`}
              >
                <span>Fill</span>
                {sizing.kind === "fill" && <Check size={12} />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setNodeSizing(node.id, axis, { kind: "relative", pct: 100 });
                  setMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                  sizing.kind === "relative"
                    ? "bg-[var(--surface-hover)] font-semibold text-[var(--text-1)]"
                    : "text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)]"
                }`}
              >
                <span>Relative (%)</span>
                {sizing.kind === "relative" && <Check size={12} />}
              </button>

              {bindableTokens.length > 0 && (
                <div className="mt-1 pt-1 border-t border-[var(--line)]">
                  <div className="px-2 py-0.5 text-[10px] font-bold text-[var(--text-2)] uppercase tracking-wider">
                    Tokens
                  </div>
                  {bindableTokens.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setNodeSizing(node.id, axis, {
                          kind: "token",
                          tokenId: t.id,
                        });
                        setMenuOpen(false);
                      }}
                      className="w-full flex items-center justify-between px-2.5 py-1 rounded-lg text-left text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] truncate"
                    >
                      <span className="truncate">{t.name}</span>
                      <span className="font-mono text-[10px] ml-1 shrink-0 text-[var(--text-2)]">
                        {String(resolveToken(tokens, t.id))}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="mb-4 border-b border-[var(--line)] pb-4 select-none font-sans">
      {/* ------------------------------------------------ Layout Header */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setLayoutOpen(!layoutOpen)}
          className="flex items-center gap-1 text-[var(--type-label)] font-medium text-[var(--text-1)] hover:text-[var(--accent)] transition-colors group cursor-pointer"
        >
          <span>Layout</span>
          {/* Proper Layout caret from Base-UI */}
          <svg
            width="8"
            height="6"
            viewBox="0 0 8 6"
            fill="none"
            stroke="currentColor"
            className={`pointer-events-none transition-transform duration-150 text-[var(--text-2)] group-hover:text-[var(--accent)] ${
              layoutOpen ? "rotate-0 mt-0.5" : "-rotate-90"
            }`}
          >
            <path d="M0.75 1.5L4 4.75L7.25 1.5" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"></path>
          </svg>
        </button>

        {/* Header Action: Exact Resize to fit (Hug) icon from Base-UI */}
        <div className="flex items-center gap-1 text-[var(--text-2)]">
          <button
            type="button"
            onClick={() => {
              setNodeSizing(node.id, "w", { kind: "fit" });
              setNodeSizing(node.id, "h", { kind: "fit" });
            }}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] transition-colors cursor-pointer"
            title="Resize to fit (Hug content)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M5 4.36328V2H6V6H2V5H4.36328L1.48145 2.11816L2.11816 1.48145L5 4.36328Z"></path>
              <path d="M5 11.6367V14H6V10H2V11H4.36328L1.48145 13.8818L2.11816 14.5186L5 11.6367Z"></path>
              <path d="M11 4.36328V2H10V6H14V5H11.6367L14.5186 2.11816L13.8818 1.48145L11 4.36328Z"></path>
              <path d="M11 11.6367V14H10V10H14V11H11.6367L14.5186 13.8818L13.8818 14.5186L11 11.6367Z"></path>
            </svg>
          </button>
        </div>
      </div>

      {layoutOpen && (
        <div className="flex flex-col gap-2">
          {/* ------------------------------------------------ Row 1: X, Y, Angle */}
          <div className="grid grid-cols-3 gap-1.5">
            {/* X */}
            <div className="flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
              <ScrubbableNumberInput
                label="X"
                value={inFlowFlexChild || inFlowGridChild ? "–" : (node?.position?.x ?? 0)}
                disabled={inFlowFlexChild || inFlowGridChild}
                onCommit={(v) => setNodePosition(node.id, v, node.position?.y ?? 0)}
                labelClassName="mr-1.5 text-[var(--text-2)] select-none font-mono text-[11px] font-medium cursor-ew-resize hover:text-[var(--text-1)]"
                inputClassName="w-full text-right text-xs font-medium text-[var(--text-1)] bg-transparent outline-none"
              />
            </div>

            {/* Y */}
            <div className="flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
              <ScrubbableNumberInput
                label="Y"
                value={inFlowFlexChild || inFlowGridChild ? "–" : (node?.position?.y ?? 0)}
                disabled={inFlowFlexChild || inFlowGridChild}
                onCommit={(v) => setNodePosition(node.id, node.position?.x ?? 0, v)}
                labelClassName="mr-1.5 text-[var(--text-2)] select-none font-mono text-[11px] font-medium cursor-ew-resize hover:text-[var(--text-1)]"
                inputClassName="w-full text-right text-xs font-medium text-[var(--text-1)] bg-transparent outline-none"
              />
            </div>

            {/* Angle ∠ 0° with proper Base-UI SVG angle icon */}
            <div className="flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors">
              <span
                onMouseDown={handleAngleIconScrub}
                className="cursor-ew-resize text-[var(--text-2)] hover:text-[var(--text-1)] shrink-0 mr-1 select-none flex items-center"
                title="Click and drag horizontally to rotate"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M6.53415 8.27384L4.49729 11.0002H7.99509C8.12208 9.87393 7.53223 8.78695 6.53415 8.27384ZM7.13893 7.46434L9.86434 3.81628L9.06322 3.21777L3.09906 11.201L2.50195 12.0002H3.49962H12.9996V11.0002H8.99988C9.11898 9.55664 8.38202 8.17597 7.13893 7.46434Z"
                    fill="currentColor"
                  ></path>
                </svg>
              </span>
              <ScrubbableNumberInput
                value={node?.rotation ?? 0}
                onCommit={(v) => setNodeRotation(node.id, v)}
                suffix="°"
                inputClassName="w-full text-right text-xs font-medium text-[var(--text-1)] bg-transparent outline-none"
              />
            </div>
          </div>

          {/* ------------------------------------------------ Row 2: W, H, Actions */}
          <div className="flex items-center gap-1.5">
            {/* W with proper caret */}
            {renderSizingField("w", "W", wMenuOpen, setWMenuOpen)}

            {/* H with proper caret */}
            {renderSizingField("h", "H", hMenuOpen, setHMenuOpen)}

            {/* Segmented Actions Pill with exact Base-UI SVGs */}
            <div className="flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] p-0.5 divide-x divide-[var(--line)] shrink-0">
              {/* Rotate 90° / Orientation toggle */}
              <button
                type="button"
                onClick={handleRotate}
                className="flex h-full w-6 items-center justify-center text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] rounded-[var(--radius-sm)] transition-colors cursor-pointer shrink-0"
                title="Rotate 90°"
                aria-label="Rotate 90°"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 -scale-x-100">
                  <path transform="translate(1 0)" d="M9.5 2.5L6 4.5V3H4.5C3.11929 3 2 4.11929 2 5.5V8H1V5.5C1 3.567 2.567 2 4.5 2H6V0.5L9.5 2.5Z"></path>
                  <rect transform="translate(1 0)" x="5.5" y="6.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeLinejoin="round"></rect>
                </svg>
              </button>

              {/* Flip Horizontal */}
              <button
                type="button"
                onClick={handleFlipH}
                className={`flex h-full w-6 items-center justify-center rounded-[var(--radius-sm)] transition-colors cursor-pointer shrink-0 ${
                  style.transform?.includes("scaleX(-1)")
                    ? "bg-[var(--surface-hover)] text-[var(--accent)] font-semibold"
                    : "text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)]"
                }`}
                title="Flip horizontal"
              >
                <svg width="14" height="14" viewBox="0 0 14 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0">
                  <path d="M1.5 12.5H5.5V3.5L1.5 12.5Z" strokeLinejoin="round"></path>
                  <path d="M12.5 12.5H8.5V3.5L12.5 12.5Z" strokeLinejoin="round"></path>
                </svg>
              </button>

              {/* Flip Vertical */}
              <button
                type="button"
                onClick={handleFlipV}
                className={`flex h-full w-6 items-center justify-center rounded-[var(--radius-sm)] transition-colors cursor-pointer shrink-0 ${
                  style.transform?.includes("scaleY(-1)")
                    ? "bg-[var(--surface-hover)] text-[var(--accent)] font-semibold"
                    : "text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)]"
                }`}
                title="Flip vertical"
              >
                <svg width="14" height="14" viewBox="0 0 14 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 rotate-90">
                  <path d="M1.5 12.5H5.5V3.5L1.5 12.5Z" strokeLinejoin="round"></path>
                  <path d="M12.5 12.5H8.5V3.5L12.5 12.5Z" strokeLinejoin="round"></path>
                </svg>
              </button>
            </div>
          </div>

          {/* ------------------------------------------------ Constraints (when layer is Absolute position) */}
          {Boolean(node?.position?.absolute && node?.parentId) && (() => {
            const currentH = node?.constraints?.horizontal ?? "start";
            const currentV = node?.constraints?.vertical ?? "start";
            const hLabel = HORIZONTAL_CONSTRAINTS.find((c) => c.value === currentH)?.label ?? "Left";
            const vLabel = VERTICAL_CONSTRAINTS.find((c) => c.value === currentV)?.label ?? "Top";

            return (
              <div className="grid grid-cols-[1fr_auto] gap-x-2 py-1 items-stretch">
                {/* Left Column: Horizontal & Vertical Dropdown controls */}
                <div className="flex flex-col gap-1.5 justify-between">
                  {/* Horizontal constraint dropdown */}
                  <div className="relative">
                    <div
                      onClick={() => {
                        setHConstraintMenuOpen(!hConstraintMenuOpen);
                        setVConstraintMenuOpen(false);
                      }}
                      className="flex h-[var(--row-field-h)] w-full items-center justify-between rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors group cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[var(--text-2)] group-hover:text-[var(--text-1)] shrink-0 flex items-center">
                          {/* Exact horizontal constraint icon |-| */}
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <line x1="2.5" y1="3" x2="2.5" y2="13" strokeLinecap="round" />
                            <line x1="2.5" y1="8" x2="13.5" y2="8" />
                            <line x1="13.5" y1="3" x2="13.5" y2="13" strokeLinecap="round" />
                          </svg>
                        </span>
                        <span className="text-xs font-medium text-[var(--text-1)] truncate">
                          {hLabel}
                        </span>
                      </div>
                      <div className="p-0.5 text-[var(--text-2)] group-hover:text-[var(--text-1)] shrink-0">
                        <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="currentColor">
                          <path d="M0.75 1.5L4 4.75L7.25 1.5" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"></path>
                        </svg>
                      </div>
                    </div>

                    {hConstraintMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setHConstraintMenuOpen(false)} />
                        <div className="absolute left-0 top-full mt-1 z-50 w-36 rounded-xl border border-[var(--line)] bg-[var(--surface-content)] p-1 shadow-xl text-xs text-[var(--text-1)] animate-in fade-in zoom-in-95 duration-100">
                          {HORIZONTAL_CONSTRAINTS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => {
                                patchNode(node.id, {
                                  constraints: {
                                    ...(node?.constraints || {}),
                                    horizontal: opt.value,
                                  },
                                });
                                setHConstraintMenuOpen(false);
                              }}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                                currentH === opt.value
                                  ? "bg-[var(--surface-hover)] font-semibold text-[var(--text-1)]"
                                  : "text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)]"
                              }`}
                            >
                              <span>{opt.label}</span>
                              {currentH === opt.value && <Check size={12} className="text-[var(--accent)]" />}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Vertical constraint dropdown */}
                  <div className="relative">
                    <div
                      onClick={() => {
                        setVConstraintMenuOpen(!vConstraintMenuOpen);
                        setHConstraintMenuOpen(false);
                      }}
                      className="flex h-[var(--row-field-h)] w-full items-center justify-between rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors group cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[var(--text-2)] group-hover:text-[var(--text-1)] shrink-0 flex items-center">
                          {/* Exact vertical constraint icon _|_ */}
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <line x1="3" y1="2.5" x2="13" y2="2.5" strokeLinecap="round" />
                            <line x1="8" y1="2.5" x2="8" y2="13.5" />
                            <line x1="3" y1="13.5" x2="13" y2="13.5" strokeLinecap="round" />
                          </svg>
                        </span>
                        <span className="text-xs font-medium text-[var(--text-1)] truncate">
                          {vLabel}
                        </span>
                      </div>
                      <div className="p-0.5 text-[var(--text-2)] group-hover:text-[var(--text-1)] shrink-0">
                        <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="currentColor">
                          <path d="M0.75 1.5L4 4.75L7.25 1.5" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"></path>
                        </svg>
                      </div>
                    </div>

                    {vConstraintMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setVConstraintMenuOpen(false)} />
                        <div className="absolute left-0 top-full mt-1 z-50 w-36 rounded-xl border border-[var(--line)] bg-[var(--surface-content)] p-1 shadow-xl text-xs text-[var(--text-1)] animate-in fade-in zoom-in-95 duration-100">
                          {VERTICAL_CONSTRAINTS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => {
                                patchNode(node.id, {
                                  constraints: {
                                    ...(node?.constraints || {}),
                                    vertical: opt.value,
                                  },
                                });
                                setVConstraintMenuOpen(false);
                              }}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                                currentV === opt.value
                                  ? "bg-[var(--surface-hover)] font-semibold text-[var(--text-1)]"
                                  : "text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)]"
                              }`}
                            >
                              <span>{opt.label}</span>
                              {currentV === opt.value && <Check size={12} className="text-[var(--accent)]" />}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Right Column: 3x3 Constraint Box diagram widget */}
                <div
                  className="w-[80px] h-[64px] rounded-[6px] border border-[var(--line)] bg-[var(--surface-content)] relative grid grid-cols-3 grid-rows-3 select-none overflow-hidden p-0.5"
                  title="Constraints diagram"
                >
                  {/* Subtle inner dashed rect */}
                  <div className="absolute inset-[13px] border border-dashed border-[var(--line)] rounded-[3px] pointer-events-none opacity-40" />

                  {/* (0,0) */}
                  <div />

                  {/* (0,1) Top Pin */}
                  <button
                    type="button"
                    onClick={() => {
                      const isTop = currentV === "start";
                      const nextV = isTop ? "end" : "start";
                      patchNode(node.id, {
                        constraints: { ...(node?.constraints || {}), vertical: nextV },
                      });
                    }}
                    className="flex items-center justify-center size-full group cursor-pointer z-10"
                    title="Constrain Top"
                  >
                    <div
                      className={`rounded-full transition-all ${
                        currentV === "start" || currentV === "stretch"
                          ? "w-[2px] h-3.5 bg-[#0D99FF] shadow-xs"
                          : "w-[1.5px] h-2.5 bg-[var(--text-2)]/30 group-hover:bg-[var(--text-2)]/70"
                      }`}
                    />
                  </button>

                  {/* (0,2) */}
                  <div />

                  {/* (1,0) Left Pin */}
                  <button
                    type="button"
                    onClick={() => {
                      const isLeft = currentH === "start";
                      const nextH = isLeft ? "end" : "start";
                      patchNode(node.id, {
                        constraints: { ...(node?.constraints || {}), horizontal: nextH },
                      });
                    }}
                    className="flex items-center justify-center size-full group cursor-pointer z-10"
                    title="Constrain Left"
                  >
                    <div
                      className={`rounded-full transition-all ${
                        currentH === "start" || currentH === "stretch"
                          ? "h-[2px] w-3.5 bg-[#0D99FF] shadow-xs"
                          : "h-[1.5px] w-2.5 bg-[var(--text-2)]/30 group-hover:bg-[var(--text-2)]/70"
                      }`}
                    />
                  </button>

                  {/* (1,1) Center cross (+) */}
                  <button
                    type="button"
                    onClick={() => {
                      const isCenter = currentH === "center" && currentV === "center";
                      patchNode(node.id, {
                        constraints: {
                          horizontal: isCenter ? "start" : "center",
                          vertical: isCenter ? "start" : "center",
                        },
                      });
                    }}
                    className="flex items-center justify-center size-full group cursor-pointer z-10"
                    title="Constrain Center"
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 11 11"
                      fill="none"
                      stroke="currentColor"
                      className={`transition-colors ${
                        currentH === "center" && currentV === "center"
                          ? "text-[#0D99FF] stroke-[1.8]"
                          : "text-[var(--text-2)]/40 group-hover:text-[var(--text-2)]/80 stroke-[1.2]"
                      }`}
                    >
                      <path d="M5.5 0V5.5M5.5 11V5.5M5.5 5.5H11M5.5 5.5H0"></path>
                    </svg>
                  </button>

                  {/* (1,2) Right Pin */}
                  <button
                    type="button"
                    onClick={() => {
                      const isRight = currentH === "end";
                      const nextH = isRight ? "start" : "end";
                      patchNode(node.id, {
                        constraints: { ...(node?.constraints || {}), horizontal: nextH },
                      });
                    }}
                    className="flex items-center justify-center size-full group cursor-pointer z-10"
                    title="Constrain Right"
                  >
                    <div
                      className={`rounded-full transition-all ${
                        currentH === "end" || currentH === "stretch"
                          ? "h-[2px] w-3.5 bg-[#0D99FF] shadow-xs"
                          : "h-[1.5px] w-2.5 bg-[var(--text-2)]/30 group-hover:bg-[var(--text-2)]/70"
                      }`}
                    />
                  </button>

                  {/* (2,0) */}
                  <div />

                  {/* (2,1) Bottom Pin */}
                  <button
                    type="button"
                    onClick={() => {
                      const isBottom = currentV === "end";
                      const nextV = isBottom ? "start" : "end";
                      patchNode(node.id, {
                        constraints: { ...(node?.constraints || {}), vertical: nextV },
                      });
                    }}
                    className="flex items-center justify-center size-full group cursor-pointer z-10"
                    title="Constrain Bottom"
                  >
                    <div
                      className={`rounded-full transition-all ${
                        currentV === "end" || currentV === "stretch"
                          ? "w-[2px] h-3.5 bg-[#0D99FF] shadow-xs"
                          : "w-[1.5px] h-2.5 bg-[var(--text-2)]/30 group-hover:bg-[var(--text-2)]/70"
                      }`}
                    />
                  </button>

                  {/* (2,2) */}
                  <div />
                </div>
              </div>
            );
          })()}

          {/* ------------------------------------------------ State 1: Frame or Element without layout */}
          {canAddLayout && (
            <div className="mt-1 flex items-center gap-1.5 w-full">
              <button
                type="button"
                onClick={() => addFlex?.(node.id)}
                className="flex-1 flex h-[var(--row-field-h)] items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] hover:bg-[var(--surface-hover)] text-xs font-medium text-[var(--text-1)] transition-colors shadow-2xs cursor-pointer"
                title="Add Auto-layout / Flexbox (Shift + A)"
              >
                <span>Add flex</span>
                <span className="text-[10px] text-[var(--text-3)] font-sans">
                  Shift+A
                </span>
              </button>
              <button
                type="button"
                onClick={() => addGrid?.(node.id)}
                className="flex-1 flex h-[var(--row-field-h)] items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] hover:bg-[var(--surface-hover)] text-xs font-medium text-[var(--text-1)] transition-colors shadow-2xs cursor-pointer"
                title="Add CSS Grid layout"
              >
                <span>Add grid</span>
              </button>
            </div>
          )}

          {/* ------------------------------------------------ State 2 & 3: Layer WITH flex (Images 2 & 3) */}
          {isFlex && (
            <div className="flex flex-col gap-2 mt-1">
              {/* Flex Section Header with exact minus icon from Base-UI */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--text-1)]">
                  Flex
                </span>
                <button
                  type="button"
                  onClick={() => removeFlex?.(node.id)}
                  className="flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--surface-hover)] text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors cursor-pointer"
                  title="Remove flex"
                >
                  <svg width="10" height="2" viewBox="0 0 10 2" fill="none" stroke="currentColor">
                    <path d="M10 1H0" strokeWidth="1.5" vectorEffect="non-scaling-stroke"></path>
                  </svg>
                </button>
              </div>

              {/* 3x3 Matrix + Direction / Wrap / Gap / Sliders */}
              <div className="flex items-stretch gap-1.5">
                {/* 3x3 Alignment Matrix Card with 2-bar active state and space-between pills */}
                {(() => {
                  const isSpaceBetween = layout.alignMain === "space-between";
                  const crossIdx = posNames.indexOf(layout.alignCross ?? "start");
                  const activeCrossIndex = crossIdx >= 0 ? crossIdx : 0;

                  return (
                    <div
                      onMouseLeave={() => setHoveredCrossIndex(null)}
                      className="w-[96px] shrink-0 self-stretch rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] p-1.5 relative select-none overflow-hidden"
                    >
                      {/* Space-between active & hover pill backgrounds mapped directly to the 3x3 grid */}
                      {isSpaceBetween && (
                        <div className="absolute inset-1.5 grid grid-cols-3 grid-rows-3 pointer-events-none z-0">
                          {/* Active Cross-Axis Pill */}
                          <div
                            className="rounded-[5px] bg-[#0D99FF]/12 dark:bg-[#0D99FF]/25 border border-[#0D99FF]/30 transition-all duration-150"
                            style={
                              isColumn
                                ? {
                                    gridColumnStart: activeCrossIndex + 1,
                                    gridColumnEnd: activeCrossIndex + 2,
                                    gridRow: "1 / span 3",
                                  }
                                : {
                                    gridRowStart: activeCrossIndex + 1,
                                    gridRowEnd: activeCrossIndex + 2,
                                    gridColumn: "1 / span 3",
                                  }
                            }
                          />

                          {/* Hover Cross-Axis Preview Pill */}
                          {hoveredCrossIndex !== null &&
                            hoveredCrossIndex !== activeCrossIndex && (
                              <div
                                className="rounded-[5px] bg-[var(--surface-hover)] dark:bg-white/10 transition-all duration-150"
                                style={
                                  isColumn
                                    ? {
                                        gridColumnStart: hoveredCrossIndex + 1,
                                        gridColumnEnd: hoveredCrossIndex + 2,
                                        gridRow: "1 / span 3",
                                      }
                                    : {
                                        gridRowStart: hoveredCrossIndex + 1,
                                        gridRowEnd: hoveredCrossIndex + 2,
                                        gridColumn: "1 / span 3",
                                      }
                                }
                              />
                            )}
                        </div>
                      )}

                      {/* 3x3 Interactive Buttons Grid */}
                      <div className="relative z-10 w-full h-full grid grid-cols-3 grid-rows-3 items-center justify-items-center">
                        {[0, 1, 2].map((r) =>
                          [0, 1, 2].map((c) => {
                            const active = isDotActive(r, c);
                            const crossIndex = isColumn ? c : r;
                            const isCrossActive = crossIndex === activeCrossIndex;
                            const isCrossHovered =
                              isSpaceBetween &&
                              hoveredCrossIndex === crossIndex &&
                              !isCrossActive;

                            return (
                              <button
                                key={`${r}-${c}`}
                                type="button"
                                onClick={() => handleDotClick(r, c)}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  handleDotDoubleClick(r, c);
                                }}
                                onMouseEnter={() => {
                                  if (isSpaceBetween) setHoveredCrossIndex(crossIndex);
                                }}
                                className="w-6 h-6 flex items-center justify-center group focus:outline-none cursor-pointer relative"
                                title={
                                  isSpaceBetween
                                    ? `Space between (${isColumn ? (c === 0 ? "Left" : c === 1 ? "Center" : "Right") : (r === 0 ? "Top" : r === 1 ? "Center" : "Bottom")}) - click to change alignment, double-click for packed`
                                    : `Align row ${r + 1}, col ${c + 1} - double-click for space-between`
                                }
                              >
                                {isSpaceBetween ? (
                                  isCrossActive ? (
                                    /* Active Space-between centered dash */
                                    <span
                                      className={`rounded-full bg-[#0D99FF] ${
                                        isColumn ? "w-3 h-[2px]" : "h-3 w-[2px]"
                                      }`}
                                    />
                                  ) : isCrossHovered ? (
                                    /* Hovered Space-between centered dash */
                                    <span
                                      className={`rounded-full bg-[var(--text-2)] opacity-70 ${
                                        isColumn ? "w-3 h-[2px]" : "h-3 w-[2px]"
                                      }`}
                                    />
                                  ) : (
                                    /* Inactive dot in space-between mode */
                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-2)] opacity-35 group-hover:opacity-80 transition-all" />
                                  )
                                ) : active ? (
                                  /* Packed Active alignment: Professional square box with perfectly centered dash */
                                  <div className="w-5 h-5 rounded-[4px] bg-[#0D99FF]/15 border border-[#0D99FF]/40 shadow-xs flex items-center justify-center">
                                    <span
                                      className={`rounded-full bg-[#0D99FF] ${
                                        isColumn ? "w-2.5 h-[2px]" : "h-2.5 w-[2px]"
                                      }`}
                                    />
                                  </div>
                                ) : (
                                  /* Inactive dot in packed mode */
                                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-2)] opacity-35 group-hover:opacity-80 group-hover:scale-125 transition-all" />
                                )}
                              </button>
                            );
                          }),
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Right side controls (Direction + Wrap, Gap 1 + Sliders, Gap 2 if wrapped) */}
                <div className="flex-1 flex flex-col gap-1.5">
                  {/* Row 1: Direction [↓][→] and Wrap [⮡] */}
                  <div className="flex items-center gap-1.5">
                    {/* Direction Segmented Pill with exact Base-UI arrows */}
                    <div className="flex-1 flex h-[var(--row-field-h)] rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] p-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          patchNodeLayout(node.id, { direction: "column" })
                        }
                        className={`flex-1 flex items-center justify-center rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
                          isColumn
                            ? "bg-[var(--surface-hover)] text-[var(--text-1)] shadow-2xs font-semibold"
                            : "text-[var(--text-2)] hover:text-[var(--text-1)]"
                        }`}
                        title="Vertical (Column)"
                      >
                        <svg width="10" height="10" viewBox="0 0 9 9" fill="none" className="rotate-90">
                          <path d="M0.5 4.49971H8.4M8.4 4.49971L5.3 1.16895M8.4 4.49971L5.3 7.83048" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"></path>
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          patchNodeLayout(node.id, { direction: "row" })
                        }
                        className={`flex-1 flex items-center justify-center rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
                          !isColumn
                            ? "bg-[var(--surface-hover)] text-[var(--text-1)] shadow-2xs font-semibold"
                            : "text-[var(--text-2)] hover:text-[var(--text-1)]"
                        }`}
                        title="Horizontal (Row)"
                      >
                        <svg width="10" height="10" viewBox="0 0 9 9" fill="none">
                          <path d="M0.5 4.49971H8.4M8.4 4.49971L5.3 1.16895M8.4 4.49971L5.3 7.83048" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"></path>
                        </svg>
                      </button>
                    </div>

                    {/* Wrap Button with exact Base-UI icon */}
                    <button
                      type="button"
                      onClick={() =>
                        patchNodeLayout(node.id, { wrap: !layout.wrap })
                      }
                      className={`w-[var(--row-field-h)] h-[var(--row-field-h)] flex items-center justify-center rounded-[var(--radius-md)] border transition-colors shrink-0 cursor-pointer ${
                        layout.wrap
                          ? "border-[var(--accent)] bg-[var(--surface-hover)] text-[var(--accent)]"
                          : "border-[var(--line)] bg-[var(--surface-content)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)]"
                      }`}
                      title={layout.wrap ? "Wrap enabled" : "Wrap disabled"}
                    >
                      <svg width="13" height="11" viewBox="0 0 13 11" fill="none" stroke="currentColor">
                        <path d="M4.5 10.5L1.5 7.5003L4.5 4.5M1.5 7.5003L8 7.5003" strokeLinecap="round" strokeLinejoin="round"></path>
                        <path d="M8 7.5C9.933 7.5 11.5 5.933 11.5 4C11.5 2.067 9.933 0.5 8 0.5"></path>
                        <path d="M5 0.5H8"></path>
                      </svg>
                    </button>
                  </div>

                  {/* Row 2: Gap [☰ gap ˅] and Sliders [⫶⫶] */}
                  <div className="flex items-center gap-1.5">
                    {/* Gap Input */}
                    <div className="flex-1 flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors relative" data-gap-menu>
                      <span
                        onMouseDown={(e) => handleGapIconScrub(e, "gap")}
                        className="cursor-ew-resize text-[var(--text-2)] hover:text-[var(--text-1)] shrink-0 mr-1.5 flex items-center select-none"
                        title="Click and drag horizontally to scrub gap"
                      >
                        {isColumn ? (
                          /* Column mode: row gap icon */
                          <svg width="13" height="12" viewBox="0 0 13 12" fill="none" stroke="currentColor">
                            <rect x="1.5" y="0.5" width="10" height="3" rx="0.5"></rect>
                            <rect x="1.5" y="8.5" width="10" height="3" rx="0.5"></rect>
                            <line x1="0" y1="6" x2="13" y2="6"></line>
                          </svg>
                        ) : (
                          /* Row mode: col gap icon */
                          <svg width="13" height="12" viewBox="0 0 13 12" fill="none" stroke="currentColor">
                            <rect x="0.5" y="1.5" width="3" height="9" rx="0.5"></rect>
                            <rect x="9.5" y="1.5" width="3" height="9" rx="0.5"></rect>
                            <line x1="6.5" y1="0" x2="6.5" y2="12"></line>
                          </svg>
                        )}
                      </span>
                      <ScrubbableNumberInput
                        value={
                          typeof layout.gap === "number"
                            ? layout.gap
                            : resolveNumeric(layout.gap, tokens)
                        }
                        min={0}
                        onCommit={(v) => patchNodeLayout(node.id, { gap: v })}
                        inputClassName="w-full text-left text-xs font-medium text-[var(--text-1)] bg-transparent outline-none cursor-text"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setGapMenuOpen(!gapMenuOpen);
                          setCrossGapMenuOpen(false);
                        }}
                        className="text-[var(--text-2)] hover:text-[var(--text-1)] ml-1 shrink-0 p-0.5 rounded cursor-pointer flex items-center"
                        title="Gap options"
                      >
                        <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="currentColor">
                          <path d="M0.75 1.5L4 4.75L7.25 1.5" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"></path>
                        </svg>
                      </button>

                      {/* Gap Dropdown Menu */}
                      {gapMenuOpen && (
                        <div
                          onMouseDown={(e) => e.preventDefault()}
                          className="absolute right-0 top-full mt-1.5 w-36 rounded-lg border border-[var(--line)] bg-[var(--surface-content)] shadow-lg py-1 z-50 text-xs animate-in fade-in duration-100"
                        >
                          <div className="px-3 py-1 text-[10px] font-semibold text-[var(--text-2)] uppercase tracking-wider">
                            {isColumn ? "Row gap" : "Column gap"}
                          </div>
                          {spacingTokens.length > 0 ? (
                            spacingTokens.map((tok) => (
                              <button
                                key={tok.id || tok.name}
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  patchNodeLayout(node.id, { gap: tok.value ?? tok.name });
                                  setGapMenuOpen(false);
                                }}
                                className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-hover)] text-[var(--text-1)] flex items-center justify-between cursor-pointer"
                              >
                                <span className="font-mono text-xs">{tok.name}</span>
                                <span className="text-[11px] text-[var(--text-2)]">{tok.value}px</span>
                              </button>
                            ))
                          ) : (
                            [0, 4, 8, 12, 16, 24, 32, 48, 64].map((v) => (
                              <button
                                key={v}
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  patchNodeLayout(node.id, { gap: v });
                                  setGapMenuOpen(false);
                                }}
                                className="w-full text-left px-3 py-1 hover:bg-[var(--surface-hover)] text-[var(--text-1)] flex items-center justify-between cursor-pointer"
                              >
                                <span>{v}px</span>
                                {Number(layout.gap) === v && <Check className="w-3.5 h-3.5 text-[var(--accent)]" />}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>

                    {/* Sliders / Advanced settings button with exact Base-UI icon */}
                    <div className="relative" data-flex-advanced>
                      <button
                        type="button"
                        onClick={() => setShowFlexAdvanced(!showFlexAdvanced)}
                        className={`w-[var(--row-field-h)] h-[var(--row-field-h)] flex items-center justify-center rounded-[var(--radius-md)] border transition-colors shrink-0 cursor-pointer ${
                          showFlexAdvanced
                            ? "border-[var(--accent)] bg-[var(--surface-hover)] text-[var(--accent)]"
                            : "border-[var(--line)] bg-[var(--surface-content)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)]"
                        }`}
                        title="Advanced layout options"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                          <path d="M3 9.5H2V12H3V9.5Z"></path>
                          <path d="M10 6.5H9V12H10V6.5Z"></path>
                          <path d="M10 0H9V2.5H10V0Z"></path>
                          <path d="M3 0H2V5.5H3V0Z"></path>
                          <path fill="none" stroke="currentColor" d="M2.4998 9.5001C3.60427 9.5001 4.49961 8.60475 4.49961 7.50029C4.49961 6.39583 3.60427 5.50049 2.4998 5.50049C1.39534 5.50049 0.5 6.39583 0.5 7.50029C0.5 8.60475 1.39534 9.5001 2.4998 9.5001Z"></path>
                          <path fill="none" stroke="currentColor" d="M9.49971 6.4999C10.6041 6.4999 11.4994 5.6046 11.4994 4.5002C11.4994 3.39579 10.6041 2.50049 9.49971 2.50049C8.3953 2.50049 7.5 3.39579 7.5 4.5002C7.5 5.6046 8.3953 6.4999 9.49971 6.4999Z"></path>
                        </svg>
                      </button>

                      {/* Advanced Flex Options Popup matching Image 1 */}
                      {showFlexAdvanced && (
                        <div className="absolute right-0 top-full mt-1.5 w-44 rounded-xl border border-[var(--line)] bg-[var(--surface-content)] shadow-xl py-1.5 z-50 text-xs animate-in fade-in duration-100 select-none">
                          <button
                            type="button"
                            onClick={() => {
                              patchNodeLayout(node.id, {
                                alignMain: layout.alignMain === "space-between" ? "start" : "space-between",
                              });
                              setShowFlexAdvanced(false);
                            }}
                            className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-hover)] text-[var(--text-1)] flex items-center justify-between cursor-pointer"
                          >
                            <span>Space between</span>
                            {layout.alignMain === "space-between" && (
                              <Check className="w-3.5 h-3.5 text-[var(--accent)]" />
                            )}
                          </button>

                          <div className="px-3 pb-1 text-[11px] text-[var(--text-2)] select-none">
                            {isColumn ? "Vertically" : "Horizontally"}
                          </div>

                          <div className="my-1 border-t border-[var(--line)]" />

                          <div className="px-3 py-1 text-xs text-[var(--text-2)] select-none">
                            Align to baseline
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              patchNodeLayout(node.id, {
                                alignCross: layout.alignCross === "first baseline" ? "start" : "first baseline",
                              });
                              setShowFlexAdvanced(false);
                            }}
                            className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-hover)] text-[var(--text-1)] flex items-center justify-between cursor-pointer"
                          >
                            <span>First baseline</span>
                            {layout.alignCross === "first baseline" && (
                              <Check className="w-3.5 h-3.5 text-[var(--accent)]" />
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              patchNodeLayout(node.id, {
                                alignCross: layout.alignCross === "last baseline" ? "start" : "last baseline",
                              });
                              setShowFlexAdvanced(false);
                            }}
                            className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-hover)] text-[var(--text-1)] flex items-center justify-between cursor-pointer"
                          >
                            <span>Last baseline</span>
                            {layout.alignCross === "last baseline" && (
                              <Check className="w-3.5 h-3.5 text-[var(--accent)]" />
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Row 3: Cross Gap [밈 crossGap ˅] (Predefined slot: empty space when wrap is inactive, input appears when wrap is active) */}
                  <div className="flex items-center gap-1.5 h-[var(--row-field-h)]">
                    {layout.wrap ? (
                      <>
                        <div className="flex-1 flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors relative" data-gap-menu>
                          <span
                            onMouseDown={(e) => handleGapIconScrub(e, "crossGap")}
                            className="cursor-ew-resize text-[var(--text-2)] hover:text-[var(--text-1)] shrink-0 mr-1.5 flex items-center select-none"
                            title="Click and drag horizontally to scrub cross gap"
                          >
                            {isColumn ? (
                              /* Column mode: cross gap is col gap icon */
                              <svg width="13" height="12" viewBox="0 0 13 12" fill="none" stroke="currentColor">
                                <rect x="0.5" y="1.5" width="3" height="9" rx="0.5"></rect>
                                <rect x="9.5" y="1.5" width="3" height="9" rx="0.5"></rect>
                                <line x1="6.5" y1="0" x2="6.5" y2="12"></line>
                              </svg>
                            ) : (
                              /* Row mode: cross gap is row gap icon */
                              <svg width="13" height="12" viewBox="0 0 13 12" fill="none" stroke="currentColor">
                                <rect x="1.5" y="0.5" width="10" height="3" rx="0.5"></rect>
                                <rect x="1.5" y="8.5" width="10" height="3" rx="0.5"></rect>
                                <line x1="0" y1="6" x2="13" y2="6"></line>
                              </svg>
                            )}
                          </span>
                          <ScrubbableNumberInput
                            value={
                              layout.crossGap != null
                                ? (typeof layout.crossGap === "number"
                                    ? layout.crossGap
                                    : resolveNumeric(layout.crossGap, tokens))
                                : (typeof layout.gap === "number"
                                    ? layout.gap
                                    : (resolveNumeric(layout.gap, tokens) ?? 0))
                            }
                            min={0}
                            onCommit={(v) => patchNodeLayout(node.id, { crossGap: v })}
                            inputClassName="w-full text-left text-xs font-medium text-[var(--text-1)] bg-transparent outline-none cursor-text"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setCrossGapMenuOpen(!crossGapMenuOpen);
                              setGapMenuOpen(false);
                            }}
                            className="text-[var(--text-2)] hover:text-[var(--text-1)] ml-1 shrink-0 p-0.5 rounded cursor-pointer flex items-center"
                            title="Cross gap options"
                          >
                            <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="currentColor">
                              <path d="M0.75 1.5L4 4.75L7.25 1.5" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"></path>
                            </svg>
                          </button>

                          {/* Cross Gap Dropdown Menu */}
                          {crossGapMenuOpen && (
                            <div
                              onMouseDown={(e) => e.preventDefault()}
                              className="absolute right-0 top-full mt-1.5 w-36 rounded-lg border border-[var(--line)] bg-[var(--surface-content)] shadow-lg py-1 z-50 text-xs animate-in fade-in duration-100"
                            >
                              <div className="px-3 py-1 text-[10px] font-semibold text-[var(--text-2)] uppercase tracking-wider">
                                Cross gap ({isColumn ? "Column" : "Row"})
                              </div>
                              {spacingTokens.length > 0 ? (
                                spacingTokens.map((tok) => (
                                  <button
                                    key={tok.id || tok.name}
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                      patchNodeLayout(node.id, { crossGap: tok.value ?? tok.name });
                                      setCrossGapMenuOpen(false);
                                    }}
                                    className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-hover)] text-[var(--text-1)] flex items-center justify-between cursor-pointer"
                                  >
                                    <span className="font-mono text-xs">{tok.name}</span>
                                    <span className="text-[11px] text-[var(--text-2)]">{tok.value}px</span>
                                  </button>
                                ))
                              ) : (
                                [0, 4, 8, 12, 16, 24, 32, 48, 64].map((v) => (
                                  <button
                                    key={v}
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                      patchNodeLayout(node.id, { crossGap: v });
                                      setCrossGapMenuOpen(false);
                                    }}
                                    className="w-full text-left px-3 py-1 hover:bg-[var(--surface-hover)] text-[var(--text-1)] flex items-center justify-between cursor-pointer"
                                  >
                                    <span>{v}px</span>
                                    {Number(layout.crossGap) === v && <Check className="w-3.5 h-3.5 text-[var(--accent)]" />}
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                        {/* Spacer to align width with Row 2 */}
                        <div className="w-[var(--row-field-h)] shrink-0" />
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ------------------------------------------------ State 4: Layer WITH Grid */}
          {isGrid && (
            <GridContainerControls
              node={node}
              tokens={tokens}
              patchNodeLayout={patchNodeLayout}
              removeGrid={removeGrid}
            />
          )}

          {/* ------------------------------------------------ State 5: Child inside Grid */}
          {inFlowGridChild && (
            <GridItemControls
              node={node}
              patchNode={patchNode}
            />
          )}
          <div className="flex flex-col gap-1.5 mt-2 pt-2 border-t border-[var(--line)]/60">
            <div className="flex items-center justify-between text-[11px] font-medium text-[var(--text-2)] px-0.5">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#0D99FF]" />
                <span>Padding</span>
              </span>
              <span className="text-[10px] text-[#0D99FF] font-mono">
                {individualPadding ? `${padLeft} ${padTop} ${padRight} ${padBottom}` : `${padLeft}h ${padTop}v`}
              </span>
            </div>
            {/* Row 1: Horizontal / Left [|], Vertical / Top [-], Mode button [⊡] */}
            <div className="flex items-center gap-1.5">
              {/* Left / Horizontal Padding */}
                  <div
                    className="flex-1 min-w-0 flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors relative"
                    data-padding-menu
                  >
                    <span
                      onMouseDown={(e) => handlePaddingIconScrub(e, individualPadding ? "l" : "h")}
                      className="cursor-ew-resize text-[var(--text-2)] hover:text-[var(--text-1)] shrink-0 mr-1.5 flex items-center select-none"
                      title={individualPadding ? "Left padding (drag to scrub)" : "Horizontal padding (drag to scrub)"}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor">
                        <rect x="0.5" y="0.5" width="11" height="11" rx="1.5"></rect>
                        {individualPadding ? (
                          <line x1="3.5" y1="3" x2="3.5" y2="9" strokeWidth="1.8"></line>
                        ) : (
                          <>
                            <line x1="3.5" y1="3" x2="3.5" y2="9"></line>
                            <line x1="8.5" y1="3" x2="8.5" y2="9"></line>
                          </>
                        )}
                      </svg>
                    </span>
                    <ScrubbableNumberInput
                      value={individualPadding ? padLeft : (layout.padding?.h ?? padLeft)}
                      min={0}
                      onFocus={() => {
                        setPaddingMenuOpen(individualPadding ? "l" : "h");
                        setPaddingSearch("");
                      }}
                      onInputText={(raw) => {
                        setPaddingMenuOpen(individualPadding ? "l" : "h");
                        setPaddingSearch(raw);
                      }}
                      onCommit={(v) => {
                        patchPadding(individualPadding ? "l" : "h", v);
                      }}
                      inputClassName="w-full text-left text-xs font-medium text-[var(--text-1)] bg-transparent outline-none cursor-text"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setPaddingMenuOpen(paddingMenuOpen === (individualPadding ? "l" : "h") ? null : (individualPadding ? "l" : "h"))
                      }
                      className="text-[var(--text-2)] hover:text-[var(--text-1)] ml-1 shrink-0 p-0.5 rounded cursor-pointer flex items-center"
                      title={individualPadding ? "Left padding options" : "Horizontal padding options"}
                    >
                      <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="currentColor">
                        <path d="M0.75 1.5L4 4.75L7.25 1.5" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"></path>
                      </svg>
                    </button>
                    {renderPaddingDropdown(
                      individualPadding ? "l" : "h",
                      individualPadding ? "Left padding" : "Horizontal padding",
                      individualPadding ? padLeft : (layout.padding?.h ?? padLeft)
                    )}
                  </div>

                  {/* Top / Vertical Padding */}
                  <div
                    className="flex-1 min-w-0 flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors relative"
                    data-padding-menu
                  >
                    <span
                      onMouseDown={(e) => handlePaddingIconScrub(e, individualPadding ? "t" : "v")}
                      className="cursor-ew-resize text-[var(--text-2)] hover:text-[var(--text-1)] shrink-0 mr-1.5 flex items-center select-none"
                      title={individualPadding ? "Top padding (drag to scrub)" : "Vertical padding (drag to scrub)"}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor">
                        <rect x="0.5" y="0.5" width="11" height="11" rx="1.5"></rect>
                        {individualPadding ? (
                          <line x1="3" y1="3.5" x2="9" y2="3.5" strokeWidth="1.8"></line>
                        ) : (
                          <>
                            <line x1="3" y1="3.5" x2="9" y2="3.5"></line>
                            <line x1="3" y1="8.5" x2="9" y2="8.5"></line>
                          </>
                        )}
                      </svg>
                    </span>
                    <ScrubbableNumberInput
                      value={individualPadding ? padTop : (layout.padding?.v ?? padTop)}
                      min={0}
                      onFocus={() => {
                        setPaddingMenuOpen(individualPadding ? "t" : "v");
                        setPaddingSearch("");
                      }}
                      onInputText={(raw) => {
                        setPaddingMenuOpen(individualPadding ? "t" : "v");
                        setPaddingSearch(raw);
                      }}
                      onCommit={(v) => {
                        patchPadding(individualPadding ? "t" : "v", v);
                      }}
                      inputClassName="w-full text-left text-xs font-medium text-[var(--text-1)] bg-transparent outline-none cursor-text"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setPaddingMenuOpen(paddingMenuOpen === (individualPadding ? "t" : "v") ? null : (individualPadding ? "t" : "v"))
                      }
                      className="text-[var(--text-2)] hover:text-[var(--text-1)] ml-1 shrink-0 p-0.5 rounded cursor-pointer flex items-center"
                      title={individualPadding ? "Top padding options" : "Vertical padding options"}
                    >
                      <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="currentColor">
                        <path d="M0.75 1.5L4 4.75L7.25 1.5" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"></path>
                      </svg>
                    </button>
                    {renderPaddingDropdown(
                      individualPadding ? "t" : "v",
                      individualPadding ? "Top padding" : "Vertical padding",
                      individualPadding ? padTop : (layout.padding?.v ?? padTop)
                    )}
                  </div>

                  {/* Mode Button [⊡] with exact Base-UI SVG */}
                  <button
                    type="button"
                    onClick={toggleIndividualPadding}
                    className={`w-[var(--row-field-h)] h-[var(--row-field-h)] flex items-center justify-center rounded-[var(--radius-md)] border transition-colors shrink-0 cursor-pointer ${
                      individualPadding
                        ? "border-[var(--accent)] bg-[var(--surface-hover)] text-[var(--accent)]"
                        : "border-[var(--line)] bg-[var(--surface-content)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)]"
                    }`}
                    title={
                      individualPadding
                        ? "Switch to uniform padding"
                        : "Switch to 4-side padding"
                    }
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor">
                      <rect x="0.5" y="0.5" width="11" height="11" rx="1.5"></rect>
                      <g>
                        <path d="M2.5 4V8"></path>
                        <path d="M9.5 4V8"></path>
                        <path d="M4 2.5H8"></path>
                        <path d="M4 9.5H8"></path>
                      </g>
                    </svg>
                  </button>
                </div>

                {/* Row 2: Right [|] 0 ˅, Bottom [_] 0 ˅ (shown only in 4-side mode) */}
                {individualPadding && (
                  <div className="flex items-center gap-1.5">
                    {/* Right Padding */}
                    <div
                      className="flex-1 min-w-0 flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors relative"
                      data-padding-menu
                    >
                      <span
                        onMouseDown={(e) => handlePaddingIconScrub(e, "r")}
                        className="cursor-ew-resize text-[var(--text-2)] hover:text-[var(--text-1)] shrink-0 mr-1.5 flex items-center select-none"
                        title="Right padding (drag to scrub)"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor">
                          <rect x="0.5" y="0.5" width="11" height="11" rx="1.5"></rect>
                          <line x1="8.5" y1="3" x2="8.5" y2="9" strokeWidth="1.8"></line>
                        </svg>
                      </span>
                      <ScrubbableNumberInput
                        value={padRight}
                        min={0}
                        onFocus={() => {
                          setPaddingMenuOpen("r");
                          setPaddingSearch("");
                        }}
                        onInputText={(raw) => {
                          setPaddingMenuOpen("r");
                          setPaddingSearch(raw);
                        }}
                        onCommit={(v) => {
                          patchPadding("r", v);
                        }}
                        inputClassName="w-full text-left text-xs font-medium text-[var(--text-1)] bg-transparent outline-none cursor-text"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setPaddingMenuOpen(paddingMenuOpen === "r" ? null : "r")
                        }
                        className="text-[var(--text-2)] hover:text-[var(--text-1)] ml-1 shrink-0 p-0.5 rounded cursor-pointer flex items-center"
                        title="Right padding options"
                      >
                        <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="currentColor">
                          <path d="M0.75 1.5L4 4.75L7.25 1.5" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"></path>
                        </svg>
                      </button>
                      {renderPaddingDropdown("r", "Right padding", padRight)}
                    </div>

                    {/* Bottom Padding */}
                    <div
                      className="flex-1 min-w-0 flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[var(--text-2)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-colors relative"
                      data-padding-menu
                    >
                      <span
                        onMouseDown={(e) => handlePaddingIconScrub(e, "b")}
                        className="cursor-ew-resize text-[var(--text-2)] hover:text-[var(--text-1)] shrink-0 mr-1.5 flex items-center select-none"
                        title="Bottom padding (drag to scrub)"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor">
                          <rect x="0.5" y="0.5" width="11" height="11" rx="1.5"></rect>
                          <line x1="3" y1="8.5" x2="9" y2="8.5" strokeWidth="1.8"></line>
                        </svg>
                      </span>
                      <ScrubbableNumberInput
                        value={padBottom}
                        min={0}
                        onFocus={() => {
                          setPaddingMenuOpen("b");
                          setPaddingSearch("");
                        }}
                        onInputText={(raw) => {
                          setPaddingMenuOpen("b");
                          setPaddingSearch(raw);
                        }}
                        onCommit={(v) => {
                          patchPadding("b", v);
                        }}
                        inputClassName="w-full text-left text-xs font-medium text-[var(--text-1)] bg-transparent outline-none cursor-text"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setPaddingMenuOpen(paddingMenuOpen === "b" ? null : "b")
                        }
                        className="text-[var(--text-2)] hover:text-[var(--text-1)] ml-1 shrink-0 p-0.5 rounded cursor-pointer flex items-center"
                        title="Bottom padding options"
                      >
                        <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="currentColor">
                          <path d="M0.75 1.5L4 4.75L7.25 1.5" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"></path>
                        </svg>
                      </button>
                      {renderPaddingDropdown("b", "Bottom padding", padBottom)}
                    </div>
                    {/* Spacer to match row width */}
                    <div className="w-[var(--row-field-h)] shrink-0" />
                  </div>
                )}
              </div>

              {/* ------------------------------------------------ Margin Controls (soft amber/orange theme) */}
              <div className="flex flex-col gap-1.5 mt-2 pt-2 border-t border-[var(--line)]/60">
                <div className="flex items-center justify-between text-[11px] font-medium text-[var(--text-2)] px-0.5">
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#F97316]" />
                    <span>Margin</span>
                  </span>
                  <span className="text-[10px] text-[#F97316] font-mono">
                    {individualMargin ? `${marLeft} ${marTop} ${marRight} ${marBottom}` : `${marLeft}h ${marTop}v`}
                  </span>
                </div>
                {/* Row 1: Horizontal / Left, Vertical / Top, Mode button [⊡] */}
                <div className="flex items-center gap-1.5">
                  {/* Left / Horizontal Margin */}
                  <div
                    className="flex-1 min-w-0 flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[#F97316] focus-within:ring-1 focus-within:ring-[#F97316] transition-colors relative"
                    data-margin-menu
                  >
                    <span
                      onMouseDown={(e) => handleMarginIconScrub(e, individualMargin ? "l" : "h")}
                      className="cursor-ew-resize text-[#F97316] hover:text-[#EA580C] shrink-0 mr-1.5 flex items-center select-none"
                      title={individualMargin ? "Left margin (drag to scrub)" : "Horizontal margin (drag to scrub)"}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor">
                        <rect x="2.5" y="2.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 1.5" className="opacity-60" />
                        {individualMargin ? (
                          <line x1="1" y1="1.5" x2="1" y2="10.5" stroke="#F97316" strokeWidth="1.8" strokeLinecap="round" />
                        ) : (
                          <>
                            <line x1="1" y1="1.5" x2="1" y2="10.5" stroke="#F97316" strokeWidth="1.6" strokeLinecap="round" />
                            <line x1="11" y1="1.5" x2="11" y2="10.5" stroke="#F97316" strokeWidth="1.6" strokeLinecap="round" />
                          </>
                        )}
                      </svg>
                    </span>
                    <ScrubbableNumberInput
                      value={individualMargin ? marLeft : (nodeMar?.h ?? marLeft)}
                      min={0}
                      onFocus={() => {
                        setMarginMenuOpen(individualMargin ? "l" : "h");
                        setMarginSearch("");
                      }}
                      onInputText={(raw) => {
                        setMarginMenuOpen(individualMargin ? "l" : "h");
                        setMarginSearch(raw);
                      }}
                      onCommit={(v) => {
                        patchMargin(individualMargin ? "l" : "h", v);
                      }}
                      inputClassName="w-full text-left text-xs font-medium text-[var(--text-1)] bg-transparent outline-none cursor-text"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setMarginMenuOpen(marginMenuOpen === (individualMargin ? "l" : "h") ? null : (individualMargin ? "l" : "h"))
                      }
                      className="text-[var(--text-2)] hover:text-[#F97316] ml-1 shrink-0 p-0.5 rounded cursor-pointer flex items-center"
                      title={individualMargin ? "Left margin options" : "Horizontal margin options"}
                    >
                      <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="currentColor">
                        <path d="M0.75 1.5L4 4.75L7.25 1.5" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"></path>
                      </svg>
                    </button>
                    {renderMarginDropdown(
                      individualMargin ? "l" : "h",
                      individualMargin ? "Left margin" : "Horizontal margin",
                      individualMargin ? marLeft : (nodeMar?.h ?? marLeft)
                    )}
                  </div>

                  {/* Top / Vertical Margin */}
                  <div
                    className="flex-1 min-w-0 flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[#F97316] focus-within:ring-1 focus-within:ring-[#F97316] transition-colors relative"
                    data-margin-menu
                  >
                    <span
                      onMouseDown={(e) => handleMarginIconScrub(e, individualMargin ? "t" : "v")}
                      className="cursor-ew-resize text-[#F97316] hover:text-[#EA580C] shrink-0 mr-1.5 flex items-center select-none"
                      title={individualMargin ? "Top margin (drag to scrub)" : "Vertical margin (drag to scrub)"}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor">
                        <rect x="2.5" y="2.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 1.5" className="opacity-60" />
                        {individualMargin ? (
                          <line x1="1.5" y1="1" x2="10.5" y2="1" stroke="#F97316" strokeWidth="1.8" strokeLinecap="round" />
                        ) : (
                          <>
                            <line x1="1.5" y1="1" x2="10.5" y2="1" stroke="#F97316" strokeWidth="1.6" strokeLinecap="round" />
                            <line x1="1.5" y1="11" x2="10.5" y2="11" stroke="#F97316" strokeWidth="1.6" strokeLinecap="round" />
                          </>
                        )}
                      </svg>
                    </span>
                    <ScrubbableNumberInput
                      value={individualMargin ? marTop : (nodeMar?.v ?? marTop)}
                      min={0}
                      onFocus={() => {
                        setMarginMenuOpen(individualMargin ? "t" : "v");
                        setMarginSearch("");
                      }}
                      onInputText={(raw) => {
                        setMarginMenuOpen(individualMargin ? "t" : "v");
                        setMarginSearch(raw);
                      }}
                      onCommit={(v) => {
                        patchMargin(individualMargin ? "t" : "v", v);
                      }}
                      inputClassName="w-full text-left text-xs font-medium text-[var(--text-1)] bg-transparent outline-none cursor-text"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setMarginMenuOpen(marginMenuOpen === (individualMargin ? "t" : "v") ? null : (individualMargin ? "t" : "v"))
                      }
                      className="text-[var(--text-2)] hover:text-[#F97316] ml-1 shrink-0 p-0.5 rounded cursor-pointer flex items-center"
                      title={individualMargin ? "Top margin options" : "Vertical margin options"}
                    >
                      <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="currentColor">
                        <path d="M0.75 1.5L4 4.75L7.25 1.5" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"></path>
                      </svg>
                    </button>
                    {renderMarginDropdown(
                      individualMargin ? "t" : "v",
                      individualMargin ? "Top margin" : "Vertical margin",
                      individualMargin ? marTop : (nodeMar?.v ?? marTop)
                    )}
                  </div>

                  {/* Mode Button [⊡] toggle 2-sided vs 4-sided */}
                  <button
                    type="button"
                    onClick={toggleIndividualMargin}
                    className={`w-[var(--row-field-h)] h-[var(--row-field-h)] flex items-center justify-center rounded-[var(--radius-md)] border transition-colors shrink-0 cursor-pointer ${
                      individualMargin
                        ? "border-[#F97316] bg-[#F97316]/10 text-[#F97316]"
                        : "border-[var(--line)] bg-[var(--surface-content)] text-[var(--text-2)] hover:text-[#F97316] hover:bg-[var(--surface-hover)]"
                    }`}
                    title={individualMargin ? "Switch to uniform margin" : "Switch to 4-side margin"}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor">
                      <rect x="0.5" y="0.5" width="11" height="11" rx="1.5"></rect>
                      <g>
                        <path d="M2.5 4V8"></path>
                        <path d="M9.5 4V8"></path>
                        <path d="M4 2.5H8"></path>
                        <path d="M4 9.5H8"></path>
                      </g>
                    </svg>
                  </button>
                </div>

                {/* Row 2: Right, Bottom (shown only in 4-side mode) */}
                {individualMargin && (
                  <div className="flex items-center gap-1.5">
                    {/* Right Margin */}
                    <div
                      className="flex-1 min-w-0 flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[#F97316] focus-within:ring-1 focus-within:ring-[#F97316] transition-colors relative"
                      data-margin-menu
                    >
                      <span
                        onMouseDown={(e) => handleMarginIconScrub(e, "r")}
                        className="cursor-ew-resize text-[#F97316] hover:text-[#EA580C] shrink-0 mr-1.5 flex items-center select-none"
                        title="Right margin (drag to scrub)"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor">
                          <rect x="2.5" y="2.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 1.5" className="opacity-60" />
                          <line x1="11" y1="1.5" x2="11" y2="10.5" stroke="#F97316" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                      </span>
                      <ScrubbableNumberInput
                        value={marRight}
                        min={0}
                        onFocus={() => {
                          setMarginMenuOpen("r");
                          setMarginSearch("");
                        }}
                        onInputText={(raw) => {
                          setMarginMenuOpen("r");
                          setMarginSearch(raw);
                        }}
                        onCommit={(v) => {
                          patchMargin("r", v);
                        }}
                        inputClassName="w-full text-left text-xs font-medium text-[var(--text-1)] bg-transparent outline-none cursor-text"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setMarginMenuOpen(marginMenuOpen === "r" ? null : "r")
                        }
                        className="text-[var(--text-2)] hover:text-[#F97316] ml-1 shrink-0 p-0.5 rounded cursor-pointer flex items-center"
                        title="Right margin options"
                      >
                        <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="currentColor">
                          <path d="M0.75 1.5L4 4.75L7.25 1.5" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"></path>
                        </svg>
                      </button>
                      {renderMarginDropdown("r", "Right margin", marRight)}
                    </div>

                    {/* Bottom Margin */}
                    <div
                      className="flex-1 min-w-0 flex h-[var(--row-field-h)] items-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 hover:border-[#F97316] focus-within:ring-1 focus-within:ring-[#F97316] transition-colors relative"
                      data-margin-menu
                    >
                      <span
                        onMouseDown={(e) => handleMarginIconScrub(e, "b")}
                        className="cursor-ew-resize text-[#F97316] hover:text-[#EA580C] shrink-0 mr-1.5 flex items-center select-none"
                        title="Bottom margin (drag to scrub)"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor">
                          <rect x="2.5" y="2.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 1.5" className="opacity-60" />
                          <line x1="1.5" y1="11" x2="10.5" y2="11" stroke="#F97316" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                      </span>
                      <ScrubbableNumberInput
                        value={marBottom}
                        min={0}
                        onFocus={() => {
                          setMarginMenuOpen("b");
                          setMarginSearch("");
                        }}
                        onInputText={(raw) => {
                          setMarginMenuOpen("b");
                          setMarginSearch(raw);
                        }}
                        onCommit={(v) => {
                          patchMargin("b", v);
                        }}
                        inputClassName="w-full text-left text-xs font-medium text-[var(--text-1)] bg-transparent outline-none cursor-text"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setMarginMenuOpen(marginMenuOpen === "b" ? null : "b")
                        }
                        className="text-[var(--text-2)] hover:text-[#F97316] ml-1 shrink-0 p-0.5 rounded cursor-pointer flex items-center"
                        title="Bottom margin options"
                      >
                        <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="currentColor">
                          <path d="M0.75 1.5L4 4.75L7.25 1.5" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"></path>
                        </svg>
                      </button>
                      {renderMarginDropdown("b", "Bottom margin", marBottom)}
                    </div>
                    {/* Spacer to match row width */}
                    <div className="w-[var(--row-field-h)] shrink-0" />
                  </div>
                )}
              </div>

          {/* ------------------------------------------------ Checkboxes */}
          <div className="flex flex-col gap-1.5 mt-1 pt-1.5 border-t border-[var(--line)]">
            {/* Absolute position checkbox (available for every element / layer) */}
            <div
              onClick={handleToggleAbsolute}
              className="flex items-center gap-2 py-0.5 text-xs text-[var(--text-1)] cursor-pointer select-none group"
            >
              <span
                role="checkbox"
                aria-checked={Boolean(node?.position?.absolute)}
                tabIndex={0}
                className={`flex h-3.5 w-3.5 items-center justify-center rounded-[var(--radius-xs)] border transition-colors cursor-pointer ${
                  node?.position?.absolute
                    ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                    : "border-[var(--line)] bg-[var(--surface-content)] group-hover:border-[var(--text-2)]"
                }`}
              >
                {node?.position?.absolute && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1.75 5.75L4.51562 8.25L8.75 1.75"></path>
                  </svg>
                )}
              </span>
              <span className="group-hover:text-[var(--accent)] transition-colors">
                Absolute position
              </span>
            </div>

            {/* Clip content checkbox (shown for any frame or flex container, Images 1, 2, and 3) */}
            {(isFrame || isFlex || isGrid || (node?.childIds && node.childIds.length > 0)) && (
              <div
                onClick={() => {
                  const nextClip = !(node.clipContent || node.style?.overflow === "hidden");
                  patchNode(node.id, { clipContent: nextClip });
                  patchStyle({ overflow: nextClip ? "hidden" : undefined });
                }}
                className="flex items-center justify-between py-0.5 text-xs text-[var(--text-1)] cursor-pointer select-none group"
              >
                <div className="flex items-center gap-2">
                  <span
                    role="checkbox"
                    aria-checked={Boolean(node?.clipContent || node?.style?.overflow === "hidden")}
                    tabIndex={0}
                    className={`flex h-3.5 w-3.5 items-center justify-center rounded-[var(--radius-xs)] border transition-colors cursor-pointer ${
                      node?.clipContent || node?.style?.overflow === "hidden"
                        ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                        : "border-[var(--line)] bg-[var(--surface-content)] group-hover:border-[var(--text-2)]"
                    }`}
                  >
                    {(node?.clipContent || node?.style?.overflow === "hidden") && (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1.75 5.75L4.51562 8.25L8.75 1.75"></path>
                      </svg>
                    )}
                  </span>
                  <span className="group-hover:text-[var(--accent)] transition-colors">
                    Clip content
                  </span>
                </div>
                <span className="text-[11px] text-[var(--text-2)] font-sans">
                  Alt + C
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
