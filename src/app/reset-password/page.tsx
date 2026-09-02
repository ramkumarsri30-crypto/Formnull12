"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AuthShell } from "@/features/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});

  function validate(): boolean {
    const next: typeof errors = {};
    if (!password) next.password = "Password is required.";
    else if (password.length < 8)
      next.password = "Password must be at least 8 characters.";
    if (!confirm) next.confirm = "Please confirm your password.";
    else if (password !== confirm) next.confirm = "Passwords don't match.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);

    const { error } = await supabaseBrowser.auth.updateUser({ password });

    setLoading(false);

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("weak") || msg.includes("password")) {
        toast.error("Password is too weak.", {
          description: "Use at least 8 characters with a mix of letters and numbers.",
        });
      } else if (msg.includes("same") || msg.includes("already")) {
        toast.error("New password must be different from your current one.");
      } else {
        toast.error("Could not update password.", { description: error.message });
      }
      return;
    }

    toast.success("Password updated!", {
      description: "Please sign in with your new password.",
    });
    await supabaseBrowser.auth.signOut();
    router.push("/signin");
    router.refresh();
  }

  return (
    <AuthShell
      title="Set a new password"
      subtitle="Choose a strong password for your FormNull account."
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "password-error" : "password-hint"}
            className="h-11"
          />
          {errors.password ? (
            <p id="password-error" className="text-xs font-medium text-destructive">
              {errors.password}
            </p>
          ) : (
            <p id="password-hint" className="text-xs text-muted-foreground">
              Use 8+ characters with a mix of letters and numbers.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm new password</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            placeholder="Re-enter your new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={loading}
            aria-invalid={!!errors.confirm}
            aria-describedby={errors.confirm ? "confirm-error" : undefined}
            className="h-11"
          />
          {errors.confirm && (
            <p id="confirm-error" className="text-xs font-medium text-destructive">
              {errors.confirm}
            </p>
          )}
        </div>

        <Button
          type="submit"
          variant="memphis-coral"
          size="lg"
          className="w-full"
          disabled={loading}
        >
          {loading ? "Updating password…" : "Update password"}
        </Button>
      </form>
    </AuthShell>
  );
}
