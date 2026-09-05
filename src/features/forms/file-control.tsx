"use client";

/**
 * FormNull — File Upload Control (Field Expansion, migration 008)
 * =====================================================================
 * THE real upload path for file_upload fields on the public form.
 *
 *   1. create_upload_intent RPC (008) — the SERVER validates the file
 *      name/size/mime against the PUBLISHED snapshot's field config
 *      and returns an unguessable token + pending/{token}/ path.
 *   2. XHR PUT to Supabase Storage (form-uploads bucket, anon key).
 *      The bucket's storage policy only permits writes under
 *      pending/, and its file-size limit is enforced by the Storage
 *      API itself — a second, independent server-side ceiling.
 *   3. The token becomes the field's answer value; submit_public_form
 *      re-validates the object from storage (actual size + mime) and
 *      attaches the row to the submission.
 *
 * Modes: builder → inert summary; preview → the UI without uploads
 * (a preview must never create real storage objects); public → live.
 * Progress is real (XHR upload events), errors are shown with retry,
 * and removing a file only detaches the client token (the pending
 * upload expires server-side and is swept by the probabilistic
 * cleanup in submit_public_form).
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Upload, X, FileText, Loader2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { RenderableFormField } from "./form-renderer";

export interface UploadedFileRef {
  token: string;
  name: string;
  size: number;
  mime: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** The standard document/image set the bucket accepts when the field
 *  config does not narrow it (mirrors 004's submissions bucket list). */
const STANDARD_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif",
  "application/pdf", "text/plain", "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
]);

