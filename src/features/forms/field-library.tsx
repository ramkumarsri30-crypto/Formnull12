"use client";

/**
 * FormNull — Field Library (Phase 3)
 * =====================================================================
 * The professional "Add field" picker. Grouped by mental model
 * (Basic / Choice / Date & time / Content / Advanced), searchable when
 * warranted, each entry showing a real icon, name, and one-line
 * explanation.
 *
 * Honesty rules baked in:
 *   - Only the 16 implemented types appear. Deferred types
 *     (datetime, page_break, signature, address, matrix) are absent —
 *     never ghosted or "coming soon".
 *   - file_upload is offered (it is real in the builder) with its
 *     publish limitation stated on the card.
 */
import { useMemo, useState } from "react";
import { FIELD_GROUPS, FIELD_TYPES_BY_GROUP, type FieldTypeMeta } from "./field-types";
import { Search, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export function FieldLibrary({
  onAdd,
  disabled,
  fieldCount,
}: {
  onAdd: (type: FieldTypeMeta["value"]) => void;
  disabled: boolean;
  fieldCount: number;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const groups = useMemo(() => {
    if (!q) return FIELD_GROUPS.map((g) => ({ ...g, items: FIELD_TYPES_BY_GROUP[g.key] }));
    return FIELD_GROUPS.map((g) => ({
      ...g,
      items: FIELD_TYPES_BY_GROUP[g.key].filter(
        (t) =>
          t.label.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.value.includes(q),
      ),
    })).filter((g) => g.items.length > 0);
  }, [q]);

  return (
    <div className="flex h-full flex-col">
      <div className="p-3 pb-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search field types…"
            className="h-9 pl-8 text-sm"
            aria-label="Search field types"
            disabled={disabled}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No field type matches “{query.trim()}”.
          </p>
        )}
        {groups.map((group) => (
          <section key={group.key} className="mb-3">
            <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {group.label}
            </p>
            <ul className="space-y-1">
              {group.items.map((t) => {
                const Icon = t.icon;
                return (
                  <li key={t.value}>
                    <button
                      type="button"
                      onClick={() => onAdd(t.value)}
                      disabled={disabled}
                      className={cn(
                        "group flex w-full items-start gap-2.5 rounded-xl border-2 border-transparent bg-background p-2.5 text-left transition-all",
                        "hover:border-foreground/15 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        "disabled:cursor-not-allowed disabled:opacity-50",
                      )}
                      aria-label={`Add ${t.label} field`}
                    >
                      <span
                        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[color:var(--memphis-coral)]/12 text-[color:var(--memphis-coral)]"
                        aria-hidden
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                          {t.label}
                          <Plus
                            className="h-3 w-3 shrink-0 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                            aria-hidden
                          />
                        </span>
                        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                          {t.description}
                        </span>
                        {!t.publishable && (
                          <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-[color:var(--memphis-sun)]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--memphis-sun)]">
                            Cannot be published yet
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {fieldCount >= 0 && (
        <p className="border-t border-foreground/10 px-4 py-2 text-[11px] text-muted-foreground">
          {fieldCount} field{fieldCount === 1 ? "" : "s"} · max 300 per form
        </p>
      )}
    </div>
  );
}
