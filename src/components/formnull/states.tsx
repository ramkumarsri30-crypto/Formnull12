/**
 * FormNull — State Components
 * =====================================================================
 * EmptyState, ErrorState, LoadingState — consistent visual treatment
 * for the three states that every data-driven UI must handle.
 *
 * Each component uses Memphis decorations to keep the experience
 * on-brand even when there's no data to show.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  GeometricCircle,
  GeometricTriangle,
  GeometricSquare,
} from "@/components/memphis/memphis-decorations";

/* ------------------------------------------------------------------ */
/* EmptyState                                                          */
/* ------------------------------------------------------------------ */
interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border-2 border-dashed border-foreground/15 bg-surface/50 p-8 sm:p-12 text-center",
        className,
      )}
    >
      {/* Decorative shapes */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <GeometricCircle
          color="coral"
          size={40}
          className="-top-3 -right-3 opacity-30"
        />
        <GeometricTriangle
          color="mint"
          size={32}
          rotate={-15}
          className="bottom-3 left-3 opacity-30"
        />
        <GeometricSquare
          color="violet"
          size={24}
          rotate={12}
          className="top-1/2 right-6 opacity-20 hidden sm:block"
        />
      </div>

      <div className="relative mx-auto flex max-w-md flex-col items-center gap-4">
        {icon && (
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 text-accent">
            {icon}
          </div>
        )}
        <div className="space-y-1.5">
          <h3 className="text-lg font-bold tracking-tight sm:text-xl">{title}</h3>
          {description && (
            <p className="text-sm text-muted-foreground sm:text-base">
              {description}
            </p>
          )}
        </div>
        {action &&
          (action.href ? (
            <Button asChild variant="memphis-coral" size="lg">
              <a href={action.href}>{action.label}</a>
            </Button>
          ) : (
            <Button variant="memphis-coral" size="lg" onClick={action.onClick}>
              {action.label}
            </Button>
          ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ErrorState                                                          */
/* ------------------------------------------------------------------ */
interface ErrorStateProps {
  title?: string;
  description?: string;
  error?: Error | { message?: string } | null;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  description,
  error,
  onRetry,
  className,
}: ErrorStateProps) {
  const message =
    description ??
    error?.message ??
    "An unexpected error occurred. Please try again.";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border-2 border-destructive/30 bg-destructive/5 p-8 sm:p-12 text-center",
        className,
      )}
      role="alert"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <GeometricTriangle
          color="coral"
          size={48}
          rotate={180}
          className="-top-3 -left-3 opacity-40"
        />
      </div>
      <div className="relative mx-auto flex max-w-md flex-col items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          </svg>
        </div>
        <div className="space-y-1.5">
          <h3 className="text-lg font-bold tracking-tight sm:text-xl">{title}</h3>
          <p className="text-sm text-muted-foreground sm:text-base">{message}</p>
        </div>
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* LoadingState                                                        */
/* ------------------------------------------------------------------ */
interface LoadingStateProps {
  title?: string;
  description?: string;
  className?: string;
}

export function LoadingState({
  title = "Loading…",
  description,
  className,
}: LoadingStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 p-8 text-center sm:p-12",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="relative flex h-12 w-12 items-center justify-center">
        {/* Three rotating Memphis shapes */}
        <div className="absolute h-3 w-3 rounded-full bg-[color:var(--memphis-coral)] animate-pulse-soft" style={{ animationDelay: "0ms" }} />
        <div className="absolute h-3 w-3 rounded-full bg-[color:var(--memphis-mint)] animate-pulse-soft" style={{ animationDelay: "150ms", transform: "translateX(8px)" }} />
        <div className="absolute h-3 w-3 rounded-full bg-[color:var(--memphis-violet)] animate-pulse-soft" style={{ animationDelay: "300ms", transform: "translateX(-8px)" }} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold sm:text-base">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground sm:text-sm">{description}</p>
        )}
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* FullScreenSkeleton                                                  */
/* ------------------------------------------------------------------ */
export function FullScreenSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex min-h-screen items-center justify-center bg-background",
        className,
      )}
    >
      <LoadingState />
    </div>
  );
}
