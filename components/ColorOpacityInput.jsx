"use client";

import React, { useState, useEffect, useRef } from "react";
import { startScrubbing } from "./ScrubbableNumberInput";

export function ColorOpacityInput({
  value,
  onChange,
  disabled = false,
  className = ""
}) {
  const numericVal = Math.max(0, Math.min(100, isNaN(value) ? 100 : Math.round(Number(value))));
  const [localVal, setLocalVal] = useState(String(numericVal));
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!isEditing) {
      setLocalVal(String(numericVal));
    }
  }, [numericVal, isEditing]);

  const commitValue = (str) => {
    const cleanStr = str.replace("%", "").trim();
    let parsed = parseInt(cleanStr, 10);
    if (isNaN(parsed)) {
      parsed = numericVal;
    } else {
      parsed = Math.max(0, Math.min(100, parsed));
    }
    setLocalVal(String(parsed));
    setIsEditing(false);
    if (onChange && parsed !== numericVal) {
      onChange(parsed);
    }
  };

  const handleMouseDown = (e) => {
    if (disabled || isEditing) return;
    startScrubbing(
      e,
      numericVal,
      (val) => {
        const clamped = Math.max(0, Math.min(100, Math.round(val)));
        setLocalVal(String(clamped));
        if (onChange) onChange(clamped);
      },
      { min: 0, max: 100, step: 1 }
    );
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`group relative flex items-center justify-center rounded-[var(--radius-md)] px-1.5 py-0.5 text-xs font-mono transition-colors cursor-ew-resize select-none hover:bg-[var(--surface-hover)] ${className}`}
      title="Click to edit opacity or drag horizontally"
    >
      {isEditing ? (
        <div className="flex items-center">
          <input
            ref={inputRef}
            type="text"
            value={localVal}
            onChange={(e) => setLocalVal(e.target.value)}
            onBlur={() => commitValue(localVal)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitValue(localVal);
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                setLocalVal(String(numericVal));
                setIsEditing(false);
              }
              e.stopPropagation();
            }}
            className="w-8 bg-transparent text-right outline-none font-mono text-[var(--text-1)]"
            autoFocus
          />
          <span className="text-[var(--text-2)] ml-0.5">%</span>
        </div>
      ) : (
        <div
          onClick={(e) => {
            e.stopPropagation();
            setIsEditing(true);
          }}
          className="flex items-center gap-0.5 text-[var(--text-2)] group-hover:text-[var(--text-1)] cursor-text"
        >
          <span className="font-medium text-[var(--text-1)]">{numericVal}</span>
          <span className="text-[var(--text-2)]">%</span>
        </div>
      )}
    </div>
  );
}

export default ColorOpacityInput;
