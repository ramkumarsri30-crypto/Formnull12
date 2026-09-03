"use client";

/**
 * FormNull — Preview Dialog (Phase 3)
 * =====================================================================
 * Live preview of the form using the SAME shared FormRenderer (and the
 * SAME field definitions/configuration) as the public form — there is
 * no separate preview model. Device frames switch the rendered width:
 *
 *   Desktop  ≥ 900px of canvas   ( respondent layout at full width )
 *   Tablet   768px
 *   Mobile   375px
 *
 * The preview is fully interactive: validation runs exactly as it will
 * for respondents, and pressing the submit button shows a notice
 * instead of persisting anything (preview is honest — no fake saves).
 */
import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormRenderer, type RenderableFormField, type RenderableFormHeader } from "./form-renderer";
import { Monitor, Tablet, Smartphone, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type Device = "desktop" | "tablet" | "mobile";

const DEVICE_WIDTHS: Record<Device, string> = {
  desktop: "100%",
  tablet: "768px",
  mobile: "375px",
};

export function PreviewDialog({
  open,
  onOpenChange,
  form,
  fields,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: RenderableFormHeader;
  fields: RenderableFormField[];
}) {
  const [device, setDevice] = useState<Device>("desktop");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] max-w-6xl flex-col overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="shrink-0 border-b border-foreground/10 px-5 py-4">
          <DialogTitle className="flex flex-wrap items-center justify-between gap-3">
            <span>Preview — {form.name}</span>
            {/* Device switcher */}
            <div
              className="flex items-center gap-1 rounded-xl border-2 border-foreground/10 bg-background p-1"
              role="group"
              aria-label="Preview device"
            >
              {(
                [
                  ["desktop", Monitor, "Desktop preview"],
                  ["tablet", Tablet, "Tablet preview"],
                  ["mobile", Smartphone, "Mobile preview"],
                ] as const
              ).map(([d, Icon, label]) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDevice(d)}
                  aria-label={label}
                  aria-pressed={device === d}
                  className={cn(
                    "flex h-8 w-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    device === d
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-accent/10 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </DialogTitle>
          <DialogDescription>
            Exactly what respondents will see — same fields, validation, and layout.
            Nothing is saved from a preview.
          </DialogDescription>
        </DialogHeader>

        {/* Canvas */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-[color:var(--surface)]/60 p-3 sm:p-6">
          <div
            className="mx-auto overflow-hidden rounded-2xl border-2 border-foreground/10 bg-surface p-4 shadow-[6px_6px_0_0_var(--memphis-ink)] transition-all duration-300 sm:p-8"
            style={{ width: DEVICE_WIDTHS[device], maxWidth: "100%" }}
          >
            {fields.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                This form has no fields yet — add fields to see them here.
              </p>
            ) : (
              <FormRenderer
                form={form}
                fields={fields}
                idPrefix="pv-"
                mode="preview"
                onSubmit={async () => {
                  /* Validation already ran (empty errors = valid). The
                     preview deliberately does not persist anything. */
                  toast.info("Preview submit works — no response was saved.", {
                    description: "Publish the form to start collecting real answers.",
                  });
                }}
                submitNotice={
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    Preview mode — answers are checked but not stored.
                  </p>
                }
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
