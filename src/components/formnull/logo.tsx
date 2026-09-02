/**
 * FormNull — Logo
 * =====================================================================
 * The FormNull logo: a Memphis-styled square + circle + triangle mark
 * with the FormNull wordmark. Used in headers, auth pages, and footer.
 *
 * SVG-based so it scales crisply and inherits currentColor for accents.
 */
import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  showWordmark?: boolean;
  size?: number;
}

export function Logo({
  className,
  showWordmark = true,
  size = 36,
}: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="FormNull logo"
        role="img"
      >
        {/* Background: rounded square (ink) */}
        <rect width="40" height="40" rx="10" fill="var(--memphis-ink)" />
        {/* Coral circle */}
        <circle cx="14" cy="14" r="6" fill="var(--memphis-coral)" />
        {/* Mint triangle */}
        <path
          d="M26 8L32 18H20L26 8Z"
          fill="var(--memphis-mint)"
        />
        {/* Sun square (rotated) */}
        <rect
          x="22"
          y="22"
          width="9"
          height="9"
          transform="rotate(15 26.5 26.5)"
          fill="var(--memphis-sun)"
        />
        {/* Violet dot */}
        <circle cx="13" cy="28" r="3.5" fill="var(--memphis-violet)" />
      </svg>
      {showWordmark && (
        <span
          className="font-display text-xl tracking-tight"
          style={{ fontWeight: 800 }}
        >
          FormNull
        </span>
      )}
    </div>
  );
}
