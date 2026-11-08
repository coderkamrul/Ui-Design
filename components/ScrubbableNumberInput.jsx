"use client";

import React, { useState, useEffect, useRef } from "react";

/**
 * Anchored scrubbing with Pointer Lock API.
 * When the user drags on the label/icon, the pointer is locked in place
 * so the cursor stays fixed on the label while dragging left/right increases
 * or decreases the number.
 */
export function startScrubbing(e, initialValue, onChange, options = {}) {
  e.preventDefault();
  const safeVal = isNaN(initialValue) || initialValue == null ? 0 : Number(initialValue);
  const step = options.step ?? 1;
  const min = options.min;
  const max = options.max;
  const precision = options.precision ?? 1;

  let currentVal = safeVal;
  let lastClientX = e.clientX;

  const targetEl = e.currentTarget || e.target;
  let isPointerLocked = false;

  // Try to lock the pointer so the cursor stays fixed in place
  if (targetEl && typeof targetEl.requestPointerLock === "function") {
    try {
      const lockPromise = targetEl.requestPointerLock();
      if (lockPromise && typeof lockPromise.catch === "function") {
        lockPromise.catch(() => {});
      }
      isPointerLocked = true;
    } catch {
      isPointerLocked = false;
    }
  }

  const originalCursor = document.body.style.cursor;
  const originalUserSelect = document.body.style.userSelect;

  document.body.style.cursor = "ew-resize";
  document.body.style.userSelect = "none";

  const onMouseMove = (moveEvent) => {
    // If pointer is locked, movementX gives movement while cursor is frozen.
    // Otherwise fall back to clientX delta.
    let delta = 0;
    if (document.pointerLockElement || isPointerLocked) {
      delta = moveEvent.movementX ?? 0;
    } else {
      delta = moveEvent.clientX - lastClientX;
      lastClientX = moveEvent.clientX;
    }

    if (delta === 0) return;

    const multiplier = moveEvent.shiftKey ? 10 : moveEvent.altKey ? 0.1 : 1;
    const diff = delta * multiplier * step;
    currentVal = currentVal + diff;

    let clamped = currentVal;
    if (min !== undefined) clamped = Math.max(min, clamped);
    if (max !== undefined) clamped = Math.min(max, clamped);

    const factor = Math.pow(10, precision);
    clamped = Math.round(clamped * factor) / factor;

    onChange(clamped);
  };

  const onMouseUp = () => {
    if (document.pointerLockElement) {
      try {
        document.exitPointerLock();
      } catch {}
    }
    document.body.style.cursor = originalCursor;
    document.body.style.userSelect = originalUserSelect;
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  };

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
}

export function ScrubbableNumberInput({
  label,
  value,
  onChange,
  onCommit,
  min,
  max,
  step = 1,
  suffix = "",
  className = "",
  inputClassName = "",
  labelClassName = "",
  disabled = false,
  precision = 1,
  onScrubStart,
  onFocus,
  onInputText,
}) {
  const isDash = value === "–" || value === "-" || value == null;
  const safeVal = isDash || isNaN(value) ? 0 : Number(value);
  const [localVal, setLocalVal] = useState(isDash ? "–" : String(safeVal));
  const [isFocused, setIsFocused] = useState(false);
  const isDraggingRef = useRef(false);
  const isDirtyRef = useRef(false);
  const prevValueRef = useRef(value);

  useEffect(() => {
    // If the prop value changed externally (e.g. dropdown selection, token pick, undo/redo):
    if (prevValueRef.current !== value) {
      prevValueRef.current = value;
      setLocalVal(isDash ? "–" : String(Math.round(safeVal * 100) / 100));
      isDirtyRef.current = false;
      return;
    }
    // Normal synchronization when not actively focused or dragging
    if (!isFocused && !isDraggingRef.current) {
      setLocalVal(isDash ? "–" : String(Math.round(safeVal * 100) / 100));
    }
  }, [value, safeVal, isDash, isFocused]);

  const clampValue = (val) => {
    let res = val;
    if (min !== undefined) res = Math.max(min, res);
    if (max !== undefined) res = Math.min(max, res);
    return res;
  };

  const handleCommit = (str) => {
    const parsed = parseFloat(str);
    if (isNaN(parsed)) {
      setLocalVal(String(safeVal));
    } else {
      const clamped = clampValue(parsed);
      setLocalVal(String(clamped));
      if (onChange) onChange(clamped);
      if (onCommit) onCommit(clamped);
    }
  };

  const handleLabelMouseDown = (e) => {
    if (disabled) return;
    if (e.button !== 0) return;
    isDraggingRef.current = true;
    onScrubStart?.();
    startScrubbing(
      e,
      safeVal,
      (newVal) => {
        setLocalVal(String(newVal));
        if (onChange) onChange(newVal);
        if (onCommit) onCommit(newVal);
      },
      { min, max, step, precision }
    );
    const onMouseUp = () => {
      isDraggingRef.current = false;
      window.addEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div className={`flex items-center select-none ${className}`}>
      {label && (
        <span
          onMouseDown={handleLabelMouseDown}
          className={`cursor-ew-resize transition-colors shrink-0 select-none ${labelClassName}`}
          title="Click and drag horizontally to scrub value"
        >
          {label}
        </span>
      )}
      <input
        type="text"
        disabled={disabled}
        value={localVal}
        onFocus={(e) => {
          setIsFocused(true);
          isDirtyRef.current = false;
          e.target.select();
          onFocus?.(e);
        }}
        onChange={(e) => {
          const val = e.target.value;
          setLocalVal(val);
          isDirtyRef.current = true;
          onInputText?.(val);
          const parsed = parseFloat(val);
          if (!isNaN(parsed) && onChange) {
            onChange(clampValue(parsed));
          }
        }}
        onBlur={(e) => {
          setIsFocused(false);
          if (isDirtyRef.current) {
            handleCommit(e.target.value);
            isDirtyRef.current = false;
          } else {
            setLocalVal(value == null ? "–" : String(Math.round(safeVal * 100) / 100));
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            isDirtyRef.current = false;
            handleCommit(e.target.value);
            e.target.blur();
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            const inc = e.shiftKey ? 10 : step;
            const next = clampValue(safeVal + inc);
            setLocalVal(String(next));
            isDirtyRef.current = false;
            if (onChange) onChange(next);
            if (onCommit) onCommit(next);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            const dec = e.shiftKey ? 10 : step;
            const next = clampValue(safeVal - dec);
            setLocalVal(String(next));
            isDirtyRef.current = false;
            if (onChange) onChange(next);
            if (onCommit) onCommit(next);
          }
          e.stopPropagation();
        }}
        className={`bg-transparent outline-none font-mono cursor-text ${inputClassName}`}
      />
      {suffix && (
        <span className="text-[var(--text-2)] text-[11px] pointer-events-none select-none ml-0.5">
          {suffix}
        </span>
      )}
    </div>
  );
}

export default ScrubbableNumberInput;
