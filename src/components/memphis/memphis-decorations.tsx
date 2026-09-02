/**
 * FormNull — Memphis Decoration Components
 * =====================================================================
 * Reusable geometric primitives that establish the Memphis / Playful
 * Geometric design language across the product.
 *
 * Design principles:
 *   - Decorations are PURELY visual: pointer-events-none, aria-hidden.
 *   - They NEVER cover buttons, text, inputs, or interactive elements.
 *   - They NEVER cause horizontal scrolling (overflow-x is contained).
 *   - They scale and reposition responsively via Tailwind classes.
 *   - They respect prefers-reduced-motion (no continuous animation).
 *
 * Compose decorations via <MemphisDecoration> which bundles a tasteful
 * set of shapes, or use individual primitives for fine control.
 */
import { cn } from "@/lib/utils";
import type { CSSProperties, HTMLAttributes } from "react";

type MemphisColor =
  | "coral"
  | "mint"
  | "sun"
  | "violet"
  | "sky"
  | "pink"
  | "lemon"
  | "ink"
  | "background";

const colorVar: Record<MemphisColor, string> = {
  coral: "var(--memphis-coral)",
  mint: "var(--memphis-mint)",
  sun: "var(--memphis-sun)",
  violet: "var(--memphis-violet)",
  sky: "var(--memphis-sky)",
  pink: "var(--memphis-pink)",
  lemon: "var(--memphis-lemon)",
  ink: "var(--memphis-ink)",
  background: "var(--background)",
};

interface ShapeProps extends HTMLAttributes<HTMLDivElement> {
  color?: MemphisColor;
  size?: number; // px
  rotate?: number; // deg
  float?: boolean;
}

/* ------------------------------------------------------------------ */
/* GeometricCircle                                                     */
/* ------------------------------------------------------------------ */
export function GeometricCircle({
  color = "coral",
  size = 80,
  className,
  style,
  float = false,
  ...props
}: ShapeProps) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute rounded-full",
        float && "animate-float",
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: colorVar[color],
        ...style,
      }}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/* GeometricSquare                                                     */
/* ------------------------------------------------------------------ */
export function GeometricSquare({
  color = "violet",
  size = 80,
  rotate = 0,
  className,
  style,
  float = false,
  ...props
}: ShapeProps) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute",
        float && "animate-float",
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: colorVar[color],
        transform: `rotate(${rotate}deg)`,
        ...style,
      }}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/* GeometricTriangle                                                   */
/* ------------------------------------------------------------------ */
export function GeometricTriangle({
  color = "mint",
  size = 80,
  rotate = 0,
  className,
  style,
  float = false,
  ...props
}: ShapeProps) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute",
        float && "animate-float",
        className,
      )}
      style={
        {
          width: 0,
          height: 0,
          borderLeft: `${size / 2}px solid transparent`,
          borderRight: `${size / 2}px solid transparent`,
          borderBottom: `${size}px solid ${colorVar[color]}`,
          transform: `rotate(${rotate}deg)`,
          ...style,
        } as CSSProperties
      }
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/* GeometricSemiCircle                                                 */
/* ------------------------------------------------------------------ */
export function GeometricSemiCircle({
  color = "sun",
  size = 80,
  rotate = 0,
  className,
  style,
  ...props
}: Omit<ShapeProps, "float">) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute", className)}
      style={{
        width: size,
        height: size / 2,
        backgroundColor: colorVar[color],
        borderTopLeftRadius: size,
        borderTopRightRadius: size,
        transform: `rotate(${rotate}deg)`,
        ...style,
      }}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/* GeometricZigZag — Memphis signature zigzag line                     */
/* ------------------------------------------------------------------ */
export function GeometricZigZag({
  color = "ink",
  width = 120,
  className,
  style,
}: {
  color?: MemphisColor;
  width?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden
      className={cn("pointer-events-none absolute", className)}
      width={width}
      height={12}
      viewBox="0 0 120 12"
      fill="none"
      style={style}
    >
      <path
        d="M0 6 L10 0 L20 12 L30 0 L40 12 L50 0 L60 12 L70 0 L80 12 L90 0 L100 12 L110 0 L120 6"
        stroke={colorVar[color]}
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* DotPattern — full-bleed decorative dot grid                         */
/* ------------------------------------------------------------------ */
export function DotPattern({
  className,
  opacity = 1,
}: {
  className?: string;
  opacity?: number;
}) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 bg-dot-pattern", className)}
      style={{ opacity }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* GridPattern — full-bleed decorative grid                            */
/* ------------------------------------------------------------------ */
export function GridPattern({
  className,
  opacity = 1,
}: {
  className?: string;
  opacity?: number;
}) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 bg-grid-pattern", className)}
      style={{ opacity }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* StripePattern — diagonal Memphis stripes                            */
/* ------------------------------------------------------------------ */
export function StripePattern({
  className,
  opacity = 1,
}: {
  className?: string;
  opacity?: number;
}) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 bg-stripe-pattern", className)}
      style={{ opacity }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* MemphisDecoration — composed bundle of decorations                  */
/* ------------------------------------------------------------------ */
type DecorationVariant = "hero" | "auth" | "dashboard" | "minimal" | "corner";

export function MemphisDecoration({
  variant = "minimal",
  className,
}: {
  variant?: DecorationVariant;
  className?: string;
}) {
  if (variant === "hero") {
    return (
      <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
        {/* Top-left cluster */}
        <GeometricCircle color="coral" size={140} className="-top-12 -left-12 opacity-90 hidden sm:block" />
        <GeometricSquare color="violet" size={64} rotate={12} className="top-24 left-[18%] opacity-80 hidden md:block" />
        <GeometricTriangle color="mint" size={56} rotate={-15} className="top-8 right-[20%] opacity-90" />

        {/* Bottom-right cluster */}
        <GeometricCircle color="sun" size={96} className="bottom-[-24px] right-[8%] opacity-90 hidden sm:block" />
        <GeometricSquare color="pink" size={48} rotate={45} className="bottom-20 right-[24%] opacity-80 hidden lg:block" />
        <GeometricZigZag color="ink" width={140} className="bottom-32 left-[10%] hidden md:block" />

        {/* Background pattern */}
        <DotPattern className="opacity-50" />
      </div>
    );
  }

  if (variant === "auth") {
    return (
      <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
        <GeometricCircle color="coral" size={120} className="-top-16 -right-16 opacity-90" />
        <GeometricSquare color="violet" size={56} rotate={12} className="top-1/2 -left-8 opacity-80 hidden sm:block" />
        <GeometricTriangle color="mint" size={48} rotate={-15} className="bottom-12 right-12 opacity-90" />
        <GeometricZigZag color="ink" width={100} className="bottom-1/3 left-1/4 opacity-70 hidden md:block" />
        <DotPattern className="opacity-40" />
      </div>
    );
  }

  if (variant === "dashboard") {
    return (
      <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
        <GeometricCircle color="coral" size={80} className="-top-10 -right-10 opacity-50" />
        <GeometricTriangle color="mint" size={48} rotate={-15} className="bottom-10 right-1/3 opacity-40 hidden md:block" />
        <DotPattern className="opacity-20" />
      </div>
    );
  }

  if (variant === "corner") {
    return (
      <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
        <GeometricCircle color="coral" size={64} className="-top-8 -right-8 opacity-80" />
      </div>
    );
  }

  // minimal
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <DotPattern className="opacity-30" />
    </div>
  );
}
