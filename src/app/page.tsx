import Link from "next/link";
import { Logo } from "@/components/formnull/logo";
import { Button } from "@/components/ui/button";
import {
  MemphisDecoration,
  GeometricCircle,
  GeometricSquare,
  GeometricTriangle,
  GeometricZigZag,
  DotPattern,
  GridPattern,
} from "@/components/memphis/memphis-decorations";

/**
 * FormNull Landing Page
 * =====================================================================
 * The home page. Memphis / Playful Geometric design.
 *
 * Sections:
 *   1. Header (logo + nav + sign in/up CTAs)
 *   2. Hero (headline + subhead + CTAs + decorative shapes)
 *   3. Features grid (6 cards with Memphis icons)
 *   4. Stats band (4 KPIs)
 *   5. Architecture highlights (Supabase / RLS / scalability)
 *   6. Final CTA band
 *   7. Footer
 *
 * All sections are fully responsive (320px → 2560px) and have intentional
 * layout changes at each breakpoint, not just scaling.
 */
export default function LandingPage() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip">
      {/* ================================================================= */}
      {/* Header                                                            */}
      {/* ================================================================= */}
      <header className="sticky top-0 z-40 w-full border-b-2 border-foreground/10 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" aria-label="FormNull home">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            <Link
              href="#features"
              className="rounded-md px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-accent/10 hover:text-foreground"
            >
              Features
            </Link>
            <Link
              href="#architecture"
              className="rounded-md px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-accent/10 hover:text-foreground"
            >
              Architecture
            </Link>
            <Link
              href="#pricing"
              className="rounded-md px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-accent/10 hover:text-foreground"
            >
              Pricing
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="/signin">Sign in</Link>
            </Button>
            <Button asChild variant="memphis-coral" size="sm">
              <Link href="/signup">Get started</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* ================================================================= */}
      {/* Hero                                                              */}
      {/* ================================================================= */}
      <section className="relative overflow-hidden">
        <MemphisDecoration variant="hero" />
        <div className="relative mx-auto w-full max-w-7xl px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:px-8 lg:pb-24 lg:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            {/* Badge */}
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border-2 border-foreground/15 bg-surface px-4 py-1.5 text-xs font-semibold">
              <span
                className="inline-block h-2 w-2 rounded-full bg-[color:var(--memphis-coral)]"
                aria-hidden
              />
              Phase 1 · Production foundation is live
            </div>

            {/* Headline */}
            <h1 className="font-display text-4xl leading-[1.05] tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
              Build forms that{" "}
              <span className="relative inline-block">
                <span className="relative z-10 text-[color:var(--memphis-coral)]">
                  get out of the way
                </span>
                <span
                  aria-hidden
                  className="absolute -bottom-1 left-0 right-0 z-0 h-3 bg-[color:var(--memphis-sun)] opacity-70 sm:h-4"
                />
              </span>
              .
            </h1>

            {/* Subhead */}
            <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg md:text-xl">
              FormNull is the form builder for teams that ship. Design beautiful
              forms, collect submissions at scale, and own your data — on a
              foundation engineered for 50M+ users.
            </p>

            {/* CTAs */}
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
              <Button asChild variant="memphis-coral" size="lg" className="w-full sm:w-auto">
                <Link href="/signup">Start building free</Link>
              </Button>
              <Button asChild variant="memphis-outline" size="lg" className="w-full sm:w-auto">
                <Link href="/signin">Sign in</Link>
              </Button>
            </div>

            {/* Trust line */}
            <p className="mt-6 text-xs text-muted-foreground sm:text-sm">
              No credit card required · Free forever for solo use
            </p>
          </div>

          {/* Visual preview block — desktop only */}
          <div className="relative mx-auto mt-12 max-w-5xl sm:mt-16">
            <div className="relative overflow-hidden rounded-2xl border-2 border-foreground/15 bg-surface shadow-[8px_8px_0_0_var(--memphis-ink)]">
              {/* Window chrome */}
              <div className="flex items-center gap-2 border-b-2 border-foreground/10 bg-muted/50 px-4 py-3">
                <span className="h-3 w-3 rounded-full bg-[color:var(--memphis-coral)]" />
                <span className="h-3 w-3 rounded-full bg-[color:var(--memphis-sun)]" />
                <span className="h-3 w-3 rounded-full bg-[color:var(--memphis-mint)]" />
                <div className="ml-3 hidden flex-1 sm:block">
                  <div className="h-6 max-w-md rounded-md bg-background/60 px-3 py-1.5 text-xs text-muted-foreground">
                    formnull.app/dashboard
                  </div>
                </div>
              </div>
              {/* Mock dashboard */}
              <div className="grid gap-4 p-4 sm:p-6 md:grid-cols-3">
                <div className="md:col-span-2">
                  <div className="rounded-xl border-2 border-foreground/10 bg-background p-4">
                    <div className="mb-3 h-4 w-32 rounded bg-foreground/10" />
                    <div className="space-y-2">
                      <div className="h-3 w-full rounded bg-foreground/5" />
                      <div className="h-3 w-3/4 rounded bg-foreground/5" />
                      <div className="h-3 w-5/6 rounded bg-foreground/5" />
                    </div>
                    <div className="mt-4 flex gap-2">
                      <div className="h-7 w-24 rounded-md bg-[color:var(--memphis-coral)]" />
                      <div className="h-7 w-20 rounded-md border-2 border-foreground/15" />
                    </div>
                  </div>
                </div>
                <div className="grid gap-3">
                  <div className="rounded-xl border-2 border-foreground/10 bg-background p-3">
                    <div className="text-xs text-muted-foreground">Submissions</div>
                    <div className="font-display text-2xl">12,481</div>
                  </div>
                  <div className="rounded-xl border-2 border-foreground/10 bg-background p-3">
                    <div className="text-xs text-muted-foreground">Active forms</div>
                    <div className="font-display text-2xl">7</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================= */}
      {/* Features                                                          */}
      {/* ================================================================= */}
      <section id="features" className="relative scroll-mt-16 py-16 sm:py-24">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-[color:var(--memphis-coral)]">
              Why FormNull
            </p>
            <h2 className="font-display text-3xl tracking-tight sm:text-4xl md:text-5xl">
              Everything you need. Nothing you don&apos;t.
            </h2>
            <p className="mt-4 text-base text-muted-foreground sm:text-lg">
              A modern foundation for forms that scale — without locking you
              into proprietary black boxes.
            </p>
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <FeatureCard key={f.title} {...f} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* ================================================================= */}
      {/* Stats band                                                        */}
      {/* ================================================================= */}
      <section className="relative overflow-hidden border-y-2 border-foreground/10 bg-foreground text-background">
        <GridPattern className="opacity-10" />
        <div className="relative mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <div className="grid grid-cols-2 gap-6 sm:gap-8 md:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.label} className="text-center">
                <div className="font-display text-3xl sm:text-4xl md:text-5xl">
                  {s.value}
                </div>
                <div className="mt-1 text-xs text-background/70 sm:text-sm">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ================================================================= */}
      {/* Architecture                                                      */}
      {/* ================================================================= */}
      <section id="architecture" className="relative scroll-mt-16 py-16 sm:py-24">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid items-start gap-12 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-[color:var(--memphis-coral)]">
                Built right
              </p>
              <h2 className="font-display text-3xl tracking-tight sm:text-4xl md:text-5xl">
                An architecture you can trust at scale.
              </h2>
              <p className="mt-4 text-base text-muted-foreground sm:text-lg">
                FormNull is built on Supabase — Postgres, Auth, Storage, and
                Row-Level Security. Your data is yours: no proprietary lock-in,
                no fragile abstractions, no black boxes.
              </p>

              <ul className="mt-8 space-y-4">
                {ARCH_POINTS.map((p) => (
                  <li key={p.title} className="flex gap-3">
                    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[color:var(--memphis-mint)] text-[color:var(--memphis-ink)]">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-semibold">{p.title}</p>
                      <p className="text-sm text-muted-foreground">{p.description}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Architecture diagram (CSS-based) */}
            <div className="relative overflow-hidden rounded-2xl border-2 border-foreground/15 bg-surface p-6 shadow-[6px_6px_0_0_var(--memphis-ink)] sm:p-8">
              <p className="mb-6 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                System architecture
              </p>
              <div className="space-y-3">
                <ArchLayer label="Frontend" sublabel="Next.js 16 · App Router · Memphis design" color="coral" />
                <ArchArrow />
                <ArchLayer label="Supabase Auth" sublabel="PKCE · Email · OAuth (Phase 2)" color="violet" />
                <ArchArrow />
                <ArchLayer label="PostgreSQL + RLS" sublabel="Multi-tenant · Workspace-scoped · Indexed" color="mint" />
                <ArchArrow />
                <ArchLayer label="Supabase Storage" sublabel="Per-user / per-workspace policies" color="sun" />
                <ArchArrow />
                <ArchLayer label="Edge Functions" sublabel="Privileged server-side ops (Phase 2)" color="sky" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================= */}
      {/* Final CTA                                                         */}
      {/* ================================================================= */}
      <section id="pricing" className="relative scroll-mt-16 py-16 sm:py-24">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-3xl border-2 border-foreground/15 bg-foreground px-6 py-12 text-center text-background sm:px-12 sm:py-16">
            {/* Decorative shapes inside CTA */}
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
              <GeometricCircle color="coral" size={120} className="-top-8 -left-8 opacity-80" />
              <GeometricSquare color="mint" size={56} rotate={12} className="bottom-6 -right-6 opacity-80" />
              <GeometricTriangle color="sun" size={48} rotate={-15} className="top-1/2 right-1/4 opacity-70 hidden sm:block" />
              <GeometricZigZag color="background" width={100} className="bottom-4 left-1/4 opacity-40 hidden md:block" />
            </div>
            <div className="relative">
              <h2 className="font-display text-3xl tracking-tight sm:text-4xl md:text-5xl">
                Ship your first form in minutes.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-sm text-background/80 sm:text-base">
                Free forever for solo use. Bring your team when you&apos;re ready.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
                <Button asChild variant="memphis-coral" size="lg" className="w-full sm:w-auto">
                  <Link href="/signup">Get started free</Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="w-full border-background/30 bg-transparent text-background hover:bg-background/10 hover:text-background sm:w-auto">
                  <Link href="/signin">I already have an account</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================= */}
      {/* Footer                                                            */}
      {/* ================================================================= */}
      <footer className="mt-auto border-t-2 border-foreground/10 bg-background">
        <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-4">
            <div className="md:col-span-2">
              <Logo />
              <p className="mt-3 max-w-xs text-sm text-muted-foreground">
                Forms that get out of the way. Built on Supabase, designed for scale.
              </p>
            </div>
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Product
              </p>
              <ul className="space-y-2 text-sm">
                <li><Link href="#features" className="text-foreground/80 hover:text-foreground">Features</Link></li>
                <li><Link href="#architecture" className="text-foreground/80 hover:text-foreground">Architecture</Link></li>
                <li><Link href="#pricing" className="text-foreground/80 hover:text-foreground">Pricing</Link></li>
              </ul>
            </div>
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Account
              </p>
              <ul className="space-y-2 text-sm">
                <li><Link href="/signin" className="text-foreground/80 hover:text-foreground">Sign in</Link></li>
                <li><Link href="/signup" className="text-foreground/80 hover:text-foreground">Sign up</Link></li>
                <li><Link href="/forgot-password" className="text-foreground/80 hover:text-foreground">Reset password</Link></li>
              </ul>
            </div>
          </div>
          <div className="mt-10 flex flex-col items-start justify-between gap-2 border-t border-foreground/10 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center">
            <p>© {new Date().getFullYear()} FormNull. All rights reserved.</p>
            <p>Built on Supabase · Memphis design language</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* FeatureCard                                                         */
