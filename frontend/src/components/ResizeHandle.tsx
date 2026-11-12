"use client";

import { useRef, useState, type RefObject } from "react";

/** Pointer capture keeps resizing predictable when the pointer crosses a camera. */
export default function ResizeHandle({ orientation, label, value, min, max, onChange,
  containerRef, unit = "percent", inverted = false, className = "", controls }: {
  orientation: "vertical" | "horizontal";
  label: string; value: number; min: number; max: number;
  onChange: (value: number) => void;
  containerRef: RefObject<HTMLElement | null>;
  unit?: "percent" | "pixels";
  inverted?: boolean; className?: string; controls?: string;
}) {
  const drag = useRef<{ position: number; value: number; extent: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const vertical = orientation === "vertical";
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const finish = () => { drag.current = null; setDragging(false); };
  return <div
    role="separator" tabIndex={0} aria-label={label} aria-orientation={orientation}
    aria-valuenow={Math.round(value)} aria-valuemin={min} aria-valuemax={max}
    aria-controls={controls}
    className={`group touch-none select-none items-center justify-center outline-none focus-visible:bg-sky-100 hover:bg-sky-100/60 rounded ${vertical ? "cursor-col-resize" : "cursor-row-resize"} ${dragging ? "bg-sky-100" : ""} ${className}`}
    onPointerDown={event => {
      if (event.button !== 0) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { position: vertical ? event.clientX : event.clientY, value,
        extent: unit === "pixels" ? 1 : (vertical ? rect.width : rect.height) / 100 };
      setDragging(true);
    }}
    onPointerMove={event => {
      const start = drag.current;
      if (!start || !start.extent) return;
      const delta = (vertical ? event.clientX : event.clientY) - start.position;
      onChange(clamp(start.value + delta / start.extent * (inverted ? -1 : 1)));
    }}
    onPointerUp={event => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      finish();
    }}
    onPointerCancel={finish} onLostPointerCapture={finish}
    onKeyDown={event => {
      const positive = vertical ? "ArrowRight" : "ArrowDown";
      const negative = vertical ? "ArrowLeft" : "ArrowUp";
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault(); onChange(event.key === "Home" ? min : max);
      } else if (event.key === positive || event.key === negative) {
        event.preventDefault();
        const step = (unit === "pixels" ? 8 : 1) * (event.shiftKey ? 5 : 1);
        onChange(clamp(value + step * (event.key === positive ? 1 : -1) * (inverted ? -1 : 1)));
      }
    }}
  >
    <span aria-hidden="true" className={`rounded-full bg-slate-300 group-hover:bg-sky-500 group-focus-visible:bg-sky-500 ${vertical ? "w-1 h-9" : "h-1 w-9"}`} />
  </div>;
}
