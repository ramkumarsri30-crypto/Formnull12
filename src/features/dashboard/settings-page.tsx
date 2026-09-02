"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/auth-provider";
import { useWorkspace } from "@/features/dashboard/use-workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  GeometricCircle,
  GeometricTriangle,
} from "@/components/memphis/memphis-decorations";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Workspace = Database["public"]["Tables"]["workspaces"]["Row"];

/**
 * Settings page.
 *
 * Phase 1 surfaces:
 *   - Profile: display_name, email (read-only)
 *   - Workspace: name, description
 *
 * All updates go through Supabase with RLS — the user can only update
 * their own profile and (if editor+) their workspace.
 *
 * The profile/workspace forms are split into separate components with
 * a `key` prop so they re-initialize state when the underlying data
 * changes — no setState-in-effect needed.
 */
export function SettingsPage() {
  const { user, profile, refreshProfile } = useAuth();
  const { currentWorkspace, reload: reloadWorkspace } = useWorkspace();

  const handleSaveProfile = async (displayName: string): Promise<boolean> => {
    if (!user) return false;
    const { error } = await supabaseBrowser
      .from("profiles")
      .update({ display_name: displayName.trim() || null })
      .eq("id", user.id);
    if (error) {
      toast.error("Could not save profile.", { description: error.message });
      return false;
    }
    await refreshProfile();
    return true;
  };

  const handleSaveWorkspace = async (
    name: string,
    description: string,
  ): Promise<boolean> => {
    if (!currentWorkspace) return false;
    const { error } = await supabaseBrowser
      .from("workspaces")
      .update({
        name: name.trim(),
        description: description.trim() || null,
      })
      .eq("id", currentWorkspace.id);
    if (error) {
      toast.error("Could not save workspace.", { description: error.message });
      return false;
    }
    await reloadWorkspace();
    return true;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage your profile and workspace.
        </p>
      </div>

      {/* Profile section */}
      <ProfileForm
        key={profile?.id ?? "no-profile"}
        profile={profile}
        userEmail={user?.email ?? ""}
        onSave={handleSaveProfile}
      />

      {/* Workspace section */}
      {currentWorkspace ? (
        <WorkspaceForm
          key={currentWorkspace.id}
          workspace={currentWorkspace}
          onSave={handleSaveWorkspace}
        />
      ) : (
        <section className="rounded-2xl border-2 border-dashed border-foreground/15 bg-surface/50 p-8 text-center">
          <h2 className="font-display text-lg font-bold">Workspace</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your workspace will appear here once database migrations are applied.
          </p>
        </section>
      )}

      {/* Danger zone — sign out everywhere */}
      <section className="rounded-2xl border-2 border-destructive/30 bg-destructive/5 p-5 sm:p-6">
        <h2 className="font-display text-lg font-bold text-destructive">Danger zone</h2>
        <p className="mb-4 mt-1 text-xs text-muted-foreground">
          Sign out of all devices and sessions.
        </p>
        <Button
          variant="outline"
          onClick={async () => {
            await supabaseBrowser.auth.signOut({ scope: "others" });
            toast.success("Signed out of other devices.");
          }}
        >
          Sign out other sessions
        </Button>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ProfileForm — uses key-based remount for state init                 */
/* ------------------------------------------------------------------ */
function ProfileForm({
  profile,
  userEmail,
  onSave,
}: {
  profile: Profile | null;
  userEmail: string;
  onSave: (displayName: string) => Promise<boolean>;
}) {
  // useState initializer only runs once (when component mounts).
  // Parent uses key={profile.id} to remount when profile changes.
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const ok = await onSave(displayName);
    setSaving(false);
    if (ok) toast.success("Profile updated.");
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border-2 border-foreground/10 bg-surface p-5 sm:p-6">
      <GeometricCircle color="coral" size={28} className="-top-3 -right-3 opacity-80" />
      <div className="relative">
        <h2 className="font-display text-lg font-bold">Profile</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Your personal account information.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="display_name">Display name</Label>
            <Input
              id="display_name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              disabled={saving}
              className="h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={userEmail}
              readOnly
              disabled
              className="h-11 bg-muted/30"
            />
            <p className="text-xs text-muted-foreground">
              Email changes require verification. Coming in Phase 2.
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={save} variant="memphis-coral" disabled={saving}>
            {saving ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* WorkspaceForm — uses key-based remount for state init               */
/* ------------------------------------------------------------------ */
function WorkspaceForm({
  workspace,
  onSave,
}: {
  workspace: Workspace;
  onSave: (name: string, description: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const ok = await onSave(name, description);
    setSaving(false);
    if (ok) toast.success("Workspace updated.");
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border-2 border-foreground/10 bg-surface p-5 sm:p-6">
      <GeometricTriangle color="mint" size={28} rotate={-15} className="-top-3 -right-3 opacity-80" />
      <div className="relative">
        <h2 className="font-display text-lg font-bold">Workspace</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Forms belong to this workspace. Rename or describe it below.
        </p>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ws_name">Workspace name</Label>
            <Input
              id="ws_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              className="h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ws_desc">Description</Label>
            <Textarea
              id="ws_desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              disabled={saving}
              placeholder="What is this workspace for?"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-foreground/10 bg-background p-3">
              <p className="text-xs text-muted-foreground">Plan</p>
              <p className="text-sm font-semibold capitalize">{workspace.plan}</p>
            </div>
            <div className="rounded-lg border border-foreground/10 bg-background p-3">
              <p className="text-xs text-muted-foreground">Created</p>
              <p className="text-sm font-semibold">
                {new Date(workspace.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={save} variant="memphis-coral" disabled={saving}>
            {saving ? "Saving…" : "Save workspace"}
          </Button>
        </div>
      </div>
    </section>
  );
}
