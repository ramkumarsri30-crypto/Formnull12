/**
 * FormNull — Supabase Database Type Definitions
 * =====================================================================
 * Provides type-safe access to tables. Kept in sync with the SQL
 * migrations in supabase/migrations/. Update this file whenever a
 * migration changes the schema.
 *
 * NOTE: For full type inference, the user should run
 *   `supabase gen types typescript --project-id sqtolkfjnskyxnltuyci`
 * after applying migrations. The types below are hand-written to match
 * the migrations for development convenience.
 */

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";
export type WorkspacePlan = "free" | "pro" | "business" | "enterprise";
export type FormStatus = "draft" | "published" | "paused" | "archived";
export type FieldType =
  | "short_text" | "long_text" | "email" | "url" | "phone"
  | "number" | "decimal" | "boolean" | "single_select" | "multi_select"
  | "date" | "datetime" | "time" | "rating" | "scale" | "file_upload"
  | "section" | "page_break" | "signature" | "address" | "matrix"
  // Field Expansion phase (migration 008 — enum values added by
  // ALTER TYPE; fields of these types cannot be created until 008
  // is applied, which the builder detects via a runtime capability
  // probe and gates the library entries honestly):
  | "contact_info" | "payment" | "scheduler" | "embed";
export type SubmissionStatus = "pending" | "completed" | "flagged" | "rejected";
export type AssetKind =
  | "avatar" | "workspace_logo" | "form_asset"
  | "submission_upload" | "export" | "inline_image";
