"use client";

/**
 * FormNull — Signature Control (Field Expansion, migration 008)
 * =====================================================================
 * A real drawing surface: mouse, touch and pen input via Pointer
 * Events, a fixed internal canvas resolution (600×200) scaled to the
 * container with CSS so it is fully responsive WITHOUT losing the
 * drawing (coordinates are remapped by the scale factor).
 *
 * Value model: while the respondent draws, the value is the canvas
 * PNG data URL. On the PUBLIC form the submit handler
 * (public-form.tsx) converts the drawing into a private storage
 * object (create_upload_intent → XHR upload → token) before calling
 * submit_public_form; the stored answer is the file reference, never
 * raw canvas data. Preview and builder never upload anything.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PenLine, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RenderableFormField } from "./form-renderer";

const CANVAS_W = 600;
const CANVAS_H = 200;

export function SignatureControl({
  field,
  value,
  onChange,
  disabled,
  mode,
  id,
}: {
  field: RenderableFormField;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
  mode: "builder" | "preview" | "public";
  id: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(typeof value === "string" && value.startsWith("data:image/png"));

  // Seed the canvas when a value already exists (validation round-trips
  // keep the drawing visible while the respondent fixes other fields).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    if (typeof value === "string" && value.startsWith("data:image/png")) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
      img.src = value;
    }
    // value is only meaningful at mount / when the parent resets it.
     
  }, []);

  const posOf = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * CANVAS_W;
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_H;
    return { x, y };
  }, []);

  function stroke(a: { x: number; y: number }, b: { x: number; y: number }) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled || mode === "builder") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const p = posOf(e);
    lastPointRef.current = p;
    if (p) {
      // A dot for taps.
      stroke(p, { x: p.x + 0.5, y: p.y + 0.5 });
      setHasInk(true);
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const p = posOf(e);
    const last = lastPointRef.current;
    if (p && last) stroke(last, p);
    lastPointRef.current = p;
  }

  function onPointerUp() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    emit();
  }

  /** Push the drawing to the form state as a compact PNG data URL. */
  function emit() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Empty-canvas detection: track ink presence instead of scanning
    // pixels — cheaper and exact enough for the UX layer (the server
    // validates the uploaded PNG, not the data URL).
    if (!hasInk) {
      onChange(undefined);
      return;
    }
    onChange(canvas.toDataURL("image/png"));
  }

  function clear() {
    if (disabled) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    setHasInk(false);
    onChange(undefined);
  }

  const interactive = !disabled && mode !== "builder";

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "relative rounded-xl border-2 border-dashed transition-colors",
          interactive
            ? hasInk
              ? "border-foreground/25 bg-background"
              : "border-foreground/25 bg-background/60 hover:border-foreground/40"
            : "border-foreground/20 bg-background/60",
        )}
      >
        <canvas
          id={id}
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className={cn(
            "block h-auto w-full touch-none",
            interactive ? "cursor-crosshair" : "pointer-events-none opacity-70",
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          role="img"
          aria-label={
            hasInk
              ? "Signature captured — use the clear button to redraw"
              : "Signature drawing area"
          }
        />
        {!hasInk && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center">
            <PenLine className="h-5 w-5 text-muted-foreground/50" aria-hidden />
            <p className="text-sm text-muted-foreground/80">
              {mode === "builder" ? "Signature drawing area" : "Draw your signature here"}
            </p>
            {field.is_required && mode !== "builder" && (
              <p className="text-xs text-muted-foreground/70">A signature is required</p>
            )}
          </div>
        )}
      </div>
      {interactive && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={clear}
            disabled={disabled || !hasInk}
            aria-label="Clear signature and redraw"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      )}
    </div>
  );
}