/* ------------------------------------------------------------------ */
interface Feature {
  title: string;
  description: string;
  shape: "circle" | "square" | "triangle";
  color: "coral" | "mint" | "sun" | "violet" | "sky" | "pink";
}

const FEATURES: Feature[] = [
  {
    title: "Drag-free form builder",
    description:
      "Compose forms field-by-field with a keyboard-first builder. Every field is its own row in Postgres — no JSON soup.",
    shape: "circle",
    color: "coral",
  },
  {
    title: "Submissions that scale",
    description:
      "Each submission is independently addressable with keyset pagination and BRIN indexes. 10 or 100M — same access pattern.",
    shape: "triangle",
    color: "mint",
  },
  {
    title: "Row-Level Security",
    description:
      "Authorization lives in the database. Even a malicious client cannot read another workspace's data.",
    shape: "square",
    color: "violet",
  },
  {
    title: "Multi-tenant workspaces",
    description:
      "Forms belong to workspaces, not users. Invite teammates with role-based permissions from day one.",
    shape: "circle",
    color: "sun",
  },
  {
    title: "Storage that respects ownership",
    description:
      "Uploaded files live in Supabase Storage with path-based policies. Private files stay private.",
    shape: "triangle",
    color: "pink",
  },
  {
    title: "Versioned form schemas",
    description:
      "Publish a form and we snapshot an immutable version. Compare versions, roll back, never lose history.",
    shape: "square",
    color: "sky",
  },
];