export type FormUploadStatus = "pending" | "attached" | "orphaned";
export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded";
export type BookingStatus = "booked" | "cancelled";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          avatar_path: string | null;
          default_workspace_id: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          avatar_path?: string | null;
          default_workspace_id?: string | null;
          metadata?: Record<string, unknown>;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      workspaces: {
        Row: {
          id: string;
          slug: string;
          name: string;
          description: string | null;
          avatar_path: string | null;
          owner_id: string;
          plan: WorkspacePlan;
          metadata: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          slug: string;
          name: string;
          description?: string | null;
          avatar_path?: string | null;
          owner_id: string;
          plan?: WorkspacePlan;
          metadata?: Record<string, unknown>;
        };
        Update: Partial<Database["public"]["Tables"]["workspaces"]["Insert"]>;
        Relationships: [];
      };
      workspace_members: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          role: WorkspaceRole;
          invited_email: string | null;
          joined_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          user_id: string;
          role?: WorkspaceRole;
          invited_email?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["workspace_members"]["Insert"]>;
        Relationships: [];
      };
      forms: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          description: string | null;
          status: FormStatus;
          public_key: string;
          published_version: number | null;
          settings: Record<string, unknown>;
          metadata: Record<string, unknown>;
          created_by: string;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          name: string;
          description?: string | null;
          status?: FormStatus;
          public_key?: string;
          published_version?: number | null;
          settings?: Record<string, unknown>;
          metadata?: Record<string, unknown>;
          created_by: string;
          updated_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["forms"]["Insert"]>;
        Relationships: [];
      };
      form_fields: {
        Row: {
          id: string;
          form_id: string;
          field_key: string;
          field_type: FieldType;
          label: string;
          description: string | null;
          placeholder: string | null;
          help_text: string | null;
          is_required: boolean;
          is_unique: boolean;
          is_searchable: boolean;
          config: Record<string, unknown>;
          visibility: Record<string, unknown>;
          sort_order: number;
          width: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          form_id: string;
          field_key: string;
          field_type: FieldType;
          label: string;
          description?: string | null;
          placeholder?: string | null;
          help_text?: string | null;
          is_required?: boolean;
          is_unique?: boolean;
          is_searchable?: boolean;
          config?: Record<string, unknown>;
          visibility?: Record<string, unknown>;
          sort_order?: number;
          width?: number;
        };
        Update: Partial<Database["public"]["Tables"]["form_fields"]["Insert"]>;
        Relationships: [];
      };
      form_versions: {
        Row: {
          id: string;
          form_id: string;
          version_number: number;
          schema_snapshot: Record<string, unknown>;
          notes: string | null;
          published_by: string;
          created_at: string;
        };
        Insert: {
          form_id: string;
          version_number: number;
          schema_snapshot: Record<string, unknown>;
          notes?: string | null;
          published_by: string;
        };
        Update: never;
        Relationships: [];
      };
      submissions: {
        Row: {
          id: string;
          form_id: string;
          workspace_id: string;
          submission_seq: number;
          status: SubmissionStatus;
          submitted_by: string | null;
          submitter_email: string | null;
          submitter_ip: string | null;
          submitter_user_agent: string | null;
          metadata: Record<string, unknown>;
          duration_ms: number | null;
          is_complete: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          form_id: string;
          workspace_id?: string;
          submission_seq?: number;
          status?: SubmissionStatus;
          submitted_by?: string | null;
          submitter_email?: string | null;
          metadata?: Record<string, unknown>;
          duration_ms?: number | null;
          is_complete?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["submissions"]["Insert"]>;
        Relationships: [];
      };
      submission_values: {
        Row: {
          id: string;
          submission_id: string;
          form_id: string;
          field_id: string;
          field_key: string;
          value: unknown;
          value_text: string | null;
          value_number: number | null;
          value_boolean: boolean | null;
          created_at: string;
        };
        Insert: {
          submission_id: string;
          form_id?: string;
          field_id: string;
          field_key: string;
          value?: unknown;
        };
        Update: Partial<Database["public"]["Tables"]["submission_values"]["Insert"]>;
        Relationships: [];
      };
      assets: {
        Row: {
          id: string;
          workspace_id: string | null;
          form_id: string | null;
          submission_id: string | null;
          owner_id: string;
          kind: AssetKind;
          bucket: string;
          storage_path: string;
          original_filename: string | null;
          mime_type: string | null;
          size_bytes: number;
          width: number | null;
          height: number | null;
          checksum: string | null;
          is_public: boolean;
          metadata: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id?: string | null;
          form_id?: string | null;
          submission_id?: string | null;
          owner_id: string;
          kind: AssetKind;
          bucket: string;
          storage_path: string;
          original_filename?: string | null;
          mime_type?: string | null;
          size_bytes?: number;
          width?: number | null;
          height?: number | null;
          checksum?: string | null;
          is_public?: boolean;
          metadata?: Record<string, unknown>;
        };
        Update: Partial<Database["public"]["Tables"]["assets"]["Insert"]>;
        Relationships: [];
      };
      form_uploads: {
        Row: {
          id: string;
          token: string;
          workspace_id: string;
          form_id: string;
          field_key: string;
          bucket: string;
          storage_path: string;
          original_name: string;
          mime_type: string;
          size_bytes: number;
          ip_hash: string | null;
          status: FormUploadStatus;
          submission_id: string | null;
          created_at: string;
          attached_at: string | null;
        };
        Insert: {
          workspace_id: string;
          form_id: string;
          field_key: string;
          bucket?: string;
          storage_path: string;
          original_name: string;
          mime_type: string;
          size_bytes: number;
          status?: FormUploadStatus;
        };
        Update: Partial<Database["public"]["Tables"]["form_uploads"]["Insert"]>;
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          workspace_id: string;
          form_id: string;
          submission_id: string | null;
          field_key: string;
          provider: string;
          provider_ref: string | null;
          amount_cents: number;
          currency: string;
          status: PaymentStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          form_id: string;
          field_key: string;
          provider?: string;
          provider_ref?: string | null;
          amount_cents: number;
          currency: string;
          status?: PaymentStatus;
        };
        Update: Partial<Database["public"]["Tables"]["payments"]["Insert"]>;
        Relationships: [];
      };
      bookings: {
        Row: {
          id: string;
          workspace_id: string;
          form_id: string;
          submission_id: string | null;
          field_key: string;
          start_at: string;
          end_at: string;
          timezone: string;
          status: BookingStatus;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          form_id: string;
          field_key: string;
          start_at: string;
          end_at: string;
          timezone: string;
          status?: BookingStatus;
        };
        Update: Partial<Database["public"]["Tables"]["bookings"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      /**
       * Atomic workspace creation (migration 005).
       * SECURITY DEFINER RPC: inserts workspace + owner membership in one
       * transaction. Only takes a name/description — the owner is always
       * auth.uid(), so cross-tenant membership creation is impossible.
       */
      create_workspace: {
        Args: { p_name: string; p_description?: string | null };
        Returns: Database["public"]["Tables"]["workspaces"]["Row"];
      };
      fn_user_workspace_role: {
        Args: { p_workspace_id: string };
        Returns: WorkspaceRole | null;
      };
      fn_user_is_workspace_member: {
        Args: { p_workspace_id: string };
        Returns: boolean;
      };
      fn_user_can_edit_workspace: {
        Args: { p_workspace_id: string };
        Returns: boolean;
      };
      fn_user_can_admin_workspace: {
        Args: { p_workspace_id: string };
        Returns: boolean;
      };
      fn_user_owns_workspace: {
        Args: { p_workspace_id: string };
        Returns: boolean;
      };
      /**
       * Publish the form as an immutable version snapshot + flip status
       * to 'published' (migration 006). SECURITY DEFINER RPC: re-checks
       * editor rights server-side; validates every field's config;
       * enforces the 300-field / 512KiB-snapshot caps; rejects forms
       * containing file_upload fields (anonymous uploads arrive later).
       */
      publish_form: {
        Args: { p_form_id: string };
        Returns: { public_key: string; version: number };
      };
      /**
       * Snapshot-only public read (migration 006): name, description,
       * settings, version, status, published_at + the frozen fields
       * array (key/type/label/description/placeholder/help_text/
       * required/config/sort_order/width). Serves 'published' and
       * 'paused' forms; unknown keys → NOT_FOUND (no existence oracle).
       */
      get_public_form: {
        Args: { p_public_key: string };
        Returns: Record<string, unknown>;
      };
      /**
       * Anonymous submission (migration 006): validates every answer
       * against the published snapshot (14 submittable types), rate
       * limits 20/10min per hashed IP, honeypot-first fake success,
       * atomic submission + values insert, server-derived
       * workspace_id/submitted_by. Returns ok + sequential reference.
       */
      submit_public_form: {
        Args: {
          p_public_key: string;
          p_values: Record<string, unknown>;
          p_honeypot?: string | null;
          p_meta?: Record<string, unknown> | null;
        };
        Returns: { ok: boolean; reference: number | null };
      };
      /**
       * Anonymous upload intent (migration 008): validates a file
       * against the PUBLISHED snapshot's file_upload/signature field
       * config (size + allowed types) BEFORE any bytes move, bounds
       * pending uploads per hashed IP, and returns an unguessable
       * token + pending/ storage path the client uploads to with the
       * anon key (bucket policy allows writes only under pending/).
       */
      create_upload_intent: {
        Args: {
          p_public_key: string;
          p_field_key: string;
          p_file_name: string;
          p_mime_type: string;
          p_size_bytes: number;
        };
        Returns: {
          token: string;
          path: string;
          max_bytes: number;
        };
      };
      /**
       * Payment intent (migration 008): creates a PENDING payments row
       * for a published payment field. The charge itself runs through
       * Stripe Checkout from the app's /api/payments/checkout route
       * (requires STRIPE_SECRET_KEY); submit_public_form refuses to
       * store a required-payment submission until the webhook marks the
       * matching provider_ref succeeded. Nothing is faked.
       */
      create_payment_intent: {
        Args: {
          p_public_key: string;
          p_field_key: string;
          p_provider_ref: string;
        };
        Returns: {
          payment_id: string;
          amount_cents: number;
          currency: string;
        };
      };
    };
    Enums: {
      workspace_role: WorkspaceRole;
      workspace_plan: WorkspacePlan;
      form_status: FormStatus;
      field_type: FieldType;
      submission_status: SubmissionStatus;
      asset_kind: AssetKind;
    };
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
