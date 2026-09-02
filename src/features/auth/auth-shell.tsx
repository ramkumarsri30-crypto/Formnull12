import { MemphisDecoration } from "@/components/memphis/memphis-decorations";
import { Logo } from "@/components/formnull/logo";
import Link from "next/link";

/**
 * AuthShell — shared layout for sign-in / sign-up / reset pages.
 *
 * Memphis-decorated left panel + form panel on the right.
 * On mobile, the decorative panel collapses to a thin banner.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip lg:flex-row">
      {/* Left: decorative panel (hidden on mobile, thin on tablet) */}
      <aside className="relative hidden h-64 overflow-hidden border-b-2 border-foreground/10 bg-foreground text-background lg:block lg:h-auto lg:w-1/2 lg:border-b-0 lg:border-r-2">
        <MemphisDecoration variant="auth" />
        <div className="relative flex h-full flex-col justify-between p-8 lg:p-12">
          <Link href="/" className="inline-flex items-center gap-2 text-background">
            <Logo />
          </Link>
          <div className="max-w-md">
            <h2 className="font-display text-3xl leading-tight tracking-tight sm:text-4xl lg:text-5xl">
              Forms that get out of the way.
            </h2>
            <p className="mt-4 text-sm text-background/70 sm:text-base">
              Built on Supabase. Engineered for 50M+ users. Memphis-designed
              from the ground up.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-background/60">
            <span
              className="inline-block h-2 w-2 rounded-full bg-[color:var(--memphis-mint)]"
              aria-hidden
            />
            Production foundation · Phase 1
          </div>
        </div>
      </aside>

      {/* Right: form panel */}
      <main className="relative flex flex-1 flex-col justify-center px-4 py-10 sm:px-6 lg:px-12">
        {/* Mobile logo */}
        <div className="absolute left-4 top-6 sm:left-6 lg:hidden">
          <Link href="/" aria-label="FormNull home">
            <Logo />
          </Link>
        </div>

        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 space-y-2">
            <h1 className="font-display text-2xl tracking-tight sm:text-3xl">
              {title}
            </h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
          {children}
          {footer && <div className="mt-8 text-sm text-muted-foreground">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