function FeatureCard({ title, description, shape, color, index }: Feature & { index: number }) {
  const colorVar = `var(--memphis-${color})`;
  return (
    <div className="group relative overflow-hidden rounded-2xl border-2 border-foreground/10 bg-surface p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[6px_6px_0_0_var(--memphis-ink)]">
      <div className="mb-4 flex h-12 w-12 items-center justify-center">
        {shape === "circle" && (
          <div className="h-12 w-12 rounded-full" style={{ backgroundColor: colorVar }} aria-hidden />
        )}
        {shape === "square" && (
          <div
            className="h-11 w-11"
            style={{
              backgroundColor: colorVar,
              transform: `rotate(${(index % 2 === 0 ? 1 : -1) * 8}deg)`,
            }}
            aria-hidden
          />
        )}
        {shape === "triangle" && (
          <div
            aria-hidden
            style={{
              width: 0,
              height: 0,
              borderLeft: "24px solid transparent",
              borderRight: "24px solid transparent",
              borderBottom: `42px solid ${colorVar}`,
            }}
          />
        )}
      </div>
      <h3 className="font-display text-lg font-bold tracking-tight sm:text-xl">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground sm:text-base">{description}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */
const STATS = [
  { value: "50M+", label: "Users supported" },
  { value: "100M+", label: "Submissions per form" },
  { value: "<50ms", label: "RLS policy overhead" },
  { value: "100%", label: "Your data, your DB" },
];

/* ------------------------------------------------------------------ */
/* Architecture points                                                 */
/* ------------------------------------------------------------------ */
const ARCH_POINTS = [
  {
    title: "Supabase Auth with PKCE flow",
    description:
      "Secure session handling via HTTP-only cookies. Email, OAuth, and magic-link ready.",
  },
  {
    title: "PostgreSQL with strict RLS",
    description:
      "Every user-owned table has explicit SELECT / INSERT / UPDATE / DELETE policies based on workspace membership.",
  },
  {
    title: "Normalized submission storage",
    description:
      "Submissions and submission_values are separate tables — never a JSON blob in a form row.",
  },
  {
    title: "Cursor pagination everywhere",
    description:
      "All list queries use (created_at, id) cursor pagination — no offset, no drift, no slowdown.",
  },
];

/* ------------------------------------------------------------------ */
/* Architecture diagram primitives                                     */
/* ------------------------------------------------------------------ */
function ArchLayer({
  label,
  sublabel,
  color,
}: {
  label: string;
  sublabel: string;
  color: "coral" | "violet" | "mint" | "sun" | "sky";
}) {
  const colorVar = `var(--memphis-${color})`;
  return (
    <div className="flex items-center gap-3 rounded-xl border-2 border-foreground/10 bg-background p-3 sm:p-4">
      <div
        className="h-3 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: colorVar }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold sm:text-base">{label}</p>
        <p className="truncate text-xs text-muted-foreground sm:text-sm">{sublabel}</p>
      </div>
    </div>
  );
}

function ArchArrow() {
  return (
    <div className="flex justify-center" aria-hidden>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40">
        <path d="M12 5v14M19 12l-7 7-7-7" />
      </svg>
    </div>
  );
}
