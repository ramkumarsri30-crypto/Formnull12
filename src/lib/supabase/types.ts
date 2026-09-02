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
  | "section" | "page_break" | "signature" | "address" | "matrix";
export type SubmissionStatus = "pending" | "completed" | "flagged" | "rejected";
export type AssetKind =
  | "avatar" | "workspace_logo" | "form_asset"
  | "submission_upload" | "export" | "inline_image";

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
    };
    Views: Record<string, never>;
    Functions: {
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