export function FileControl({
  field,
  value,
  onChange,
  disabled,
  mode,
  id,
  publicKey,
}: {
  field: RenderableFormField;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
  mode: "builder" | "preview" | "public";
  id: string;
  /** The public form's key — required for the upload-intent RPC. */
  publicKey: string;
}) {
  const cfg = field.config ?? {};
  const multiple = cfg.multiple === true;
  const maxFiles = typeof cfg.maxFiles === "number" ? Math.round(cfg.maxFiles) : 5;
  const maxSizeMb = typeof cfg.maxSizeMb === "number" ? cfg.maxSizeMb : 10;
  const allowedTypes = Array.isArray(cfg.allowedTypes)
    ? (cfg.allowedTypes as unknown[]).filter((t): t is string => typeof t === "string")
    : [];
  const allowSet = allowedTypes.length > 0 ? new Set(allowedTypes) : null;

  const files = Array.isArray(value)
    ? (value as unknown[]).filter((v): v is UploadedFileRef =>
        typeof v === "object" && v !== null && typeof (v as UploadedFileRef).token === "string")
    : [];
  const [uploading, setUploading] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function typeAllowed(mime: string): boolean {
    if (allowSet) {
      if (allowSet.has(mime)) return true;
      // wildcard entries like image/*
      for (const t of allowSet) {
        if (t.endsWith("/*") && mime.startsWith(t.slice(0, -1))) return true;
      }
      return false;
    }
    return STANDARD_TYPES.has(mime);
  }

  function commit(next: UploadedFileRef[]) {
    if (next.length === 0) onChange(undefined);
    else onChange(next);
  }

  function removeAt(i: number) {
    if (disabled) return;
    commit(files.filter((_, idx) => idx !== i));
  }

  async function uploadFile(file: File) {
    setError(null);

    // Client-side pre-checks (UX only — the server re-validates both
    // in the intent RPC and at submit time).
    if (file.size > maxSizeMb * 1024 * 1024) {
      setError(`“${file.name}” is larger than the ${maxSizeMb} MB limit.`);
      return;
    }
    if (!typeAllowed(file.type || "application/octet-stream")) {
      setError(
        allowSet
          ? `“${file.name}” is not an allowed file type (${allowedTypes.join(", ")}).`
          : `“${file.name}” is not an accepted file type.`,
      );
      return;
    }
    if (files.length >= maxFiles) {
      setError(`At most ${maxFiles} file${maxFiles === 1 ? "" : "s"} allowed.`);
      return;
    }

    // Preview never touches storage — show exactly what respondents
    // will see without creating real objects.
    if (mode === "preview") {
      toast.info("Preview mode — files are uploaded only on the published form.");
      return;
    }
    if (mode !== "public") return;

    setUploading(file.name);
    setProgress(0);
    try {
      // (1) Server-validated upload intent against the snapshot.
      const { data: intent, error: rpcError } = await supabaseBrowser.rpc(
        "create_upload_intent",
        {
          p_public_key: publicKey,
          p_field_key: field.field_key,
          p_file_name: file.name,
          p_mime_type: file.type || "application/octet-stream",
          p_size_bytes: file.size,
        },
      );
      if (rpcError) throw rpcError;
      const r = intent as { token?: string; path?: string } | null;
      if (!r?.token || !r?.path) throw new Error("Upload intent returned no path.");

      // (2) Upload the bytes with progress (plain XHR — fetch has no
      //     upload progress events).
      await new Promise<void>((resolve, reject) => {
        const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/form-uploads/${r.path}`;
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url, true);
        xhr.setRequestHeader(
          "Authorization",
          `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
        );
        xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "");
        xhr.setRequestHeader("x-upsert", "false");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onerror = () => reject(new Error("Network error during upload."));
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Storage rejected the upload (HTTP ${xhr.status}).`));
        };
        xhr.send(file);
      });

      // (3) Token joins the answer value.
      commit([...files, { token: r.token, name: file.name, size: file.size, mime: file.type }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed.";
      setError(msg);
    } finally {
      setUploading(null);
      setProgress(0);
    }
  }

  async function onPick(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    const room = multiple ? maxFiles - files.length : 1;
    const list = Array.from(picked).slice(0, Math.max(0, room));
    if (!multiple && files.length > 0) {
      setError("This field accepts a single file — remove the current one first.");
      return;
    }
    for (const f of list) {
      // Sequential uploads keep progress messages unambiguous.
       
      await uploadFile(f);
      if (!multiple) break;
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  const canAdd = !disabled && !uploading && (multiple ? files.length < maxFiles : files.length === 0);

  /* ── Builder canvas: configuration summary, inert ── */
  if (mode === "builder") {
    return (
      <div className="rounded-xl border-2 border-dashed border-foreground/20 bg-background/60 p-4 text-center">
        <Upload className="mx-auto h-5 w-5 text-muted-foreground/60" aria-hidden />
        <p className="mt-1.5 text-sm font-medium text-foreground/80">File upload</p>
        <p className="text-xs text-muted-foreground">
          {multiple ? `up to ${maxFiles} files · ` : "one file · "}
          {maxSizeMb} MB each{allowSet ? ` · ${allowedTypes.join(", ")}` : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {/* Accepted files */}
      {files.map((f, i) => (
        <div
          key={f.token}
          className="flex items-center gap-2.5 rounded-xl border-2 border-foreground/10 bg-background px-3 py-2.5"
        >
          <FileText className="h-4 w-4 shrink-0 text-[color:var(--memphis-coral)]" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{f.name}</p>
            <p className="text-xs text-muted-foreground">{formatBytes(f.size)}</p>
          </div>
          {!disabled && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => removeAt(i)}
              aria-label={`Remove ${f.name}`}
              className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ))}

      {/* In-flight upload with real progress */}
      {uploading && (
        <div className="rounded-xl border-2 border-foreground/10 bg-background px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
            <p className="min-w-0 flex-1 truncate text-sm text-foreground/80" role="status" aria-live="polite">
              Uploading {uploading}… {progress}%
            </p>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/10"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div
              className="h-full rounded-full bg-[color:var(--memphis-coral)] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Dropzone / picker */}
      {canAdd && (
        <button
          type="button"
          id={id}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void onPick(e.dataTransfer.files);
          }}
          className={cn(
            "flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed p-5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            dragOver
              ? "border-[color:var(--memphis-coral)] bg-[color:var(--memphis-coral)]/8"
              : "border-foreground/25 bg-background/60 hover:border-foreground/40",
          )}
          aria-label={`Upload a file (${maxSizeMb} MB max${allowSet ? `, ${allowedTypes.join(", ")}` : ""})`}
        >
          <Upload className="h-5 w-5 text-muted-foreground/70" aria-hidden />
          <span className="text-sm font-medium text-foreground/85">
            Click to upload <span className="hidden sm:inline">or drag and drop</span>
          </span>
          <span className="text-xs text-muted-foreground">
            {multiple ? `up to ${maxFiles} files · ` : "one file · "}
            {maxSizeMb} MB each{allowSet ? ` · ${allowedTypes.join(", ")}` : ""}
          </span>
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            multiple={multiple}
            accept={allowSet ? allowedTypes.join(",") : undefined}
            onChange={(e) => void onPick(e.target.files)}
            tabIndex={-1}
            aria-hidden="true"
          />
        </button>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-xs font-medium text-destructive" role="alert">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
